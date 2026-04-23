module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Notification id is required' });
    }

    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No API key' });
    }

    const APP_ID = "b6d94be7-713f-4369-8b1f-2df77580872c";
    const response = await fetch(
      `https://api.onesignal.com/notifications/${id}?app_id=${APP_ID}`,
      {
        headers: {
          "Authorization": `Key ${apiKey}`
        }
      }
    );

    const data = await response.json();
    return res.status(200).json(data);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
