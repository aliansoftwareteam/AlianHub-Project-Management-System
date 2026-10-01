# 046: the parity scorecard

Rated on 2026-10-01. Tracker: AP-441, Track C.

This re-rates each area of the table in `task.md` ("Where we stand today"), with the evidence for each rating.

## How to read it

- Ratings: **Ahead**, **Level**, **Close** (small gaps), **Behind** (large gaps), **Not measured**.
- "Level" or "Ahead" is given only where the benchmark run or a merged pull request shows it.
- Three kinds of evidence are used, and each row says which:
  - **Run**: the first benchmark run, AlianHub build `14.36.0-beta.705`, in `benchmark-25-jobs.md`. Job numbers refer to that file.
  - **Merged**: pull requests on `beta`, with their build numbers. `beta` was at build 739 when this was written. A pull request merged after build 705 was not in the run, so it is merged but not seen working here.
  - **Earlier**: the code audit at build 645 (`034-end-to-end-qa-programme/findings/clickup-recheck-2026-09-30.md`) and the hands-on passes logged in `progress.md`.
- ClickUp's side is counted from its help pages and from a look-only pass, not from a saved run. See the benchmark file.

## The scorecard

| Area | 2026-09-30 | 2026-10-01 | Evidence | Still missing |
|---|---|---|---|---|
| Tasks, List, Board, Table | Level | **Level** | Run: jobs 1, 7 and 11 done; job 1 takes 7 steps against 9 seen in ClickUp. Merged: #1212 density and menu parity (677), #1246 list loading (710), #1232 subtask rows (698) | The selection clears after each bulk change (job 7). Quick-create from Home needs the project and the list picked (job 2). Pickers open as full-height side panels |
| Custom fields | Close | **Close** | Run: job 12 done, five types made and filled; job 8 done in 2 clicks; a rollup field works (job 13b). Merged: #1216 people, URL, rating, progress (680); #1243 files (717); #1236 values checked on every write (703); #1195 fields by task type; #1191 and #1206 filter, group, sort; #1268 rollups at three levels (725) | Making a field costs far more than in ClickUp: 59 steps for job 12 against at least 34. Three field types demand a placeholder and a ten-character description. No total per group for a number field (job 13a). Relationship, location, button, voting and signature types |
| Views | Close | **Close** | Run: job 9 done in 10 steps (ClickUp at least 11 from its help pages); job 8 done. Merged: #1211 view templates (676); #1251 view tabs (707); #1250 and #1262 the Everything page with List, Board, Table and saved views (713, 720) | The Everything page is merged but was not in the run (job 10 partly done). Not measured at 10,000 tasks. A view added with "Add View" is not opened |
| Hierarchy | Behind | **Close** | Merged: nested subtasks to three levels in #1218, #1226, #1245, #1254, #1240, #1275, #1268 (690 to 737); subfolders in #1219, #1235, #1265 (681, 694, 731); duplicate a project #1257 (711). Run: job 5 done, but only by a hidden path; job 4 one level of three; job 6 blocked, all three because the fix merged after build 705 | A task in several lists, and Goals (designed in #1277, not built). None of the later merges was seen working in this run. "Move to folder" and "Make it a sprint" are only on the Calendar tab |
| Docs | Close | **Close** | Run: job 15 done; job 24b done (#1242, 705); restore from history works (job 16). Merged: #1196 mentions and images; #1198 comments; #1231 version history (692); #1229, #1237 | An edit by the same person within ten minutes keeps no version, so job 16 fails as written. No share with one named person. Saving is a button. Restore asks through the browser's own confirm box. Live presence |
| Chat | Close | **Close** | Merged: #1228 threads (695), passed by use in QA pass 3; #1197 agents in chat. Run: job 3 done | Message to task takes 6 steps against 2 in ClickUp's help pages, because the project and list are picked each time. The rest of chat was not compared |
| Dashboards and reports | Level | **Close** | Run: job 22 done in 6 steps (ClickUp at least 7 from its help pages); job 23 done in 3. Merged: #1188 burndown, velocity and ask cards; #1224 cards load (686); #1199 Home cards; #1189 workload units | The card catalogue says 11 of 23 cards are built. A card cannot be pointed at one project. Rated down from Level on that evidence |
| Time tracking and timesheets | Level to Ahead | **Level** | Run: job 17 done in 6 steps; job 18 done in 5 (ClickUp 6 from its help pages, and its approvals need a higher plan). Merged: #1208 bulk approve (674); #1239 working days in timesheets and workload (699) | The approvals page has no entry in the navigation or the command palette. A timer under one minute logs nothing |
| Automations | Close | **Level** | Run: job 21 done in 11 steps, with a notify action and a status trigger. Merged: #1222 two triggers, the notify action and three recipes (684); #1190 recipe gallery and the Automate button; #1274 builder fixes (730) | ClickUp's side of job 21 could not be counted from its help pages, so step parity is not shown. No name field for a rule |
| AI | Level, Ahead in principle | **Not measured** | No AI feature was run in the benchmark, by instruction. Merged: #1193 AI field outputs; #1192 agent templates; #1261 and #1270 MCP task tools (719, 728) | A measured comparison. Connectors, web research, a meeting notetaker (from `task.md`) |
| Search and navigation | Level | **Close** | Run: job 24 done in 7 steps (ClickUp 6 from its help pages). Merged: #1185 palette recents; #1242 a doc opens from the palette (705) | Navigation gaps found in the run: approvals unreachable (job 18); folder and sprint actions on the Calendar tab only (jobs 5, 20); invite and project privacy deep in Settings (job 25). The first palette result for a doc's word was a task from another project |
| Integrations | Behind | **Behind** | Not measured in the run. Merged: #1261 and #1270 widen the MCP tools | As on 2026-09-30: few ready-made integrations; two-way calendar sync |
| Mobile | Behind | **Behind** | Not measured: the run was at 1440 by 900 only | As on 2026-09-30: no offline app shell, no native apps |
| Look and feel | Behind | **Behind** | Merged: #1209 date pickers (675); #1215 variants (685); #1221 screenshot atlas (691); #1259 the dense look as default (724); #1252, #1272, #1279 dark mode batches; #1278 screenshot check (733). Run: legacy side panels for priority, assignee and dropdown values; the legacy Project Timesheet screen; lists called "sprint" in notices; a raw "SPRINT DATA REQUIRED" label; a browser confirm box on doc restore | The style baseline test (#1210) is not merged. Core and legacy screens are not yet converted (Tracks B2, B3) |
| Speed at scale | Not measured | **Not measured** against ClickUp | Merged: #1220 a 10,000-task seed and budgets (682). Measured once at build 672: List first rows 2.27 s against the 1.5 s budget (`followups.md`). #1246 removed a one-second wait afterwards (710) | A measurement after #1246. 50,000 tasks. Any ClickUp figure |
| Security, permissions, self-hosting, audit | Ahead | **Ahead**, not re-measured | Earlier: self-hosted against SaaS only; audit log. Merged: nine access and storage fixes, listed by title in `progress.md` | Not part of this run. Job 25 was counted to the last button and not applied |
| Switching from ClickUp | Close | **Not measured** | No import was run and no pull request touched the importer | The earlier "Close" rested on the importer existing. Coverage of comments, attachments, fields and docs is unverified (Track C4) |
| Price | Ahead | **Ahead** | Earlier: no per-seat AI credits. ClickUp's help pages, read 2026-10-01, put column totals and timesheet approvals on the Business plan or higher, and cap the free plan at 60 uses of custom fields, Gantt, dashboards and workload | Not measured as money; rests on published limits |

## What moved since 2026-09-30

- **Hierarchy: Behind to Close.** Three levels of subtasks, subfolders, an Everything page and project duplication all merged on 2026-10-01. Only part of it was in the build that was run.
- **Automations: Close to Level.** The two missing triggers and the notify action merged (#1222), and job 21 was completed by use.
- **Dashboards and reports: Level to Close.** The run showed 12 of 23 cards not built and no per-card scope.
- **Search and navigation: Level to Close.** Search works; four jobs showed controls that are hard or impossible to reach.
- **Time tracking: "Level to Ahead" to Level.** Bulk approve merged, but the approvals page cannot be reached from the navigation.
- **Custom fields, Views, Docs, Chat: still Close**, each with its named gap closed (field types, view templates and Everything, version history, threads) and a new gap found by use.
- **AI and Switching: now "Not measured".** Neither was measured in this run, and the earlier ratings rested on the code audit.
- **Speed: measured once**, over budget, before a fix. Not yet measured again.

Against the finish line "the same or fewer steps on at least 22 of 25 jobs": 8 at build 705, with ClickUp mostly counted from its help pages. The count is provisional.

## The three biggest gaps left

Ranked by how many benchmark jobs each one blocks or slows.

| Rank | Gap | Jobs | What the run showed |
|---|---|---|---|
| 1 | **Things are not where the work is.** Places must be picked by hand, and some actions live on an unrelated screen | 2, 3, 5, 18, 20, 25 (six jobs slowed) | Quick-create and message-to-task ask for project and list each time. "Move to folder" and "Make it a sprint" are in a menu on the Calendar tab only. The approvals page has no entry anywhere. Invite and project privacy are two levels into Settings |
| 2 | **Hierarchy is merged but not yet proven by use.** | 4, 6, 10 (three jobs not completed), 5 (slowed) | Nested subtasks from the panel, project duplication, the Everything page and lists inside folders all merged after build 705. Until a build with them is run through these jobs, the Hierarchy and Views ratings rest on pull requests alone. A task in several lists and Goals are still unbuilt |
| 3 | **Fields cost too much to make, and totals are missing.** | 12, 13 (two jobs; job 12 is the slowest of all 25) | 59 steps and about 106 seconds for five fields, against at least 34 steps in ClickUp. Required placeholder and description; five trips through a side panel. No sum per group for a number field. Close behind: job 16, where a quick edit leaves no version to restore |

## What would change these ratings

- Rerun jobs 4, 5, 6, 10 and 13 on a build at or after 739.
- A hands-on ClickUp run that saves its work, on the sheet in `benchmark-25-jobs.md`.
- The speed measurement after #1246, at 10,000 tasks.
- An import of a real ClickUp export (Track C4).
