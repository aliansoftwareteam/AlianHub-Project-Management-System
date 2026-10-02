# Progress: 047 — AI-run

State at build 766 (`14.36.0-beta.766`), 2026-10-02 01:10 IST.

How to read a line: `[x]` is merged into `beta`, with its PR and build number. "Inside build 762" means the PR reached `beta` inside the combined PR #1395; 764 is #1399, 765 is #1401, 766 is #1405. "In review (#n)" has an open PR. "Needs the owner" waits for a step only the owner can take.

Every merged slice below is behind what it was behind before: `MCP_OAUTH` and the three `MCP_TOOLS_*` flags are off in the local `.env`, so nothing that needs a connected AI has been used by hand yet.

## Checklist

**Step 0 — writing only**
- [x] The plan (`task.md`) and decisions 27 to 30 in task 046 (#1380, inside build 762)
- [ ] S-6 Newcomer tests written, and a first run on the local build as it is (the run needs a new account: the owner)
- [ ] AI-1 The benchmark sheet written (`ai-benchmark.md`)
- [ ] S-3 The plain-words test and its baseline, with the first 51 rewordings: in review (#1407, inside the ninth combined PR, #1408)
- [ ] The owner's answers to the 16 open decisions. Nine were taken as recommended; see "Decisions taken on 2026-10-01/02"

**Step 1 — the road in**
- [x] Each group of registry entries in its own file, so slices stop colliding (#1383, inside build 762)
- [ ] AI-4a A real Claude connected over OAuth with the manage grant (needs the owner)
- [x] AI-4b The agent's name in task history ("Claude, for Priya"), and the loop guard on the newer path (#1387, inside build 762)
- [x] AI-4d Token default, expiry notice and renew (#1386, inside build 762)

**Step 2 — the agent knows the product**
- [x] T-3 MCP instructions, the five ready-made prompts and the "show me" link (#1390, inside build 762)
- [x] AI-4c The project's policy: Done, and how far a connected agent may go (#1394, build 763)
- [x] AI-2 Over MCP: where the person is, message to task, and the preview card in the web app (#1398, inside build 764)
- [x] AI-3 Fields over MCP, with preview and undo (#1402, inside build 766)
- [x] AI-3 Views over MCP (#1402, inside build 766)
- [ ] AI-3 Automations over MCP. Not started

**Step 3 — measure**
- [ ] AI-1 First measured run over MCP (needs the owner: flags on locally, a connection with the manage grant)
- [ ] AI-4e The dogfood list repeated on the local build (needs the owner)

**Step 4 — the front door and the simple outside**
- [x] T-1 Sign-up ends in "Connect your AI", with a sign that the connection works (#1397, inside build 764). The server-key field in the wizard is not built
- [x] S-1 Simple mode (#1393, inside build 762)
- [x] S-5 No dead ends (#1391, inside build 762). Ten questions are left in `resources/dead-ends.md`
- [ ] AI-2 In the web app with no model: quick create, message to task and the palette start where the person is. Not started

**Step 5 — the system looks for you**
- [x] AI-5 The "Needs your approval" tab and row in the Inbox (#1392, inside build 762)
- [x] AI-6 Findings from rules, and the daily look (#1396, inside build 764)
- [x] AI-6 The work queue for the connected agent, with claims (#1404, inside build 766)
- [ ] AI-6 Triage of new tasks and estimates. Later: it needs a server key
- [ ] AI-5 "Always do this", and typed decline reasons kept as notes: in review (#1406, inside #1408)

**Step 6 — the teammate**
- [ ] S-2 Describe your project: one plan, one preview. Not started; it follows AI-3
- [ ] T-2 The connected AI as a named member: in review (#1410; on the tenth batch branch, which has no PR yet)
- [ ] T-4 Agent work visible in List, Table and Board: in review (#1409; on the tenth batch branch)
- [ ] T-5 Several agents at once. Not started
- [x] S-4 Home as "what next" (#1400, inside build 765)
- [ ] AI-1b The replay test in CI. It needs a passing AI-1 run first

**Step 7 — prove it (needs the owner)**
- [ ] AI-1 measured again: 15 delegations and 3 reserves, three runs each
- [ ] The one-week trial on one project
- [ ] The newcomer tests run again, on the "connect, then say it" path
- [ ] The scorecard's AI row and newcomer row filled

**Throughout**
- [ ] S-3 Plain-words batches. Batch 1 is in review (#1407): 51 keys reworded, 81 left in the baseline. Also left: 57 strings that say "1 tasks", and server replies such as "Sprint not found."

**Later, optional (with a server key)**
- [ ] The Ask box that plans with a model (AI-2, AI-3, T-3)
- [ ] The in-product manager on a schedule (AI-6)
- [ ] The generator's wider plan (S-2); the built-in workspace agent (T-2)

## What is left

**Can be done without the owner**
- Merge the ninth combined PR (#1408: #1406, #1407), then open the tenth (#1409, #1410) and merge it.
- T-5, several agents at once: one item per agent, a per-project limit, changed-since-read, pause all.
- S-2, describe your project.
- AI-2 in the web app, with no model.
- AI-3, automations over MCP.
- S-3, further plain-words batches.
- The AI-1 benchmark sheet and the S-6 newcomer test sheet, as writing.
- Small follow-ups the slices named: the undo notice and the e2e spec for intent create (#1398); one sentence in the MCP instructions about a close that waits for approval (#1394); a control in the web app for the workspace's "check before Done" switch, which has only a route today (#1394); "@" for a connected AI in chat (#1410); group by who is working (#1409).

**Needs the owner**
- Turn on `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` in the local `.env`, and connect their Claude with the manage grant. AI-4a, AI-4e and AI-1 wait for this, and so do the hand checks of #1387, #1390, #1398, #1402 and #1404 with a real connection.
- A new account, for the S-6 newcomer run.
- The one-week trial on AlianHub's own project.
- Whether the three `MCP_TOOLS_*` flags and `MCP_OAUTH` are on by default on a new install. It changes a security default and needs an access review first. Not planned as done.
- Whether AlianHub's own AI is measured with a server key, at a cap of $10. Recommended: not now.

## Decisions taken on 2026-10-01/02

The numbers are the rows of "Open decisions for the owner" in `task.md`. The coordinator took each as recommended while the owner was away; each is a setting or a slice, so each can be overruled.

- **5.** An agent does not mark a task Done without a person's approval by default. A project chooses "never", "with approval" or "yes" (#1394).
- **6.** Over MCP, a change to a single task is applied at once and shown with Undo; anything wider waits. A project may choose "propose everything" (#1394).
- **8.** "Always do this" exists, within the limits in AI-5, and each rule ends after 90 days (#1406, in review).
- **9.** A typed decline reason is kept as a note the agent reads, per project (#1406, in review).
- **11.** Connected agents appear in the member list under the person who connected them, with no seat and no role (#1410, in review).
- **12.** "Connect your AI" can be skipped at sign-up (#1397).
- **13.** New accounts start in Simple mode; existing accounts stay on Full (#1393).
- **14.** An agent never creates a field or a view without a preview: both are proposals a person approves (#1402).
- **16.** The project's manager starts at "Suggest": everything it offers is a proposal (#1396).
- **7** was built as the plan wrote it (30 days by default, a notice three days before, Renew) in #1386. The log does not record it as a decision taken.
- **Decision 30, confirmed by the owner** in chat on 2026-10-01 at about 22:09 IST: the agent that comes with AlianHub is the person's own Claude or ChatGPT over MCP. A server key is an optional extra.
- **Connector slices 4 to 6 (calendar) are paused** after slice 3 (#1381). With decision 30 the person's own AI brings its own calendar and mail connectors, so the agent slots went to this task. Reversible: the design is still in `design-connectors.md` of task 046.
- Still the owner's: rows 1 to 4, and rows 10 and 15, which nobody has answered. #1410 follows row 10's recommendation (a person hands work only to their own AI).

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
- #1406 (in review): a standing approval covers only a connected agent's change held by "propose everything", never a close or a status change, and ends when the policy tightens or the connection goes; a decline reason is at most 200 characters, 20 kept per agent per project.
- #1407 (in review): a new string that uses a listed word turns the plain-words test red; reword it, or prune the baseline with `node scripts/plain-words.js --prune`.
- #1410 (in review): only the caller's own AI can be picked as "My Claude".

## Last step

Batches 5 to 8 carried the first sixteen 047 PRs into `beta` between 23:29 and 00:52 IST. The ninth combined PR (#1408) is in CI; the tenth batch branch holds #1409 and #1410 and has no PR yet. No agent is running.

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
- The local server runs build 766. Seen by hand on builds 762 to 766 (the Supporter session; results in task 046's `dogfood-findings.md`): Simple and Full mode, the token form, the "Needs your approval" tab, Connect your AI, the two agent cards on Project Details, the "What next" line, "Hand to an agent" and "Take it back". Not seen: anything that needs a connected AI.
- 01:02: T-2 (#1410) and T-4 (#1409) reported; both sit on the tenth batch branch.
