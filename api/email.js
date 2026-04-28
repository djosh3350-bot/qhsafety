// api/email.js — Vercel serverless function
// Handles all EmailJS calls server-side so keys never appear in the browser.
//
// Required environment variables (set in Vercel dashboard → Settings → Environment Variables):
//   EMAILJS_PUBLIC_KEY        e.g. UTo3HGspnevn_DA4e
//   EMAILJS_SERVICE_ID        e.g. service_abcgxwe
//   EMAILJS_STUDENT_TEMPLATE  e.g. template_4682uol
//   EMAILJS_GUIDANCE_TEMPLATE e.g. template_schi35q
//   GUIDANCE_EMAIL            e.g. djosh3350@gmail.com

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    type,           // 'student_reply' | 'consultation_reply' | 'high_risk' | 'reminder'
    to_email,
    to_name,
    post_title,
    guidance_message,
    app_url,
    sent_at,
    // high_risk fields
    alert_type,
    author,
    reason,
    description,
    ai_score,
    risk_level,
    risk_reasons,
  } = req.body;

  const PUBLIC_KEY        = process.env.EMAILJS_PUBLIC_KEY;
  const SERVICE_ID        = process.env.EMAILJS_SERVICE_ID;
  const STUDENT_TEMPLATE  = process.env.EMAILJS_STUDENT_TEMPLATE;
  const GUIDANCE_TEMPLATE = process.env.EMAILJS_GUIDANCE_TEMPLATE;
  const GUIDANCE_EMAIL    = process.env.GUIDANCE_EMAIL;

  if (!PUBLIC_KEY || !SERVICE_ID || !STUDENT_TEMPLATE || !GUIDANCE_TEMPLATE || !GUIDANCE_EMAIL) {
    console.error('[email] Missing one or more EmailJS environment variables');
    return res.status(500).json({ error: 'Email service not configured' });
  }

  if (!type) {
    return res.status(400).json({ error: 'type is required' });
  }

  let templateId;
  let templateParams;

  if (type === 'student_reply' || type === 'consultation_reply' || type === 'reminder') {
    // Email to student
    if (!to_email) return res.status(400).json({ error: 'to_email required' });
    templateId = STUDENT_TEMPLATE;
    templateParams = {
      to_email,
      to_name:          to_name  || to_email.split('@')[0],
      post_title:       post_title || (type === 'consultation_reply' ? 'your consultation' : 'your posting'),
      guidance_message: guidance_message || '',
      app_url:          app_url  || 'https://qh-safety.vercel.app',
      sent_at:          sent_at  || new Date().toLocaleString(),
    };
  } else if (type === 'high_risk') {
    // Alert email to guidance counselor
    templateId = GUIDANCE_TEMPLATE;
    templateParams = {
      to_email:    GUIDANCE_EMAIL,          // always sent to guidance — never exposed to client
      to_name:     'Guidance Counselor',
      alert_type:  alert_type  || 'Submission',
      author:      author      || 'Anonymous',
      reason:      reason      || '',
      description: description || '',
      ai_score:    ai_score    ?? '',
      risk_level:  risk_level  || '',
      risk_reasons: risk_reasons || '',
      app_url:     app_url     || 'https://qh-safety.vercel.app',
      sent_at:     sent_at     || new Date().toLocaleString(),
    };
  } else {
    return res.status(400).json({ error: `Unknown email type: ${type}` });
  }

  try {
    const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id:  SERVICE_ID,
        template_id: templateId,
        user_id:     PUBLIC_KEY,
        template_params: templateParams,
      }),
    });

    const text = await response.text();
    if (!response.ok) {
      console.error('[email] EmailJS error:', text);
      return res.status(502).json({ error: 'EmailJS failed', detail: text });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[email] Fetch error:', e);
    return res.status(500).json({ error: e.message });
  }
}
