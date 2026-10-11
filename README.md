# QHsafety

Static front-end (`index.html` + `app.js` + `risk-engine.js`) with Vercel serverless functions in `/api`.

## Files
| File | What it is |
|---|---|
| `index.html` | Page shell and all styles |
| `app.js` | The app (screens, sign-in, Firestore, notifications) |
| `risk-engine.js` | Risk-detection rules and the language filter. Used by the browser, by `/api/analyze`, and by the tests |
| `api/` | Serverless functions: AI analysis, email, push |
| `firestore.rules` | Security rules to paste into the Firebase console |
| `tests/` | `node tests/risk.test.js` — 329 checks on risk detection and the language filter |

## Environment variables (Vercel → Settings → Environment Variables)
`GROQ_API_KEY`, optional `GITHUB_MODELS_TOKEN` (+ `GITHUB_MODELS_MODEL`), optional `ANTHROPIC_API_KEY` (+ `CLAUDE_MODEL`),
`ONESIGNAL_REST_API_KEY`, `EMAILJS_PUBLIC_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_STUDENT_TEMPLATE`,
`EMAILJS_GUIDANCE_TEMPLATE`, `GUIDANCE_EMAIL`

## Google sign-in — one-time setup
The "Continue with Google" button needs two switches in the Firebase console (project `qhsafety-57c55`):
1. **Authentication → Sign-in method → Add new provider → Google → Enable → Save.**
2. **Authentication → Settings → Authorized domains →** make sure your site address (for example `qh-safety.vercel.app`) is listed.

Until step 1 is done the button shows "This sign-in method is not switched on yet".
Students still need an `@gmail.com` address; to allow a school Google Workspace domain, add it to
`STUDENT_EMAIL_DOMAINS` near the top of the sign-in section in `app.js`.
Counselors and admins can use the Google button too, once an account with their email and role exists.

## Do these three things after deploying
1. **Rotate the OneSignal REST API key.** The old `app.js` shipped it to every browser. Create a new key in
   OneSignal → Settings → Keys & IDs, put it in the `ONESIGNAL_REST_API_KEY` variable on Vercel, delete the old one.
2. **Publish `firestore.rules`** (after creating your staff accounts). With the previous rules any signed-in user
   could give themselves the admin role.
3. **Delete `setup.html` and `api/setup-account.js`** — anyone who finds `/setup` can create an admin account.

## How risk detection works
1. A post is saved and shown immediately, rated by the local rules in `risk-engine.js`.
2. `/api/analyze` asks the AI for a second opinion in the background and the rating is updated.
3. Floors the AI cannot lower: a clear threat against others → High; a direct statement of wanting to die → High;
   anything else the local rules rate High → at least Medium.
4. A local High alerts the guidance office at once; Medium/High after the AI answers.
5. Chat replies are checked too. A serious message raises the item's risk and alerts guidance.

Language filter: profanity with no sign of distress is refused; with a mild sign it is posted with the words masked;
with a serious sign (Medium or higher) it is posted as typed, so a student in trouble is never turned away.

To change the rules, edit `risk-engine.js`, add a sentence to `tests/corpus.js`, and run `node tests/risk.test.js`.

## Notes
- API routes require a signed-in Firebase user (`Authorization: Bearer <idToken>`); mass broadcasts,
  stats and student emails are staff-only.
- `OneSignalSDKWorker.js` must stay at the site root (no rewrite needed).
- When you deploy a change, bump `?v=8` on the two script tags at the bottom of `index.html`.
- Icons: Lucide v0.263 (ISC License), inlined in `app.js`.
