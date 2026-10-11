const { getUser, isStaff } = require('./_auth');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const user = await getUser(req);
    if (!isStaff(user)) return res.status(user ? 403 : 401).json({ error: 'Forbidden' });

    const { id } = req.query || {};
    if (!id || !/^[0-9a-fA-F-]{8,64}$/.test(String(id))) {
      return res.status(400).json({ error: 'Valid notification id is required' });
    }

    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'No API key' });

    const APP_ID = process.env.ONESIGNAL_APP_ID || 'b6d94be7-713f-4369-8b1f-2df77580872c';
    const response = await fetch(
      `https://api.onesignal.com/notifications/${encodeURIComponent(id)}?app_id=${APP_ID}`,
      { headers: { Authorization: `Key ${apiKey}` } }
    );
    const data = await response.json().catch(() => ({}));
    return res.status(response.ok ? 200 : 502).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
