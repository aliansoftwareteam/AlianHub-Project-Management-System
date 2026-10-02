# 046 progress

State at build 766 (`14.36.0-beta.766`), 2026-10-02 01:10 IST. Tracker: AP-441.

How to read a line:
- `[x]` is merged into `beta`, with its PR and build number.
- "inside build 754" means the PR reached `beta` inside the combined PR #1332; "inside build 755" means inside #1343. GitHub shows each of those PRs as merged; `docs/BETA-LOG.md` has one row per build, so they have no row of their own.
- The later combined PRs read the same way: build 759 is #1357, 761 is #1378, 762 is #1395, 764 is #1399, 765 is #1401 and 766 is #1405.
- "In review (#n)" has an open PR.
- "Running" has an agent or a cloud run at work and no PR yet. "Not started" has neither.

Other files in this folder:
- `task.md`: the plan, and decisions 1 to 26.
- `design-hierarchy.md`, `design-m3-lists-and-goals.md`, `design-connectors.md`: the designs.
- `followups.md`: what each PR left, and the checks to do by hand.
- `dogfood-findings.md`: what running this task through AlianHub showed, and the hand checks on builds 754 to 766.
- `benchmark-25-jobs.md`, `scorecard.md`: the benchmark and the parity scorecard.
- The AI-run wave (decisions 27 to 30) is task 047; its slices are in `Tasks/active/047-ai-run/progress.md`, not here.

## M1 Foundation
**Track A — fields and views (A1)**
- [x] A1.1 Field types: people, URL, rating, progress (#1216, build 680)
- [x] A1.2 Field type: files (#1243, build 717)
- [x] A1.3 View templates (#1211, build 676)
- [x] A1.4 List density, and Board and List menu parity (#1212, build 677)
- [x] A1.5 Bulk timesheet approve (#1208, build 674)
- [x] A1.6 Field values checked on every write; AI field columns sort from the Table header; number, money and progress fields can be grouped; AI ratings use the rating type (#1236, build 703)
- [x] Field types: relationship and voting (#1298, build 747); exact vote counts, vote erasure and link clean-up (#1320, inside build 754)
- [x] A field is created from its name alone; number columns are totalled per List group (#1315, inside build 754)
- [x] Totals per Table group (#1360, from a cloud run, inside build 762)
- [ ] Field types: location and button. Not started.

**Track B — visual refresh (B0, B1)**
- [x] B0.1 Screenshot atlas of every screen (light, dark, desktop, 390 px) (#1221, build 691)
- [x] B0.2 Three reference screens in switchable variants (#1215, build 685)
- [x] B0.3 The dense variant is the default look, with the former look kept as "Classic" (#1259, build 724)
- [ ] B1.1 Convention test: no hard-coded colours or legacy classes, shrink-only baseline: in review (#1210). Its baseline is regenerated once the open visual PRs are in.
- [x] B1.2 Date pickers follow the theme (#1209, build 675)
- [x] B1.3 Screenshot check for the core screens: 11 screens, 30 shots, its own workflow (#1278, build 733). It runs on pushes to `beta` and on demand until a baseline is committed (#1342, build 756). The baseline is not committed yet; see `followups.md`.

**Track C — proof (C1 data set)**
- [x] C1.1 A seeded project with 10,000 tasks, speed budgets, first measurements (#1220, build 682)

**Carried over from task 045**
- [x] #1206: the project page offers custom fields to group by (build 672)
- [ ] Hands-on pass in the running app. Three agent passes ran (builds 672, 679, 705), the integrator checked builds 752 and 754 by hand, and the Supporter session swept builds 757 to 766. The screens still unchecked are listed in `dogfood-findings.md`.

## M2 Core
**Track A — hierarchy (A2).** The design is in `design-hierarchy.md`.

Nested subtasks, three levels:
- [x] N1 Task `ancestors`, the tree rules and migration 064 (#1218, build 690)
- [x] N2 Create paths set placement and `ancestors`; level-ordered import; migration 065 (#1226, build 696)
- [x] N3a Archive, delete, restore and move reach every level (#1238, inside build 712)
- [x] N3b Convert, merge and duplicate keep the tree; migration 066 (#1245, build 712)
- [x] N4 Three levels in the store and the List (#1254, build 718)
- [x] N5a The task panel adds and shows subtasks down to three levels (#1240, build 722)
- [x] N5b Board, Table and Calendar show three levels (#1275, build 737)
- [x] N6 Imports, rollups and exports follow three levels (#1268, build 725)

Subfolders:
- [x] F1 Subfolders on the server (#1219, build 681)
- [x] F2 Subfolders in the web app (#1235, build 694)
- [x] Folder row actions: rename, archive, delete; folders in the Trash (#1247, inside build 711)
- [x] Duplicate a project with its folders, lists, statuses and views; replaces F3 (#1257, build 711)
- [x] A new list is created in the folder you are in (#1265, build 731)

Everything view:
- [x] E1 The endpoint, the query builder and migration 067 (#1250, build 713)
- [x] E2 The Everything page, List mode (#1260, inside build 720; closed on GitHub after its commits merged inside #1262)
- [x] E3 Board and Table modes, and saved views (#1262, build 720)
- [x] E4 Measured at 10,000 tasks with one project and with 301: every budget met (#1324, inside build 754). Numbers in `docs/PERFORMANCE.md`.

**Track B — core screens (B2)**
- [x] B2.1 The project toolbar, tree, tabs and cards on design tokens (#1280, build 741); data tables on the row type size (#1285, build 749)
- [x] B2.2 Home, the Inbox and the Docs hub share one type scale and spacing (#1290, build 746)
- [x] B2.3 The Board and the Table on design tokens (#1311, inside build 754)
- [x] B2.4 Chat and dashboards (#1316), the Gantt and the calendar (#1318), both inside build 754
- [ ] The Shell (rail, header) and the task panel have no slice of their own yet. Not started.

**Track C — speed fixes (C1)**
- [x] A status group loads all of its tasks, and the List opens without a wait (#1246, build 710)
- [x] Only the language in use is loaded: the entry file went from 7.85 MiB to 2.58 MiB (#1339, inside build 755)
- [x] A smaller first load, 7.1 MB to 2.3 MB, with a size budget (#1351, inside build 759)
- [x] The five everyday task edits show at once and return on a refusal (#1372, inside build 761)
- [ ] 50,000 tasks seeded and measured. Not started.

## M3 Depth
**Track A — a task in several lists, and Goals** (moved here from A2 by decision 2). The design is in `design-m3-lists-and-goals.md` (#1277, build 732).
- [x] L1 and L2: a task can be added to more lists, with its home deciding who sees it; migration 069 (#1309, inside build 754)
- [x] L3 and W1: extra lists follow moves and converts, and show in the task panel (#1334, inside build 755)
- [x] L4, L5 and W2: a task shows in the lists it was added to (#1347, inside build 759)
- [x] W3 and W4: rows from other projects in a list, and a task's lists in Everything and search (#1371, inside build 761)
- [x] L6: MCP tools to add a task to another list, take it out and search a list's rows (#1369, inside build 761)
- [x] G1 Goals with targets a person updates, and who may see them (#1291, inside build 754)
- [x] G2 A target can count finished tasks from lists and tasks (#1308, inside build 754)
- [x] G3 The Goals page (#1310, inside build 754)
- [x] G4 The page draws and edits a target counted from tasks (#1327, inside build 754)
- [x] G5 and G6: goals on Home and on a task; migration 070 (#1335, inside build 755)
- [x] Reached notices, a count that ends, and linking from a task or a list (#1341, inside build 755)
- [x] G7 Goals for outside agents (#1348, inside build 759)
- [x] G8 An AI summary of a goal, on request (#1363, from a cloud run, inside build 762)

**Track A — collaboration depth (A3)**
- [x] Automation engine: "due date passed" and "all subtasks done" triggers and a notify action (#1222, build 684)
- [x] Chat threads (#1228, build 695)
- [x] Doc version history, with what changed and restore (#1231, build 692)
- [x] Doc autosave, and a version before a save loses text (#1319, inside build 754)
- [x] Doc comments can be assigned, reacted to and carry files (#1287, build 744)
- [x] One rule for who reaches a doc page (#1326, inside build 754)
- [x] Share a doc with people by name (#1345, inside build 759)
- [x] Read-only docs for readers, and what a guest may do with docs (#1352, inside build 759)
- [x] Whiteboards are saved on the server (#1300) and have notes, text and touch dragging (#1321), both inside build 754
- [x] Form questions can show or hide depending on earlier answers, with no script on the public page (#1292, build 748)
- [ ] Doc presence (who else is in the doc). Not started.
- [ ] Two-way calendar sync. Designed in `design-connectors.md`; paused with connector slices 4 to 6.

**Track A — platform (A5)**
- [x] Save a project as a template and start a project from one (#1282, build 743)
- [x] The ClickUp import brings comments, fields, checklists and tags (#1288, build 745)
- [x] Imported descriptions show in the task panel, and every importer imports quietly (#1299, inside build 754)
- [x] Importing again does not duplicate, and an import can be undone (#1338, inside build 755)
- [x] An update from the file moves a status the way a person does (#1356, inside build 761)
- [x] A public API reference generated from the routes (#1297, build 751)
- [ ] The app can be installed and its shell opens offline: in review (#1306). Held: it merges alone, after its own rebuild and the 14 hand checks.

**Track B — legacy screens (B3)**
- [x] Batch 1: reports, time off and identity settings (#1279, build 735)
- [x] Batch 2: timesheets, shared pickers and older settings pages (#1293, inside build 754)
- [x] Batch 3: menus, dialogs and alerts (#1303, inside build 754)
- [x] Batch 4: sidebars (#1329, inside build 754)
- [ ] Remove the legacy stylesheets and utility classes once nothing uses them. Not started; the counts are in `followups.md`.

**Track C — phone (C2)**
- [x] Sweep 1: twelve screens fit 390 px (#1296, build 752)
- [x] Sweep 2: the remaining screens, scoped star rules, a toolbar that can wrap (#1325, inside build 754)
- Installable: #1306, listed under A5.
- [ ] Readable offline. Not started.

## M4 Lead and proof
**Track A — AI lead (A4)**
- [x] Working days per company, with a per-project override (#1225, build 688), used everywhere (#1239, build 699)
- [x] The Ask card keeps its answer (#1266, build 734); AI columns show kept values and generate on request, and an answer can be posted to chat (#1295, inside build 754)
- [x] Area generation is booked to the budget, and model timers are cleared (#1302, inside build 754)
- [x] Talk to Text spend is booked, and a self-approved timesheet week is recorded (#1333, inside build 755)
- [x] Connectors: the design for Gmail, Google Calendar and Slack (#1340, inside build 755)
- [x] Connector slice 1, a Slack message an agent proposes and an owner or admin approves (#1350, inside build 759). Off by default; no screen and no real Slack call has been seen.
- [x] Connector slice 2, an agent run reads an allowed Slack channel (#1362, inside build 761)
- [x] Connector slice 3, a person's Google connection (#1381, inside build 762). It needs the owner's Google client before it can be tried.
- [ ] Connector slices 4 to 6 (the calendar one way and two way, calendar agent tools). Paused; see the decisions below.
- [ ] A web research tool. Not started.
- Connector slices 7 to 9 (Gmail read, Gmail draft, production) moved to a follow-up task; see the decisions below.

**Track A — MCP parity (A6)**
- [x] Part 1: update, assign, move, archive and restore tasks; set a field; list fields, subtasks and members (#1261, build 719)
- [x] Part 2: finish, create and batch work, and write docs (#1270, build 728)
- [x] The manage grants over OAuth, with consent and approval (#1307, inside build 754)
- [x] Part 3: tags, task links, lists and doc comments (#1337, inside build 755)
- Goals for outside agents (#1348) and extra lists through MCP (#1369) are listed under M3. The MCP work after part 3 is task 047.

**Track B — finish (B4)**
- [x] Accent colour choice and motion tokens (#1322, inside build 754)
- [x] Illustrated empty states and keyboard hints (#1328, inside build 754)
- [x] A five-step setup card and a four-stop first-visit tour (#1354, inside build 759)
- [x] A refreshed sample project for a first visit: folders, deep subtasks, fields, a doc, a goal and a second list (#1370, from a cloud run and finished locally, inside build 765)
- Optimistic updates are listed under M2, Track C.

**Track C — reliability, switching, the benchmark (C3, C4, C5)**
- [x] C3 slice 1: ten everyday flows covered end to end, a console guard, `docs/E2E-FLOWS.md` and `docs/KNOWN-ISSUES.md` (#1323, build 757)
- [x] C3: no console errors on the milestone report, the task panel and Home (#1346, inside build 759)
- [ ] C3 slice 2: the next batch of core flows: in review (#1361, from a cloud run). It was written on an older base and its backend and e2e checks failed; a local agent has to bring it up to date.
- [x] Tests do not depend on the day they run (#1314, build 753; #1336, inside build 755)
- [x] The unit suites run with the clock moved forward (#1359, from a cloud run, inside build 764)
- [x] C4: the "moving from ClickUp" guide, with a 40-row sample export imported end to end (#1331, inside build 754). A real export has not been imported.
- [x] C5: the 25-job benchmark, the scorecard and a first measured run on build 705 (#1301, inside build 754)
- [x] C5: a second run on build 754 (#1358, inside build 761). 21 jobs done, 3 partly, 1 blocked (first run: 19, 5, 1); the same or fewer steps than ClickUp on 12 of 25 (first run: 8; the finish line is 22).
- [x] Fixes for what the second run found: #1375 (inside build 761), #1377 and #1379 (inside build 762). What each fixed, and what is still open, is under "From the second benchmark run" below.
- [ ] A third run, on a build that has those fixes. Not started.

## Access, storage and the desktop tracker
Titles only; see the private notes.
- [x] #1213 (build 678): the project list and project search check the active seat first
- [x] #1217 (build 683): archive search, project search and task queries follow project visibility
- [x] #1223 (build 693): MCP reads and scheduled deliveries leave other people's personal lists alone
- [x] #1233 (build 701): timesheets, dashboard totals and trash leave other people's private work alone
- [x] #1241 (inside build 709): agent records leave other people's private work alone
- [x] #1244 (build 709): dashboard cards, timesheet joins and planned hours leave private work alone
- [x] #1253 (build 708): removing a file needs access to what the file belongs to
- [x] #1256 (build 715): captures and copied comment files stay within what the caller owns
- [x] #1258 (build 716): the desktop tracker stops and says so when its timer was stopped elsewhere
- [x] #1283 (build 740): epic and portfolio numbers count only what the viewer can open
- [x] #1294 (build 750): a portfolio is removed by its creator, and plan moves check the task
- [x] #1263 (inside build 754): the member list returns the fields the app shows
- [x] #1276 (inside build 754): task reads follow the same list permission as the web app
- [x] #1286 (inside build 754): task writes check where they land and who they name
- [x] #1313 (inside build 754): agent tokens, linked tasks and computed fields keep to the task rules
- [x] #1304 (inside build 754): older text descriptions render as text and markdown
- [x] #1312 (inside build 754): the docs editor draws a page the way its preview shows it
- [x] #1330 (inside build 754): the page readers give the same answer
- [x] #1353 (build 758): a room is joined only by people who can open what it shows
- [x] #1344 (inside build 759): relation answers, agent route checks and write input checks
- [x] #1355 (inside build 759): doc routes for agent tokens, bulk status and tag values, list rename company
- [x] #1349 (inside build 759): descriptions and doc pages are stored as the editor draws them
- [x] #1367 (inside build 761): live events name the company they were written in
- [x] #1368 (inside build 761): doc writes follow the rules of the routes beside them
- [x] #1382 (inside build 762): agent drafts, task changes and room pings follow the routes beside them

## Fixes from the hands-on QA passes and the benchmark
**From pass 1 (build 672) and the first speed measurements**
- [x] #1224 (build 686): dashboard cards load their content
- [x] #1227 (build 687): task types are offered for a field; a date field shows in the task panel
- [x] #1229 (build 689): a new doc lands in the selected project; share dialogs stay open
- [x] #1230 (build 697): the live agent panel refreshes once per change; a busy server says so
- [x] #1232 (build 698): a subtask row can be assigned; its parent stays open after an edit
- [x] #1234 (build 700): date limits and field messages work in every language
- [x] #1237 (build 704): the public link dialog follows the theme; "New doc" is offered where "New task" is
- [x] #1242 (build 705): a doc in the command palette opens the doc

**From pass 2 (build 679)**
- [x] #1248 (build 702): the Board card menu and the merge and convert sidebars follow the theme and fit
- [x] #1249 (build 706): opening the Table no longer fails to save the task order
- [x] #1251 (build 707): private view copies are marked; templates are easy to reach; popups follow the theme
- [x] #1252 (build 714): the task panel reads in dark mode; small layout slips on Home, Docs and Create project
- [x] #1255 (build 723): move, duplicate and convert send plain values; index repair covers every group

**From pass 3 (build 705)**
- [x] #1272 (build 729): dark mode batch 2
- [x] #1284 (build 742): dark mode batch 3
- [x] #1269 (build 736): the task name keeps its width when many columns are shown
- [x] #1271 (build 727): default task types show their bundled icon without a request
- [x] #1274 (build 730): the automation builder starts in its project and explains itself plainly
- [x] #1273 (build 739): duplicating a task keeps the assignees and watchers you chose
- [x] #1281 (build 738): a task stores only the list fields it needs; migration 068
- [x] #1289 (inside build 754): adding or removing a project on a field does not overwrite other changes

**From the benchmark's first run**
- [x] #1317 (inside build 754): one list menu everywhere, a way into Approvals, reopen an approved week
- Quick field create (#1315) and the doc's first-edit version (#1319) are listed above.

**From the hand check on build 754**
- [x] Calendar tab, dark: collapsed lists sat on a white card. Fixed on `fix/calendar-collapsed-lists-dark`, which has no PR of its own and reached `beta` inside #1357 (build 759).

**From the second benchmark run (build 754)**
- [x] #1375 (inside build 761): duplicating a project with no currency set; "Add subtask" keeps its own focus; a rollup is filled when the field is made or changed; "list" and "folder" wording in 16 strings
- [x] #1391 (inside build 762): the currency #1375 picked was empty on a seeded company; one helper now answers it
- [x] #1377 (inside build 762): a timer start is refused in an approved week; one total on the Approvals card; timesheets come first on its All tab
- [x] #1379 (inside build 762): removing an assignee no longer removes the wrong person; a one-person picker closes; a date-only field stores a date; quick create lists the creator
- Not a defect: the panel's subtask limit. Task, subtask and sub-subtask are the three levels everywhere, and the panel already says so at the limit.

**From the Supporter session's hand-check sweeps (builds 757 to 766)**
- [x] #1366 (inside build 762): property rows in the task panel keep their height; the goal chip fits
- [x] #1373 (inside build 762): the import dialog loads a project's lists when it is picked
- [x] #1374 (inside build 761): a company is remembered from the address only when the person holds it
- [x] #1384 (inside build 762): sweep 1: popover clamp, `<html lang>`, the import table and rows at 390 px, the whiteboard note's place
- [x] #1385 (inside build 762): a group a task moves into updates its count, and so do the list header and the sidebar
- [x] #1388 (inside build 762): calendar sprint lanes, the doc share list and switch, a real placeholder for a new doc title
- [ ] In review (#1389): the title saves on blur, panels follow their route, no bare avatar request, Undo on "Remove from this list"
- [ ] In review (#1403): the Add View menu stays inside the window. #1384's clamp ran before the menu had its content.
- The defects still open after the sixth sweep are in `followups.md`, under "Added at build 766".

**Tooling**
- [x] #1264 (build 721): `docs/ENV.md` regenerated
- [x] #1305 (inside build 754): a stale env doc is a warning in a pull request, not a failure
- [x] #1342 (build 756): task notes skip the suites
- [x] #1365 (inside build 761): the 046 progress, decisions and builds 721 to 758
- [x] #1376 (build 760): a draft pull request skips the suites until it is marked ready
- [x] #1383 (inside build 762): each group of agent registry entries in its own file
- [ ] The API reference caught up with the routes: in the docs PR of 2026-10-02, which describes 38 routes and regenerates both files. The cloud PR #1364 did part of it on an older base and is replaced by that PR; close it.

## Decisions taken on 2026-10-01 and the night after
These follow decisions 1 to 26 in `task.md`. The integrator took them under the owner's "make your own decisions"; the ones marked "owner" are the owner's own. Each is its own slice, flag or setting, so each can be overruled.

Connectors (`design-connectors.md`, #1340):
- Slack comes first, connected by a pasted bot token, with no OAuth.
- Google uses its own OAuth client, separate from the sign-in client.
- Every write to an outside service is a proposal a person approves. Gmail is never sent; a draft is the most an agent makes.
- After an agent reads from a connector, that run may not fetch from the web.
- A private list's tasks are never put on the calendar in the first version.
- Slices 7 to 9 (Gmail read, Gmail draft, production) move to a follow-up task. The Gmail scope question moves with them.
- A failed Slack send keeps the proposal "approved" with the error on its card; there is no send-again (#1350).
- Slices 4 to 6 (the calendar) are paused after slice 3 (#1381). With decision 30 a person's own AI brings its own calendar and mail connectors, so the agent slots went to task 047.
- Owner: the owner types every credential. The integrator builds each connector up to the sign-in step and then says so.

Docs:
- On someone else's private doc, only the author manages the share list (#1345).
- A guest reads and comments on the docs they reach, and edits only a doc shared with them by name as an editor (#1352).
- A replaced doc state is kept as a version when another person wrote it, when the newest version is over ten minutes old, or when the save loses a large part of the text (#1319).
- Owner: yes to `sanitize-html` on the server. It is pinned to 2.17.5, because 2.18 needs Node 22.12 (#1349). Owner: the project moves to Node 22 later.

Tasks, fields and imports:
- Imports are quiet: no notification or unread count per imported row (#1299). An imported comment keeps its author only when an owner or admin runs the import (#1288).
- Linked task ids and voter ids live in their own collection, not on the task (#1298).
- A task's home list alone decides who sees it; an extra list never grants access. A trashed list keeps its entry and the name returns on restore (#1309, #1334).
- A goal shared with named people is read by its owner and those people only. Tasks in a closed list or project still count toward a target (#1291, #1308). The Home "Goals" card is off by default (#1335).
- A whiteboard follows its list on every request: trashed is gone, archived is read-only, restored is back (#1321).
- The public form page keeps its no-script rule; show-and-hide rules run on the server (#1292).
- A bulk status or tag change that mixes allowed and refused tasks skips the refused ones and reports them; it fails only when every task is refused (#1355).
- An import's "update from the file" moves a status the way a person does, quietly, and a status the project lacks is reported, not replaced by the first one (#1356).
- A date-only field stores the day at local midnight (#1379).
- A list's header and sidebar count stay home-only: a task added from another list is shown and not counted. A "+N added" hint needs a count from the server and was not built (#1385).
- The quick field "+" in a List header was never built, and is not being built: task 047 makes fields from a sentence.
- The undo of an import keeps a field that has since been made a field of every project (#1356).

AI and MCP:
- A task summary and the List's AI columns are generated on request, not on open (#1266, #1295).
- With the manage grant, an agent may set a task Done. It is recorded as closed by the person "via agent", and refused when the workspace asks for a check before Done (#1270).
- The part 3 tools sit behind a new flag, `MCP_TOOLS_WORK`, off by default (#1337).
- Talk to Text is booked at a price per minute held in a setting (#1333). Owner: an owner may approve their own timesheet week, and it is recorded as self-approved.
- Decisions 27 to 30 (in `task.md`): three more finish lines, "AI-run", "anyone can use it" and "no manual", and the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP. Owner: decision 30 confirmed in chat at about 22:09 IST. The work is task 047.
- No new feature wave starts while more than 15 merged builds are unused, and no more parity features (field types, whiteboard, dashboard cards, legacy polish) take a new agent slot.

Design and speed:
- The project tree keeps one density; it does not follow the open view (#1280).
- The accent colour is kept per browser, like the theme (#1322).
- No global `box-sizing` change: it would move most screens (#1325).
- No extra sort indexes for the Everything view at 10,000 tasks (#1324).

How the work runs:
- Owner: one combined PR per batch, so the suites run once for many changes.
- Owner: 8 agents on the PC, plus 6 cloud runs for work that needs only the repository. Overnight, with the owner asleep, the coordinator held at three to five local agents and started no new cloud runs, to keep the weekly plan limit.
- Agents open draft PRs, and a draft skips the suites (#1376). The combined PR runs them once.
- A cloud PR written on an older base is brought up to date by a local agent before it joins a batch (#1370 was).
- Stay on GitHub Free. The paid plans' extra minutes matter only for private repositories.
- The screenshot check runs on `beta` and on demand until it has a baseline, and a PR that only changes task notes skips the suites (#1342).
- #1306 (the installable app) merges alone, after its own rebuild and hand check.
- Owner: after merges that add or change a route, the docs PR runs `npm run api:doc` (now in `CLAUDE.md`, Rule 4).

## Open decisions for the owner
1. Switch stored-file downloads to enforce (`STORAGE_DOWNLOAD_SCOPE=enforce`).
2. Turn on `MCP_OAUTH`, `MCP_TOOLS_MANAGE`, `MCP_TOOLS_DATA` and `MCP_TOOLS_WORK` in the local `.env`, and connect the owner's Claude with the manage grant. Task 047's AI-4a, AI-4e and AI-1 wait for it.
3. Switch `PERMISSION_ENFORCEMENT_MODE` to enforce.
4. Billing numbers: count tasks in a private list for every project member, or only for the people on that list (#1283).
5. Guests: whether they see the member list and company-level docs (#1326), and whether forms, whiteboards and public links follow the new doc rule (#1352).
6. The Home "Goals" card: on by default or not (#1335).
7. Confirm the Talk to Text price, `WHISPER_USD_PER_MINUTE` 0.006, against the vendor's price page (#1333).
8. Gmail's restricted scopes: internal only, Google verification, or testing mode. Needed before the Gmail slices, which are now in the follow-up task.
9. `git` on this Mac has no `user.name` or `user.email`, so commits are not linked to a GitHub account.
10. A task in a Scrum sprint and in the backlog at once: the M3 design refuses it (#1277).
11. Live show-and-hide on the public form page would need a script there (#1292).
12. A first import still lets automations run once per imported task (#1356, merged): keep or silence.
13. #1352 is merged and live on the local build: a doc a guest wrote earlier is now read-only to them, and a public doc link a guest made no longer works.
14. Cloud runs get the account's connectors attached. Their briefs say to use none; the owner may want to remove them. One duplicate cloud run (the moved-clock job) cannot be stopped from the session; the owner can stop it.
15. #1350 is merged and on the local build, so the Slack connector can be tried: the Slack app and the four `.env` lines (steps A and B in `design-connectors.md`). For slice 3, a Google client and two more `.env` lines (the steps are in #1381).
16. New date fields default to "allow time", which is why a date still needs a press on Select (#1379): flip the default or keep it.
17. The tracker: an agent cannot set a subtask to Done, so more than 86 subtasks of merged PRs wait for the owner to close them, or for the MCP flags.
18. CI is on GitHub Free (20 jobs at once). A Team plan would give 60 for money; the recommendation is to stay on Free now that drafts skip the suites.
19. The Claude plan: the weekly limit was at 24% at 01:00 IST and rises about 2% an hour at three to four agents; extra usage is off. Pace, or turn extra usage on (money).
20. Two hand checks need a second person: the unread counts in a second account, and a doc opened as a view-only reader.
21. A timer that is running when its week gets approved loses its tracked time at Stop (#1377 found it). The coordinator may fix it; say if it should wait.

## Log
- 2026-10-01: the owner confirmed the plan with the recommended definition of "great" and asked to start M1. Wave 1 started at about 12:25: A1.1, A1.3, A1.4, A1.5, B0 (atlas and variants), B1.1, B1.2, C1.1.
  - Agents run only the test files they touch and leave the full suites to CI, after the overload of 2026-09-30.
  - A slice counts as done only after its main flow is used in the running app: #1191 passed CI with its headline feature not working on the project page.
- 2026-10-01, later: the owner said to continue without waiting and to make the decisions. The plan's seven decisions were taken as recommended (see `task.md`), and the ten hierarchy questions as recorded in `design-hierarchy.md`.
- 2026-10-01, QA pass 1 (build 672). Five fix agents started at about 13:10. Deferred: the Gantt shift preview shows only on a drag, and the preview panel covers the bars.
- 2026-10-01 13:09: local build 679.
- 2026-10-01, QA pass 2 (build 679).
  - Passed: date pickers on eight surfaces, view templates, List density, menu parity, group by custom field.
  - Not tested: bulk timesheet approve, the "left out" toast, saving the Table density.
- 2026-10-01, about 13:59: local build 693. Migration 064 ran at start.
- 2026-10-01: the nested-subtasks slices were merged as one unit; see decision 19 in `task.md`.
- 2026-10-01: access fixes push the test and the fix together, with neutral names and text, and go to the front of the queue. Every other slice still pushes its failing test first.
- 2026-10-01, about 14:35: the owner asked how much work is left, and why this work is not run through AlianHub itself. At about 14:40 the owner said to use Claude on the owner's plan through MCP where possible. MCP parity started (Track A6).
- 2026-10-01 14:42: local build 705.
- 2026-10-01, about 14:58: the Claude plan's session limit was reached. Three agents stopped and were resumed.
- 2026-10-01, about 15:25, QA pass 3 (build 705): 15 of 16 items passed by use. The defects went to three fix agents.
- 2026-10-01, 15:30 to 16:40, the load test the owner asked for, on 8 CPUs:
  - 8 agents: average load 5.9, highest 10.2. 10 agents: 7.7, highest 11.8. 12 agents: 11.0, highest 17.6.
  - 14 agents: 9.8, highest 12.1. 15 to 16 agents: 6.0, highest 7.2. 17 to 18 agents: 9.9, highest 16.2. 20 agents: 11.4, highest 14.6.
  - Free memory never fell below 37%. The load follows how many agents run tests at the same moment, not the count of agents.
  - The tool refuses a 21st agent. 20 is its limit.
- 2026-10-01 15:50: `beta` at build 720.
- 2026-10-01, about 17:16: the plan's weekly limit stopped all 20 agents. After the owner's "Try again" they were resumed in two batches, each told to be economical.
- 2026-10-01, about 17:30: every CI run on `beta` went red. A chat test compared a reply made "now" with one pinned to 12:00 UTC on the same day. #1314 pinned both times (merged 18:26, build 753). About 19 doomed CI runs were queued ahead of it; cancelling them was refused by the session's permission check and was not retried.
- 2026-10-01 17:52: local build 752. Migrations 066 to 068 ran. A hand check on it found nothing wrong.
- 2026-10-01, about 18:20: the owner set the agent count to 8.
- 2026-10-01, about 19:20: the owner chose one combined PR over 25 separate CI runs. #1332 carries #1314's followers: 37 PRs, each with its own merge commit.
  - Combining found one real defect: an AI task reader used a helper that another PR in the batch had removed. Fixed as its own commit.
  - Local runs before the push: the backend suite (18,657 tests; nine files failed under load and passed alone) and the frontend suite (466 files, 7,463 tests).
  - CI took three rounds: three integration files, then one end-to-end selector.
- 2026-10-01, about 20:05, the owner answered three open items: credentials are typed by the owner only; yes to `sanitize-html`; yes to the `api:doc` line, the Talk to Text booking and the self-approval record.
- 2026-10-01 20:52: #1332 merged, build 754. Local build 754, 64 migrations applied, none pending.
- 2026-10-01, about 21:00: a hand check on build 754. One defect, fixed; see `dogfood-findings.md`.
- 2026-10-01 21:20: #1343 merged, build 755, carrying nine PRs. 21:22: #1342, build 756. 21:24: #1323, build 757.
- 2026-10-01, evening: the owner decided on 8 agents on the PC plus cloud runs, and Node 22 later.
- 2026-10-01 21:38: #1357 opened, the third combined PR, with twelve PRs and the calendar fix.
- 2026-10-01, about 21:45: six cloud runs started, for work that needs only the repository: the moved-clock CI job, Table group totals, the goal summary, the next e2e flows, the API reference catch-up and the sample project. The moved-clock run started twice by mistake; the owner can stop the duplicate.
- 2026-10-01, about 21:47: the second benchmark run finished (#1358). Its worst findings went to a fix agent; they are in `followups.md`.
- 2026-10-01, about 21:50: local build 757, migrations through 070 applied, none pending. A second local session, the "supporter", hand-checks the second batch on it and sets tracker subtasks to Done.
- 2026-10-01 21:51: #1353 merged, build 758.
- 2026-10-01 21:55: `beta` is at build 758. GitHub shows 159 PRs merged today, in 110 builds (649 to 758). Forty-nine of them have no build of their own: 37 inside #1332, 9 inside #1343, and #1238, #1241 and #1247 from earlier in the day. #1260 also reached `beta` inside another PR, and GitHub shows it closed, not merged.
- 2026-10-01, about 22:05: an advisor session reviewed the task at the owner's request. Its three notes and the coordinator's reply became decisions 27 to 30 and task 047. The notes file is in the main checkout, not committed.
- 2026-10-01, about 22:10: CI was congested (5 runs in progress, 12 queued), and the third batch's second round waited over 15 minutes behind single-PR runs. #1376 makes a draft PR skip the suites.
- 2026-10-01 22:18: #1357 merged, build 759, carrying eleven PRs and the calendar fix. Its first round failed on a fixture whose cursors had changed and on a test worker that ran out of memory; both were fixed on the branch.
  - Combining found a defect again: two PRs changed the same socket relay, and one called a helper the other had renamed. One relay was kept.
  - The local server was rebuilt to build 759 at 22:24.
- 2026-10-01 22:43: #1376 merged, build 760.
- 2026-10-01 23:15: #1378 merged, build 761, carrying eleven PRs. Its frontend round failed once: a spec that mounts `App.vue` must mock `@/config/warmChunks`. Local build 761 at 23:18.
- 2026-10-01 23:29: #1395 merged, build 762, carrying nineteen PRs: the 046 fixes above, connector slice 3, and the first 047 slices. 23:32: #1394, build 763 (task 047). Local build 762 at 23:33.
- 2026-10-02 00:03: #1399 merged, build 764 (#1359 from this task, and three 047 slices). Local build 764 at 00:06.
- 2026-10-02 00:34: #1401 merged, build 765 (the sample project, #1370, and Home's "What next", #1400). Its first backend round failed: a convention test caught that a helper added as a method of the task write mixins had become a task action. It was moved to its own module before the merge. Local build 765 at 00:38.
- 2026-10-02 00:52: #1405 merged, build 766 (task 047). Local build 766 at 00:56.
- 2026-10-02 01:10: `beta` is at build 766. Since build 758, GitHub shows 57 more PRs merged, six of them the combined PRs, in eight builds (759 to 766). The Supporter session swept builds 757, 759, 762, 764, 765 and 766 by hand; the results are in `dogfood-findings.md`.
