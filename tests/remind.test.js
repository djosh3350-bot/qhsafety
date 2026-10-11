// Run with:  node tests/remind.test.js   — checks the server reminder with a fake Google / OneSignal / EmailJS.
const crypto = require('crypto');
const path = require('path');
const handler = require(path.join(__dirname, '..', 'api', 'remind.js'));
const { decode, needsReply, pickOverdue } = handler._test;
let fail = 0, n = 0; const ok = (name, c, extra) => { n++; if (!c) { fail++; console.log('FAIL', name, extra || ''); } };

const now = Date.now(), H = 3600000;
ok('decode nested', JSON.stringify(decode({ mapValue: { fields: { a: { integerValue: '5' }, b: { arrayValue: { values: [{ stringValue: 'x' }, { booleanValue: true }] } } } } })) === '{"a":5,"b":["x",true]}');
ok('unanswered needs reply', needsReply({ chatMessages: [] }, 'postings'));
ok('guidance message counts as a reply', !needsReply({ guidanceMessage: 'hi', chatMessages: [] }, 'postings'));
ok('student wrote last -> needs reply', needsReply({ guidanceMessage: 'hi', chatMessages: [{ role: 'guidance', text: 'a' }, { role: 'student', text: 'b' }] }, 'postings'));
ok('system messages are ignored', needsReply({ chatMessages: [{ role: 'guidance', isSystem: true, text: 'meeting' }] }, 'consultations'));
ok('resolved consultation is skipped', !needsReply({ status: 'Done', chatMessages: [] }, 'consultations'));
const items = [
  { id: 1, riskLevel: 'High', timestamp: now - 2 * H },                                  // overdue
  { id: 2, riskLevel: 'High', timestamp: now - 10 * 60000 },                             // too recent
  { id: 3, riskLevel: 'Medium', timestamp: now - 2 * H },                                // medium waits 4 h
  { id: 4, riskLevel: 'Medium', timestamp: now - 5 * H },                                // overdue
  { id: 5, riskLevel: 'High', timestamp: now - 9 * H, lastReminderAt: now - 1 * H },     // reminded recently
  { id: 6, riskLevel: 'Low', timestamp: now - 99 * H },                                  // low never reminds
  { id: 7, riskLevel: 'High', timestamp: now - 9 * H, guidanceMessage: 'answered' },     // answered
];
ok('picks only the overdue, unanswered, not-recently-reminded items', pickOverdue(items, 'postings', now).map(i => i.id).join() === '1,4', pickOverdue(items, 'postings', now).map(i => i.id).join());

(async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const calls = [];
  const enc = (o) => { const f = {}; for (const k in o) { const v = o[k]; f[k] = typeof v === 'number' ? { integerValue: String(v) } : Array.isArray(v) ? { arrayValue: { values: [] } } : { stringValue: String(v) }; } return f; };
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), method: opts && opts.method, body: opts && opts.body });
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (String(url).includes('oauth2.googleapis.com')) return json({ access_token: 'tok' });
    if (String(url).includes(':runQuery')) {
      const col = JSON.parse(opts.body).structuredQuery.from[0].collectionId;
      return json(col === 'postings' ? [{ document: { name: 'projects/p/databases/(default)/documents/postings/1', fields: enc({ id: 1, title: 'help', riskLevel: 'High', timestamp: now - 2 * H, chatMessages: [] }) } }, { readTime: 'x' }] : []);
    }
    return json({ id: 'n1' });
  };
  const run = async (headers) => { let out = {}; const res = { status(c) { out.code = c; return this; }, json(o) { out.body = o; return this; } }; await handler({ method: 'GET', headers }, res); return out; };

  process.env.CRON_SECRET = 's3cret';
  ok('refuses callers without the secret', (await run({})).code === 401);
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const idle = await run({ authorization: 'Bearer s3cret' });
  ok('does nothing until a service account is configured', idle.code === 200 && idle.body.ok === false && calls.length === 0);

  Object.assign(process.env, { FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: 'p', client_email: 'x@p.iam.gserviceaccount.com', private_key: privateKey }), ONESIGNAL_REST_API_KEY: 'k', EMAILJS_PUBLIC_KEY: 'a', EMAILJS_SERVICE_ID: 'b', EMAILJS_GUIDANCE_TEMPLATE: 'c', GUIDANCE_EMAIL: 'g@school.ph' });
  const done = await run({ authorization: 'Bearer s3cret' });
  ok('reminds about the overdue item', done.code === 200 && done.body.reminded === 1 && done.body.high === 1 && done.body.sent.push && done.body.sent.email, JSON.stringify(done));
  ok('signs in to Google with a signed JWT', calls.some(c => c.url.includes('oauth2') && /assertion=[\w-]+\.[\w-]+\.[\w-]+/.test(c.body)));
  ok('push goes only to counselors', calls.some(c => c.url.includes('onesignal') && /"value":"guidance"/.test(c.body)));
  ok('marks the item as reminded', calls.some(c => c.method === 'PATCH' && c.url.includes('/postings/1?updateMask.fieldPaths=lastReminderAt')));
  console.log(`\n${n - fail}/${n} passed` + (fail ? `, ${fail} FAILED` : ''));
  process.exit(fail ? 1 : 0);
})();
