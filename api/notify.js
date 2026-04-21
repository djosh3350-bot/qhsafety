export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, message, url, reasons, target } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required' });
    }

    const apiKey = process.env.ONESIGNAL_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No API key' });
    }

    const role = target === 'student' ? 'student' : 'guidance';

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Key ${apiKey}`
      },
      // notify.js — fixed

body: JSON.stringify({
  app_id: "4babeeb8-31f4-4cfa-8a8c-d5c109262d78",

  // For "Send to All": use included_segments
  // For role-targeted: use filters
  ...(target === 'all'
    ? { included_segments: ["All"] }
    : { filters: [{ field: "tag", key: "user_role", relation: "=", value: target === 'student' ? 'student' : 'guidance' }] }
  ),

  headings: { en: title },
  contents: { en: message },
  url: url || 'https://qhsafety.vercel.app',
  priority: 10,
  ttl: 86400,
})
    const data = await response.json();
    return res.status(200).json(data);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
