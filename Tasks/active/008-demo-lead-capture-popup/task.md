---
id: 008
title: Demo site lead-capture popup (Email, Name, Find from → Google Sheets)
status: active
priority: medium
depends_on: []
created: 2026-11-18
---

# Demo site lead-capture popup

## Goal
When someone visits the public demo (`https://demo.alianhub.com/`), show a one-time popup 1–2 seconds after the home/login page loads, asking for their email, their name and where they heard about AlianHub. Each submission is added as a row in a Google Sheet so the team knows who is trying the demo and which channels bring them.

## Scope
- **Where:** only on the home URL (the login page). Only when the server runs with `DEMO_MODE=true` (the same flag the demo login buttons already use). Real or self-hosted installs never see it.
- **When:** the popup opens 1–2 seconds after the page loads.
- **One time per browser:** once the visitor submits or closes the popup, it does not show again in that browser (remembered in localStorage).
- **Fields:**
  - Email: required, must be a valid email address.
  - Name: required.
  - Find from: required dropdown (changed from optional by the user). Options: a list of tech events (BTE first, then A–Z), then Other. Choosing "Other" shows a small text box. To review the list with the TL later.
- **Closing:** the visitor can close it with the ✕ button, by clicking outside it or by pressing Esc. Closing counts as "seen".
- **Submit:** the frontend calls a new public backend endpoint. The backend validates the input and appends a row to the Google Sheet: timestamp, email, name, find from, other text and the page URL.
- **Google Sheets connection:** a Google Apps Script web app attached to the sheet. Its URL is stored in a new server env var (e.g. `DEMO_LEADS_SHEET_URL`) and called only from the backend, so the URL never appears in the browser. This adds no new npm dependency.
- After a successful submit, show a short thank-you and close the popup.

## Out of scope
- Showing the popup on any page other than the home/login page.
- Saving leads in MongoDB or an admin "leads" screen. The demo DB is reset by cron, so it would lose them anyway.
- Emailing the team about new leads, or sending them to a CRM.
- Making the dropdown options editable from settings.
- Committing or pushing. Changes stay local until the user tests and says otherwise.

## Acceptance criteria
- [ ] With `DEMO_MODE=true`, opening the home URL in a fresh browser shows the popup about 1–2 seconds after load.
- [ ] With `DEMO_MODE=false`, the popup never shows and no request goes to the leads endpoint.
- [ ] Email, Name and Find from are required, and an invalid email shows an error.
- [ ] Choosing "Other" shows a text box, and its value is saved too.
- [ ] A valid submit adds one row to the Google Sheet with all fields plus a timestamp.
- [ ] After a submit or a close (✕, outside click or Esc), reloading the page does not show the popup again.
- [ ] If the Google Sheet call fails or `DEMO_LEADS_SHEET_URL` is not set, the visitor gets a simple message (or a quiet close), and login and every other screen keep working.
- [ ] The existing login form, the demo "Login as Owner/Admin" / "Login as Member" buttons, the demo banner and every other existing flow behave exactly as before.
- [ ] The popup works and reads well on mobile width.
- [ ] Nothing is committed or pushed.

## Constraints & notes
- **Hard rule from the user:** this feature must not break any existing functionality. The popup is additive and isolated. Any failure in it (network, sheet or script error) must be swallowed so the login page and the rest of the app keep working.
- **Hard rule from the user:** no commit and no push. Test locally first.
- The demo flag is already exposed to the frontend as `brandSettings.demoMode` (`frontend/src/views/Authentication/Login/Login.vue`). Reuse it.
- The public endpoint is unauthenticated, so it needs input validation (length limits, email format) and a basic rate limit to stop spam.
- If the popup uses `<Teleport to="body">`, set its font-family explicitly, because teleported content falls back to serif.
- Setting up the Apps Script (a small `doPost` that appends a row) happens on the Google side. The repo will include the script snippet and setup steps, and the user deploys it and supplies the URL.

## Resources
- None yet.
