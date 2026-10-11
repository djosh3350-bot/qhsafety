// Shared helper: verifies the Firebase ID token sent by the app and looks up the caller's role.
// Uses Google's public REST endpoints, so no service-account secret is needed.
// Optional env: FIREBASE_API_KEY, FIREBASE_PROJECT_ID (defaults match the app's public config).
const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyD4N8D_FT_Oy8umm_79tQJiy24uWxbJ_KA';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'qhsafety-57c55';
const BOOTSTRAP_ADMINS = ['admin@qhsafety.demo', 'youradminemail@gmail.com'];

const cache = new Map(); // token -> { user, exp }  (keeps repeat calls fast, 60s)

async function getUser(req) {
  const header = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return null;
  const token = m[1];

  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  try {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const u = data && data.users && data.users[0];
    if (!u) return null;

    const email = (u.email || '').toLowerCase();
    let role = 'student';
    try {
      const d = await fetch(
        `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${u.localId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (d.ok) {
        const doc = await d.json();
        const val = doc && doc.fields && doc.fields.role && doc.fields.role.stringValue;
        if (val) role = val;
        else if (BOOTSTRAP_ADMINS.includes(email)) role = 'admin';
      } else if (BOOTSTRAP_ADMINS.includes(email)) role = 'admin';
    } catch (e) { if (BOOTSTRAP_ADMINS.includes(email)) role = 'admin'; }

    const user = { uid: u.localId, email, role };
    if (cache.size > 200) cache.clear();
    cache.set(token, { user, exp: Date.now() + 60000 });
    return user;
  } catch (e) {
    return null;
  }
}

function isStaff(user) { return !!user && (user.role === 'guidance' || user.role === 'admin'); }

// Vercel may hand us a string body or nothing at all
function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return b;
}

module.exports = { getUser, isStaff, readBody };
