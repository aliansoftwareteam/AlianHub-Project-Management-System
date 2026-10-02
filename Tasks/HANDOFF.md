# Handoff: where to start next session

Updated 2026-10-02 21:00 IST. Read this first, then `Tasks/index.md` and the two `progress.md` files named below. Overwrite this file at the end of every session.

## State

- **Two tasks are in hand.**
  - Task 047, "AI-run" (`Tasks/active/047-ai-run/`, tracker AP-441): the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP (decision 30). New agent slots go here.
  - Task 046, "great next to ClickUp" (`Tasks/active/046-better-than-clickup/`, tracker AP-441): no new parity features; fixes, proof and the held PRs remain.
  - In each folder, `progress.md` has every slice with its PR and build, the decisions and what waits for the owner.
- **`beta` is at build 806** (`14.36.0-beta.806`, #1525). This docs PR becomes the next build.
- **Live on localhost: build 806.** Nothing is merged and not built. Migration 071 (#1504) ran at the first start after build 805; its dry run said it would write nothing, and it wrote nothing. The next free number is 072.
- **Hand-checked:** builds 782 (ninth sweep), 792 to 802 (tenth sweep), and on build 806 the checklist fix (a new checklist and its removal show at once). The eleventh sweep, on build 806, is running. The notes are in `Tasks/active/046-better-than-clickup/hand-check-2026-10-01.md`, which is a working note and is not committed. **Not hand-checked:** nothing that needs a connected AI (the MCP flags are off locally).
- `docs/API.md` and `docs/api/openapi.json` are in sync with build 806 once this docs PR merges.
- **The browser tests of `beta` were red from 14:08 to 18:41** on 2026-10-02 and have been green since. Read "Learned on 2026-10-02" below before merging anything.

## Merged since the last handoff (builds 773 to 806)

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

Each PR's own title is in `docs/BETA-LOG.md` or on GitHub. The reversible choices they made are in 047's `progress.md`, under "Choices to review".

## Open

| PR | What | State |
|---|---|---|
| #1521, `chore/integrate-batch-24` (no PR yet) | "a thing read by its id answers only to a person who can open it", 111 files | **Held.** Its review found fifteen things, six of them steps back for ordinary use (see the private notes, "REVIEW of batch 24"). Its author is fixing them on `fix/private-list-by-id-reads`. Then: merge into the batch branch, run the checks, a short second read of the fixes, open the PR |
| `feat/group-by-who-is-working` | T-4: group by who is working | In progress |
| `chore/plain-words-last-batch` | S-3: the keys still in the baseline, and `Views.replan_chain*` | In progress |
| `fix/plan-parts-an-approver-cannot-make` | S-2: a part the approver may not make is locked before approval; the AI Inbox gets part ticks | In progress |
| `fix/request-timers-and-upload-types` | Three server leftovers | In progress |
| #1506 | Colours batch 5 (draft) | Being brought onto today's `beta` |
| #1471 | Accessibility checks for the everyday screens | Merged with `beta` by hand, in the queue |
| Cloud runs started 20:51 | `chore/legacy-classes-2`, `chore/colours-from-tokens-6`, `docs/guide-views-fields-rules`, `docs/ai-benchmark-and-dead-ends`, `test/pure-helpers-3` | Each opens a draft PR. Read the PR bodies; a run's log is costly to read |
| #1306 | The installable app shell | **Held.** It merges alone, after its own rebuild and the 14 checks in `.claude/test-cases/PWA.md` |
| #1364 | A cloud run's API reference catch-up | Replaced. Close it |
| This PR | Task docs, the beta log, the API reference, this handoff | Not a draft, docs only |

## The combined-PR method

1. Make a branch from `origin/beta`, or from the batch before it, in its own worktree (`chore/integrate-batch-N`).
2. Merge each PR's head into it with a commit titled `Merge pull request #N from <branch>`. For a stack, merge only the top.
3. Resolve conflicts by keeping both sides (registries, locales, route lists). Locale pending files are joined key by key. A defect only the combination shows gets its own commit.
4. Before the push, run on the combined branch: each merged PR's own test files and every frontend spec that mentions a changed file; every `tests/mcp-*`, `tests/agent-*`, `tests/inbox-*` when agent code is touched; `tests/permission-task-write-keys.test.js` and the conventions project; the four whole-stylesheet specs (`onBrandContrast`, `inkTextContrast`, `designVariantTokens`, `uiSweepThirdPass`); `node scripts/env-doc.js --check`, `npm run i18n:check`, `npm run style:check`; `npx eslint --quiet` on the changed server and web files (CI lints before it tests). Run the server tests in three groups with `--maxWorkers=3 --forceExit`, and the web specs with `--maxWorkers 3 --minWorkers 1`. Run also the test files that other merged PRs added: a test written on an older `beta` is the usual failure.
5. **Have a fresh agent review the combined branch before it gets a pull request.** Four reviews today found 42 things where two fixes meet or where a fix cut too deep. A branch with no PR cannot be merged by the queue; an open PR can, as soon as its checks pass.
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
3. **How many agents to run.** After the usage limit stopped every agent at about 15:25, the coordinator ran four to five local agents until `beta` was green, then seven local and five cloud from 20:50 (the window stood at 23%, the week at 62%). The owner's standing number is eight and twelve.
4. **`STORAGE_DOWNLOAD_SCOPE`**: enforce by default, or stay on "report". **`PERMISSION_ENFORCEMENT_MODE`**: on by default or not.
5. Whether a personal API token may read and write chat as its person. Agent tokens cannot.
6. The choices in 047's `progress.md` under "Choices to review, builds 773 to 803" and "builds 804 to 806".
7. About 250 old agent worktrees (22 GB) under `.claude/worktrees/`: clear the ones whose branches are merged, or leave them.
8. A new account for the newcomer test; the one-week trial; the tracker subtasks only the owner can close; #1306's hand check.

## Private notes

Access findings and their state are in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/2026-10-01/`. Read that folder before working on any access item. Nothing from it is copied here.

## Next steps, in order

1. Batch 24: when #1521's author reports, merge `fix/private-list-by-id-reads` into `chore/integrate-batch-24`, run the checks of step 4 (two test files from #1518 failed against it: the invoice controller's and the notification entry's), have the fixes read once more, then open its PR.
2. The eleventh sweep's report: one fix agent per group of defects.
3. Each agent branch in "Open": gather them into batch 25, review it before its PR.
4. The cloud runs' draft PRs: colours and legacy classes conflict in `scripts/style-baseline.json` every time (keep the higher count, then `npm run style:baseline`).
5. 047, without the owner: T-2 "@" for a connected AI in chat; the benchmark gaps with no slice.
6. When the owner has switched the flags on: AI-4a, AI-4e, then the first AI-1 run.

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
