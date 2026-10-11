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
| `api/remind.js` | Server-side reminder about unanswered serious items (off until configured — see below) |
| `manifest.json`, `icons/` | Lets phones install the site as an app |
| `tests/` | `node tests/risk.test.js` (340 checks on risk detection and the language filter) and `node tests/remind.test.js` (13 checks on the reminder) |

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

## Anonymous mode — one-time setup
"Continue without an account" needs **Authentication → Sign-in method → Anonymous → Enable** in the Firebase console.
Until then the button shows "This sign-in method is not switched on yet". An anonymous student's posts are tied to
that browser on that device; clearing browser data or logging in with an email on the same device loses access to them.
The updated `firestore.rules` already allows anonymous students to see only their own items.

## Things to edit for your school (top of the "FEATURES ADDED IN v9" section in `app.js`)
- `HELP_CONTACTS.school` — the guidance office's phone number, room and hours shown on the help screen (phone is blank now).
- `HELP_CONTACTS.lines` — hotline numbers. Checked October 2026; re-check them once a year.
- `IDLE_LIMIT_MIN` — minutes before an idle session is signed out (students 15, staff 30).
- `OVERDUE_MIN` — how long a High (30 min) or Medium (4 h) item may wait before counselors are reminded.

## What was added in v9
Students: help screen with hotlines (always one tap away, and shown automatically after a serious post), anonymous mode,
"sent / seen / replied" status, "counselor is typing", unread badges, reports about someone else, Filipino for the
consultation screens. Counselors: assign to me, filters and consultation search, "waited too long" banner, case history
per student, monthly report with CSV export and print. Admin: storage page, reports. Everyone: sign-out when idle,
photos shrunk in the browser before upload, new logo.

Limits worth knowing: the "waited too long" reminder only runs while a counselor has the app open (there is no
server job); case history covers the most recent 150 postings and consultations; counselor-only screens are still
mostly in English; attachments still live inside Firestore documents (now much smaller) rather than Firebase Storage.

## What was added in v10
- **After-hours notice** — students posting outside `SCHOOL_HOURS` are told when to expect a reply and pointed to the hotlines.
- **Follow-up reminders** — "Remind me to follow up" on every item; due ones are listed on the counselor dashboard.
- **Saved replies** — shared templates under every reply box; counselors edit them in Settings.
- **Install as an app** — home-screen icon and full-screen mode; an Install card appears in Settings when the browser allows it.
- **Library** — six short self-help guides in English and Filipino (`LIBRARY` in `app.js`). They are general advice written
  for this app: **have your counselors read and edit them before students see them.**
- **Mood check-in** — one tap a day on the student dashboard. Stored only in that browser; counselors cannot see it.
- **Appointment slots** — counselors publish open times on the Consultations page; a student with a pending consultation books one.
- **Announcements board** — sent announcements stay readable on the dashboard.
- **Filipino for staff screens** — a phrase dictionary (`TL_UI`) translates counselor and admin screens. Pop-up messages and
  anything not in the dictionary stay in English; add phrases to `TL_UI` as you find them.
- **Server-side reminders** — `api/remind.js`.

Also editable near the top of the v10 section in `app.js`: `SCHOOL_HOURS` and `DEFAULT_TEMPLATES`.

## Server-side reminders — optional setup
`/api/remind` emails and pushes the guidance office about High (30 min) and Medium (4 h) items nobody has answered,
at most once every 3 hours per item. It does nothing until you add two variables on Vercel:
1. `FIREBASE_SERVICE_ACCOUNT` — Firebase Console → Project settings → Service accounts → Generate new private key;
   paste the whole JSON file as the value. **Treat this key like a password: it can read and change everything in the database.**
2. `CRON_SECRET` — any long random string.

`vercel.json` schedules it once a day (7 AM Manila), which is what Vercel's free plan allows. For reminders every 15 minutes,
use a free outside scheduler (for example cron-job.org) to call `https://YOUR-SITE/api/remind` with the header
`Authorization: Bearer <your CRON_SECRET>`. This endpoint was tested against stand-ins for Google, OneSignal and EmailJS,
not against your live project — run it once by hand after setup and check the JSON it returns.

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
- When you deploy a change, bump `?v=10` on the two script tags at the bottom of `index.html`.
- Icons: Lucide v0.263 (ISC License), inlined in `app.js`.
