# Handoff: where to start next session

Updated 2026-10-10 IST. Read this first, then `Tasks/index.md` and the `progress.md` files named below. Overwrite this file at the end of every session.

## State

- **Four tasks are in hand.**
  - Task 047, "AI-run" (`Tasks/active/047-ai-run/`, tracker AP-441): the agent is the person's own Claude or ChatGPT over MCP (decision 30). **AI-1 run 2 is done: 15 of 15 pass, three runs each** (#1630); its fixes are #1631 and #1632.
  - Task 048, "Team agent packs" (`Tasks/active/048-team-agent-packs/`): parts 1 to 6 merged. Pack run 2 (Manufacturing) is measured (#1628) and its fixes merged (#1629). Left: the flow board, the owner's read of the playbooks.
  - Task 049, "GitHub repos per project" (`Tasks/active/049-github-repos-per-project/`, tracker AP-524): merged (#1627, migration 075).
  - Task 046, "great next to ClickUp": no new parity features; fixes, proof and the held PRs remain.
- **`beta` is at build 861** (#1632). This docs PR becomes the next build.
- **Local build (localhost):** `DISPATCHER=on`, `MCP_ROLE_PROMPTS=on` and `APP_CONNECTIONS=on` in the owner's `.env` (approved by the owner). Check which build the server answers with `npm run version:show` after a rebuild. The daily AI budget is $50 and the monthly $1,500. GitHub is connected by one-click OAuth (the owner set the `GITHUB_CONNECT_*` keys), `api.github.com` is allowed on the main workspace's egress, and AlianHub Platform is mapped to aliansoftwareteam/AlianHub-Project-Management-System. The IT company pack is on AlianHub Platform with its 3 agents on ("Suggests changes"); the Manufacturing pack is on Sweep Project W2d with its 3 agents paused. Start the server only with the "alianhub-api" launch entry: it now unsets the `ANTHROPIC_MODEL` that Claude Code passes down (it had made the server use "opusplan").
- **The owner's local `.env`, changed at the owner's request on 2026-10-08:** the MCP flags (`MCP_OAUTH=both`, issuer localhost:4000, `MCP_TOOLS_DATA/MANAGE/WORK=on`, `MCP_OAUTH_DCR=on`), and the AI provider switched to Anthropic: `LLM_PROVIDER="anthropic"`, `ANTHROPIC_MODEL="claude-sonnet-5-5"`, its price $2/$10 per million in `LLM_PRICING`. The key is in the admin field only; the `.env` key line stays empty. A backup of the old `.env` is in the private handoff folder.
- **The owner's Claude Code is connected** as `alianhub-oauth` (user scope, OAuth, Manage tasks, Write docs, Read chat). Measured runs: `claude -p "<sentence>" --allowedTools "mcp__alianhub-oauth" --max-turns 40 --output-format json`, from `~`, with the browser pane on the job's start screen.
- `docs/API.md`, `docs/api/openapi.json`, `docs/ENV.md` and `.env.example` are in sync with build 861.

## Merged since the last handoff (builds 773 to 861)

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
| 813 | #1551 | The docs PR for builds 811 and 812 |
| 814, 815 | #1553, #1556 | Batches 27 and 28: guide chapters, web helper specs, colours and legacy classes; a plan approved part by part; agent web writes named as MCP writes |
| 816 | #1557 | The docs PR for builds 813 to 815 |
| 817 | #1561, twenty-ninth batch | Replies in a thread, doc versions, a timesheet week, uploads over MCP |
| 818 | #1566 | An approved subtask is made, and an approval that made nothing says so (AI-1 defect 1) |
| 819 | #1569, thirtieth batch | The AI-1 fixes (#1568: grouped list by a saved view, dependent dates move with one undo, batch step names, formulas filled at once, approvals inside the token's projects) and live Inbox and Docs with the app named by its host (#1567) |
| 820 | #1573 | The docs PR for builds 816 to 819, the AI-1 results and the 048 plan |
| 821 | #1577, thirty-second batch | Same-named fields asked (#1575); `tag.create` and search by tag, priority and field (#1576) |
| 822 | #1578 | A view approved elsewhere shows in the open project when its tab is seen again |
| 823 | #1579 | The docs PR for builds 820 to 822 |
| 824 | #1580 | A paused project says so; the sidebar catches up after a hidden tab |
| 825 | #1582, thirty-third batch | 048: 44 role playbooks (#1572), role prompts and skills behind `MCP_ROLE_PROMPTS` (#1574), the dispatcher in suggest mode behind `DISPATCHER` (#1581) |
| 826 | #1583 | The docs PR for builds 823 to 825 |
| 827 | #1584 | Dispatcher hand-check fixes: the card framed, IT company named, the accepter shown, a role sees its queue |
| 828 | #1585 | Team packs: the catalogue Team filter and one-click packs, undoable |
| 829, 831 | #1589, #1596 | A mention in an agent's comment reaches the person, on every comment tool |
| 830 | #1598, thirty-fourth batch | Playbooks for e-commerce, agency, professional services, education and construction; the team packs guide |
| 832 | #1599, thirty-fifth batch | The company view, tuning a role playbook per workspace, the dispatcher's model guess |
| 833 | #1601, thirty-sixth batch | Clinic playbooks and the company blueprint picker |
| 834 | #1602 | The docs PR for builds 826 to 833 |
| 835 | #1603 | The roles the blueprints named but had not written |
| 836 | #1605 | The docs PR: pack run 1, builds 834 and 835 |
| 837 | #1604 | 048 part 4: role hand-overs as workflow steps, the ready-made team workflows |
| 838, 839 | #1608, #1610 | A comment from the connected AI shows at once and counts as unread |
| 840 | #1613 | Roles take routed work from their queue; offered when a few tools are missing |
| 841 | #1614 | MCP tool access follows the web app's rules in every case |
| 842 | #1611 | The Ask box plans with the server model (AI-2, AI-3) |
| 843 | #1607 | App connections, GitHub pull requests linked to tasks (own main-menu item, behind `APP_CONNECTIONS`) |
| 844 | #1617 | List rows show the unread comment count |
| 845 | #1616, thirty-seventh batch | Pack starter rules and tags (#1606), one agent per role (#1612) |
| 846 | #1609 | AI-6: the project manager triages new tasks with the server model, hourly |
| 847 | #1619 | GitHub one-click connect through GitHub sign-in |
| 848 | #1615 | MCP tools and OAuth on by default for new installs (migration 074 keeps upgrades off) |
| 849 | #1620 | A daily AI budget (#1618, inside); every server-key call counts, a failed budget read refuses |
| 850 | #1623 | AI-1b: the benchmark's tool calls replay in CI with no model |
| 851 | #1622 | MCP `pull_request.get` |
| 852 | #1621 | The installable app shell (replaces #1306) |
| 853 | #1624 | The docs PR for builds 836 to 852 |
| 854 | #1625 | The GitHub card is one Connect button |
| 855 | #1626 | GitHub says when the server may not reach it; an owner can allow it; a repository picker |
| 856 | #1627 | 049: each project picks its own GitHub repositories (migration 075) |
| 857 | #1628 | Pack run 2 results, Manufacturing |
| 858 | #1629 | A blueprint pack brings its starter rules and tags and turns routing on; settings revision checks |
| 859 | #1630 | AI-1 run 2 results, 15 of 15 |
| 860 | #1631 | MCP: fewer needless holds and conflicts on a person's own AI's writes |
| 861 | #1632 | MCP: dates in the person's zone, unique view names, `views.list` |

Each PR's own title is in `docs/BETA-LOG.md` or on GitHub. The reversible choices they made are in 047's `progress.md`, under "Choices to review".

## Work from AlianHub

Since 2026-10-08 the owner gives work as tasks in project AlianHub Platform (AP), list "Claude coordinator" (read-me AP-477). Check it with `handoff/scripts/coord-check.sh` at the start of every session and on the 30-minute `/loop`; post decisions as "Decision taken:" comments there.

## Open

| PR | What | State |
|---|---|---|
| #1364 | A cloud run's API reference catch-up | Replaced. Close it |
| This PR | The beta log for builds 853 to 861, API docs, 047, 048 and 049 progress, this handoff | Not a draft, merged by hand when its required checks pass |

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
Open owner tasks in AlianHub (AP):
- **AP-496**: the four PWA hand checks of the installable app shell (#1621).
- **AP-504**: revoke the two secrets pasted in chat on 2026-10-08.
- **AP-498, AP-500, AP-501, AP-502, AP-503**: open owner items; details on each task.
- **Approve the tracker task** "GitHub: each project picks its own repositories" in the Inbox.
- **Decision A or B:** should creates from an outside AI wait for approval? Default A: keep the hold.

Older items:
1. **Read the 048 playbooks** (merged in build 825) and say what to change.
2. **Whether a live instance exists** that needs today's fixes deployed and its logs looked at. Deploying is the owner's.
3. **How many agents to run.** The owner's standing number is eight local and twelve cloud. At that pace the week's limit does not last to its reset, so the coordinator held to the critical path from 22:20 on 2 October. Ask again after the reset.
3a. **A rule woken by a narrowed agent token's change** (#1535): its steps are held to the token's projects. One function, `judgedAfter` in `event/writerLimits.js`, switches that to the rule maker's full rights if the owner prefers.
3b. **Two archived `[QA 047]` custom fields** in QA Sandbox: the sweep left them for the owner to delete, because delete is for good.
4. **`STORAGE_DOWNLOAD_SCOPE`**: enforce by default, or stay on "report". **`PERMISSION_ENFORCEMENT_MODE`**: on by default or not.
5. Whether a personal API token may read and write chat as its person. Agent tokens cannot.
6. The choices in 047's `progress.md` under "Choices to review, builds 773 to 803" and "builds 804 to 806".
7. About 250 old agent worktrees (22 GB) under `.claude/worktrees/`: clear the ones whose branches are merged, or leave them.
8. A new account for the newcomer test; the one-week trial; the tracker subtasks only the owner can close.

## Private notes

Access findings and their state are in `~/.claude/projects/-Users-mevil-Alian-Hub/handoff/2026-10-01/`. Read that folder before working on any access item. Nothing from it is copied here.

## Next steps, in order

1. Rebuild the local server on build 861 and hand-check the merges: a project's GitHub repositories card and header chip, the budget, the Ask box plan, manager triage, the installable shell (AP-496).
2. Ask the owner to see the live view tab by eye (#1578): the coordinator's browser pane is always hidden, so it cannot.
3. 048: left are the flow board and the owner's read of the playbooks.
4. The hand check of build 812 and the held batch 27 items, as before.

## Learned on 2026-10-10

- **Docs-only PRs are merged by hand.** Their suites are skipped, and the queue waits on an all-skipped run. Merge such a PR by hand once its required checks pass.

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
