# Handoff — where to start next session

Updated 2026-10-01 21:55 IST. Read this first, then `Tasks/index.md` and `Tasks/active/046-better-than-clickup/progress.md`. Overwrite this file at the end of every session.

## State

- **The work in hand is task 046, "the plan to be great next to ClickUp"** (tracker AP-441). In its folder:
  - `progress.md`: every slice with its PR and build, the decisions of 2026-10-01, and the open decisions for the owner.
  - `followups.md`: what each PR left and the checks to do by hand.
  - `dogfood-findings.md`: the hand checks on build 754 and the screens still unchecked.
  - `task.md`: the plan and decisions 1 to 26. The designs are `design-hierarchy.md`, `design-m3-lists-and-goals.md` and `design-connectors.md`.
- **`beta` is at build 758** (`14.36.0-beta.758`, #1353). GitHub shows 159 PRs merged on 2026-10-01, in 110 builds (649 to 758).
- **Live on localhost: build 757** (rebuilt at about 21:50; migrations through 070 applied, none pending). It has both merged batches, #1332 and #1343.
- **Merged but not built locally: build 758** (#1353, an access fix).
- Hand-checked so far: builds 752 and 754 by the integrator. The second batch (#1333 to #1341) is being checked on 757 by a second local session.
- The next free migration number is 071.
- `docs/API.md` and `docs/api/openapi.json` are out of date (`npm run api:doc:check`). A cloud run is regenerating them.

## Merged since the last handoff (builds 721 to 758)

| Area | Merged, with the build in brackets |
|---|---|
| Nested subtasks | #1240 (722) task panel; #1275 (737) Board, Table, Calendar; #1268 (725) import, rollups, export |
| Tasks in several lists | #1277 (732) design; #1309 (in 754); #1334 (in 755) |
| Goals | #1291, #1308, #1310, #1327 (in 754); #1335, #1341 (in 755) |
| Fields | #1298 (747) relationship, voting; #1320, #1315, #1289 (in 754) |
| Docs, whiteboard, forms | #1287 (744); #1292 (748); #1319, #1326, #1330, #1300, #1321 (in 754) |
| Projects and import | #1265 (731); #1282 (743) templates; #1288 (745); #1299, #1331, #1317 (in 754); #1338 (in 755) |
| AI and MCP | #1266 (734); #1270 (728); #1295, #1302, #1307 (in 754); #1333, #1337, #1340 (in 755) |
| Design | #1259 (724) dense default; #1272 (729); #1279 (735); #1280 (741); #1284 (742); #1285 (749); #1290 (746); #1293, #1303, #1329, #1311, #1316, #1318, #1322, #1328 (in 754) |
| Phone and speed | #1296 (752); #1325, #1324 (in 754); #1339 (in 755) |
| Access (titles in `progress.md`; detail in the private notes) | #1283 (740); #1294 (750); #1263, #1276, #1286, #1313, #1304, #1312 (in 754); #1353 (758) |
| Fixes | #1255 (723); #1271 (727); #1274 (730); #1269 (736); #1281 (738); #1273 (739) |
| Tests, CI, docs | #1264 (721); #1267 (726); #1278 (733); #1297 (751); #1314 (753); #1301, #1305 (in 754); #1336 (in 755); #1342 (756); #1323 (757) |

"In 754" means inside the combined PR #1332; "in 755" means inside #1343.

## Open

| PR | What | State |
|---|---|---|
| #1357 | The third combined PR: #1344, #1355, #1345, #1352, #1346, #1347, #1348, #1349, #1350, #1351, #1354, the branch `fix/calendar-collapsed-lists-dark`, and #1353, which has since merged alone | Queued; its checks were running |
| #1356 | An import update moves a status the way a person does | Goes into the fourth batch |
| #1358 | The second benchmark run, on build 754 | Fourth batch |
| #1362 | Connector slice 2: an agent run reads an allowed Slack channel. It sits on #1350 | Fourth batch, after #1357 |
| #1359, #1360, #1361 | From cloud runs: the unit suites with the clock moved forward; Table group totals; the next e2e flows | Read each before queueing; nobody has reviewed them |
| #1306 | The installable app shell | Green. Held: it merges alone, after its own rebuild and the 14 checks in `.claude/test-cases/PWA.md`. It needs `beta` merged in and its env doc regenerated |
| #1210 | Colours and legacy classes may only shrink | Held until the visual PRs are in; then its baseline is regenerated once. It adds Rule 5 to `CLAUDE.md` |
| This PR | Task docs, the beta log, the `api:doc` line in `CLAUDE.md`, this handoff | Its checks |

When #1357 merges, GitHub marks the eleven open PRs inside it merged. Check that each one does, and close with a note any that does not.

## Running when this was written

Agents on the PC with no PR yet:
- Two access fixes, on top of the third batch.
- Task edits that show at once (`feat/instant-task-edits`).
- Extra lists through MCP (`feat/mcp-task-lists`).
- Extra-list rows across projects (`feat/extra-list-rows-across-projects`).
- Fixes for what the second benchmark run found (`fix/benchmark-run-2-blockers`).
- This docs PR.

A second local session, the "supporter", hand-checks the second batch on localhost and sets the tracker subtasks of merged PRs to Done. It was told not to push to any PR that is inside #1357.

Six cloud runs were started from the briefs in `Tasks/active/046-better-than-clickup/cloud-briefs.md` (in the main checkout, not committed). Three have opened PRs (#1359, #1360, #1361). Three have not: the goal summary on request (`feat/goal-summary-on-request`), the API reference catch-up (`docs/api-reference-catch-up`) and the sample project (`feat/sample-project-refresh`). The moved-clock run was started twice by mistake; the owner can stop the duplicate. Start a cloud run with no schedule and then run it: a scheduled one that is also run by hand fires twice.

A new session cannot see these agents. Find their work with `gh pr list --base beta` and `git branch -r --sort=-committerdate`, and read each worktree under `.claude/worktrees/` before starting the same work again. The session's scratch folder (the queue scripts, the agent log) is wiped by a restart.

## The combined-PR method

GitHub runs about two CI runs at a time and a run takes about ten minutes of jobs, so 25 open PRs meant hours of queue. The owner chose one combined PR per batch.

1. Make a branch from `origin/beta` in its own worktree (`chore/integrate-046-batch-N`).
2. Merge each PR's head into it, in order, with a commit titled `Merge pull request #N from <branch>`. For a stack, merge only the top, after checking that it contains its parent's head.
3. Resolve conflicts by keeping both sides (registries, locales, route lists). A defect that only the combination shows gets its own commit.
4. Run locally the test files the PRs touch, the convention files and the frontend specs they touch; then `npm run i18n:check` and `node scripts/env-doc.js --check`.
5. Push and open one PR. CI runs once. Fix what it finds on the branch.
6. Merge it. Each included PR shows as merged, because its head is now in `beta`. Set the tracker subtasks to Done, run `npm run version:log`, rebuild the local server, and do the hand checks.

An access fix can also be queued alone ahead of the batch. Do not rebuild the local server between two PRs that only work together.

## Standing owner rules

- **Eight agents on the PC.** Start the next one only when one finishes. Cloud runs are extra, for work that needs only the repository.
- **Decisions in two lines.** Put the choice first; do not bury it under a report.
- **Say what is live.** After every merge and every rebuild, say which build runs on localhost and what is merged but not built.
- **Credentials are typed by the owner only.** Build up to the sign-in step, then say so. Never type, read or store a key or a password.
- **Security detail stays out of this repository.** It lives in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/<date>/`. An access fix pushes its test and its fix together, with neutral titles and text.
- **Keep working without asking.** Take product and plan decisions, record them, keep them reversible. Stop only for money, permanent deletion, credentials, messages to outside people, or loosening security.
- **Work targets `beta`.** One PR per change, no direct pushes, Conventional Commit titles, checks green before a merge.
- **Done means used.** A slice is done after its main flow is used on the local build. Green CI is not enough.
- **Keep the tracker current** (AP-441 and its subtasks), and say which task a piece of work belongs to when it starts.
- **Light load.** An agent runs only the test files it touched, one worker. No full suites, no build, no `npm ci`. Node 20 for everything.

## Waiting for the owner

The full list is "Open decisions for the owner" in `progress.md`. The ones that block work:
1. The local `.env` flags for MCP (`MCP_TOOLS_MANAGE`, `MCP_TOOLS_DATA`, `MCP_TOOLS_WORK`) and a new token with the manage grant.
2. The Slack app and four `.env` lines, once #1350 is merged and on the local build (steps A and B in `design-connectors.md`). The Google client is needed from connector slice 3.
3. `STORAGE_DOWNLOAD_SCOPE=enforce` and `PERMISSION_ENFORCEMENT_MODE=enforce`: both still undecided.
4. The Talk to Text price (0.006 a minute) to confirm.
5. `git config --global user.name` and `user.email` on this Mac.

## Next steps, in order

1. Merge #1357 when green. Check the eleven included PRs show merged; set their tracker subtasks to Done, and those of #1332 and #1343.
2. Rebuild the local server from `beta` and say which build is live.
3. Hand-check that build, starting with the list in `dogfood-findings.md`, then the per-PR lists in `followups.md`. Uploads and removals first.
4. Build the fourth batch: #1356, #1358, #1362, the cloud PRs once read, and whatever the running agents open. Then `npm run version:log` and the next docs PR.
5. Merge the API reference catch-up when its cloud run opens a PR, or run `npm run api:doc` in the next docs PR.
6. Merge #1306 alone, after its hand check. Regenerate #1210's baseline and merge it.
7. Give the screenshot check its baseline: let the Visual workflow run on `beta`, `npm run visual:accept -- <run id>`, look at the pictures, commit `e2e/visual-baseline/`.
8. Tell the owner when #1350 is live locally, and what #1352 changes for guests.
9. Open the follow-up task for connector slices 7 to 9, and continue slices 2 to 6.
10. Next slices: the Shell and task panel on tokens, doc presence, 50,000 tasks measured, removing the legacy stylesheets, and the rest of the second benchmark run's findings (`followups.md`).
11. Close M1 and M2: update `scorecard.md` from the second benchmark run and ask the owner to sign them off.

## Learned on 2026-10-01

- **The Claude plan has two limits.** The session limit stopped three agents at about 14:58; the weekly limit stopped all 20 at about 17:16 (it resets on 2026-10-03 at 17:30 IST). Agents commit and push early, and a stopped agent is resumed from its transcript.
- **The machine takes 20 agents if CI runs the suites.** The tool refuses a 21st. Load follows how many agents run tests at once, not the count.
- **CI is the slow part, not the agents.** Hence the combined PR. A stale run cannot be cancelled from the session; the owner can cancel it in the Actions tab.
- **A test that mixes the real clock with a pinned date fails on one day.** `beta` went red for everyone at 12:00 UTC (#1314), and another test would have failed from 2026-10-04 (#1336). When one unrelated test fails on every PR, look at the date first.
- **Combining PRs finds defects no single PR shows.** Twice, one PR used a helper that another PR in the batch had removed or renamed.
- **A merge of two regenerated files can leave them stale.** `docs/ENV.md` and the API reference are now warnings in a PR and strict in the docs PR (#1305, #1297).
- **The permission check refused three things** (a bulk tracker write, cancelling workflow runs, one mutation check). None was retried or worked around; tell the owner instead.
- **The queue runner must treat an advisory check that reports CANCELLED as neutral,** and "not in the queue" is not "merged": a rebuild fired early on that.
- **The Mac sleeping with the lid closed stalls every agent.** Ask for keep-awake at the start.
- **In this shell use `/usr/bin/grep`,** and put the test file before `--selectProjects` when calling jest.
- **A cloud run gets the account's connectors attached.** Its brief must say to use none.
- **The integrator's log drifts from the clock.** Take merge times from GitHub.

## Earlier handoffs

The handoff written at build 720 held the history back to build 303, the owner decisions recorded since 2026-09-12, the upgrade steps for a deployed instance, the older open items and some fifty lessons. It was cut to keep this file short. Read it with `git show ea651ebae:Tasks/HANDOFF.md`.

## Handy commands

```bash
npm run nodemon             # backend on :4000 under Node 20
npm run version:show
npm run version:log         # after merges, then commit docs/BETA-LOG.md
npm run migrate -- status
npm run api:doc:check && npm run env:doc:check
npx jest <file> --selectProjects unit --maxWorkers=1
cd frontend && npx vitest run <file> --maxWorkers=1 --minWorkers=1
npm run i18n:check
```
