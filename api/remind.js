// api/remind.js — reminds the guidance office about serious items nobody has answered yet.
// Unlike the banner inside the app, this runs on the server, so it works at night and on weekends
// when no counselor has the app open.
//
// Switch it on (all in Vercel → Settings → Environment Variables):
//   FIREBASE_SERVICE_ACCOUNT  the full JSON of a service-account key
//                             (Firebase Console → Project settings → Service accounts → Generate new private key)
//   CRON_SECRET               any long random string; Vercel Cron sends it automatically,
//                             an outside scheduler must send it as  Authorization: Bearer <secret>
// It reuses ONESIGNAL_REST_API_KEY and the EMAILJS_* / GUIDANCE_EMAIL variables you already have.
// Without FIREBASE_SERVICE_ACCOUNT it answers "not configured" and does nothing.
const crypto = require('crypto');

const OVERDUE_MIN = { High: 30, Medium: 240 };   // keep in step with OVERDUE_MIN in app.js
const REPEAT_HOURS = 3;                          // do not nag about the same item more often than this
const LOOKBACK_DAYS = 14;
const APP_ID = process.env.ONESIGNAL_APP_ID || 'b6d94be7-713f-4369-8b1f-2df77580872c';
const SITE = process.env.SITE_URL || 'https://qh-safety.vercel.app';

// ── Firestore REST value <-> plain JS ──
function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return null;
}
function decodeFields(fields) { const o = {}; Object.keys(fields || {}).forEach(k => { o[k] = decode(fields[k]); }); return o; }

// Same rule the app uses: is a counselor's reply still owed?
function needsReply(item, kind) {
  if (kind === 'consultations' && item.status === 'Done') return false;
  const last = (Array.isArray(item.chatMessages) ? item.chatMessages : []).filter(m => m && !m.isSystem).pop();
  if (last) return last.role !== 'guidance';
  return !item.guidanceMessage;
}
function pickOverdue(items, kind, now) {
  return items.filter(i => {
    const limit = OVERDUE_MIN[i.riskLevel];
    if (!limit || !needsReply(i, kind)) return false;
    if (now - (Number(i.timestamp) || now) < limit * 60000) return false;
    return now - (Number(i.lastReminderAt) || 0) >= REPEAT_HOURS * 3600000;
  });
}

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(8000),
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + unsigned + '.' + sig,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error('Google sign-in for the service account failed: ' + (d.error_description || d.error || r.status));
  return d.access_token;
}

async function handler(req, res) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || (req.headers['authorization'] || '') !== 'Bearer ' + secret) return res.status(401).json({ error: 'Unauthorized' });
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) return res.status(200).json({ ok: false, reason: 'not configured: set FIREBASE_SERVICE_ACCOUNT' });
    let sa; try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT); } catch (e) { return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT is not valid JSON' }); }
    const projectId = sa.project_id, token = await accessToken(sa);
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    const now = Date.now(), since = now - LOOKBACK_DAYS * 86400000;

    const fetchRecent = async (col) => {
      const r = await fetch(base + ':runQuery', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(9000),
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: 'timestamp' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(since) } } }, limit: 400 } }),
      });
      const rows = await r.json().catch(() => []);
      if (!r.ok) throw new Error('Firestore query failed for ' + col + ': ' + JSON.stringify(rows).slice(0, 200));
      return (Array.isArray(rows) ? rows : []).filter(x => x.document).map(x => Object.assign(decodeFields(x.document.fields), { _name: x.document.name }));
    };
    const [postings, consultations] = await Promise.all([fetchRecent('postings'), fetchRecent('consultations')]);
    const due = pickOverdue(postings, 'postings', now).map(i => ({ i, kind: 'Posting' })).concat(pickOverdue(consultations, 'consultations', now).map(i => ({ i, kind: 'Consultation' })));
    if (!due.length) return res.status(200).json({ ok: true, reminded: 0 });

    const high = due.filter(d => d.i.riskLevel === 'High').length;
    const title = `${due.length} ${due.length === 1 ? 'item is' : 'items are'} still waiting for a reply`;
    const message = (high ? `${high} high-risk. ` : '') + 'Open QHsafety to respond.';
    const sent = { push: false, email: false };

    if (process.env.ONESIGNAL_REST_API_KEY) {
      const r = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Key ' + process.env.ONESIGNAL_REST_API_KEY }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ app_id: APP_ID, headings: { en: 'QHsafety: ' + title }, contents: { en: message }, url: SITE, priority: 10, ttl: 3600, filters: [{ field: 'tag', key: 'user_role', relation: '=', value: 'guidance' }] }),
      }).catch(() => null);
      sent.push = !!(r && r.ok);
    }
    const E = process.env;
    if (E.EMAILJS_PUBLIC_KEY && E.EMAILJS_SERVICE_ID && E.EMAILJS_GUIDANCE_TEMPLATE && E.GUIDANCE_EMAIL) {
      const worst = due.slice().sort((a, b) => (a.i.riskLevel === 'High' ? -1 : 1) - (b.i.riskLevel === 'High' ? -1 : 1))[0];
      const r = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
        body: JSON.stringify({ service_id: E.EMAILJS_SERVICE_ID, template_id: E.EMAILJS_GUIDANCE_TEMPLATE, user_id: E.EMAILJS_PUBLIC_KEY, template_params: {
          to_email: E.GUIDANCE_EMAIL, to_name: 'Guidance Counselor', alert_type: 'Reminder — ' + title, author: 'QHsafety reminder',
          reason: worst.kind + ': ' + String(worst.i.title || worst.i.reason || '').slice(0, 120), description: message + ' The oldest waiting item was sent ' + new Date(Math.min.apply(null, due.map(d => Number(d.i.timestamp) || now))).toISOString() + '.',
          ai_score: worst.i.aiScore == null ? '' : worst.i.aiScore, risk_level: worst.i.riskLevel, risk_reasons: (worst.i.reasons || []).join(', '), app_url: SITE, sent_at: new Date().toLocaleString() } }),
      }).catch(() => null);
      sent.email = !!(r && r.ok);
    }
    // remember that we reminded, so the next run does not repeat it straight away
    if (sent.push || sent.email) await Promise.all(due.map(d => fetch('https://firestore.googleapis.com/v1/' + d.i._name + '?updateMask.fieldPaths=lastReminderAt', {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ fields: { lastReminderAt: { integerValue: String(now) } } }),
    }).catch(() => null)));
    return res.status(200).json({ ok: true, reminded: due.length, high, sent });
  } catch (e) {
    console.error('[remind]', e);
    return res.status(500).json({ error: e.message });
  }
}
module.exports = handler;
module.exports._test = { decode, decodeFields, needsReply, pickOverdue, accessToken };
