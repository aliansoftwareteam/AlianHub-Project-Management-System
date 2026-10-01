# 046 progress

State at build 720 (`14.36.0-beta.720`), 2026-10-01 15:50 IST. Tracker: AP-441.

How to read a line: `[x]` is merged into `beta`, with its PR and build number. "In review (#n)" has an open PR. "Running" has an agent at work and no PR yet.

Other files in this folder:
- `task.md`: the plan, and every decision taken so far.
- `design-hierarchy.md`: the M2 hierarchy design and the Everything endpoint contract.
- `followups.md`: what each PR left, and the checks to do by hand.
- `dogfood-findings.md`: what running this task through AlianHub's own MCP endpoint showed.

## M1 Foundation
**Track A — fields and views**
- [x] A1.1 Field types: people, URL, rating, progress (#1216, build 680)
- [x] A1.2 Field type: files (#1243, build 717)
- [x] A1.3 View templates (#1211, build 676)
- [x] A1.4 List density, and Board and List menu parity (#1212, build 677)
- [x] A1.5 Bulk timesheet approve (#1208, build 674)
- [x] A1.6 Field values checked on every write; AI field columns sort from the Table header; number, money and progress fields can be grouped; AI ratings use the rating type (#1236, build 703)

**Track B — visual refresh**
- [x] B0.1 Screenshot atlas of every screen (light, dark, desktop, 390 px) (#1221, build 691)
- [x] B0.2 Three reference screens in switchable variants (#1215, build 685). The integrator picked variant B; see decision 24 in `task.md`.
- [ ] B0.3 The dense variant (B) becomes the default look, with the former look kept as "Classic": in review (#1259)
- [ ] B1.1 Convention test: no hard-coded colours or legacy classes, shrink-only baseline: in review (#1210). Held until the open visual PRs merge, then its baseline is regenerated once.
- [x] B1.2 Date pickers follow the theme (#1209, build 675)
- [ ] B1.3 Screenshot regression test for the core screens: running. The before-and-after compare it builds on (`npm run atlas:compare`) is merged (#1221, build 691) and is run by hand.

**Track C — proof**
- [x] C1.1 A seeded project with 10,000 tasks, speed budgets, first measurements (#1220, build 682). The seed takes any task count; 50,000 has not been seeded or measured.

**Carried over from task 045**
- [x] #1206: the project page offers custom fields to group by (build 672)
- [ ] Hands-on pass in the running app. Three passes ran (see the log). They covered "Who can see this" (#1229), doc mentions (#1229), the Gantt shift preview (two items deferred, in `followups.md`) and group by custom field (pass 2). The notes do not name doc comments or custom-field filter and sort: check those two.

## Started early from later milestones
**Track A3 — collaboration depth**
- [x] Automation engine: "due date passed" and "all subtasks done" triggers, a notify action, and the three adapted templates restored (#1222, build 684)
- [x] Chat threads (#1228, build 695)
- [x] Doc version history, with what changed and restore (#1231, build 692)

**Track A4 — working days**
- [x] Working days per company, with a per-project override, used by Gantt shifts (#1225, build 688)
- [x] Working days everywhere: timesheets, workload, reminders, the estimate table, the Gantt critical path and shading (#1239, build 699)

**Track A6 — MCP parity** (added on 2026-10-01 at the owner's direction)
- [x] Part 1: an outside agent can update, assign, move, archive and restore tasks, set a field, and list fields, subtasks and members (#1261, build 719). Off by default behind `MCP_TOOLS_MANAGE`.
- [ ] Part 2: running. The plan is in `dogfood-findings.md`.

**Access, storage and the desktop tracker** (titles only; see the private notes)
- [x] #1213 (build 678): the project list and project search check the active seat first
- [x] #1217 (build 683): archive search, project search and task queries follow project visibility
- [x] #1223 (build 693): MCP reads and scheduled deliveries leave other people's personal lists alone
- [x] #1233 (build 701): timesheets, dashboard totals and trash leave other people's private work alone
- [x] #1241 (inside build 709): agent records leave other people's private work alone
- [x] #1244 (build 709): dashboard cards, timesheet joins and planned hours leave private work alone
- [x] #1253 (build 708): removing a file needs access to what the file belongs to
- [x] #1256 (build 715): captures and copied comment files stay within what the caller owns
- [x] #1258 (build 716): the desktop tracker stops and says so when its timer was stopped elsewhere
- [ ] In review (#1263): the member list returns the fields the app shows

## M2 Core
The hierarchy design is in `design-hierarchy.md`. F3 was replaced by "duplicate a project", and two folder slices were added.

**Nested subtasks, three levels**
- [x] N1 Task `ancestors`, the tree rules and migration 064 (#1218, build 690)
- [x] N2 Create paths set placement and `ancestors`; level-ordered import; migration 065 (#1226, build 696)
- [x] N3a Archive, delete, restore and move reach every level (#1238, inside build 712)
- [x] N3b Convert, merge and duplicate keep the tree; migration 066 (#1245, build 712)
- [x] N4 Three levels in the store and the List (#1254, build 718)
- [ ] N5a The task panel adds and shows subtasks down to three levels: in review (#1240)
- [ ] N5b Board, Table, Calendar and the legacy item list: running
- [ ] N6 Import keeps three levels; field rollups; unread rollup; export column: running

**Subfolders**
- [x] F1 Subfolders on the server (#1219, build 681)
- [x] F2 Subfolders in the web app: create, show and move in the project tree (#1235, build 694)
- [x] Folder row actions: rename, archive and delete; folders in the Trash; a live update after every folder write (#1247, inside build 711)
- [x] Duplicate a project with its folders, lists, statuses and views; replaces F3 (#1257, build 711)

**Everything view**
- [x] E1 The endpoint, the query builder and migration 067 (#1250, build 713)
- [x] E2 The Everything page, List mode (#1260, inside build 720). Its commits reached `beta` inside #1262; #1260 was then closed without a merge of its own.
- [x] E3 Board and Table modes, and saved views (#1262, build 720)
- [ ] E4 Measure at 10,000 tasks and fix: not started

**Track B2 — core screens** (started early)
- [ ] B2.1 The project chrome on design tokens: running

## Fixes from the hands-on QA passes
**From pass 1 (build 672) and the first speed measurements**
- [x] #1224 (build 686): dashboard cards load their content
- [x] #1227 (build 687): task types are offered for a field; a date field shows in the task panel
- [x] #1229 (build 689): a new doc lands in the selected project; share dialogs stay open
- [x] #1230 (build 697): the live agent panel refreshes once per change; a busy server says so
- [x] #1232 (build 698): a subtask row can be assigned; its parent stays open after an edit
- [x] #1234 (build 700): date limits and field messages work in every language
- [x] #1237 (build 704): the public link dialog follows the theme; "New doc" is offered where "New task" is
- [x] #1242 (build 705): a doc in the command palette opens the doc
- [x] #1246 (build 710): a status group loads all of its tasks; the List opens without a wait

**From pass 2 (build 679)**
- [x] #1248 (build 702): the Board card menu and the merge and convert sidebars follow the theme and fit
- [x] #1249 (build 706): opening the Table no longer fails to save the task order
- [x] #1251 (build 707): private view copies are marked; templates are easy to reach; popups follow the theme
- [x] #1252 (build 714): the task panel reads in dark mode; small layout slips on Home, Docs and Create project
- [ ] In review (#1255): move, duplicate and convert send plain values; index repair covers every group

**From pass 3 (build 705)**: running, with no PR yet unless one is named
- [ ] Dark mode batch 2
- [ ] In review (#1265): a new list is created in the folder you are in
- [ ] The List title column keeps a minimum width; the task type image that answers 404
- [ ] In review (#1266): the Ask card keeps its answer instead of asking again on every open
- [ ] Small bugs in the automation builder

## M3 Depth, M4 Lead and proof
Not started, apart from the A3 and A4 slices listed above. The slices are in `task.md`. "Save a project as a template" moved here from M2 (decision 20).

## Log
- 2026-10-01: the owner confirmed the plan with the recommended definition of "great" and asked to start M1. Wave 1 started at about 12:25: A1.1, A1.3, A1.4, A1.5, B0 (atlas and variants), B1.1, B1.2, C1.1.
  - Agents run only the test files they touch and leave the full suites to CI, after the overload of 2026-09-30.
  - A slice counts as done only after its main flow is used in the running app: #1191 passed CI with its headline feature not working on the project page.
- 2026-10-01, later: the owner said to continue without waiting and to make the decisions. The plan's seven decisions were taken as recommended (see `task.md`), and the ten hierarchy questions as recorded in `design-hierarchy.md`.
  - Merged so far: #1206 (672), #1207 (673, this plan), #1208 (674).
  - The style baseline test (#1210) is held until the other wave 1 PRs are in, then regenerated once.
  - The hands-on pass runs in the QA Sandbox project with a dedicated agent.
- 2026-10-01, QA pass 1 (build 672). Run by hand in the QA Sandbox project.
  - Five fix agents started at about 13:10. Their work became #1224, #1227, #1229, #1230 and #1232, then #1234, #1237, #1242 and #1246.
  - Deferred: the Gantt shift preview shows only on a drag, not on a date edit in the panel, and the preview panel covers the bars.
  - The notes hold no item-by-item result for this pass.
- 2026-10-01 13:09: local build 679 (#1208, #1209, #1211, #1212, #1213).
- 2026-10-01, QA pass 2 (build 679).
  - Passed: date pickers on eight surfaces, view templates, List density, menu parity, group by custom field.
  - Still failing on 679, already fixed in PRs not yet built: the dashboard skeleton (#1224), the date field crash (#1227).
  - Still open then: the subtask assignee picker was empty (fixed by #1232).
  - Not tested: bulk timesheet approve (no submitted week), the "left out" toast (needs a second project), saving the Table density.
  - New defects went to four agents at about 13:50: #1248, #1249, #1251, #1252, then #1255.
- 2026-10-01, about 13:59: local build 693 (#1215 to #1231, without #1226, #1228 and #1230). Migration 064 ran at start.
- 2026-10-01: the nested-subtasks slices were merged as one unit; see decision 19 in `task.md`. #1245 merged at 15:02 and #1254 at 15:22.
- 2026-10-01: access fixes push the test and the fix together. A failing test pushed alone can describe an unfixed gap, and this repository is public. Test names, commit messages and PR text stay neutral, and such a PR goes to the front of the merge queue. Every other slice still pushes its failing test first.
- 2026-10-01, about 14:35: the owner asked how much work is left, and why this work is not run through AlianHub itself, to find what is missing.
  - A bulk write of one subtask per open PR under AP-441 was refused by the session's permission check. It was not retried.
  - At about 14:40 the owner said to use Claude on the owner's plan through MCP in place of AlianHub's paid AI API where possible. MCP parity part 1 started (Track A6). In-app AI (the Ask card, AI fields, Write with AI, agents that run unattended) still needs an API key.
- 2026-10-01 14:42: local build 705 (adds #1226, #1228, #1230, #1232 to #1237, #1239, #1242, #1248). No migration was pending afterwards.
- 2026-10-01, about 14:58: the Claude plan's session limit was reached (reset at 15:00). Three agents stopped mid-run and were resumed from their transcripts: the Everything page, MCP parity, and QA pass 3. The integrator set a limit of about four agents at once.
- 2026-10-01, about 15:05: the owner allowed reconnecting the AlianHub connector. Later the owner said "you can connect alianhub on your side". Work items are now tracked as subtasks of AP-441 through the MCP endpoint.
- 2026-10-01, about 15:25, QA pass 3 (build 705): 15 of 16 items passed by use.
  - Passed: dashboards, the date field, the subtask row, task types, the four field types, subfolders, chat threads, doc history, the docs fixes, working days, automation triggers and notify, the Board menu and sidebars, List hover and the bulk bar, the variants picker, date limits.
  - Item 14, agent polling, counted 12 requests in two minutes against about 3 expected. Two agent runs were live the whole time, and the designed pace during a live run is three requests every 30 seconds. Follow-up: poll at the idle pace while the socket is connected.
  - Defects went to three fix agents (see "From pass 3" above).
  - Not tested: folder archive, restore, keyboard and permissions; the `?thread=` link, deleting a thread root, `@ai` in a thread; creating a public link; the Move, Duplicate, Create and Queue sidebars; a subtask created in a Board card; the phone card menu; the bulk bar at 800 to 1100 px; hidden-tab polling and the busy message; variants at 390 px; whether a task's date picker enforces Past and Future; light-mode contrast.
- 2026-10-01, after QA pass 3: the owner raised the agent limit to four to six, then said: "we have enough plan limit; increase agents step by step to find the system's maximum."
  - A load sampler records the machine every 30 seconds. With six agents: load 5.4 on 8 CPUs, 61% of memory free.
  - Step 1, 15:32 to 15:39, eight agents: average load 5.9, highest 10.2, at least 51% of memory free.
  - Step 2, from 15:40, ten agents. B1.3 and B2.1 started with it.
  - The rule: add two agents about every eight minutes while the one-minute load stays under 12 and free memory stays above 25%. Stop adding above load 16 or below 20% free memory. Pause agents above load 24.
- 2026-10-01, about 15:40: `tests/conventions/env-doc` fails on `beta` itself. Two PRs merged today each regenerated `docs/ENV.md`, and their merge left one line out of date. #1264 regenerates the file and goes first in the queue; the backend check of #1240, #1255 and #1259 fails only on this.
- 2026-10-01 15:50: `beta` is at build 720. GitHub shows 75 PRs merged today, in 72 builds (649 to 720); 52 of them came after tasks 044 and 045 closed (#1206 onwards). Three have no build of their own because they reached `beta` inside the PR stacked on them: #1238 inside #1245, #1241 inside #1244, #1247 inside #1257. A fourth, #1260, reached `beta` inside #1262 and was then closed, so GitHub does not count it as merged. `docs/BETA-LOG.md` lists one row per build, so these four are not in it.
