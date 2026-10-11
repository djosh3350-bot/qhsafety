const { getUser, isStaff, readBody } = require('./_auth');

const APP_ID = process.env.ONESIGNAL_APP_ID || 'b6d94be7-713f-4369-8b1f-2df77580872c';
const SITE   = 'https://qh-safety.vercel.app';

function safeUrl(u) {
  // only allow links back to our own site (stops the endpoint being used to push phishing links)
  try {
    const x = new URL(u);
    if (x.hostname === 'qh-safety.vercel.app' || x.hostname.endsWith('.vercel.app')) return x.toString();
  } catch (e) {}
  return SITE;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Sign in required' });

    const { title, message, url, target } = readBody(req);
    if (!title || !message) return res.status(400).json({ error: 'title and message are required' });

    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'No API key' });

    const base = {
      app_id: APP_ID,
      headings: { en: String(title).slice(0, 120) },
      contents: { en: String(message).slice(0, 500) },
      url: safeUrl(url),
      priority: 10,
      ttl: 86400,
    };

    let payload;
    if (target === 'broadcast') {
      // Mass announcements: staff only (previously anyone on the internet could call this)
      if (!isStaff(user)) return res.status(403).json({ error: 'Forbidden' });
      payload = { ...base, included_segments: ['Total Subscriptions'] };
    } else {
      const role = target === 'student' ? 'student' : 'guidance';
      if (role === 'student' && !isStaff(user)) return res.status(403).json({ error: 'Forbidden' });
      payload = { ...base, filters: [{ field: 'tag', key: 'user_role', relation: '=', value: role }] };
    }

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Key ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : 502).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
