module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { title, message, url, reasons, target } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: 'title and message are required' });
    }

    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'No API key' });
    }

    let notificationPayload;

    if (target === 'broadcast') {
      // ── Broadcast to ALL subscribed students via segment ──
      notificationPayload = {
        app_id: "b6d94be7-713f-4369-8b1f-2df77580872c",
        included_segments: ["Total Subscriptions"],
        headings: { en: title },
        contents: { en: message },
        url: url || 'https://qh-safety.vercel.app',
        priority: 10,
        ttl: 86400,
      };
    } else {
      // ── Targeted push to guidance or student by tag ──
      const role = target === 'student' ? 'student' : 'guidance';
      notificationPayload = {
        app_id: "b6d94be7-713f-4369-8b1f-2df77580872c",
        filters: [{ field: "tag", key: "user_role", relation: "=", value: role }],
        headings: { en: title },
        contents: { en: message },
        url: url || 'https://qh-safety.vercel.app',
        priority: 10,
        ttl: 86400,
      };
    }

    const response = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Key ${apiKey}`
      },
      body: JSON.stringify(notificationPayload)
    });

    const data = await response.json();
    return res.status(200).json(data);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
