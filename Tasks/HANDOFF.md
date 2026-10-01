# Handoff — where to start next session

Updated 2026-10-01. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (`14.36.0-beta.670`)

- **2026-09-30 to 2026-10-01: builds 646–670, tasks 044 and 045 (the ClickUp re-check and its gaps).**
  - **Re-check:** #1180 (646) lists what is still open against ClickUp at build 645, ranked, in `Tasks/active/034-end-to-end-qa-programme/findings/clickup-recheck-2026-09-30.md`.
  - **Task 044, quick gaps, is done** (all four slices; tracker AP-439, in review):
    - #1183 (650): Board cards show the chosen custom fields.
    - #1184 (651): language settings are restored from the account on a new device.
    - #1187 (660): a form response opens the task it created.
    - #1192 (661): the Field Filler, PRD Writer and Wiki Upkeep agent templates can be picked. Each has a built-in skill; `aifield.fill` is a new agent action.
  - **Task 045, medium gaps, is done** (all fifteen slices; tracker AP-440):
    - #1185 (652): the command palette lists recent projects, docs and sprints, closes on a page change, and replaces the old search modal.
    - #1189 (653): Workload in hours, points or task count.
    - #1188 (654): Burndown, Velocity and Ask dashboard cards.
    - #1193 (656): AI fields fill numbers, ratings, labels and dates, and an invalid answer is never stored.
    - #1197 (657): an agent can be mentioned in chat or messaged directly.
    - #1186 (658): one bulk bar, with move to another project and convert; the legacy bar is deleted.
    - #1199 (659): Home cards can be added, reordered and removed, with a Recents card.
    - #1196 (663): docs take @mentions of people, docs and tasks, and uploaded images.
    - #1191 (664): filter, group and sort by custom field.
    - #1190 (665): an automation template gallery and an Automate button in projects.
    - #1203 (666): moving a blocker in Gantt shifts its dependants after a preview.
    - #1194 (667): "Who can see this" on projects, sprints and docs.
    - #1200 (668): subtask rows in List edit in place and can be selected.
    - #1198 (669): comments on docs and blocks; migration `063-page-comments`.
    - #1195 (670): a custom field can be limited to task types.
  - **Fixes:**
    - #1201 (649): `tests/task-write-company-fields.test.js` compared run-stamped times unmasked on its fixture day, 2026-10-01.
    - #1202 (655): docs, Ask and agents use the same project visibility rule as projects (`Config/rulePermissions.js`), the project list included; only a doc's author can make it private. Details are in the owner's private notes.
    - #1204 (662): Board cards in a full column keep their height on a phone.
  - **Docs:** #1181 (648) and #1182 (647) opened the two tasks.
  - **The owner's local server** was rebuilt at 653 and 661 and checked in dark mode both times; see the line below for its current build.

### Earlier: `beta` at d7e144bf, `14.36.0-beta.645`

- **2026-09-29: builds 636–645, follow-ups from tasks 041–043.** The owner's local server was on 644 (backend pulled; the frontend was last built at 635, and nothing since changed it).
  - **Login guard:**
    - #1171 (636): memory, feedback, quality and notes-to-tasks routes.
    - #1174 (640): `tests/conventions/route-guard-coverage.test.js` walks every route: 856 in total, 767 guarded, 88 public with reasons. It also guarded `/api/v1/ai/chat-ask`.
    - #1176 (642): `getGlobalTemplate` is now guarded.
    - A new route must be in the guard list or in the test's `PUBLIC_ROUTES`, or CI fails.
  - **Emails:**
    - #1172 (639): comment_reply and comment_assigned emails.
    - #1177 (643): every notification and account email escapes the text it includes (`Modules/Template/emailText.js`).
  - **Workflows:**
    - #1173 (638): condition steps match status by key (migration `062`) and fixed the workflow's `previous` context.
    - #1175 (641): the external agent step saves its session id before announcing it. This was the flaky integration test.
    - #1178 (644): a session that closes before the step waits is picked up at once.
  - **Docs:** #1170 (637) ticked tasks 041 and 043 and refreshed the beta log and handoff.

### Earlier: `beta` at 9f1f63db, `14.36.0-beta.635`

- **2026-09-28 evening: builds 601–635 (tasks 041, 042 and 043).** The owner's local server was rebuilt at 603, 608 and 635.
  - **Task 041 (AI UX fixes) is done:**
    - #1122: one AI availability state (build 609).
    - #1157: automation "Assign to" action; assignees now have one write path, `updateAssignee` with `eventActor` and `eventDepth` (build 625).
    - #1159: AI assignment rules per project (build 629).
    - #1154: plain proposal titles and dark-mode fixes (build 615).
  - **Task 042 (non-AI UX fixes) is done:** all 13 slices, builds 581–607.
  - **Task 043 (advanced AI, from a hands-on look at ClickUp Brain²) is done:** all 10 slices, builds 620–635.
    - personal AI memory (#1160)
    - Ask composer (#1164)
    - task and editor AI (#1163)
    - agent catalogue and builder (#1158)
    - scheduled agents (#1165)
    - AI fields (#1166)
    - `@ai` in comments and chat (#1168)
    - notes to tasks (#1167)
    - Automate with AI (#1161)
    - feedback and Quality page (#1162)
  - **Fixes:**
    - #1136: build-info git buffer raised to 64 MB. version:show had failed with ENOBUFS since build 581.
    - #1143: startup migrations record the resolved build.
    - #1140: project template writes need owner or admin.
    - #1141: every run a person starts needs access to its task.
    - #1148: localePreferences declared in the users schema.
    - #1169: automation status conditions match by key; migration `061`.
  - **Offered as task chips, not started:**
    - workflow condition steps and `statusRef`
    - email templates for `comment_reply` and `comment_assigned`
    - the flaky `external-agent-step` integration test

- **2026-09-28 afternoon and evening: builds 560–600.** #1094 (build log). Two sessions merged into beta in parallel.
  - **This session — a second security audit** (details in the owner's private notes), all in-company: channel lists check the channel's members (#1106); project updates take only the app's operators and fields, so a renamed field cannot flip a project's visibility (#1105); the project sprint update only adds or removes the caller's own favourite (#1107); sprint and folder updates write only the app's fields, with permissions from what is written, no silent creation, private lists 404 to others and moves inside the project (#1112); a new list takes only its icon's fields from the icon (#1114); managing teams needs the teams permission and adds only active members (#1099); a project rule update sets only its roles (#1098); company-wide custom fields need the settings permission (#1104); restoring from the trash needs the same rights as deleting (#1108) and the trash lists only what you can open (#1118); the milestone week needs admin rights (#1100); manual time writes only time records (#1101, after #1090/#1091); comment updates take no client options (#1102); company counters are kept by the server (#1109); notification counters act on your own user (#1110). Every new gate is a hard check, independent of `PERMISSION_ENFORCEMENT_MODE`.
  - **Task 039:** keyboard users reach the actions inside options with the arrow keys, and focus stays in the list when an option removes itself (#1095). Only the screenshots remain.
  - **Task 040:** rules, calls, dashboards and agent records find project ids in either form (#1096) and store one form, migrations `049`–`055` (#1097). Next: history, notifications, mentions; customFields; task ids; then removing the both-forms matching.
  - **The other session (tasks 041 and 042, AI and non-AI UX fixes):** #1103, #1111, #1113, #1115, #1117, #1119, #1120, #1123, #1126 (with migration `056-project-view-catalogue`), #1127, #1128 and more; see `docs/BETA-LOG.md` and those tasks' progress files.
- **2026-09-27 night to 2026-09-28: builds 520–559.** #1055 (build log, 520).
  - **Security hardening from a tenant-header audit** (details in the owner's private notes): dashboard routes check the live seat (#1058, 528); personal access tokens stop working and are revoked when their owner leaves or is deprovisioned (#1065, 529); public sign-in and token routes check the company exists before opening its database (#1067, 530); a company header must be an id, only `global` and company ids open databases, and the tenant helpers refuse requests with no verified audience except the instance admin key (#1066, 533); the time tracker writes only time records (#1090, 553) and deleting a manual entry acts only on time records (#1091, 554). Agent runs put task data inside an escaped `<workspace_data>` block (#1079, 539).
  - **Task 039, accessible dropdowns:** `mode="menu"|"listbox"|"dialog"`, `#search`, `multiselectable` on the shared DropDown (#1062, 526; #1078, 537); six call-site batches (538–555) with a shrink-only baseline; unique milestone ids (#1083, 541); axe e2e opens a menu and a listbox (#1088, 549); form-style dropdowns open labelled dialogs and the baseline is empty (#1092, 558); search fields sit outside the lists, multi-select pickers say so, and the column picker, watcher removal and per-tag menu work from the keyboard (#1093, 559).
  - **Task 040, one stored form per id:** Phase 1 read fixes (#1057, #1059–#1061, #1068, #1069, #1085; builds 522–546); Phase 2 migrations `044-task-sprint-ids` (#1077), `045-milestone-project-ids` (#1082), `046-task-sprint-placement` (#1086), `047-timesheet-project-ids` and `048-estimate-project-ids` (#1087, #1089), all through a schema setter so both-forms filters stay uncast.
  - **Owner decisions shipped:** the legacy header fallback and kiln aliases are gone (#1064, 523; task 021 closed); tags show on List and Table rows (#1063, 531). Also: `npm run migrate -- verify|status|down` run what they say (#1084, 543; before, they ran `up`); agents' confidence floor (#1080, 545); agent sprint moves keep the app's fields (#1081, 540); bulk-menu tag contrast (#1056, 521).
- **2026-09-27 evening: builds 513–519.** #1048 (build log, 513). Legacy settings cards follow the dark theme (#1049, 514, follow-up 138). The add-tag "+" icon is inline and token-coloured (#1050, 515, follow-up 136 closed). "1 task closed" (#1051, 516, follow-up 142). Trash, the instance audit export and every task write read the company through `tenantOf`; a header outside the token audience gets 403 (#1052, 517, task 013 B.4). The permission matrix scrolls its role columns inside the card with the permission column pinned (#1053, 518, follow-up 140). The upgrade card illustration fits a phone (#1054, 519, follow-up 144).
- **2026-09-27 afternoon: builds 504–512.** #1040 (build log, 504). The permission matrix shows each permission's description from `PermissionDesc` (#1041, 505, task 013 G10). Instance guide links use the brand colour and the settings group tabs stay on one line at 390 px (#1043, 506, follow-up 139). The Shell rail uses `var(--brand)`, so its mark and New tile are lavender in dark mode (#1039, 507). Tag chip text meets 4.5:1 for any tag colour (#1044, 508, follow-up 136). Pinned nav items are stored on the user through `PUT /api/v2/users/nav-preferences`; a browser's local copy counts only for the user who saved it (#1042, 509). The legacy Roboto font is gone: `var(--font-ui)` everywhere and a `font-ui` class (#1045, 510). The bulk status menu keeps light-theme ink on its white surface (#1047, 511, follow-up 141). Done by: a Table column, a filter in the shared task search for List, Table and Board, and a rollup on the Sprint report (#1046, 512). Tasks 008 and 010 closed.
- **2026-09-27: builds 499–503.** #1034 (build log, 499). Share-link passwords use the account password format from #1027: every character counts, and older share passwords still open and are upgraded on the next successful check (#1035, 500). Board cards show their tags on first render, through the tag picker's shared `taskTagChips` (#1037, 501, follow-up 135). Request intake on a password-protected share asks for the share password (#1036, 502). A public form link cannot be given a password (#1038, 503).
- **2026-09-26 evening: builds 480–498.** #1013 (build log, 480). The owner's task-panel report: the title shows as written (#1014, 481); the title checkbox that duplicated the complete ✓ is gone (#1015, 482); the compact description box (#1017, 483); the AI checklist toast shows text, not its key (#1018, 484); property values line up with 24px targets (#1016, 485). Group 2, rehearsed on #1033 (closed unmerged; beta's tree `b8cd6852` is identical to the rehearsal's): full-length password hashing with a stored format version and upgrade at sign-in (#1027, 486); build info reads git only when the server starts it (#1026, 487); an Inbox reply mentions the person it answers (#1021, 488); undo for Inbox clear all and mark all read, via `POST /api/v1/inbox/restore-all` (#1031, 489); panel description text starts at the padding (#1023, 490); the phone priority chip follows the Priority app (#1025, 491); status chip text meets 4.5:1 on any workspace colour (#1032, 492); Firebase messaging only when push is configured (#1019, 493); the planner starts closed below 1280 px (#1028, 494); one question mark on "Forgot password?" (#1030, 495); round radios (#1020, 496); board tag and comment shortcuts are labelled buttons, and the Tags trigger has an accessible name everywhere (#1022, 497); no stray dot beside the doc body, and the dark-mode block menu is readable (#1029, 498).
- **2026-09-26 afternoon: builds 441–479.** #1011 (handoff) is build 441, and the 38-PR batch is builds 442–479, listed in `docs/BETA-LOG.md`. The batch was rehearsed first: all 38 were merged in order on `test/batch-2026-09-26` (#1012, closed unmerged), and that combined tree passed full CI. The real merges produced an identical tree (`4a84a8b5`). Every invitation acceptance path now needs its link token plus the invited account (#980, #987, #993). New passwords follow one rule, checked on the server (#977); the sign-up verification token is stored before answering (#992); `VUE_APP_IS_SSO_LOGIN` is gone and the login page follows the server's public config (#985). The findings rows are marked with their PR and build.
- **2026-09-26: builds 435–439 (#966, #968–#971).** Owners and admins can flush their own company's cache, and only the key types that name their company are cleared (#968, build 436). Tasks assigned only to a team show under each team member when grouping by assignee (#969, build 437, follow-up 129). The bell leaves out notifications cleared in the Inbox (#970, build 438, follow-up 126). Automation rule comments show the rule's name, a gear and an AUTOMATION chip instead of "Ghost User" (#971, build 439, task 020 closed); `automationName` is declared on the strict comments schema. CodeRabbit allows one review an hour on the current plan; the owner said to skip it for this batch.

- **Tasks 035–038 closed 2026-09-27** and moved to `Tasks/done/`. **Task 038 (build 434, #965):** List rows edit status (circle with a grouped picker), assignee, due date and priority in place, with row actions (rename, add subtask, copy link, new tab, row menu) and Undo on every change; at 390 px the cells fold under the title. The new row menu has no archive, delete, move or duplicate yet.

- **Evening 2026-09-24: builds 423–431 (#954–#962).** Flow-level UX audit against ClickUp (#955, task 034 findings). **Task 037, UX flow fixes, done:** List view honours search, "Me" and saved filters, remembers group/Me/search and groups by assignee (#958); one create-task dialog from `c`, the palette, the rail and "+ New" (#957); task panel Esc closes the innermost thing first, Undo on property changes, one shared timer (#961); bulk bar visible at 390 px, shift-click ranges, Undo on bulk changes (#956); one per-role Home checklist instead of the floating card, dismissal on the user, new projects start Blank (#962); Inbox keyboard triage keeps focus and opens tasks over the Inbox (#959); plain invite-mail failure with a working join link (#960).

- **Daytime 2026-09-24: builds 409–422 (#936–#953).** Company deletion cleanup (#939); company phone, state and city optional (#941); `--ink-3` retired for text (#942); ClickUp comparison (#943); accessibility pass with an axe e2e spec (#944); signed-out and first-run screens (#945); "keep me signed in" stores the email only (#946); e2e harness port retry (#947). **Task 036, ClickUp parity, done:** command palette on Cmd+K (#949), recent visits follow private sprints (#950), task detail navigation and quick actions (#952), Inbox snooze, Other and Cleared (#953), OpenAI-compatible AI endpoints with instance and workspace AI off switches (#951). New env vars from #951 are in `docs/ENV.md` (`AI_ENABLED`, `OPENAI_BASE_URL`, `OPENAI_COMPATIBLE_*`).

- **Overnight 2026-09-23/24: builds 303–408 (#834–#939)**, listed in `docs/BETA-LOG.md`.
  - **Access and tenant isolation:** comment reads and writes follow project, sprint and chat visibility, including agents, automations and MCP (#896, #899, #900); tokens narrowed to projects are held to them on every REST route (#894); tracker captures apply only to the caller's own session (#901); imports need the same project access as creating a task, undo follows task and thread visibility, and imports resolve people among the company's own members (#904, #905); invitations are accepted only with their link and by the account they were sent to (#908); social sign-in binds the account to the provider's verified identity (#909); notification routes act for the signed-in user in their verified company (#910); SSO and SCIM link existing accounts only through verified domains or existing membership, with DNS domain verification in Settings → Sign-in & SSO (#911); writes that name people accept only active members (#912); people lookups resolve among the company's members and company access needs an active seat (#913); account emails give one answer whatever the account's state (#914); tenant-scoping batches 3–6 (#873, #877, #881, #887); egress host checks (#880); notification settings reads (#870); automation run visibility (#868).
  - **After build 383 (builds 384–403):** writes that name people accept only active members, including projects, sprints and manual time (#918); company reads need an active seat (#916); mail routes send only to company members, password sign-in gives one answer for any failure, and the tracker's pre-login list returns download fields only (#919); stored request addresses follow `TRUST_PROXY` and only pending invitations can be accepted (#922); comment mentions, records and notices are built on the server, and all history and notification text is composed on the server, so the generic `/api/v1/handleHistory`, `/api/v1/handleNotification` and `/api/v1/app-notification/comment` routes are retired (#915, #926, #927, #929); the team board, agent release proposals, agent project lists, and agent runs and proposals show only what the viewer may see (#932, #933, #934); SSO domains are re-checked daily and seats SCIM deactivated for outsiders no longer count as membership (#925); tenant-scoping and hard-coded-text baselines are both empty, with tests that keep them empty (#923, #924, #928); a company's database is no longer recreated after deletion, and each connection compiles its models once (#921); third interface sweep with 21 fixes, including the automation dry run (#931).
  - **Owner decisions implemented:** 1 (#872), 2 (#861), 3 (#874), 7 (#865).
  - **Other:** console figures from stored chunk sizes, migration 043 (#895); tombstoned knowledge chunks purged after `KNOWLEDGE_TOMBSTONE_RETENTION_DAYS`, default 30 (#897); task keys in Ask (#882); spreadsheet and CSV text encodings (#888); step-credential renewal and heartbeats (#889); webhook and domain-event windows fixed from their first emit (#876, #879); agent notes per starter (#893); estimate history built on the server (#907); interface sweeps (#875, #886, #898, #903); i18n batches (#884, #885, #891, #892) and merge-clean pending files (#869); integration suites read only their own rows (#890).
- **Owner's local server:** build 661, rebuilt 2026-10-01 (frontend built). The PC restarted on 2026-09-30; Docker (`alianhub-mongo`) and the server were started again on 2026-10-01 through the `alianhub-api` launch entry. Earlier: build 593 (f94b134d, the newest green beta commit when rebuilt; its version label read 14.35.0 until #1136, restart to refresh); migrations 049–056 applied 2026-09-28 after a dry run (053: 67 agent runs, 054: 43 proposals, 056: 17 views added, the rest none); before that, migrations 044–048 applied 2026-09-28 after a dry run (044: 750 tasks, 045: 1 milestone, 046: 64 sample tasks, 047: 30 time logs, 048: none), frontend rebuilt 2026-09-27, migrations through 043 applied, frontend built. `.env` still sets `PR_SUMMARY_AS_DATA`, which nothing reads since #874 and can be removed. `GOOGLE_CLIENT_ID` is set, which Google sign-in now requires (#909). `node scripts/seat-check.js`: no memberships without an active seat. The other flags are as recorded on 2026-09-23 (`SKILL_EXTERNAL_READS=on`, `AGENT_EGRESS_ALLOWLIST=true`; the rest off until the owner's sweeps; `STORAGE_DOWNLOAD_SCOPE` in report).
- **Upgrade steps for a deployed instance:**
  1. `node scripts/audit-product-owners.js` (from #645) and review every account it marks REVIEW.
  2. `node scripts/seat-check.js` (from #913): company access now needs an active seat; it lists accounts that would lose access. Re-invite anyone who should stay.
  3. Migrations run at server start (013, 024–031 and later, through 048). Preview first with `npm run migrate -- up --dry-run`; check with `npm run migrate -- verify` (fixed by #1084 — before it, `-- verify` and `-- status` ran `up`). 044–048 convert stored reference ids to ObjectIds; each is guarded, idempotent and keeps `updatedAt`. 046 reports "cannot dry-run" when 044 is pending (it reads what 044 writes); its partial plan still lists the tasks.
  4. Google sign-in requires `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_CLIENT_ID`; the `*_OAUTH_REQUIRED` switches are gone (#909).
  5. SSO: people who are not yet members sign in only on DNS-verified domains; a configuration without verified domains admits its existing members only (#911).
  6. Invitations stored without a link token must be resent (#908). `POST /api/v2/email-cron-handler` is removed (#910). `TRUST_PROXY` accepts `true`, `false` or a hop count (#914).
  7. Removed routes: `POST /api/v2/sendMail` and `/api/v2/single-notification-email` (#919), `/api/v1/handleHistory` and `/api/v1/handleNotification` (#927), `POST /api/v1/app-notification/comment` (#929). Support chat mail now needs `SUPPORT_MAIL` in the server `.env` (#919). Verified SSO domains are re-checked daily at 03:30; three misses in a row mark a domain unverified (#925).
  8. Operator routes from #655 (`x-preset-key`, `POST /api/v1/setPresetCompany`), `TRACKER_PKCE_LEGACY_UNTIL` (#653), and the off-by-default flags listed in `docs/ENV.md` are unchanged.

## Next up

**From the ClickUp re-check (2026-10-01), in order:**
- **Missing custom field types** (people, URL, rating, progress, files): the one large gap left from the re-check. AI ratings are stored as numbers until a rating type exists.
- **Date pickers have no dark theme:** Workload's date-range input stays white and the calendar popup is light everywhere. The app's calendar stylesheet hard-codes light colours. Offered as a task chip.
- **Two small access follow-ups after #1202** (details in the owner's private notes): the project list's per-user cache is read before the seat check, and the project search endpoint reads the seat without the active-seat filter.
- **Not yet checked by eye:** the Burndown, Velocity and Ask cards on a dashboard, an `@agent` message in chat, the Gantt shift preview, doc comments and mentions, the automation gallery, and a drag in List and Board after #1195. See each slice's "Left for later" in the 044 and 045 progress files.
- **Owner decisions waiting** (from the re-check): nested subtasks, a task in several lists, subfolders, an Everything view, view templates, Goals, chat threads, doc presence and version history, in-form logic, agent connectors, a notetaker bot, a hotkey app, web search, a PWA shell; and where a working-days setting should live, so Gantt shifts can skip non-working days.

1. **In progress at handoff:** task 039's before-and-after screenshots; task 040's next field groups (history, notifications, mentions; customFields; task ids). The other session's open PRs for tasks 041/042 (#1116, #1121, #1122, #1124, #1125, #1129–#1136 at the time of writing). **Blocked by the permission system:** switching `.github/workflows/main.yml` to deploy from `beta` (owner chose beta on 2026-09-27); the staging VPS is 520 builds behind and would run migrations 024–048 on its first beta deploy. **Not started:** the minimised task tray and whiteboard positions are kept only in the browser (product decisions).
2. **Owner questions:** switch `PERMISSION_ENFORCEMENT_MODE` to enforce — the 2026-09-16 plan was after 14 days without would-be denials, and until then `requirePermission` checks only report for browser sessions (every gate added on 2026-09-28 is a hard check and does not depend on it); row 119 (decision 8 re-check once real downloads are logged); review existing Google sign-in links (details in the owner's private notes).
3. **Owner actions:** edit the held-out question set (decision 12; Sprint 9 waits, decision 13); the sweeps in rows 77, 83 and 94 (headless passes done in #903 and #931); the Sprint 5 workflow screens (task 028); Stats, Upgrade and the Docker label (task 033); the quota recompute; the duplicate migration 021; rotating the two API keys named in the owner's local notes.
4. **Open follow-ups:** 57, 77, 79, 83, 84, 89, 94, 96, 98, 101, 114, 119, 124, 127, 143, 149 in `Tasks/active/034-end-to-end-qa-programme/followups.md`. The #945 items are fixed (U5-28 by #990). Of the accessibility items only A11Y-O1 remains, as task 039 (O2 by #994, O3 by #991, O4 by #995, O5 by #989, O6 by 64e5274b, O7 by #978, O8 by #979). Task 013 keeps B.2 (deploy from beta — blocked, see above), V2 and V4 (owner and member sweeps).

## Owner decisions recorded

- **2026-09-30 to 2026-10-01:** start task 044 (the quick gaps) and task 045 (the medium gaps) from the re-check, every queued slice at once; after the restart, keep the load off the PC; merge each PR when its checks pass; rebuild the local server after each batch and check the new screens in dark mode. The owner has not yet answered whether to move the session to a cloud machine, whether to do the two access follow-ups, or whether to check local data for roles with no private-projects setting.

- **2026-09-28:** agent autonomy names follow the code (#1116): L0 "Answers and suggests", L1 "Suggests changes", L2 "Acts, you approve the rest", L3 "Acts, also on a schedule". The owner also asked that tasks 041–043 start all at once rather than queued.

- **2026-09-27 evening:** task 039 go; task 040 PRD confirmed (ObjectId, sprintArray first); deploy workflow from `beta` (not yet changed: the edit was blocked by the permission system); remove the legacy header fallback (done, #1064); tags show on List and Table rows (done, #1063); the rail mark stays lavender in dark mode.
- **2026-09-27:** public forms stay public. The share API refuses a password on a form link, since the form page never asks for one (#1038).
- **2026-09-26:** new passwords are pre-hashed (`bcrypt(base64(sha256(input)))`) with a stored format version and no new secret; older hashes keep working and upgrade at the next sign-in; 8–256 characters (follow-up 130, #1027). The owner skipped CodeRabbit for the batches (one review an hour on the current plan). Task 040 is written as a PRD before any migration code.
- **2026-09-24:** `--ink-3` is retired for text (row 113); company phone, state and city are optional on Settings → General (row 120); agent spend and budget stay visible to members (row 121); the darker upgrade-wall green stands (#937). Still open: whether to review or clear Google sign-in links made before #909.
- **2026-09-23 (answered as a set of 13):**
  1. A new manual time entry in an approved timesheet period is refused, like edits and deletes (follow-up 109).
  2. 40 stays the default daily run limit for every agent: an agent with no stored limit is capped at 40 a day on the server too; a stored 0 means no limit (#861).
  3. `SKILL_EXTERNAL_READS` alone runs the data version of `pr.summary`; `PR_SUMMARY_AS_DATA` and the code skill `prReview.js` are removed (follow-ups 103, 110).
  4. The unmerged `@Alian` mentions branch (`feat/alian-mentions-6d61`) is abandoned; the branch is left in place, not deleted.
  5. Under `MCP_OAUTH=both`, personal tokens keep working on `/mcp` for one more release, then OAuth only (follow-up 98).
  6. MCP discovery methods stay scope-free, as the MCP spec expects (follow-up 98).
  7. `AUDIT_CHAIN_KEY` cannot change; the server refuses to start if it does (follow-up 76). Key rotation will not be built.
  8. Stored-file downloads switch to enforce once seven days with real download traffic show no reported refusals. Checked 2026-09-23: no downloads at all since #794 (2026-09-21), so not switched yet.
  9. The sample and fixture tasks in "AlianHub Redesign" were moved to Trash (AR-1 to AR-8, AR-54 to AR-57; restorable).
  10. The test skill `qa.brief.summary` (retired) and agent "QA brief summariser" (deleted) from the acceptance run are removed.
  11. English-only locale keys stay English until a `TRANSLATE_API_KEY` is set (follow-up 57).
  12. The owner edits the draft held-out question set before the Sprint 7 comparison runs.
  13. Sprint 9 waits until Sprint 7's comparison passes.
- **2026-09-23:** when no verified-open work remains, free agent slots go to UI/UX improvements.
- **2026-09-16 to 18, Sprints 7 and 8:** enforcement mode per workspace with the instance value as default, ready to enforce after 14 days without a would-be denial; a departed member's private pages leave the knowledge index while shared content stays; erasure by person removes their private pages and their comments, never transcripts; agent-drafted pages are indexed and ranked below pages people wrote; erasure redacts personal fields in audit rows outside the hash; an audit row that changes is appended as a new chained row; the chain hash is keyed with `AUDIT_CHAIN_KEY`; existing API tokens without an expiry get 30 days; owners and admins see the workspace's tokens still needing an expiry; embeddings come from OpenAI `text-embedding-3-small`; an agent retrieves as the run's starter limited to the agent's projects; hosted vectors live in MongoDB Atlas Vector Search per tenant; the owner writes the held-out question set.
- Tasks 014 and 016 closed with only their member browser sweep outstanding (2026-09-12); the `agent` label in `Modules/Agents/taskSplit.js` stays (2026-09-12).
- Only owners and admins delete agents (#620). `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10 (#609). The `e2e` job runs on pushes to `beta` (#634). Webhooks reach private hosts only through an instance-owner allowlist (#647). Timesheet reads respect an admin's "Everyone" grant per screen (#635). `project.project_create` is enforced for API tokens but not for web sessions (#637). A private sprint is visible to its assignees plus owners and admins (#656).

## Things learned that affect the next session

- **Agents edit and push; CI runs the suites** (2026-10-01). Nineteen agents each running the full suites took the eight-CPU Mac to load 187 (68 jest processes) and it restarted, stopping every agent and wiping the scratchpad under `/private/tmp`. Only commits in worktrees survived. Since then an agent runs just the test files it touched, one worker, pushes early (right after the failing-test commit), and the integrator sends CI failures back. Nine such agents kept the load near 4–13.
- **`Agent` with `isolation: "remote"` is not a cloud agent in the desktop app.** It starts a local worktree agent. Stopped agents resume from their transcripts with `SendMessage`; `gh pr update-branch` merges `beta` into a PR on GitHub's side, with no local work.
- **A test can depend on the calendar** (2026-10-01). A fixture day chosen months earlier became "today", and times stamped during the run stopped being masked (#1201). When the same unrelated test fails on many PRs at once, look at `beta` and at the date first.
- **CI caught what each agent's own test files could not:** a removed response field that integration tests still read (#1187), a dialog that ran its setup while hidden (#1194), a pinned registry list (#1192), and four convention specs (guard-list quoting, `--ink-3` text, an unscoped rule sizing an `.ah-input`). Brief agents to run `v2-guard`, `route-guard-coverage`, `inkTextContrast.spec.js` and `uiSweepThirdPass.spec.js` alone before pushing.
- **Sortable's `put` as a function returning `true` accepts drops from every group**; return the group name to keep "same group only" (#1195 review).
- **A flex column with a max height squeezes children that have an explicit `min-height`** (#1204): the phone rule's `min-height: 44px` replaced the content-based minimum, so Board cards shrank and overlapped. Scrolling lists want `flex-shrink: 0` on their items.
- **Checking dark mode in the Browser pane:** screenshots shrink under an emulated viewport, so scan the DOM for light backgrounds at 1440 px and take screenshots at the pane's own size. A query-only route change keeps the command palette open, by design.
- **Merge order for a batch that shares files:** update every open PR with `beta` after a fix lands on it, queue them all, and expect each merge to put one or two others into conflict (locales at the end of the file, shared fixtures, view-settings constants). Before the last PR of a pair that edits the same component merges, update its branch so CI tests the combination.

- **An AI output posted where others read it may only use what every reader can open** (2026-09-28). Public `@ai` replies (#1168) and scheduled reports delivered to tasks or pages (#1165) were held until they followed this. Private answers keep the asker's full access. Check every new "AI writes into a shared place" feature against this rule.
- **Batches that add to shared registries conflict after every merge** (2026-09-28). The shared files are the five schema/collection files, `Modules/AICore/features.js`/`taskClass.js`, `Modules/AI/routes.js`, `frontend/src/config/env.js` and the locales. Resolve by keeping both sides and re-checking the braces in `utils/mongo-handler/schema.js`. Merge the first green PR at once and have the others merge beta again.

- **Two sessions can merge into `beta` at once.** Before writing `docs/BETA-LOG.md` or this file, run `git log -3 -- Tasks/HANDOFF.md docs/BETA-LOG.md` and `gh pr list --base beta` to see the other session's work; log every merged build, and leave another session's task progress files to that session.
- **A local rebuild never reinstalls with `--ignore-scripts`.** It leaves bcrypt's native module unbuilt and breaks sign-in. Reinstall only when a lockfile changed, with scripts on.
- **`requirePermission` only reports for browser sessions until `PERMISSION_ENFORCEMENT_MODE=enforce`.** A security fix needs a hard gate (owners and admins pass; otherwise evaluate the key with write access and refuse), as `Modules/Teams/teamWrites.js` does; `requireProjectAccess` permission lists are enforced unless `DISABLE_PERMISSION_ENFORCEMENT=true`.
- **Parallel batches collide on new i18n keys.** Two PRs that each add the same key with different text merge textually into a duplicate key, which fails lint and the build (follow-up 150). Reserve key names in batch briefs, or grep the other open branches before merging.
- **The pre-push hook checks the checked-out branch, not the pushed ref.** Push a merge resolution from a worktree whose branch name follows the convention; from the main checkout on `beta` the hook refuses.
- **A merge queue can resolve the routine conflicts itself.** `pending.json` (key union) and the dropdown baseline (lower count, both removals) resolve mechanically; anything else should stop the queue for a person.
- **After the Mac sleeps, macOS maintenance drives load past 100 for a while.** Hold new agents until it settles rather than reading it as our own load.
- **axe `target-size` is about geometry, not one control.** A 19px-wide link passes while nothing clickable is within its 24px circle, and a control half under an open popup counts as too small. Shortening some rows made the open Story Points menu half-cover the next control (#1016). Reproduce with `axe-core` injected into the dev preview, using the e2e's WCAG tags and the same popup open, instead of waiting for CI.
- **zsh does not word-split `$VAR`.** A list held in a variable reaches a command as one argument. Run such loops under `bash -c` or use `${=VAR}`; a resolver that got nine paths as one string failed with a confusing error.
- **The rehearsal pattern works.** Merge every PR in order on a throwaway branch, push it as a draft marked do-not-merge, merge the real PRs only when its CI is green, then check `origin/beta^{tree}` equals the rehearsal's tree. Two batches (38 and 13 PRs) went in this way with identical trees and green beta CI.
- **CodeRabbit's current plan allows one review an hour.** A batch of 30 PRs cannot wait on it. On 2026-09-26 the owner said to skip it for the batch; the integrator reviews each PR's diff instead, and access changes get the closest read.
- **Jest blames the next test file for a previous file's late failure.** A background promise that fails after its file has closed is reported against whichever file runs next in that worker, often as empty `●` blocks. Look for "after the Jest environment has been torn down. From <file>" earlier in the log (#1008).
- **Adjacent table rows conflict.** A docs PR that ticks follow-up rows 126 and 129 made the open PRs closing rows 125 and 128 conflict. Locale files, by contrast, merged cleanly in a 30-PR dry run. After ticking rows, merge beta into those PRs and resolve per row.
- **Features can leak in combination.** An invitation preview that said whether the address had an account looked safe, but admins can invite any address and hold the link, so together it became an instance-wide account check (#980 review). Ask what the combination reveals, not only each part.
- **Cap vitest too.** `npx vitest run --maxWorkers=2 --minWorkers=1`: uncapped, three agents pushed load to 34. After a frontend build, Spotlight re-indexing holds the load average high while the CPU is mostly idle; judge by `top -l 2 -n 0 -s 2 | grep "CPU usage"`.
- **Two PRs can each pass CI and break `beta` together.** #848 and #874 (a retired flag still used by a new test), #895 and #897 (a new stored field the other's clean-up did not reset), #908 and #909 (a changed signup contract and a new test fixture). Before merging a PR that retires or renames something, grep the open PRs for it; after a hand merge, run both PRs' suites.
- **One queue runner, not one watcher per PR.** Fifteen per-PR `gh pr checks` pollers used up the GitHub GraphQL budget and an agent could not open its PR. A single `gh pr list --json statusCheckRollup,mergeable,state` per cycle covers the whole queue; ignore a just-pushed head's old results for a few minutes.
- **Work that runs after the response makes tests flaky.** Background writes after a request answered (a signup's verification mail, Mongoose's unawaited index build on every freshly compiled model, a task's key set by a follow-up write) raced integration assertions three times on 2026-09-24 (#921, #930, #906). Wait until the value is stable, and prefer fixing the app so the write happens once (#921 compiles each model once per connection).
- **Wait for the value, not for any value.** A new task holds a placeholder key (`--`) until a follow-up write sets the real one; a fixture that waited for "a key" read the placeholder (#902, #906).
- **A test that echoes its input can pin a bug.** `project-all-task-update-allowlist` asserted the handler wrote `{ $set: <what it received> }`, which blessed a double `$set` the strict schema drops; `fakeMongo` accepted it. Assert the effect (the field and value written), not the shape received (#829).
- **Check a follow-up against `git log` before assigning it.** On 2026-09-23 three of six agents were given follow-ups (32, 56, 69) already fixed by #800 and `0ff95e7b`; the table still listed them open. Mark a row **Closed** in the same PR that fixes it.
- **CI tests the PR merged into `beta`, not the branch.** Generated files (`docs/ENV.md`) and suite order can fail only in the merge; when a slice's CI fails on a file it never touched, take `beta`, regenerate, and look for a shared-workspace collision before blaming the slice.
- **A merge-when-green script must require every named check to pass**, not only the absence of failures: backend, frontend, e2e, mcp-conformance, commitlint, PR title and branch name.
- **Review every PR that changes access, then re-review the fixes.** This week every such PR had defects after green CI: #740 (ids compared by case), #743 (two refusals enforce would have added), #744 (MCP reads ignoring the read scope), #745 (five result-loss bugs), #746 (a time-zone window), #747 (a full-collection scan on every task move), #749 (id shapes the guard skipped), #750 (five defects, then more in the fixes; three rounds). Ask reviewers to prove each rule's test fails without the rule, and re-review the fix round, not only the first version.
- **Merged is not reviewed.** On 2026-09-20 another session merged slices 8, 9 and 10 while their second review rounds were still open; the follow-ups (#782, #784) found real defects. Check an open review round before merging, whoever merges.
- **Agents stall** when a command is silent for ten minutes or the tool-approval service times out. Keep commands short, run long suites in the background and poll, commit after each step, and be ready to finish a stalled agent's work by hand from its worktree.
- **Agents stop while their own runs are still going, and can stall outright.** Brief them to run `gh pr checks --watch` in the foreground and not end the turn before it finishes. If one stops anyway, read its worktree and scratchpad logs, watch the run yourself, then resume it with `SendMessage`. If it stalls (no progress for ten minutes), start a fresh agent on the same worktree rather than reviving it.
- **Agents share one scratchpad: prompts must require a unique file prefix** (follow-up 26) so parallel agents stop overwriting each other's `pr-body.md`.
- **A unit spec that transitively requires `Modules/Sprints/controller.js` fails to parse** (`private` as a parameter name is fine in sloppy Node but not under jest's parser). Mock `../Modules/Sprints/controller` (and MainChats) like `role-catalogue.test.js` does; set `STORAGE_TYPE=server` before anything reaches `task_class_Mongo`.
- **A module the provider adapters require cannot destructure the provider registry at load**: the registry reassigns `module.exports` after the adapters load, so a captured reference stays empty — read `PROVIDER_NAMES` through a lazy `require` at call time (#778).
- **An emptied `Authorization: Bearer ` header arrives trimmed to bare `Bearer`**: treat it as absent (fall through to the cookie) rather than verifying it (#780). Reproduce browser-only auth bugs with system Chrome + `playwright-core` against a local server instead of theorizing.
- **A new frontend alias onto a backend module needs a `COPY` line in the Dockerfile's frontend stage**; `tests/conventions/docker-frontend-aliases.test.js` fails without it (#762). Any open PR that adds such an alias must add its line after merging `beta`.
- **Trace call sites before claiming what the web app sends.** A grep hit is not a caller: `git grep -E` has no `\s`, and a field set on an object is not proof the object is sent.
- **A commit subject over 100 characters fails commitlint and cannot be fixed on a pushed branch without a force-push.** Brief agents to keep subjects at 100 characters or fewer; if it happens, move the identical commits to a new branch and PR and close the old one.
- **GitHub's mergeability check can sit at UNKNOWN for many minutes**; `gh pr merge` may still go through. Confirm with `gh pr view --json state` rather than trusting the earlier status.
- **The `alianhub` MCP tools vanish from a session when localhost:4000 goes down**; keep the tracker current through its HTTP endpoint meanwhile. Pulling the owner's main checkout restarts nodemon; wait for `/health` before tracker calls.
- **Unfixed security details stay out of this repo.** They live in the owner's private notes; PR bodies and committed docs stay neutral until the fix merges.
- **Parallel agents:** five to six heavy agents with `jest --maxWorkers=2` kept the eight-CPU machine between load 5 and 19; wait for the one-minute load to drop below 8 before adding one.
- **Never `git stash` in a worktree.** Set work aside with a WIP commit; agents commit with `git -c core.hooksPath=/dev/null commit` and run eslint themselves.
- **Merge churn:** PRs that add i18n keys conflict on `*.pending.json` after each merge; keep every key from both sides. `docs/ENV.md` conflicts are resolved by taking beta's copy and re-running `node scripts/env-doc.js`. Slices that register collections in the same place (`Config/collections.js`, `Config/schemaType.js`, `utils/mongo-handler/createSchema.js`, `mongoQueries.js`) conflict on adjacent lines; keep both additions. Keep git's default merge subject.
- **Integration runs** need `--runInBand` locally, and the suite has the order dependency in follow-up 72.
- Agent worktrees have no `node_modules` and cannot source nvm; give agents `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:<repo>/node_modules/.bin:$PATH"` or symlink the parent's `node_modules`. Use `grep -a`; in zsh never name a variable `path`; the frontend builds with `vue-cli-service build`.
- **Demo team:** credentials in `.demo-accounts.local.json` at the repo root (gitignored); session tokens come from `npm run demo:token -- --email <demo email>`; see `docs/QA-DEMO-TEAM.md`.

## Handy commands

```bash
npm run nodemon             # backend on :4000 under Node 20
cd frontend && npm run build
npm run version:show
npm run migrate -- status
npx jest --selectProjects unit conventions --maxWorkers=2
E2E_MONGODB_URL=mongodb://127.0.0.1:<own port> npx jest --selectProjects integration --runInBand
cd frontend && npx vitest run
npm run i18n:check
```
