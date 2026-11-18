# Progress: Demo site lead-capture popup

## Checklist
- [x] Backend: public leads endpoint (validation + rate limit) that forwards to the Apps Script URL from env
- [x] Apps Script snippet + setup steps for the Google Sheet
- [x] Frontend: popup component (fields, Other text box, validation, close/Esc/outside click)
- [x] Mount it on the login page only when demo mode is on, with a 1–2s delay and a localStorage once-flag
- [ ] User tests locally (demo on/off, submit, close, failure, mobile, regressions)

## Last step
Tested end to end locally: the popup submit returned 200 through the Apps Script. Waiting for the user to confirm the row in the sheet and test the remaining cases. Nothing committed or pushed.

## Blockers
None.

## Log

### 2026-11-18
- Task created. Decisions from the user: BTE is an event, so it is a dropdown option. The Find from list is my starting set, to review with the TL. The popup can be closed. Leads go to Google Sheets. Home/login page only. No regressions. No commit or push, test locally first.
- User approved the PRD; moved to active.
- Built the backend module `Modules/DemoLeads` (`POST /api/v1/demo-leads`). It is guarded by `DEMO_MODE`, rate limited to 5 per minute per IP and validates input, then forwards to the Apps Script URL in `DEMO_LEADS_SHEET_URL`. The endpoint is public because it is not in the JWT path list.
- Built the frontend component `components/atom/DemoLeadPopup`, teleported with an explicit font. The `demoLeadPopupSeen` localStorage flag is set on submit or close, and storage errors are ignored. The component is mounted in Login.vue as a separate root, only when `isDemoMode` is true, so the login form markup is untouched.
- Added the setup doc `docs/demo-leads-google-sheet.md`, plus English strings under `Demo.*` in en.js.
- First URL was the sheet's /edit address (POST gives 405, or a 200 HTML page). The backend now accepts only the script's `{ok:true}` reply as saved. Raised the rate cap to 20/min because 'trust proxy' is off, so the cap is site-wide behind nginx.
- With the Apps Script /exec URL: test lead (name "Claude local test", BTE) → 200 OK, the popup closed and was marked seen.
