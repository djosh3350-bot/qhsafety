# QHsafety

Static front-end (`index.html` + `app.js`) with Vercel serverless functions in `/api`.

## Environment variables (Vercel → Settings → Environment Variables)
`GROQ_API_KEY`, `ONESIGNAL_REST_API_KEY`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`,
`EMAILJS_STUDENT_TEMPLATE`, `EMAILJS_GUIDANCE_TEMPLATE`, `GUIDANCE_EMAIL`

Temporary: `/setup` creates guidance/admin accounts with no key. Delete `setup.html` and `api/setup-account.js` when finished.

## Notes
- API routes now require a signed-in Firebase user (`Authorization: Bearer <idToken>`); mass broadcasts,
  stats and student emails are staff-only.
- `OneSignalSDKWorker.js` must stay at the site root (no rewrite needed).
