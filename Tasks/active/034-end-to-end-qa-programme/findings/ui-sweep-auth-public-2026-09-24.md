# UI sweep — signed-out, first-run, public and error screens (task 034)

Finding prefix `U5`. Headless pass on 2026-09-24 over the screens the earlier sweeps did not reach
(#875 `ui-sweep-2026-09-24.md`, #903 `sprint-7-8-sweep-2026-09-24.md`, #931
`ui-sweep-third-pass-2026-09-24.md`).

**Harness.** A throwaway server from `e2e/support/server.js` on its own Mongo (port 27217), with
Google, GitHub and GitLab sign-in switched on (dummy client ids) and login links on. First an empty
database for the setup wizard and the new workspace's first run, then the standard fixture workspace
(owner, admin, member, guest, two projects, three tasks). Seeded on top: a public share of a sprint
(with the request form), a password-protected share, a shared doc page, a live public form with nine
question types, an invitation for a new address and one for an existing account, an unverified
account, a reset-password token read from the database, and two-factor switched on for the guest.
Mail goes to a closed port, so no mail was sent. Chrome driven by `playwright-core`.

**Matrix.** 1280 and 390 px × light and dark (the theme applies before sign-in from the stored
choice), about 240 captures. Each was checked in the page for horizontal page scroll, elements past
the right edge, raw i18n keys, text contrast (blended over the real background stack), controls under
32 px at 390 px, console errors and failed calls, and by eye.

- Setup wizard: form, empty submit, progress, first-run Home with and without the tours.
- Login: default, empty submit, wrong password, unknown address, login link sent, two-factor code,
  wrong code, recovery code, verify-email step, `?reason=expired`, during maintenance, after the
  session expired.
- Forgot password (form, invalid address, sent), reset and set-new-password (form, errors, bad
  token), verify email (valid and expired link), invitation for a new account (form, errors,
  invalid link), invitation for an existing account (accepted, invalid), SSO (form, unknown domain),
  tracker login (signed out, signed in, Open), OAuth consent with an unknown client, `/signup`.
- Public pages: sprint share with the request form, password-protected share (and a wrong
  password), shared doc page, unknown share token, public form (empty, validation, sent), unknown
  form token. Public pages have no embed mode: both send `frame-ancestors 'none'`. The in-app Embed
  view lives inside a project and was out of scope.
- Error and edge: 404 signed out and signed in, a member opening the owner-only project, a member
  opening Settings → Members, maintenance mode (login, signed-in Home, recovery when it ends).

Clean across the matrix: no raw i18n keys, no horizontal page scroll on the two-panel login.
Not repeated here: `--ink-3` text (UIX-10, being retired in `fix/retire-ink-3-for-text`) shows on
the setup hint, the setup progress list, "or with email" and "Code expires in"; the Firebase console
error on Home (UIX-20).

## Findings

Severity: high = content unreadable or a control unusable, medium = clearly wrong but usable,
low = polish.

| # | Screen | Width / theme | Finding | Severity | Fixed? |
|---|---|---|---|---|---|
| U5-01 | Every single-card auth screen: setup, forgot / reset / set password, verify email, invitation, verify invitation, SSO, and login's two-factor, link-sent and verify steps | 390 / both | The card is `width: 100%` plus 56 px padding under content-box sizing: 448 px on a 390 px screen, so each page scrolls sideways. Inside the app shell (OAuth consent, tracker login) the right edge is cut off instead | high | yes — `93a4dd47`, and `dd193ac5` so the six two-factor boxes share the narrower card (a fixed 44 px each ran 40 px past it) |
| U5-02 | Invitation accepted, invalid invitation, expired reset link | all / both | Full-width link buttons (Log in, Back to login, Request a new link) run 38 px past the card | medium | yes — `93a4dd47` |
| U5-03 | Login | 1280 / dark | The product shot on the right panel is hard-coded white while its text takes the dark ink: "Today & Overdue" and the task rows at 1.1:1, blank to the eye | high | yes — `1f7eb014` |
| U5-04 | Login, invitation | all / both | Google, GitHub and GitLab buttons have no logos: the three buttons never import `ShellIcon`, so it renders as an unknown `<shellicon>` tag | medium | yes — `5812320c` (a spec now fails for any component that draws `ShellIcon` without importing it) |
| U5-05 | Login, invitation | all / both | The Google button is built once on mount; when the async Google script arrives later (slow network) or is blocked, clicking it does nothing but log "Google client not initialized" | medium | yes — `ddcfbb9f`: built on click when needed, and a toast says what to do when the script never loaded |
| U5-06 | Login, invitation, reset / set password | all / both | Show / Hide password `aria-label`s are English literals | low | yes — `ee0497b5` |
| U5-07 | Login, setup, reset / set password | all / both | Empty password fields carry a "••••••••" placeholder, so an empty field looks filled; next to "Enter your password." it reads as a contradiction | medium | yes — `d08d2718` |
| U5-08 | Invitation sign-up | all / both | Labels are screen-reader only and the name field's placeholder is a sample name ("Priya Sharma"), so it reads as a value; with the error "Enter your name." under it the form looks broken | medium | yes — `b4649c5e`: labels visible, as on every other auth form |
| U5-09 | Login → two-factor | all / both | After a wrong code the six digits stay filled; the next try means clearing each box by hand | low | yes — `e1a3931b`: boxes cleared, focus back on the first |
| U5-10 | Login during maintenance | all / both | Submitting shows "Something went wrong on the server. Try again in a moment." under the maintenance banner | medium | yes — `9a459997`: "Sign-in is paused while the server is under maintenance…" (login and login link) |
| U5-11 | Any signed-in page when maintenance ends | all / both | The banner says "This page refreshes itself when the service is back"; the banner goes away but the page stays blank (it booted against 503s) until a manual reload | high | yes — `48adff9c`: the banner reloads the page when it sees maintenance end |
| U5-12 | Login after the session expired | all / both | An expired session lands on the login page with no word about why (the `redirect_url` is kept) | medium | yes — `6aaec756`: automatic sign-outs mark the session as expired and login shows "Your session expired. Log in again to pick up where you left off." |
| U5-13 | 404 (signed out and in) | all / both | "It was deleted, moved, or never existed. Anything it held is in the audit log." with an Audit log button, shown to signed-out visitors too; the button only went home | medium | yes — `bf35e056`: "We can't find that page / The link may be mistyped, or what it pointed to was moved or deleted." and Go home |
| U5-14 | No-access state (project, Settings → Members / Projects / General) | all / both | "Request access" has no handler on any screen that shows it: a dead primary button | medium | yes — `ba4c6f0d`: one working Go home button |
| U5-15 | First-run Home → setup card | all / both | "Review member permissions(defaults applied)": the template's leading space is dropped by the compiler | low | yes — `6a83007d` |
| U5-16 | Setup wizard | 1280 / both | "Create workspace" fills half the row, left-aligned above a centred hint | low | yes — `d8b772bf`: a lone action spans the row |
| U5-17 | Login | all / both | "Email me a login link" shows when login links are off; clicking it only says they are not enabled | low | yes — `4147e0e8`: shown only when the server has them on |
| U5-18 | Every auth screen | 390 / both | Tap targets under 32 px: password eye 26×26, "Forgot Password?" 95×12, Help 25×19, "Locked out?" 66×19, Back 27×13, "Use a recovery code instead" 156×13, "Admin guide" 71×15, the logo link 92×24 | medium | yes — `ccf47082`, `681d1387`, `4a87a67c`: transparent `::before` hit areas below 768 px (the U3-26 approach) on the auth text links, the invitation's terms links and the "send again" / back text buttons; eye 34 px below 560 px |
| U5-19 | Public share pages, public form | all / light | Share footer `#aaa` 2.2:1, doc meta 2.6:1, "Pages" label 3.2:1, list sub-line and task keys 4.15:1, Send / View buttons 4.15:1; form footer 4.48:1, upload hint 2.6:1, unselected rating stars 1.6:1 | medium | yes — `d7c24ae7` |
| U5-20 | Shared doc page | 390 / — | A long page title in the top breadcrumb is cut mid-letter: `text-overflow` does nothing on an inline-flex box | low | yes — `3eb28b62` |
| U5-21 | Public form → sent | all / — | The "received" confirmation is not announced to screen readers and fades after two seconds | low | yes — `5b4831a6` (`role="status"`); the fade itself is U5-28 |
| U5-22 | Shared doc page | 390 / — | A table wider than the phone widens the whole page, so it scrolls sideways | medium | yes — `4450004c`: the table scrolls inside the page |
| U5-23 | First-run Home | 1280 / both | Two checklists at once: the "Set up {workspace} 2/9" card and the floating "Getting started 0/4" card, with overlapping items (invite, create a project); the floating card also covers the Planner footer. A member sees "Get going 0/5" beside "Getting started 2/4" with the owner's invite and first project ticked for them | medium | no — recommend one list: keep the Home card for owners and drop the floating card, or make the floating card the collapsed form of the same list |
| U5-24 | First-run Home | 390 / both | The browser-notification question opens straight away on the first sign-in, over the setup card | low | no — recommend asking at the "Set your notifications" step, or after the first task is created **Fixed** by #984 (build 448). |
| U5-25 | First-run Home (sample data on) | all / both | A brand-new workspace opens with "Overdue · 1" in red: the sample task "Give a task an owner" is due yesterday | low | no — recommend seeding sample due dates from today onwards **Fixed** by #974 (build 452). |
| U5-26 | Login | all / both | "Continue with SSO (SAML / OIDC)" shows on an instance where no workspace has SSO; the SSO page then answers "No SSO provider is set up for that domain" | low | no — recommend `public-config` report SSO only when at least one connection exists (server change) **Fixed** by #985 (build 459). |
| U5-27 | A member opening the owner-only project's link | all / both | Silently redirected to another project (the URL is rewritten) with no message; console `TypeError … reading 'findIndex'` in "loading sprints and folders" | medium | no — recommend the no-access state ("This project isn't available to you", without confirming it exists) and a guard on the sprint loader **Fixed** by #973 (build 451). |
| U5-28 | Signed-in pages during maintenance | all / both | The app boots to a blank page under the banner (its boot calls answer 503). `App.vue` has an unused `underMaintainance` branch with an image that nothing switches on | medium | no — recommend a maintenance card fed by the banner's state (and removing the dead branch) **Fixed** by #990 (build 478). |
| U5-29 | Public form → sent | all / — | The confirmation fades after two seconds and leaves an empty form; someone who looks away sees a blank form and may send again | medium | no — recommend keeping the banner until the next input, or a thank-you state with "Submit another response" **Fixed** by #975 (build 453). |
| U5-30 | Public share and form pages | all / both | Server-rendered in English only ("Password required", "Submit a request", "Shared via AlianHub", "This form is not available.") and always light | low | no — recommend a server-side string table keyed by the workspace language, and `prefers-color-scheme` |
| U5-31 | Sprint share | all / — | The page heading is only the sprint name ("List"); nothing says which project or workspace it belongs to | low | no — owner decision on what a public page may reveal; recommend "Project · Sprint" |
| U5-32 | Setup, invitation, reset | all / both | Three password rules: setup accepts any 8 characters, invitation and reset demand upper, lower, digit and symbol, and the rules line ("a capital letter, a number and a symbol") leaves out lowercase | medium | no — recommend one shared validator and one rules line **Fixed** by #977 (build 446). |
| U5-33 | Verify email | all / both | Verification links expire after 10 minutes, short for email; the page then says the link expired | low | no — product / security call (e.g. 24 h) |
| U5-34 | Tracker login | all / both | After "Open the tracker", nothing happens when the desktop app is not installed and nothing says so | low | no — recommend a "Nothing happened? Download the tracker" line after a couple of seconds **Fixed** by #986 (build 460). |
| U5-35 | Login, verify step, invitation | all / both | Copy: "Forgot Password?" in title case; "Back to Login" on the verify step, "Back to login" elsewhere; an invitee reads "Free forever on your own server. No card." | low | no — rewording existing keys needs each locale reset first (i18n backfill only fills missing keys) **Fixed** by #996 (build 479). |
| U5-36 | Login, invitation | 1280 / both | Three providers in a two-column grid leave GitLab alone at half width | low | no — recommend a single column, or the last odd button spanning the row **Fixed** by #972 (build 455). |
| U5-37 | 404 signed in | all / both | A bad in-app URL drops the app shell; only Go home is left | low | no **Fixed** by #981 (build 456). |
| U5-38 | Unknown form token, OAuth consent error | all / both | "This form is not available." with no next step; the consent error is red text with no heading or action | low | no — recommend saying what to do (ask the sender for a new link, back to the app) **Fixed** by #983 (build 454). |
| U5-39 | No-access state on settings screens | all / both | The body reads "This is visible to its members only. Ask its owner to add you.", project wording on a settings screen (the settings guard usually redirects first) | low | no — the `denied` kind fits these three screens **Fixed** by #998 (build 464). |
| U5-40 | Public form | 390 / — | The label-choice checkboxes are the browser's 13×13 boxes and the file input is 21 px tall | low | no — the labels are clickable, so the real target is larger; worth a larger custom control when the form is restyled |

Fixed: 22 (U5-01 to U5-22). Open: 18 (U5-23 to U5-40).

## Before / after

The changed screens were captured again on a rebuilt bundle and a restarted server, same widths and
themes:

- U5-01/02: setup, forgot, reset, invitation, verify invitation, SSO and the two-factor step fit
  390 px with a 16 px gutter and no sideways scroll; block buttons sit inside the card.
- U5-03: the dark login shows the product shot on the dark surface with readable rows.
- U5-04: the three provider buttons show their logos.
- U5-07/08: empty password fields are empty; the invitation form has visible labels.
- U5-13/14: the 404 card has one Go home button and the new wording.
- U5-16/17: Create workspace spans the form; with login links off, Log in spans the form.
- U5-18: the audit lists no auth link or eye under 32 px at 390 px (the invitation's terms links and
  "send again", found on this pass, were added after it).
- U5-11: with maintenance switched off mid-session the blank page reloaded into Home on its own.
- U5-10/12: the login banner reads "Sign-in is paused while the server is under maintenance…"
  during maintenance, and "Your session expired…" after the member's sessions were deleted.
- U5-19/20: the contrast audit lists nothing on the share, doc and form pages apart from the
  author avatar's initial and a decorative bullet; the breadcrumb ends in "…". U5-22 (doc table)
  and the last two hit-area commits are guarded by their specs and were not captured again.

Specs: `frontend/tests/unit/uiSweepAuthPublic.spec.js` (stylesheet and source checks),
`uiSweepAuthLogin.spec.js` (two-factor, maintenance, session expiry, login link),
`uiSweepAuthGoogle.spec.js`, `uiSweepMaintenanceBanner.spec.js`, `uiSweepAppState.spec.js`,
`uiSweepSetupChecklist.spec.js`, and `tests/ui-sweep-public-pages.test.js` for the server-rendered
pages.

## How to re-run

`npm run e2e:db -- --port <port>`, start a server with `startServer` from `e2e/support/server.js`
against `E2E_MONGODB_URL` (empty database for the wizard, then `createFixtures`), seed shares, a
form and invitations through the API, read one-time tokens (`userAuth.token`,
`users.verificationToken`) from the database, then visit each route at each width with
`localStorage['ah.theme']` set. Maintenance: `POST /api/v2/instance/maintenance {on:true}` as the
owner. Session expiry: delete the `global.sessions` rows and the access cookie, then navigate. The
scripts lived in the worktree as `u5-*` scratch files and are not committed.
