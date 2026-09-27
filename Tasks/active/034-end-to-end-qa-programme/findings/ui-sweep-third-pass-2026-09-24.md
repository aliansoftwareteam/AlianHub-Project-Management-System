# UI sweep, third pass — screens the first two sweeps did not cover (task 034)

Finding prefix `U3`. Headless pass on 2026-09-24 over the screens left out of the UI sweep (#875,
`ui-sweep-2026-09-24.md`) and the Sprint 7–8 pass (#903, `sprint-7-8-sweep-2026-09-24.md`).

**Harness.** A throwaway server from `e2e/support/harness.js` on its own Mongo (port 27208) with the
standard fixture workspace (owner, admin, member, guest, two projects, three tasks). Seeded on top: a
project doc with a long title, a wiki page, a workspace dashboard, an automation (off) scoped to the
shared project, and a private project holding one task assigned to the owner. Chrome driven by
`playwright-core`; the tours, the getting-started card and the notification prompt were suppressed.

**Matrix.** 47 routes × owner and member × 1280 and 390 px × light and dark = 376 captures, plus
20 interaction states (doc editor with text typed, dashboard and "+ Dashboard" dialog, automation run
history drawer, rule editor with the dry-run row, new automation, custom report as table and grouped by
project, chat "Create channel", global search with a query, trash tabs, the formula field editor) in the
same four combinations, 80 more. Routes: Docs hub, doc view, wiki page, Chat, Planner, Dashboards and a
dashboard, Reports (Portfolio, Sprint, Velocity + CFD, Milestones, Capacity, Variance, Custom report
builder), Log time, Project / Workload / Tracker timesheets, Automations, AI hub, Agents as teammates,
AI analytics, AI health, Route tasks to agents, Pipeline, Workflow builder, Integrations hub,
Connections, External data, Settings (General, Notifications, Language & Region, Custom fields, Teams,
Projects, Sign-in & SSO, Sign-in & security, Security & permissions, Templates, Time off, Time
tracking, Company, Integrations, SCIM, My settings), Trash, People, Team, Personal list, What's new.
Each capture was checked in the page for horizontal page scroll, elements past the right edge, raw
i18n keys, text contrast (blended over the real background stack), controls under 32 px at 390 px,
console errors and failed API calls, and by eye. The changed screens were captured again on a rebuilt
bundle after the fixes. Screenshots are not committed.

Clean across the matrix: no horizontal page scroll, no raw i18n keys (Settings → General lists
framework names such as `Vue.js` on purpose; What's new quotes commit subjects). Members are sent to
My settings from every workspace-only settings route, and see only the shared project in Docs, search,
the custom report builder and Route tasks to agents.

Not repeated here: `--ink-3` text contrast (UIX-10, owner decision, row 113) and the Firebase console
error (UIX-20) show on these screens too.

## Findings

Severity: high = content unreadable or a control unusable, medium = clearly wrong but usable,
low = polish.

| # | Screen | Role | Width / theme | Finding | Severity | Fixed? |
|---|---|---|---|---|---|---|
| U3-01 | Planner | both | 800–1280 / both | The unscheduled tray lives in the sidebar the toggle opens, but a rule left from the old two-column layout hid `.planner__tray` at 1280 px and below, so the sidebar opened as an empty white panel on most laptops | high | yes — `6f4d8657` |
| U3-02 | Planner | both | all / both | The ‹ range › week buttons were browser-default grey boxes (light grey in dark mode) | low | yes — `6f4d8657` |
| U3-03 | Automations (rule editor), Workflow builder | owner | all / both | `GET /api/v1/project` answers a bare array; both pages read `body.data`, so the scope picker ("in …") and the dry-run "Test the saved rule on a project…" picker were always empty, and a rule's project scope showed blank. Behind that, the dry-run task picker matched `ProjectID` as a string while tasks store an ObjectId, so it stayed empty too: a saved rule could not be tested on a task at all | high | yes — `66ac9651`, `61e48ab6` |
| U3-04 | Settings → General | owner | all / both | General opened with a red "Please enter valid number" (hard-coded English) under the phone before the owner touched anything: the check ran on `String(undefined)` for a company without a phone, and on the `"N/A"` the setup wizard stores (the schema requires a phone) | medium | yes — `3a5bc7b0`, `d51d440a` |
| U3-05 | Settings → Time off, Settings → SCIM | owner (time off: both) | all / dark | The white cards inherited the light dark-mode ink: "Request time off", "Team time off", the date labels, "SCIM Provisioning", the base URL and its labels at 1.1:1. Hint and empty-state grey `#9aa0b4` was 2.5:1 in either theme | high | yes — `482ef15f` |
| U3-06 | Settings → General | owner | all / dark | Section headings on the canvas (Task Priority, Milestone Weekly Range, File Extensions, Project Skills, Project Milestone Status) were black on the dark canvas (1.1:1); text inside the white sections and the owner-only cards (screenshot retention, time reminder, auto-close) was light on white | high | yes — `e2f4b4b5`, `f4e6e39a` |
| U3-07 | Project timesheet, Tracker timesheet | owner | all / both | The Mine / Project / Workload / Tracker tabs floated outside the white title strip, labels at the top and the underline 50 px below; in dark mode they were light text on the light strip (1.06:1). At 390 they were cut at the screen edge | medium | yes — `83e63909` |
| U3-08 | Settings → Custom fields | owner | 1280 / both | `.ah-page` (flex column, `tokens.css`) beat the builder's `.fb` grid at equal specificity, so the editor dropped under the list at half width beside an empty column | medium | yes — `b21be625` |
| U3-09 | Settings → Time tracking | both | all / both | With no tracker build published the page showed an empty green download bar whose click went nowhere; headline and lead were fixed navy and grey, 2.4:1 on the dark canvas | medium | yes — `f2371b55` |
| U3-10 | Settings → Templates | owner | all / dark | `:root[data-theme="dark"] .tp__tab` out-specified `.tp__tab.is-active`: the active category tab kept the grey tint with near-black text (1.3:1) | medium | yes — `ae9541fb` |
| U3-11 | Custom report builder | both | all / both | Grouping by status printed the stored type (`default_active`) on the chart axis, in the table and on the drill-down filter chip | medium | yes — `80a0e6d2` |
| U3-12 | Docs hub | both | 390 / both | The toolbar cut the primary "New doc" button at the right edge | medium | yes — `8766da84` |
| U3-13 | Docs hub | both | 1280 / both | `.ah-input` reset the search field's left padding, so the search icon sat on the "S" of "Search docs" | low | yes — `8766da84` |
| U3-14 | Doc view | both | 390 / both | Share ran off the right edge of the header | medium | yes — `aa344b8d` |
| U3-15 | Doc view | both | 1280 / both | "Edited by Olivia Owner on 4m", "… on just now" | low | yes — `aa344b8d` |
| U3-16 | Automations list | owner | 390 / both | A rule's sentence shrank to one word per line beside the count and the History / Edit / Delete buttons | medium | yes — `6d9adb29` |
| U3-17 | My settings → Working hours; Notifications → Quiet hours | both | all / both | `.ah-input`'s `width: 100%` won over `.ms__time` / `.nt__time`, so each time field took the whole card width and the "→" / "and" sat alone on a line | medium | yes — `7e184b75`, `248061a9` |
| U3-18 | Team | both | 390 / both | The "4 people · 0 agents · 0% load" headline wrapped one word per line and pushed Balance workload past the right edge | medium | yes — `fd004db0` |
| U3-19 | AI hub, AI analytics, Pipeline, Agents as teammates, Connections, External data, Planner | both | all / both | Buttons rendered as router links (`.ah-btn`, `.ah-tbtn`) kept the browser's link underline: "Ask", "AI Agents", "Go to agents", "Route many at once", "Connect", "Calendar · not connected" | low | yes — `866e1354` |
| U3-20 | Integrations hub | owner | all / both | Category subtitles, notes, the empty-inbox line and counts used `#9aa0b4`, 2.3–2.6:1 on the hub's white panel | low | yes — `2d8cf308` |
| U3-21 | Milestones report | both | all / both | Headline "0 · 0 at risk · 0 missed": the first count had no label | low | yes — `8e47496a` |
| U3-22 | Project timesheet, Workload, Tracker timesheet | member | all / both | A member without the timesheet permission gets the 404 card: "This doesn't exist any more. It was deleted, moved, or never existed. Anything it held is in the audit log", with an Audit log button the member cannot open | medium | yes — `1ea64f3f`: `AppState` kind `denied` ("You don't have access to this screen", Go home only) on the four timesheets and the legacy milestone report |
| U3-23 | Project timesheet, Tracker timesheet (body) | owner | all / dark | The legacy bodies are not dark-aware: Tracker's light panel stops 290 px down with the dark canvas below; legend "Tracked / Manual Time" is 2.5:1; "No records found" is error red for an empty state; the week range is clipped ("Sep 27, 202"); Tracker's hour axis is cut at "6 PM" | medium | yes — `c5dfba90`: `legacyTimesheetTheme.css` maps both bodies onto tokens in dark mode; in both themes the tracker panel takes the canvas, the empty state is muted, the range field fits, and the 24-hour strip fits 1280 px |
| U3-24 | Settings → Projects | owner | 1280, 390 / both | The Apps column is squeezed: names truncate ("Multipl…", "Time e…", "Milest…") and descriptions break one word per line; in dark mode the column is a dark block inside the white card; status chips use workspace colours on their own tint (1.4–2.8:1, as UIX-18) | medium | yes, apart from the status chips (UIX-18) — `ab8f6dc8`, `9e527ad6`: the list shared `.pal*` class names with the global search palette, whose unscoped rules caused the truncation and the dark block; Apps now has its own row as a grid |
| U3-25 | Security & permissions (plan-gated), other `UpgradePlan` walls | owner | all / both | The upgrade headline is black on the dark canvas (1.1:1) and "Upgrade Your Plan" is white on green (2.2:1) | medium | yes — `71040d19`: headline, plan name and message on `--ink`, `--brand`, `--ink-label`; the button keeps its green at `#15803d` (5:1) |
| U3-26 | Many phone screens | both | 390 / both | Shared primitives are under 32 px: `.ah-tab` 26 px (Trash, People, AI health, Connections, Templates tabs, My settings segments), `.ah-switch` 34×20, `.ah-btn--sm` 30 px, `.tv-pill` 22 px (Variance), `.ah-check` 15–20 px, Teams colour swatches 8 px | medium | yes, apart from the Teams swatches — `fe7e89a5`: below 768 px a transparent `::before` makes `.ah-btn--sm`, `.ah-tab`, `.ah-switch`, `.ah-check` and `.tv-pill` at least 32 px to tap without changing their drawn size |
| U3-27 | Several (see list) | both | all / both | `.ah-input` in `tokens.css` sets width, height, padding and font at single-class specificity, and chunk stylesheets load in no fixed order, so any single-class size override can lose. Found and fixed: Docs search, working hours, quiet hours (U3-13, U3-17). Same shape, not yet seen broken: `cp__whatif-input`, `billing__month-input`, `billing__pick`, `fb__opt-in`, `fb__search`, `fb__select`, `iw__select`, `lt__search`, `mbv__select`, `pipe-pick__select`, `sp__search`, `tm__name-input`, `ai-decline__note` | medium | yes — `06e276fa`: the unscoped ones use two classes (`.ah-input.x`): `billing__month-input`, `billing__pick`, `iw__select`, `mbv__select`, `pipe-pick__select`, `sp__search`, `tm__name-input`, `ai-decline__note`, plus `tv-input-mono` (Log time hours); `cp__whatif-input`, `fb__*` and `lt__search` sit in scoped blocks and already out-specify it. A spec fails on any new unscoped single-class size rule next to `.ah-input` |
| U3-28 | Integrations hub, Chat → Create channel, Settings → Teams → Create team | owner | all / dark | Legacy panels stay light in dark mode. Integrations' panel stops ~50 px short of the bottom at 1280; Create channel shows 15 of 27 icons at 390 (the grid is clipped); Create team's drawer starts 46 px below the top | low | no |
| U3-29 | Custom report builder, Capacity planning | both | all / dark | Chart bars keep the light-theme navy on the dark card; Capacity's legend says "black line = available hours" while the line is white in dark | low | no |
| U3-30 | Velocity and flow | both | all / both | The CFD's first rotated date label is cut at the left ("-2026-08-26"); the forecast note reads "0 measured sprint(s), 3 needed" | low | no |
| U3-31 | Sprint report, Portfolio | both | all / both | With no sprint / no portfolio an empty select sits in the toolbar (Portfolio's Edit stays enabled) | low | no |
| U3-32 | Variance | both | 1280, 390 / both | The "Nothing ran over its estimate" insight bar is pinned to the bottom of the view, far from the content; "DELTA ↓" wraps to two lines at 390 | low | no |
| U3-33 | AI section | both | 1280 / both | The AI side nav is an icon-only rail with no labels or tooltips at 1280 and three identical sparkle icons | low | no — design |
| U3-34 | Agents as teammates, People | owner | all / both | The guest row shows role "Member" and access "Everything"; every person's subtitle in People reads "Owner" (the fixture's designation 0), so the job title reads like a role | low | no — needs a look at the role label mapping **Fixed** by #1000 (build 467). |
| U3-35 | Route tasks to agents | both | all / both | Every open task is pre-selected on load ("3 selected") | low | no — product call |
| U3-36 | Global search | both | all / both | The palette panel runs to the bottom of the viewport with an empty area under its footer; it also stays open across a hash-route change | low | no |
| U3-37 | "+ Dashboard" dialog | owner | all / both | The mutually exclusive "Start with" options are drawn as checkboxes | low | no **Fixed** by #1020 (build 496). |
| U3-38 | Doc view | both | all / both | A long title is clipped inside the single-line title field with no wrap or ellipsis; a stray dot sits left of the editor body | low | no **Fixed** by #1009 (build 473). |
| U3-39 | Workflow builder | both | all / both | With `WORKFLOW_ENGINE` off the page shows its "not running" state but still calls `GET /api/v2/workflows/step-types` (503 in the console) | low | no |
| U3-40 | Automations → dry run | owner | all / both | For a rule that is switched off the verdict chip reads "Would run" while the reasons say "The rule is switched off, so it will not run"; the project pickers also offer the owner's "Personal" list project | low | no — verdict wording is a product call |
| U3-41 | Settings → General | owner | all / both | On a fresh install Save changes is refused until the company phone, state and city are filled ("The phone number field must be a valid phone number", "The state field is required", "The city field is required"): the wizard stores phone "N/A" and empty state and city, so an owner cannot change the tracker limit or date format without entering a company address | medium | no — whether those fields stay required is a product call |

Fixed: 27 (U3-01 to U3-27; U3-22 to U3-27 in the follow-up pass below). Open: 14 (U3-28 to U3-41).

## Before / after

Captured again on the rebuilt bundle (owner, both widths, both themes) for every fixed screen:

- U3-01: the tray shows "Unscheduled · Mine · Overdue" and its cards at 1280; the week arrows are plain
  text buttons in both themes.
- U3-03: the rule editor's scope picker shows the rule's project, the dry-run pickers list the projects
  and then that project's tasks, and the dry run answers; covered by two new cases in
  `automationDryRun.spec.js` (the bare-array answer and the ObjectId task query).
- U3-04: General opens with no phone error (saving still needs a phone, state and city: U3-41).
- U3-05, U3-06, U3-09, U3-10: the contrast audit lists nothing on Time off, SCIM, Time tracking,
  Templates and General in dark mode apart from `--ink-3` text.
- U3-07: the tabs sit inside the title strip at 1280 and on their own row at 390, readable in dark.
- U3-08: the editor is a 340 px column beside the list.
- U3-11: the chart axis and the table row read "To do".
- U3-12 to U3-18: every control is inside the screen at 390; working hours and quiet hours fields are
  110 px and 96 px wide.

Each fix has a regression check in `frontend/tests/unit/uiSweepThirdPass.spec.js` (stylesheet- and
source-level, as `uiSweepStyles.spec.js`), plus the dry-run cases above.

### Follow-up pass (U3-22 to U3-27)

Own harness on its own Mongo, two manual time logs seeded for the owner, 18 routes (the four
timesheets, Settings → Projects, Security & permissions, Members, Teams, Templates, My settings,
Trash, People, AI health, AI pipeline, Connections, Variance, Log time, Billing) × owner and member ×
1280 and 390 × light and dark, before and after, compared pixel by pixel.

- U3-22: a member on Project, Workload and Tracker timesheet sees the lock card and Go home.
- U3-23: in dark mode the Project table, filter and date fields, the legend and the tracker strip
  are on the dark tokens, the current day keeps its brand header; the strip shows 12 AM to 12 AM
  at 1280 without scrolling.
- U3-24: app names and descriptions read in full, three per row at 1280, one per row at 390; the
  other six columns stay on one row.
- U3-25: forced on the project list, the project timesheet and Chat by switching the plan feature
  off in the page store; the headline reads in both themes.
- U3-26: `elementFromPoint` answers across at least 32 px for tabs on Trash, People, AI health,
  Connections and My settings, small buttons on Templates, Variance and Automations, Variance pills
  and Notifications checkboxes. Screens that were not meant to change are pixel-identical apart
  from seeded hours; on Billing at 390 the positioned "Contract settings" button now paints over
  the card text it already overlapped. Teams colour swatches (8 px) are left as they are.
- U3-27: no visible change was expected; the spec guards the rule.

## How to re-run

Same recipe as `ui-sweep-2026-09-24.md`: `npm run e2e:db -- --port <port>`, start the harness with
`startHarness` against `E2E_MONGODB_URL`, save each role's storage state through the login form, then
for each theme set `localStorage['ah.theme']`, mark `ah.tour.skipped.{shell,project,board,list}` and
`sessionStorage['ah.gs.dismissed']`, grant `notifications`, and visit each route at each width. The
scripts lived in the worktree as `u3-*` scratch files and are not committed.
