// One-time bootstrap: creates (or repairs) a guidance/admin account.
// NO secret key: anyone who can reach /api/setup-account can use it.
// Delete api/setup-account.js and setup.html as soon as you are done.
const { readBody } = require('./_auth');

const API_KEY    = process.env.FIREBASE_API_KEY    || 'AIzaSyD4N8D_FT_Oy8umm_79tQJiy24uWxbJ_KA';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'qhsafety-57c55';

const idt = (path, body) => fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${API_KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { role, email, password } = readBody(req);
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!['guidance', 'admin'].includes(role)) return res.status(400).json({ error: 'Role must be guidance or admin.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (!password || String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    let existed = false;
    let r = await idt('accounts:signUp', { email: cleanEmail, password, returnSecureToken: true });
    let data = await r.json();

    if (!r.ok && data?.error?.message === 'EMAIL_EXISTS') {
      // Account already exists: sign in with the given password and just fix its role
      existed = true;
      r = await idt('accounts:signInWithPassword', { email: cleanEmail, password, returnSecureToken: true });
      data = await r.json();
      if (!r.ok) return res.status(400).json({ error: 'That email already exists and the password does not match it. Reset its password in Firebase Console → Authentication, then try again.' });
    } else if (!r.ok) {
      return res.status(400).json({ error: 'Firebase: ' + (data?.error?.message || 'could not create account') });
    }

    const { localId, idToken } = data;
    const mask = ['email', 'role', 'createdAt'].map(f => `updateMask.fieldPaths=${f}`).join('&');
    const w = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${localId}?${mask}`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: {
          email: { stringValue: cleanEmail },
          role: { stringValue: role },
          createdAt: { integerValue: String(Date.now()) },
        } }),
      }
    );
    if (!w.ok) {
      const t = await w.text();
      return res.status(502).json({ error: 'Account exists but the role could not be saved (check Firestore rules for /users): ' + t.slice(0, 200) });
    }
    return res.status(200).json({ ok: true, email: cleanEmail, role, existed });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
