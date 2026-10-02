# Progress: 047, AI-run

State at build 803 (`14.36.0-beta.803`), 2026-10-02 19:00 IST. Tracker: AP-441.

How to read a line: `[x]` is merged into `beta`, with its PR and build number. "Inside build 762" means the PR reached `beta` inside a combined PR:

| Build | Combined PR | Build | Combined PR |
|---|---|---|---|
| 762 | #1395 | 767 | #1408, the ninth |
| 764 | #1399 | 769 | #1412, the tenth |
| 765 | #1401 | 770 | #1417, the eleventh |
| 766 | #1405 | 771 | #1428, the twelfth |
| | | 772 | #1434, the thirteenth |
| 774 | #1435, the fourteenth | 788 | #1470, the eighteenth |
| 777 | #1449, the fifteenth | 790 | #1484, the nineteenth |
| 781 | #1463, the sixteenth | 794 | #1488, the twentieth |
| 786 | #1457, the seventeenth | 802 | #1500, the twenty-first |
| | | 803 | #1509, the twenty-second |

Build 763 is #1394 alone. Build 768 is the docs PR #1411. "In review (#n)" has an open PR. "Needs the owner" waits for a step only the owner can take.

Every merged slice below is still behind its flag. `MCP_OAUTH` and the three `MCP_TOOLS_*` flags are off in the local `.env`, so nothing that needs a connected AI has been used by hand yet.

## Checklist

**Step 0: writing only**
- [x] The plan (`task.md`) and decisions 27 to 30 in task 046 (#1380, inside build 762)
- [x] S-6 The newcomer test script written: `newcomer-test.md` (#1419, inside build 771)
- [ ] S-6 A first run on the local build as it is (needs a new account: the owner)
- [x] AI-1 The benchmark sheet written: `ai-benchmark.md` (#1419, inside build 771)
- [x] S-3 The plain-words test and its baseline, with the first 51 rewordings (#1407, inside build 767)
- [ ] The owner's answers to the 16 open decisions. Nine were taken as recommended; see "Decisions taken on 2026-10-01/02"

**Step 1: the road in**
- [x] Each group of registry entries in its own file, so slices stop colliding (#1383, inside build 762)
- [ ] AI-4a A real Claude connected over OAuth with the manage grant (needs the owner)
- [x] AI-4b The agent's name in task history ("Claude, for Priya"), and the loop guard on the newer path (#1387, inside build 762)
- [x] AI-4d Token default, expiry notice and renew (#1386, inside build 762)

**Step 2: the agent knows the product**
- [x] T-3 MCP instructions, the five ready-made prompts and the "show me" link (#1390, inside build 762)
- [x] AI-4c The project's policy: Done, and how far a connected agent may go (#1394, build 763)
- [x] AI-2 Over MCP: where the person is, message to task, and the preview card in the web app (#1398, inside build 764)
- [x] AI-3 Fields over MCP, with preview and undo (#1402, inside build 766)
- [x] AI-3 Views over MCP (#1402, inside build 766)
- [x] AI-3 Automations over MCP: an agent proposes one rule for one project, and an owner or admin approves it (#1423, inside build 771)
- [x] A batch that names more than one task waits as one proposal (#1427, inside build 772)
- [x] The setup tools the benchmark sheet found missing: a due-date filter on a view, links that open a saved view or "mine", fields with their first values in one approval (#1425, inside build 772)
- [x] The read tools the sheet found missing: who the person is, chat channels and messages, a task's field values, working days, what became of a proposal (#1429, inside build 772)
- [x] #1431 (inside build 772): "reads answer the same for a thing that is not there"
- [x] Folders, subfolders and a list made a sprint over MCP, each by proposal (#1450, inside build 781)
- [x] Rollup and formula fields, fresh computed values, and a dashboard card by proposal (#1465, inside build 790)
- [x] A copy of a project by proposal: `project.duplicate` (#1467, inside build 788)

**Step 3: measure**
- [ ] AI-1 First measured run over MCP (needs the owner: flags on locally, a connection with the manage grant)
- [ ] AI-4e The dogfood list repeated on the local build (needs the owner)

**Step 4: the front door and the simple outside**
- [x] T-1 Sign-up ends in "Connect your AI", with a sign that the connection works (#1397, inside build 764). The server-key field in the wizard is not built
- [x] S-1 Simple mode (#1393, inside build 762)
- [x] S-5 No dead ends (#1391, inside build 762). Ten questions are left in `resources/dead-ends.md`
- [x] AI-2 In the web app with no model: quick create, the palette and message to task start where the person is (#1413, inside build 770)
- [x] AI-2 A change a connected agent applied is shown to its person in the web app, with Undo (#1430, inside build 772)

**Step 5: the system looks for you**
- [x] AI-5 The "Needs your approval" tab and row in the Inbox (#1392, inside build 762)
- [x] AI-6 Findings from rules, and the daily look (#1396, inside build 764)
- [x] AI-6 The work queue for the connected agent, with claims (#1404, inside build 766)
- [x] AI-5 "Always do this", and typed decline reasons kept as notes (#1406, inside build 767)
- [ ] AI-6 Triage of new tasks and estimates. Later: it needs a server key

**Step 6: the teammate**
- [x] S-2 A connected agent sets up an existing project from one plan: `project.setup` (#1420, inside build 771)
- [x] S-2 A connected agent proposes a new project with its setup: `project.create` (#1433, inside build 772)
- [x] S-2 The person picks the parts of a plan, a plan can hold rules and first tasks, and the browser test of the whole flow (#1496, inside build 802). The card after a first look in a browser (#1508, inside build 803)
- [ ] S-2 A plan filed on the web route is stored, checked and shown as one filed over MCP, and a part only an owner or admin approves is shown locked. In review (#1515)
- [x] A project made or changed shows without a reload (#1466, inside build 790). Lists and folders follow live (#1482, inside build 794)
- [x] T-2 The connected AI as a named member (#1410, inside build 769)
- [x] T-4 Agent work visible in List, Table and Board, with a filter (#1409, inside build 769). "Group by who is working" is not built
- [x] T-5 Several agents at once (#1414, inside build 770)
- [x] S-4 Home as "what next" (#1400, inside build 765)
- [ ] AI-1b The replay test in CI. It needs a passing AI-1 run first

**Step 7: prove it (needs the owner)**
- [ ] AI-1 measured again: 15 delegations and 3 reserves, three runs each
- [ ] The one-week trial on one project
- [ ] The newcomer tests run again, on the "connect, then say it" path
- [ ] The scorecard's AI row and newcomer row filled

**Throughout**
- [x] S-3 Batch 1 (#1407, inside build 767): 51 keys reworded. The baseline went from 132 to 81
- [x] S-3 Batch 2 (#1415, inside build 770): 48 keys reworded, and 14 count strings read "1 task". The baseline went to 33
- [x] S-3 Server replies (#1426, inside build 772): 22 reply texts say "list" where they said sprint
- [x] S-3 60 more strings in plainer words (#1478, inside build 803)
- [x] S-5 Empty screens say what they are for and offer the next step (#1444, inside build 777)
- [x] S-3 Plain words in what the MCP server tells a connected agent: tool texts, refusal reasons and labels (#1468, inside build 803)
- [x] S-3 The audit log and the skill library in words, with a test that fails when a new event has none (#1497, inside build 802)
- [ ] S-3 What is left: the keys still in the plain-words baseline, and `Views.replan_chain*`

**Follow-ups the slices named**
- [x] #1421 (inside build 771): a control for the workspace's "a person checks before Done" switch, one sentence in the MCP instructions about a close that waits, and the spec for Undo after a create is approved
- [x] #1424 (inside build 771): "the workspace's agent settings save the same way as a project's"
- [x] #1418 (inside build 771): hand-check sweep 3. Home's approval link opens the Inbox tab, "Hand to an agent" follows its switch, the "Not connected yet" line has its icon
- [x] #1432 (inside build 772): hand-check sweep 7. The Members row names the person's own AI as the picker does, and two agents with one name are told apart

**Proof and hand checks, 2026-10-02**
- [x] The ninth hand check, build 782: the eighth's six defects are fixed; nine new ones, answered by #1497 and #1498 (inside build 802)
- [x] The tenth hand check, builds 792 to 802: thirteen defects. In review: #1517 (the task panel follows its own writes, search takes text as text, confirms say what happens) and #1519 (computed fields stay fresh, a field can be archived or deleted, dark mode)
- [x] Browser tests for the AI-run screens, core flows, two people, narrow and dark, accessibility (#1416, #1438, #1439, #1440, #1448, #1451, #1473, #1489)
- [x] Three independent reads of the combined access rules (batches 20, 21 with 22, and 23). What they found is fixed in #1511 (in review), #1515 (in review) and `fix/batch-23-review`
- [x] A user guide for working with your own AI app: `docs/guide/agents/` (#1490, build 799)

**Later, optional (with a server key)**
- [ ] The Ask box that plans with a model (AI-2, AI-3, T-3)
- [ ] The in-product manager on a schedule (AI-6)
- [ ] The generator's wider plan (S-2); the built-in workspace agent (T-2)

## What is left

**Can be done without the owner**
- Merge batch 23 (`chore/integrate-batch-23`: #1510, #1511, #1513, #1515, #1516, #1517, #1519, #1520) after the fixes to its review, and the side batch (`chore/integrate-batch-22b`: #1504, #1505, #1507, #1512, #1514, #1518). Then #1521.
- A hand check of build 803 and of batch 23 on the local build.
- Revise the benchmark sheet's table against build 803: folders, a sprint, a rollup field, a dashboard card and a copy of a project now have tools.
- T-4: group by who is working. T-2: "@" for a connected AI in chat.
- S-2: a status or a field the approver's role may not make is still answered "not made" after the approval; the AI Inbox has no part ticks.
- After a plan is approved, the list view can show the old status groups until a reload; a live Inbox refresh blanks the list. In progress (`fix/stale-views-after-live-changes`).
- The benchmark gaps still open that have no slice: a reply in a task's comment thread, a doc's versions, a timesheet's submit and approve.

**Needs the owner**
- Turn on `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` in the local `.env`, and connect their Claude with the manage grant. AI-4a, AI-4e and AI-1 wait for this. So do the hand checks, with a real connection, of #1387, #1390, #1398, #1402, #1404, #1406, #1409, #1410, #1414, #1420, #1423, #1425, #1427, #1429, #1430 and #1433.
- For benchmark job 3, the connection also needs "Read messages in channels you are in" ticked, and an owner or admin approves it for that app.
- A new account, for the S-6 newcomer run.
- The one-week trial on AlianHub's own project.
- Row 15: which fifteen jobs count. The sheet's own pick stands until the owner says.
- Whether the three `MCP_TOOLS_*` flags and `MCP_OAUTH` are on by default on a new install. It changes a security default and needs an access review first. Not planned as done.
- Whether AlianHub's own AI is measured with a server key, at a cap of $10. Recommended: not now.
- Raised on 2026-10-02: whether a live instance needs today's fixes deployed; #1504's migration on the local database (a dry run first); `STORAGE_DOWNLOAD_SCOPE` and `PERMISSION_ENFORCEMENT_MODE` by default; whether a personal API token may read and write chat as its person.

## Decisions taken on 2026-10-01/02

The numbers are the rows of "Open decisions for the owner" in `task.md`. The coordinator took each as recommended while the owner was away; each is a setting or a slice, so each can be overruled.

- **5.** An agent does not mark a task Done without a person's approval by default. A project chooses "never", "with approval" or "yes" (#1394).
- **6.** Over MCP, a change to a single task is applied at once and shown with Undo; anything wider waits. A project may choose "propose everything" (#1394). Since #1427 a batch is held to this too.
- **8.** "Always do this" exists, within the limits in AI-5, and each rule ends after 90 days (#1406).
- **9.** A typed decline reason is kept as a note the agent reads, per project (#1406).
- **11.** Connected agents appear in the member list under the person who connected them, with no seat and no role (#1410).
- **12.** "Connect your AI" can be skipped at sign-up (#1397).
- **13.** New accounts start in Simple mode; existing accounts stay on Full (#1393).
- **14.** An agent never creates a field, a view or an automation without a preview: each is a proposal a person approves (#1402, #1423).
- **16.** The project's manager starts at "Suggest": everything it offers is a proposal (#1396).
- **7** was built as the plan wrote it (30 days by default, a notice three days before, Renew) in #1386. The log does not record it as a decision taken.
- **Decision 30, confirmed by the owner** in chat on 2026-10-01 at about 22:09 IST: the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP. A server key is an optional extra.
- **Connector slices 4 to 6 (calendar) are paused** after slice 3 (#1381). With decision 30 the person's own AI brings its own calendar and mail connectors, so the agent slots went to this task. Reversible: the design is still in `design-connectors.md` of task 046.
- Still the owner's: rows 1 to 4, and rows 10 and 15, which nobody has answered. #1410 follows row 10's recommendation (a person hands work only to their own AI).

## Decisions taken on 2026-10-02, builds 767 to 772

Each is a default, a setting or a slice, so each can be reversed.

- **Several agents at once (#1414).** A project lets 3 agents work at once by default; an owner or admin sets 1 to 20. One agent holds one item at a time. "Pause all agents" stops agent work in one project. What people do, and a change a person approved, is never paused.
- **Quick create (#1413).** It starts in the project and list the person last opened. No model is called.
- **A batch (#1427).** A batch that names more than one task runs nothing and waits as one proposal. A batch on one task is applied at once, as before. A waiting batch stays inside one project.
- **Reading chat (#1429).** It is a permission of its own. It starts unticked, and a connection made before it never gets it. Direct messages are never read.
- **Project setup (#1420).** `project.setup` works on a project that exists. It is always one proposal with one preview, and Undo takes the plan back as a whole.
- **A new project (#1433).** `project.create` makes a private project with only the approver on it. Undo moves it to the Trash and never deletes it. A project that holds a task or a doc by then stays.
- **Automations (#1423).** An agent only proposes a rule. Only an owner or admin can have one proposed for them, and only an owner or admin approves it. The rule is saved switched off unless the proposal said otherwise.
- **The workspace's "a person checks before Done" switch (#1421).** It has a control now, under AI, Accounts, Modes. Owners and admins change it; everyone else sees it.
- **A timer in an approved week (#1422).** The stop is refused, the timer is kept and the person is told why. No time is written into the approved week.
- **Subtasks.** The third level under a task stays refused. Benchmark job 4 is rewritten; the rule is not changed.
- **Row 15.** The benchmark sheet's own pick of fifteen jobs stands until the owner decides.

### Choices to review

One line per choice a slice made that the owner may want to reverse. The PR body has the full list where one is named.

- #1348: goal actions for agents follow the task-list permission until goals have a key of their own; reads use the `projects:read` scope; a private goal's name is blank in the agent audit row.
- #1349: `sanitize-html` is pinned to 2.17.5, because 2.18 needs Node 22.12. The owner decided: Node 22 later.
- #1350: a Slack send that fails keeps the proposal "approved" with the error on its card; there is no send-again; a message is at most 3,000 characters, to public channels, from a list of at most 50.
- #1362: a run reads a Slack channel at most 3 times and 40,000 characters; the demo skill exists only while the connector is on. Fourteen choices are in the PR body.
- #1381: all three calendar scopes are asked for at once; an admin sees who is connected and not the account's email. Twelve choices are in the PR body.
- #1386: the token form fills 30 days, while a token made by a direct API call may still have no end date unless strict mode is on; a renewed token keeps its row and gets a new secret; an expired token can be renewed and a revoked one cannot; an OAuth connection is renewed by connecting again.
- #1387: the audit log's wording is unchanged; the older agent path still writes no history row for a field change; the activity list is 40 px shorter.
- #1390: the instructions are capped at 4,000 characters; the "show me" link sits behind `MCP_TOOLS_DATA`. Nine choices are in the PR body.
- #1392: members now see proposals in the Inbox, with the ones they cannot decide shown locked and not counted; guests see nothing in the tab; the Inbox opens on the tab when something waits; workflow approvals and findings are not in the tab yet; it reads at most 100 rows.
- #1393: with no AI set up, Ask opens the AI accounts page; the go-to shortcuts follow the rail; opening a place once puts it on the rail.
- #1394: **a live change.** An agent's close now waits for approval on every existing project until someone sets "yes". When the workspace's "check before Done" switch is on, an agent's close is refused. Under "propose everything", a connected app's comments, links and timers are refused, not queued.
- #1396: seven rules; at most 500 tasks read and 10 findings a day per project; the switch is off by default; the look runs hourly at :45. Twelve choices are in the PR body.
- #1397: the setup card's first step is "Connect your AI", with "Skip for now".
- #1400: for an account that never arranged Home, "Waiting on you" now sits above the agenda.
- #1402: undo of a field made by an agent switches the field off only when no task uses it.
- #1404: a claim lasts 30 minutes; "Hand to an agent" shows only in a project whose manager is on.
- #1406: a standing approval covers only a connected agent's change held by "propose everything", never a close or a status change. It ends when the policy tightens or the connection goes. A decline reason is at most 200 characters, 20 kept per agent per project.
- #1407: a new string that uses a listed word turns the plain-words test red; reword it, or prune the baseline with `node scripts/plain-words.js --prune`.
- #1409: the "Agent working" filter is not saved with a saved view. For an in-product agent the mark names the agent only. At most 200 held tasks are read.
- #1410: only the caller's own AI can be picked as "My Claude". A hand-over writes one finding and no assignee. An "@" of your own AI in a task comment hands the task over.
- #1413: the assignee of the last task in that project is filled in. Its due date is reused only when that task was made in the last 30 minutes.
- #1414: an in-product run fills a place but is not refused by the limit. An agent that never read the task is not held by "changed since you read it".
- #1415: "Payload URL" became "Webhook URL" and `null` became "not set". 33 keys were left on purpose: setting names in admin messages and the Scrum sprint flow.
- #1418: an edit made offline is kept and sent later. If the server then refuses it, the row goes back and a toast says why. The automatic re-send stops after 50 failed tries and starts again when the browser is online.
- #1420: at most 10 statuses, 10 lists, 10 fields and 5 views in one plan. A new status joins the company's list and stays there after Undo. A plan is approved or declined whole.
- #1421: the switch saves the moment it is changed. The longest MCP instructions text is 3,812 of 4,000 characters, so later slices put their words in tool descriptions.
- #1422: a kept timer goes on counting. Once the approved week is over, a plain Stop logs the whole time on the first open day.
- #1423: an agent may propose six steps: set status, set priority, add a comment, create a subtask, assign, notify. Only triggers that start from a task. Undo deletes the rule unless someone edited it. The count of past matches is shown to owners and admins only.
- #1425: "overdue" means due before today, whatever the status. A link never saves a view: it opens a saved view that already matches, or the plain link with a note. One call carries at most 50 first values.
- #1426: "Sprint not found" and the Scrum sprint replies keep the word.
- #1427: "Always do this" is not offered on a batch.
- #1429: chat answers 20 messages unless asked, at most 50, each cut at 2,000 characters. A token kept to some projects is listed no channel. The model holds no public holidays, so `workdays.get` answers none.
- #1430: only the person the agent acted for is told. "Show" appears for an owner or admin and opens the audit log.
- #1432: a person's own AI is offered in the assignee list only where the project manager is on; the Members page now says so. "Sprint Planning" stays: it is a task type of two built-in templates.
- #1433: the project is made as the approver, who must be allowed to create projects. A token kept to some projects cannot ask for one. The new project shows in the sidebar after a reload.

### Choices to review, builds 773 to 803

Each is reversible. The PR is named so the choice can be found.
- A third level of subtasks stays refused. A copy of a project and a project an agent proposes are private to the person who approves (#1467, #1433).
- Chat is read by a connected agent only with its own permission, `chat:read`, never by default (#1469).
- Quick create starts in the project the person last had open, before the one last used (#1413).
- A decision on a proposal, and every agent setting, needs a signed-in person; a guest never decides (#1455, #1453).
- A connected agent's move of a task always waits; so does archiving or restoring a task with subtasks (#1476).
- "Pause all agents" also holds connected agents until an owner or admin resumes them (#1476).
- An agent can no longer file time off, save call notes, edit the person's AI memory, mark time billable or move workload; tags on a project are refused too (#1477, #1493).
- An agent may set a task reminder for its own person: a workspace agent at once, a connected agent by proposal (#1493).
- An owner or admin no longer joins people or comments into timesheet queries (#1486).
- A rule in a setup plan starts switched off; first tasks need the manage tools on (#1496).
- A personal API token can no longer change two-step sign-in, a password or sessions, or file time off for someone else (#1501).
- A webhook made by a person who has left delivers nothing; an email inbox is changed only by its maker, an owner or an admin (#1501).
- "Convert to list" makes the list before it hides the task, so a task is never lost when the list cannot be made (#1503).
- The report tab still says "Sprint": it opens the Scrum sprint report (#1497).
- A list emptied by deleting its tasks reads like a new list (#1498).

## Last step

Batches 14 to 22 and twenty-two single PRs reached `beta` on 2026-10-02 between 11:30 and 18:41 IST (builds 773 to 803). The local server answers build 803. The browser tests of `beta` were red from 14:08 to 18:41; batch 22 carried the fixes. Batch 23 and a side batch are assembled and not yet pull requests. This docs PR ticks the lines above, regenerates the beta log and the API reference, and rewrites the handoff.

## Blockers

- **Open, the owner's:** whether `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE`, `MCP_TOOLS_WORK` and `MCP_OAUTH` are on by default. Not planned as done.
- AI-1, AI-4a, AI-4e and the one-week trial need the owner: the flags on in the local build, and the owner's Claude connected with the manage grant.
- S-6 needs a new account.

## Log

### 2026-10-01
- Task created from the advisor review of task 046 (three notes), the coordinator's reply and the owner's decision that the agent is the person's own Claude or ChatGPT over MCP. The code was surveyed on `origin/beta` before writing; the findings are in `task.md` under "What already exists".
- Recorded in task 046 as decisions 27 (the eighth finish line, "AI-run"), 28 (the ninth, "anyone can use it"), 29 (the tenth, "no manual") and 30 (the agent comes over MCP). The owner may overrule any of them.
- Found while surveying: the manage grant over OAuth (#1307), any status including Done, complete creates and the batch call (#1270) are already on `beta`, behind flags that are off by default. The notes listed them as work to do. AI-4 was narrowed to what is really missing.
- Found while surveying: when an AI app connects, the server tells it three sentences written for a coding agent, and offers no ready-made prompts. That is the gap T-3 fills.
- About 22:09 IST: the owner confirmed decision 30 in chat. About 22:17 the owner went to sleep and named the advisor session for product and plan questions; it cannot approve money, credentials, permanent deletion, outside messages or loosening security.
- 22:40: the wave started with the registry split, AI-4b and AI-4d. Overnight the coordinator held at three to five local agents and started no new cloud runs.
- 23:29: #1395 merged (build 762) with the plan, the registry split, AI-4b, AI-4d, T-3, AI-5 part 1, S-5 and S-1.
- 23:32: #1394 (AI-4c) merged alone as build 763, before its suites had run: the queue script counted a draft's skipped checks as passed. Its own run passed at 23:45, and the script now merges only a PR that is not a draft and whose backend, frontend and e2e checks succeeded.
- AI-4b found and fixed a real fault on the way: a change through the newer agent path was published as a system change, so automations ran on it without the opt-in and chains were not counted.
- S-5 found that #1375's fix for duplicating a project picked no currency on a seeded company; one helper now answers the company's currency for a project, a goal and the AI project generator.

### 2026-10-02
- 00:03: #1399 merged (build 764) with AI-6 part 1, T-1 and AI-2 part 1. 00:34: #1401 (build 765) with S-4 and the sample project. 00:52: #1405 (build 766) with AI-3 part 1 and AI-6 part 2.
- Seen by hand on builds 762 to 766 (the Supporter session; results in task 046's `dogfood-findings.md`): Simple and Full mode, the token form, the "Needs your approval" tab, Connect your AI, the two agent cards on Project Details, the "What next" line, "Hand to an agent" and "Take it back". Not seen: anything that needs a connected AI.
- 01:02: T-2 (#1410) and T-4 (#1409) reported; both sat on the tenth batch branch.
- 08:47: #1408 merged (build 767) with AI-5 part 2 and the plain-words test. 08:58: the docs PR #1411 (build 768).
- 09:39: #1412 merged (build 769) with T-4, T-2 and two fix PRs of task 046 (#1389, #1403).
- The Supporter session swept build 769 by hand: the "Always do this" card on Project Details, the decline panel in the Inbox tab, the Members row of a connected AI, and #1389's four fixes. It listed five defects. #1432 fixes four. The fifth, "My Claude" missing from the assignee list, is by design: it is offered only where the project manager is on, and the Members page now says so.
- 10:15: #1417 merged (build 770) with T-5, AI-2 in the web app and plain-words batch 2.
- 10:48: #1428 merged (build 771) with S-2 on an existing project, AI-3 automations, the sheets for AI-1 and S-6, and four fix or follow-up PRs.
- 11:02: #1434 merged (build 772) with the batch rule, the tools the benchmark sheet asked for, the notice of an agent's change, `project.create` and three more PRs.
- Three slices each added a sentence to what a connecting agent is told. The text was reworded to fit its 4,000 characters, with no rule dropped (#1428).
- 11:15: the local server answers build 772. No hand check of builds 770 to 772 is recorded.
- 11:30 to 13:07: #1416, the fourteenth to sixteenth batches, #1436, #1442, #1469 and the seventeenth and eighteenth batches merged (builds 773 to 788). The GitHub organisation moved to the Team plan, so CI runs 60 jobs at once.
- The ninth hand check (build 782) passed the eighth's six defects and listed nine new ones.
- 13:15 to 13:33: the nineteenth batch, the CI shards (#1479: the `e2e` check went from about 16 minutes to about 9), #1472, the twentieth batch and #1480 merged (builds 789 to 795).
- A fresh agent read the twentieth batch's combined access rules and found nine gaps where two fixes meet, none a step back. The batch had merged on green checks ten minutes before the report.
- 13:57 to 14:08: five test and docs PRs and the twenty-first batch merged (builds 796 to 802). The setup plan's browser test ran green on its first run.
- 14:08: the browser tests of `beta` went red. Three test PRs and the twenty-first batch had each run their checks before the others landed. The merge queue was stopped and now merges only on checks that began after the last merge.
- The tenth hand check (builds 792 to 802) listed thirteen defects, the largest being a checklist that is stored on each press but not shown until a reload. It is older than this week: the task panel learned of its own checklist write only from the live event.
- About 14:48 the local machine reached a load of 70 on 8 cores, from agents running tests at once. Agents now check the load before each run and use one or two workers.
- About 15:25 the usage limit stopped every agent; it reset at 17:00 and each was resumed from its worktree.
- A second read (batches 21 and 22) found ten gaps, four of them in the setup plan when it is filed on the web route. A third read (batch 23) found eight, three of them new with the refresh of computed fields; it reported before the batch had a pull request.
- 18:41: the twenty-second batch merged (build 803) with the fixes that made the browser tests pass. Five of the failures were real, small faults that show only on a slow machine.
