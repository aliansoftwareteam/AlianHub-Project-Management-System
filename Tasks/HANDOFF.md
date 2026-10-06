# Handoff: where to start next session

Updated 2026-10-06 09:00 IST. Read this first, then `Tasks/index.md` and the two `progress.md` files named below. Overwrite this file at the end of every session.

## State

- **Two tasks are in hand.**
  - Task 047, "AI-run" (`Tasks/active/047-ai-run/`, tracker AP-441): the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP (decision 30). New agent slots go here.
  - Task 046, "great next to ClickUp" (`Tasks/active/046-better-than-clickup/`, tracker AP-441): no new parity features; fixes, proof and the held PRs remain.
  - In each folder, `progress.md` has every slice with its PR and build, the decisions and what waits for the owner.
- **`beta` is at build 815** (`14.36.0-beta.815`, #1556). This docs PR becomes the next build.
- **Live on localhost: build 815.** Nothing is merged and not built. No migration after 073. The local server stops when the Mac sleeps: start it with the "alianhub-api" launch entry (`npm run nodemon`, Node 20) and check `/health`.
- **Hand-checked:** builds 782, 792 to 802, 803 to 806 (eleventh sweep), and by the coordinator 809 (Group by "Who is working"), 810 (the Inbox) and 812 (the task panel's tabs, the story point scale dialog and the export card in dark, measured in the page). The notes are in `Tasks/active/046-better-than-clickup/hand-check-2026-10-01.md`, a working note that is not committed. **Not hand-checked:** the rest of batch 26 (the list is under "Next steps"), and nothing that needs a connected AI (the MCP flags are off locally).
- `docs/API.md` and `docs/api/openapi.json` are in sync with build 812 once this docs PR merges.
- **Usage:** the week stood at 71% at 23:00 with the reset on 3 October at 17:30 IST. Full slots take about 5% of the week per hour. Nothing is running.
- **Task 047:** every slice that does not need the owner is merged. The next step is the owner's: the MCP flags on, a Claude connected with the manage grant.

## Merged since the last handoff (builds 773 to 812)

| Build | PR | What it carried |
|---|---|---|
| 773 | #1416 | Browser tests of the AI-run screens |
| 774 | #1435, fourteenth batch | #1361 (browser tests, batch 2), #1210 (colours and legacy classes may only shrink: CLAUDE.md Rule 5) |
| 775 | #1436 | "a project's agent settings and a proposal's decision each have one road" |
| 776 | #1437 | The docs PR for builds 767 to 772 |
| 777 | #1449, fifteenth batch | Plain words, empty screens, a count on agent changes |
| 778, 782, 785, 787, 792, 796 | #1438, #1448, #1439, #1440, #1451, #1473 | Browser and accessibility tests |
| 779, 783, 799, 801 | #1460, #1454, #1490, #1481 | The agents and MCP developer guide, the API reference (233 routes described), the user guide for working with your own AI app |
| 780, 795 | #1442, #1480 | Sign-up: the last step makes the workspace and says why when it cannot; unfinished workspaces are taken back |
| 781 | #1463, sixteenth batch | Folders and a list made a sprint by proposal over MCP (#1450), tokens, sweep fixes |
| 784 | #1469 | "a conversation is never read as a task" |
| 786 | #1457, seventeenth batch | #1453, #1455, #1461: settings and decisions are a signed-in person's |
| 788 | #1470, eighteenth batch | Scoping tests (#1464), a lighter first load (#1459), a copy of a project by proposal (#1467), colours batch 3 (#1462) |
| 789, 797, 798 | #1485, #1499, #1492 | Steadier specs, unit tests for 15 server helpers and 15 stores and composables |
| 790 | #1484, nineteenth batch | Projects follow live (#1466), rollup and formula fields and a dashboard card by proposal (#1465), settings colours (#1452) |
| 791 | #1479 | CI: the browser tests in three shards, the API tests in two, one summary check named `e2e` |
| 793 | #1472 | "the plan catalogue is read by a fixed query and changed by an instance admin" |
| 794 | #1488, twentieth batch | #1475, #1476, #1477, #1487, #1486; lists and folders follow live (#1482) |
| 800 | #1489 | Accessibility checks for the settings screens |
| 802 | #1500, twenty-first batch | S-2: the person picks the parts of a plan, and a plan can hold rules and first tasks (#1496); #1493, #1494; the ninth sweep's fixes (#1497, #1498) |
| 803 | #1509, twenty-second batch | #1501, #1502, #1503; scoping tests (#1483); colours and legacy classes to tokens (#1491, #1495); plainer words (#1478, #1468); the plan card after a first look (#1508); the fixes that made the browser tests pass again |
| 804 | #1522 | The docs PR for builds 773 to 803 |
| 805 | #1524, a side batch | The workspace rows repair with migration 071 (#1504), bugs the new unit tests found (#1512), tests (#1505, #1514, #1518), the first-hour guide (#1507) |
| 806 | #1525, twenty-third batch | #1510, #1511, #1513, #1516, #1520; S-2 on the web route with locked parts (#1515); the tenth sweep's fixes (#1517, #1519); views follow their project (#1523); the fixes to the batch's own review |
| 807, 808 | #1526, #1471 | The docs PR for builds 804 to 806; accessibility checks for the everyday screens |
| 809 | #1544, twenty-fifth batch | T-4 Group by "Who is working" (#1534); later work in its own context and the speech upload's file types (#1533); the last plain-words batch (#1529); colours batches 5 and 6 (#1506, #1527); tests for 25 pure helpers (#1528) |
| 810 | #1547, twenty-fourth batch | #1521: a thing read by its id answers only to a person who can open it; batch reads for the Inbox, the timesheet, workload and workflow runs; migration 072 |
| 811 | #1548 | The docs PR for builds 807 to 810 |
| 812 | #1550, twenty-sixth batch | S-2 locked parts and leftover rows (#1536); T-2 "@" your own AI in chat (#1537, migration 073); one approval for benchmark jobs 7 and 13 (#1546); work after a change under no bystander's limits (#1535, #1549); the eleventh sweep's fixes (#1538, #1541, #1545); legacy classes 2 (#1531); the benchmark sheet (#1530); three guide chapters (#1532) |

Each PR's own title is in `docs/BETA-LOG.md` or on GitHub. The reversible choices they made are in 047's `progress.md`, under "Choices to review".

## Open

| PR | What | State |
|---|---|---|
| `chore/integrate-batch-27` (no PR yet) | #1539 four guide chapters, #1543 specs for 25 web helpers, #1542 colours 7, #1540 legacy classes 3 | Merged on a branch from batch 26; it needs `beta` merged in and its checks run. **Held** until its screens are seen: both style PRs met the sweep's dark-mode fixes in seven dialog files (the sweep's versions were kept), and legacy classes 3 rewrites 40 files blind |
| #1306 | The installable app shell | **Held.** It merges alone, after its own rebuild and the 14 checks in `.claude/test-cases/PWA.md` |
| #1364 | A cloud run's API reference catch-up | Replaced. Close it |
| This PR | Task docs, the beta log, the API reference, this handoff | Not a draft, docs only |

## The combined-PR method

1. Make a branch from `origin/beta`, or from the batch before it, in its own worktree (`chore/integrate-batch-N`).
2. Merge each PR's head into it with a commit titled `Merge pull request #N from <branch>`. For a stack, merge only the top.
3. Resolve conflicts by keeping both sides (registries, locales, route lists). Locale pending files are joined key by key. A defect only the combination shows gets its own commit.
4. Before the push, run on the combined branch: each merged PR's own test files and every frontend spec that mentions a changed file; every `tests/mcp-*`, `tests/agent-*`, `tests/inbox-*` when agent code is touched; `tests/permission-task-write-keys.test.js` and the conventions project; the four whole-stylesheet specs (`onBrandContrast`, `inkTextContrast`, `designVariantTokens`, `uiSweepThirdPass`); `node scripts/env-doc.js --check`, `npm run i18n:check`, `npm run style:check`; `npx eslint --quiet` on the changed server and web files (CI lints before it tests). Run the server tests in three groups with `--maxWorkers=3 --forceExit`, and the web specs with `--maxWorkers 3 --minWorkers 1`. Run also the test files that other merged PRs added: a test written on an older `beta` is the usual failure.
5. **Have a fresh agent review the combined branch before it gets a pull request.** Nine reviews today found about 90 things where two fixes meet, where a fix cut too deep, or where a limit a PR relied on never applied. Tell the reviewer by name which commands are forbidden (`mongosh`, `docker exec` against the owner's database): one read the owner's database twice although told not to touch it. A branch with no PR cannot be merged by the queue; an open PR can, as soon as its checks pass.
6. Push, open one PR that is not a draft, and queue it. Agents' own PRs stay drafts, so the suites run once.
7. The queue merges a PR only when it is not a draft, its backend, frontend and e2e checks succeeded, and those checks began after the last merge into `beta`. Otherwise it refreshes the PR's branch and waits for the new run.
8. After the merge: check that each included PR shows as merged, rebuild the local server, check migrations and Home, say which build is live, and start a hand check. Then `npm run version:log` and `npm run api:doc` in the next docs PR.

## Standing owner rules

- **Eight agents on the PC and up to twelve cloud runs**, refilled as they finish. Full slots use a five-hour usage window in about three and a half hours; say so when reporting.
- **Decisions in two lines.** Put the choice first.
- **Say what is live.** After every merge and every rebuild, say which build runs on localhost and what is merged but not built.
- **Say which task and slice** a piece of work belongs to when it starts, and keep the tracker current.
- **Credentials are typed by the owner only.** No agent edits the owner's `.env`.
- **Security detail stays out of this repository.** An access fix pushes its test and its fix together, with neutral titles and text.
- **Keep working without asking.** Take product and plan decisions, record them, keep them reversible. Stop only for money, permanent deletion, credentials, messages to outside people, or loosening security.
- **Work targets `beta`.** One PR per change, no direct pushes, Conventional Commit titles, checks green before a merge.
- **Done means used.** A slice is done after its main flow is used on the local build. Green CI is not enough.
- **Light load.** Before every test run an agent checks `uptime` and waits while the one-minute load is above 24. One or two workers, named files, jest with `--forceExit`, vitest with `--maxWorkers 2 --minWorkers 1`. No full suites. A frontend build or a Playwright run only when the brief names it, on a throwaway Mongo (never port 4000 or 27017), one agent at a time.

## Waiting for the owner

The full lists are "Needs the owner" in 047's `progress.md` and "Open decisions for the owner" in 046's. The ones that block work or were raised on 2026-10-02:
1. **The MCP flags and a connected Claude.** Turn on `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` in their own local `.env`, restart, and connect their Claude with the manage grant. AI-4a, AI-4e, the first AI-1 run and the hand check of every MCP slice wait for it. Advice given: batch 23 is merged, so it can be done now; #1521 (batch 24) tightens reads further and is not needed for a first run.
2. **Whether a live instance exists** that needs today's fixes deployed and its logs looked at. Deploying is the owner's.
3. **How many agents to run.** The owner's standing number is eight local and twelve cloud. At that pace the week's limit does not last to its reset, so the coordinator held to the critical path from 22:20 on 2 October. Ask again after the reset.
3a. **A rule woken by a narrowed agent token's change** (#1535): its steps are held to the token's projects. One function, `judgedAfter` in `event/writerLimits.js`, switches that to the rule maker's full rights if the owner prefers.
3b. **Two archived `[QA 047]` custom fields** in QA Sandbox: the sweep left them for the owner to delete, because delete is for good.
4. **`STORAGE_DOWNLOAD_SCOPE`**: enforce by default, or stay on "report". **`PERMISSION_ENFORCEMENT_MODE`**: on by default or not.
5. Whether a personal API token may read and write chat as its person. Agent tokens cannot.
6. The choices in 047's `progress.md` under "Choices to review, builds 773 to 803" and "builds 804 to 806".
7. About 250 old agent worktrees (22 GB) under `.claude/worktrees/`: clear the ones whose branches are merged, or leave them.
8. A new account for the newcomer test; the one-week trial; the tracker subtasks only the owner can close; #1306's hand check.

## Private notes

Access findings and their state are in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/2026-10-01/`. Read that folder before working on any access item. Nothing from it is copied here.

## Next steps, in order

1. A full hand check of build 812, light and dark, 1280 and 390: Burndown and the four import dialogs; an empty folder; Custom Field Manager; archived lists with counts; one toast on Move and Convert; My Settings > Time format on chat, History, the audit log and the Inbox; a plan card with a locked part and with a leftover row; "@" in chat (it offers nothing without a connected AI); the status chips in Everything; the AI nav count.
2. Batch 27: merge `beta` in, run the checks (the scripts print unhandled errors now), build it and look at the 40 files of legacy classes 3 before its pull request.
3. One agent for the four small bugs the helper specs found (they are listed in 047's `progress.md`).
4. The slice left open: agent changes over the web routes named and counted as MCP changes are.
5. 047, without the owner: Home's "Waiting on you" card and the Approvals page approve a plan part by part; the benchmark gaps with no slice.
6. When the owner has switched the flags on: AI-4a, AI-4e, then the first AI-1 run. The benchmark sheet marks 10 jobs "should pass" and 5 "should pass with approval".

## Learned on 2026-10-02

- **Green alone is not green together.** Three test PRs and a batch each passed, and `beta` was red once they met. A docs-only PR failing the browser tests is the sign. The queue now merges only on checks that began after the last merge.
- **A test that fails twice on one branch and nowhere else is not a flake.** Five of the failures were real, small faults that show only on a slow machine: a doc title typed before the editor had drawn, the `c` key before its dialog had loaded, a late answer written over what a person was typing, focus pulled back on a timer.
- **A review must come before the pull request.** Batches 20 and 21 merged on green checks before their reviews reported.
- **Agents running tests locally can overload the machine.** Eight agents reached a load of 70 on 8 cores. The rule is in "Light load" above and in the shared brief.
- **The usage limit stops agents mid-task.** Their files stay in `.claude/worktrees/agent-<id>`; resume each one and tell it to commit locally as it goes.
- **A reworded sentence breaks tests on other branches.** #1468 reworded what an agent is told when refused; every later branch that matched the old text failed when combined.
- **Lint runs before the tests in CI.** One invisible character in a test failed the whole backend job. Lint the changed files on every batch.
- **The test database hides type faults.** A comparison of a stored string with an ObjectId passed on the fake and never matches on real MongoDB. A query that compares two stored fields needs an integration test.
- **A fix that closes a read can cut ordinary use.** #1521's review found a person unable to correct their own time and a badge that would never clear. A review asks "what does a member lose", not only "what can still be reached".
- **A limit a test sets up by hand may not exist in production.** #1535's tests wrapped an event in a narrowed request; the real road (MCP) never entered one, so the limit had never applied. A reviewer who asks "which real request reaches this line" finds it.
- **Fixing "inherits the caller" both ways.** Binding later work to no request removes a bystander's limits and also the starter's. Whatever the later work must keep (who started it, how deep in a chain, which limits) is written down when it is filed.
- **Usage is the limit, not the machine.** About 5% of the week per hour with seven local agents and five cloud sessions. Resuming an agent replays its whole transcript; for a narrow fix a fresh agent with a tight brief is cheaper.
- **A run can fail with every test passing.** Vitest fails on an unhandled error. Print the `Errors` line of a local run, and after a push to a queued PR wait for the new run to appear before queueing it again: the queue read the old run's failure and dropped the PR.
- Earlier lessons are in the handoffs of build 772 (`git show 9886c3d4e:Tasks/HANDOFF.md`) and build 766 (`git show 4a955e6bf:Tasks/HANDOFF.md`).

## Handy commands

```bash
npm run nodemon             # backend on :4000 under Node 20
npm run version:show
npm run version:log         # after merges, then commit docs/BETA-LOG.md
npm run api:doc             # after merges that add or change a route
npm run migrate -- status
npm run api:doc:check && node scripts/env-doc.js --check && npm run i18n:check && npm run style:check
npx jest <file> --selectProjects unit --maxWorkers=1 --forceExit
cd frontend && npx vitest run --maxWorkers 2 --minWorkers 1 <file>
```
