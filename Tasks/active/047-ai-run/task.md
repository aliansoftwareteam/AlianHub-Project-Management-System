---
id: 047
title: AI-run — a teammate that already knows the software
status: active
priority: high
depends_on: [046]
created: 2026-10-01
---

# 047 — AI-run: a teammate that already knows the software

Status: **plan written on 2026-10-01, not started.** This file is the PRD (Rule 2 in `CLAUDE.md`). Nothing here is built yet. Some steps are the owner's to do and are marked "needs the owner".

Where it comes from:
- The owner's goal: "an AI project management system: the system guides and works in parallel with AI, with less human interface".
- The owner's second direction: "more advanced, but more user friendly; anyone can easily understand; all the technical work the system does itself using AI".
- The owner's third direction: "Every project management system, you need to learn it before you use it. In our system the user operates it easily using AI. We do not just provide software, we provide a real agent with the software."
- The owner's decision of 2026-10-01: the agent is the person's own Claude or ChatGPT, connected to AlianHub over MCP.
- The advisor review of task 046 (three notes) and the coordinator's reply.
- Task 046: `Tasks/active/046-better-than-clickup/task.md`, `scorecard.md` and `benchmark-25-jobs.md` (the second run is in PR #1358).

## Goal

Other tools give you software to learn. AlianHub gives you a teammate who already knows the software.

Task 046 counts how many clicks a person needs for 25 everyday jobs. That is the right test for a tool people drive by hand. This task makes the AI the normal way to work. A person says what they want in one sentence, or the system suggests it first. The person sees exactly what will change, approves once, and can undo it. The agent works beside people, as a named member, inside the limits the project sets.

At the same time the product must get simpler to look at. Power may grow, but what a new person sees must shrink.

We say "AI-run project management, approved by people". We do not say "AGI".

## Where the agent comes from (decision 30)

- **The agent that comes with AlianHub is the person's own Claude or ChatGPT, connected over MCP.** No model key on the server and no credits are needed to have an agent.
- **A server key stays an optional extra.** It is needed only for AI that runs inside AlianHub with nobody's AI app open: the Ask card, AI fields, agents on a schedule.
- **A hosted allowance from Alian is not built.**
- **The honest limit, stated in the product:** the agent works when the person's AI app is running or scheduled. Round-the-clock unattended agents need a server key.

What this changes for the plan:
1. **MCP is the main road, not a side track.** Connecting an AI app is a step in sign-up.
2. **The MCP server teaches the agent the product.** Its instructions and its ready-made prompts carry the knowledge, so the person never has to learn the tool.
3. **Setup happens over MCP with the preview in the web app.** The agent proposes a project's statuses, fields, views and automations in a few calls. Nothing is written before the person approves it on screen.
4. **The agent has a name in the app.** A change reads "Claude, for Priya". Its current work shows on the task.
5. **The system finds the facts with rules, not with a model.** Slipping dates, overloaded people, blocked chains, tasks with no owner, stale work. They fill the approval queue and a work queue the connected agent pulls from.
6. **With no server key, nothing looks broken.** Each in-app AI surface is hidden or says "Connect your AI".

## The finish lines

These three are added to the seven in task 046. They are recorded there as decisions 27, 28 and 29, and the owner may overrule any of them.

### Eighth finish line: "AI-run"

All three must hold.

- **(a) Fifteen of 25.** Of the 25 benchmark jobs, at least 15 can be done by one sentence plus one approval.
- **(b) A week on approvals only.** One real project runs for a week with the person only approving. In that week the system triages what comes in, assigns and estimates tasks, chases stale work, flags risks and writes a status report.
- **(c) Measured per job.** For every job we record: did it succeed, how many corrections the person made, how long it took, and what it cost.

The result becomes the AI row of the scorecard, which today reads "Not measured".

### Ninth finish line: "anyone can use it"

- **The first-hour test.** A person who has never used a project tool goes from sign-up to a running project (tasks, owners, dates, one view, one report) in under ten minutes, and visits no settings page. With decision 30 the path is: sign up, connect Claude, say "set up my project", approve the preview.
- **The ten-job test.** The same person finishes ten everyday jobs with no help. We record where they stop.

### Tenth finish line: "no manual"

The newcomer passes the first-hour test without opening help and without a tour.

## Rules that do not bend

Every slice follows these. A slice that cannot is redesigned, not excused.

1. **Every write is previewed and can be undone.** The person sees each change before it happens. After it happens there is an Undo.
2. **Outside writes are propose-only.** A Slack message, a calendar event or an email is never sent by an agent on its own. It is proposed with the exact text and the exact destination.
3. **An agent never sees or does more than the person behind it.** Same projects, same private lists, same permissions.
4. **No web fetch after a connector read.** A run that has read mail, chat or a calendar fetches nothing from the web afterwards.
5. **Budgets refuse before the model is called.** Where AlianHub pays for the model, a run that does not fit its cap or the company's month is stopped before any tokens are bought.
6. **Nothing is auto-approved by default.** "Always do this" exists only where a person switched it on, for one kind of change, and can switch it off.

All six already exist in the code and are kept, not rebuilt: the action list and its never-list (`Modules/Agents/registry.js`), the rule-based review (`policy.js`), proposals and undo (`proposals.js`, `undo.js`, `revert.js`), the outside-content marker (`taint.js`, behind `AGENT_TAINT_ROUTING`), the pre-call spend check (`spendGuard.js`, `Modules/AICore/reservation.js`), and the holder check that keeps an agent inside its person's rights (`permissions.js`, `Modules/Mcp/visibility.js`).

## Rules of the wave (from the owner's second and third directions)

1. **Simple by default, advanced on request.** A new person sees five places: Home, My work, Projects, Inbox, Ask. The rest appears when the project uses it or the person asks. One switch per person: Simple or Full.
2. **The AI does the setup.** Nobody builds statuses, fields, views, automations or dashboards by hand to get started. Later changes are sentences too.
3. **Plain words.** No internal terms on screen. A list is not called a "sprint". A folder is not a "directory".
4. **Every screen says what to do next.** Every AI action carries a "Why?" line. An empty screen offers the one sentence that fills it.
5. **No dead ends.** When something is missing, the system fills a sensible default or offers the fix in place. It does not just refuse.
6. **The conversation is the manual.** Nobody reads help. "How do I see who is overloaded?" gets the answer and the screen. "Do it for me" does it, with a preview.
7. **The person stays in charge.** Preview, undo, "Why?", the approval queue. This is what makes working in parallel safe.

## What already exists (code survey, `origin/beta` on 2026-10-01)

The engine is there. What is missing is making it the default way to work. This table is the short form; each slice below has the detail and the files.

| Area | Exists today | Where |
|---|---|---|
| What an agent may do | One list of allowed actions, each with a risk rating and the permission it needs. A never-list (delete a project, delete a task, billing, remove a member, edit permissions) | `Modules/Agents/registry.js` |
| Autonomy | Four levels for in-product agents: L0 answers only, L1 proposes everything, L2 acts on low and medium risk and proposes the rest, L3 as L2 and may run on a schedule | `registry.js` (`AUTONOMY`), `policy.js` |
| Proposals | What, why and the exact changes. Approve, edit then approve, decline with a reason, undo for 15 minutes | `proposals.js`, `controller.js`, `routes.js` |
| Undo | Per action, per proposal and per whole run, inside the company's undo window (24 hours by default) | `undo.js`, `revert.js`, `budget.js` |
| Budgets | A monthly company budget, a cap per run, a refusal before the model call, a daily run limit per agent | `budget.js`, `spendGuard.js`, `dailyRunLimit.js`, `Modules/AICore/spend.js` |
| Schedules and reports | In-product agents run on a schedule. Four built-in reports: daily briefing, deadline watch, mentions digest, weekly status | `schedules/scheduler.js`, `schedules/reports.js` |
| Memory | Project decisions and constraints, a person's preferences, what happened in past runs | `memory.js`, `engine/findingMemory.js` |
| Audit | Every agent action leaves a row with its undo | `agentAudit.js` |
| MCP tools | Read tools, task and doc writes, tags, links, lists, doc comments. Three flags, all off by default: `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE`, `MCP_TOOLS_WORK` | `Modules/Mcp/`, `docs/MCP-AGENT-GUIDE.md` |
| MCP sign-in | An OAuth server for the MCP endpoint, a consent screen, approval of each app by an owner or admin, a list of connected apps. Off by default (`MCP_OAUTH`) | `Modules/OAuthServer/`, `Modules/Mcp/oauthAuth.js`, `frontend/src/views/Ai/ConnectedApps.vue` |
| What MCP tells the agent | Three sentences, written for a coding agent. The list of ready-made prompts is empty | `Modules/Mcp/server.js` (`initialize`, `prompts/list`) |
| Work handed to an outside agent | A person hands a task to an approved app; the task shows the app's name, its progress lines and the result. Off by default (`EXTERNAL_AGENT_SESSIONS`) | `Modules/AgentSessions/`, `Modules/Mcp/sessionTools.js` |
| Agents as teammates | In-product agents sit on the Team board beside people, can be picked on a task, named in a comment, and messaged in chat | `Modules/Agents/team.js`, `triggers.js`, `chatAgents.js` |
| Ask (needs a server key) | Answers over the workspace with sources, limited to what the asker may open. Tasks and a doc can be built from an answer | `Modules/AI/ask*.js`, `askBuild.js`, `Modules/Knowledge/` |
| Automate with AI (needs a server key) | One sentence becomes a draft rule, shown before saving | `Modules/Automations/aiDraft.js` |
| AI project generator (needs a server key) | A brief becomes a new project: statuses, task types, lists, tasks and up to 30 fields | `Modules/AIProjectGenerator/` |
| When there is no server key | The web app knows the states "off", "not set up" and "not permitted", and has a notice for each | `frontend/src/composable/aiAvailability.js`, `AiOffPage.vue`, `AiModelNotice.vue` |
| Risk signals | Late, blocked, or due in two days and not started. Rules, no model | `Modules/UserDashboard/atRisk.js`, `Modules/Tasks/helpers/taskSignals.js` |
| Where a person has been | Recent tasks, projects, lists and docs per person | `Modules/RecentVisits/` |
| Intake | Email to task with a fixed template; forms to task | `Modules/EmailIn/`, `Modules/Forms/` |

### Corrections to the advisor notes and the coordinator's reply

The code on `beta` is ahead of both in four places. Each was checked in the files named.

- **The manage grant over OAuth is merged.** #1307 merged on 2026-10-01: an app asks for it, the person ticks it, and an owner or admin approves the app by name. The notes put it "at the top of the list" as work to do. What is left is to prove it with a real Claude connection.
- **Any status, including Done, already exists for a connected agent.** `task.status.change` is in `registry.js` and runs in `Modules/Agents/taskRequests.js`. It is offered only to a connection that holds the manage grant, and the close is recorded as made through the agent and marked unchecked. Merged in #1270.
- **Complete creates in one call already exist.** `task.add` and `subtask.add` take description, assignees, priority, dates, status, type, estimate and links (`CREATE_FIELDS` in `registry.js`). Merged in #1270.
- **A bulk call already exists.** `tasks.batch` runs up to 25 writes in one call. Each is checked on its own, and the ones that applied can be undone together (`Modules/Mcp/manageTools.js`). Merged in #1270.

All of it is behind flags that are off by default, and each pull request says it was not exercised against a running server. So it is merged and not yet proven by use.

## Slices

Each slice is one pull request unless a size says otherwise. Sizes: S is about a day of agent time, M two to three, L several pull requests.

Every slice also follows the standing rules of the repository: a failing test first, every string through i18n, dark mode and 390 px, stored fields declared in `utils/mongo-handler/schema.js`, every read scoped to the company, nothing shown that the viewer cannot open.

The slices are written in the order they run. The three families keep their names: **AI** (the AI-run line), **S** (simple outside), **T** (the teammate).

---

### AI-4 — The agent as a first-class user (the missing parts only)

First in the order, because MCP is the main road.

**What the four pull requests already did**

| PR | State | What it gave agents |
|---|---|---|
| #1337 | Merged | Tags (list, add, remove), links between tasks (list, add, remove), lists (list, create, rename, move into a folder), doc comments (read, write, reply, assign). All behind `MCP_TOOLS_WORK`. Each write runs the web app's own handler as the person (`Modules/Agents/workRequests.js`), and leaves an audit row and an undo |
| #1344 | Merged | An agent's token follows the action list on the write routes beside the main task route too (create, relations, lists and folders, doc comments, imports). Link answers and a few input checks are made consistent |
| #1348 | Merged | Goals for outside agents: list, read, set a target's value, add or remove what a target counts. Behind `MCP_TOOLS_WORK` (`Modules/Agents/goalRequests.js`). No tool creates or deletes a goal |
| #1355 | Merged | The doc routes answer an agent's token the way the routes beside them do. Bulk status and bulk tag changes store the values each task's own project holds |

Earlier, and already on `beta` (see "Corrections" above): any status including Done, complete creates, the batch call and doc writes (#1261, #1270); the manage grant over OAuth (#1307).

**So what is still missing**

1. **A real connection, seen working.** `MCP_OAUTH` is off by default. The consent screen, the approval of an app and the list of connected apps have not been looked at in a browser (#1307 says so). No real Claude has been connected over OAuth with the manage grant.
2. **The agent's name in task history.** The audit log already names an outside app as "App, for Person" (`Modules/Agents/actor.js`, `attribution`). Task history does not. The newer tools write the web app's own history line with the person's name followed by "(via …)" as text (`Modules/Agents/taskRequests.js`, `asRoute`). The older actions mark comments, time and links with the agent. No history row stores "this was an agent" as a field, so history cannot be filtered by it and the screen shows no agent mark.
3. **The loop guard on the newer path.** The automation engine ignores changes made by automations and agents unless a rule opts in (`Modules/Automations/engine/matcher.js`), and the event bus drops a chain deeper than three (`event/domainEventBus.js`). The older agent path passes its mark and depth along (`actions.js`). The newer path runs the web handler, which publishes the change as the person's. To be pinned by a test first, then fixed.
4. **Done, and how far a connected agent may go, as a project's choice.** Closing is decided today by the connection (does it hold the manage grant) and one company switch, "a person must check before Done" (`accounts.js`). There is no project setting. An in-product agent cannot close a task at any level.
5. **Connections that outlive a day.** A personal token already lasts from 1 to 365 days, chosen when it is made (`Modules/ApiTokens/helpers/apiTokenRules.js`). An OAuth connection lasts 90 days, with a 30-day refresh (`Modules/OAuthServer/config.js`). The token form offers no default (`frontend/src/views/Ai/AiAccounts.vue`), nothing warns before an expiry, and a token cannot be renewed: a new one must be made.

**Scope, as five small pull requests**
- **AI-4a The connection, proven (S, needs the owner).** Connect a real Claude to the local build over OAuth with both manage grants. Look at the consent screen, the app approval and the connected-apps list in a browser. Fix what breaks. Write the steps, and the ChatGPT path, into `docs/MCP-AGENT-GUIDE.md`.
- **AI-4b Actor and loop guard (M).** Store who acted on the history row: person or agent, the agent's name, and the person it acted for. One wording on both paths: "Claude, for Priya". An agent mark in the task's activity and the project's activity log, and a filter "made by an agent". The newer path passes the agent's mark and the chain depth to the event bus.
- **AI-4c The project's policy (M).** Two settings per project, changed only by an owner or admin:
  - Agents and Done: never; with approval (the default); yes, marked unchecked.
  - Connected agents: propose everything; or act on single tasks and propose anything wider (the default).
  They apply to connected agents and in-product agents alike, and are never looser than the company's switch.
- **AI-4d Tokens and connections (S).** A default lifetime in the form. A notice in the Inbox three days before a token or a connection ends. "Renew" keeps the name, the projects and the grants, and gives a new secret.
- **AI-4e Proof by use (S, needs the owner).** With the flags on locally, repeat the dogfood list from `Tasks/active/046-better-than-clickup/dogfood-findings.md`: close a task, create a complete subtask in one call, run a batch, write a doc. Record what works.

**Out of scope**
- New tools (they are in T-3, AI-2, AI-3 and AI-6). Deleting anything. Changing the never-list.
- Switching the tool flags on by default. That is an open decision for the owner (see below) and needs an access review first.
- A separate rate limit for agent calls (dogfood finding 6): recorded for later.

**Acceptance criteria**
- [ ] A real Claude is connected to the local build over OAuth, holds the manage grant, and creates and closes a task.
- [ ] A change made by an agent shows the agent's name and the person it acted for, in the task's activity and in the project's activity log, the same on both paths.
- [ ] The activity can be filtered to changes made by agents.
- [ ] A rule that reacts to a status change does not fire on an agent's change unless the rule opted in, on both paths. A chain of agent and automation changes stops at the depth limit.
- [ ] With the project set to "never", no agent closes a task there. With "with approval", a close arrives as a proposal. With "yes", the task is closed and marked unchecked. The company switch wins over the project.
- [ ] With the project set to "propose everything", every write from a connected agent waits in the approval queue.
- [ ] A new token starts with the default lifetime. Three days before an expiry its owner is told. Renew gives a new secret and the old one stops.
- [ ] The dogfood list is repeated on the local build and written up.

**Tests**
- Server: history rows for both paths; the event's actor and depth for both paths; the policy table (project values by company values, for a connected agent and an in-product agent); token default, notice and renew.
- Existing suites that must stay green: `agent-task-route-actions`, `agent-rest-route-actions`, `mcp-manage-tools`, `mcp-manage-work`, `mcp-oauth-actions`, `agent-policy`, `agent-automation-run`, `task-history-server-text`.
- Web: the agent mark and the filter; the project setting; the token form.

**Files**
- AI-4a: `docs/MCP-AGENT-GUIDE.md`, and whatever the browser pass finds in `Modules/OAuthServer/`, `frontend/src/views/OAuth/`, `ConnectedApps.vue`.
- AI-4b: `Modules/Agents/taskRequests.js`, `workRequests.js`, `actions.js` (wording only), `actor.js`, `Modules/Tasks/helpers/task_class_Mongo.js`, `Modules/History/controller.js`, `event/domainEventBus.js`, `utils/mongo-handler/schema.js`, `frontend/src/views/Projects/ActivityLog/`, the task panel's activity, `en.js`.
- AI-4c: `Modules/Agents/registry.js`, `policy.js`, `accounts.js`, `taskRequests.js`, `Modules/Mcp/propose.js`, the project settings store and screen, `frontend/src/views/Ai/AgentSettings.vue`, `schema.js`, `en.js`.
- AI-4d: `Modules/ApiTokens/`, `Modules/OAuthServer/`, `Modules/Inbox/`, `AiAccounts.vue`, `tokenPolicy.js`, `ConnectedApps.vue`, `en.js`.
- AI-4e: the local `.env` (the owner's), `dogfood-findings.md`.

**Size:** S + M + M + S + S. **Depends on:** nothing in code: #1344 and #1355, which changed `taskRequests.js` and the task routes, merged on 2026-10-01. AI-4a and AI-4e need the owner.

---

### T-3 — The conversation is the manual (the MCP server teaches the product)

**Exists**
- When an AI app connects, the server sends three sentences of instructions, written for a coding agent: start with the next task, comment, attach the pull request (`Modules/Mcp/server.js`, `initialize`).
- The list of ready-made prompts is empty (`prompts/list`).
- Each tool has a description. `docs/MCP-AGENT-GUIDE.md` explains the tools to a person, not to the agent.
- Inside the web app, with a server key: Ask answers from the workspace's own content, and the command palette opens a screen by name (`CommandPalette.vue`).

**Missing**
- Instructions that explain the product. Ready-made prompts. A way for the agent to answer "show me" with the right screen.

**Scope**
- **Instructions for a project teammate,** sent at connect and fitted to what that connection may do:
  - what a project, a list, a task, a field and a view are here, in a few lines;
  - how to find where the person is and what they can open;
  - the rules: read before writing, never guess a name, say what will change, a change that reaches a whole project waits for the person's approval in AlianHub;
  - the honest limit: what it cannot do, and where the person does that instead.
- **Ready-made prompts** the person picks in their AI app:
  - "Set up my project" (asks a few questions, then proposes the whole setup; see S-2);
  - "Plan my day";
  - "What is at risk";
  - "Write the status report";
  - "Triage what is new".
  Each prompt names only tools that connection is offered.
- **"Show me":** a tool that returns the address of a screen with a view applied (a list grouped by a field, the workload of this week, a task). "How do I see who is overloaded?" gets a one-line answer and the link.
- **Inside the web app, when a server key is set (second pull request):** the Ask box answers "how do I …" by opening the screen, and "do it for me" by showing the preview.

**Out of scope**
- New write tools (AI-2, AI-3). A help centre. Videos.
- Replacing the first-run tour now. #1354 refreshed it as a short tour that does not block the screen, and it stays. The conversation replaces it later, when S-2 and T-1 are proven.

**Acceptance criteria**
- [ ] A connected Claude that has never seen AlianHub answers "what can you do here?" correctly from the instructions alone.
- [ ] The five prompts appear in the AI app's prompt list. A connection without a write grant is offered only the prompts that read.
- [ ] No prompt and no instruction names a tool the connection is not offered.
- [ ] "Show me who is overloaded this week" returns a link that opens the workload view for the right project and week, and only for a project the person can open.
- [ ] The instructions stay under a set length, so they do not crowd the conversation.

**Tests**
- Server: the instructions and the prompt list for each mix of flags and grants; the link tool's access check.
- A new convention test: every tool named in a prompt or in the instructions exists and is offered to that caller.
- Existing: `mcp-tool-scopes`, `mcp-tool-visibility`, `mcp-tool-annotations`.

**Files**
- New: `Modules/Mcp/instructions.js`, `Modules/Mcp/prompts.js`, `tests/conventions/mcp-prompts.test.js`.
- Changed: `Modules/Mcp/server.js`, `Modules/Mcp/tools.js`, `scopes.js`, `Modules/Agents/registry.js` (one read action for the link tool), `docs/MCP-AGENT-GUIDE.md`; later `AskPage.vue`, `CommandPalette.vue`, `en.js`.

**Size:** M, then S for the web part. **Depends on:** AI-4a.

---

### AI-2 — Intent create

A task, a subtask or a message-to-task from one sentence. The place (project, list, assignee, date) is taken from where the person is and shown as a preview.

**Exists**
- Over MCP: a complete create in one call (`task.add`, `subtask.add`), a batch of up to 25 writes, edits, assignees, a field value, moving and archiving (`Modules/Mcp/manageTools.js`, `Modules/Agents/taskRequests.js`). People and lists are found with `members.list` and `lists.list`. A date given as a day is read in the person's time zone.
- A write that must wait is filed as a proposal, and approval asks the connection again (`Modules/Mcp/propose.js`, `approval.js`).
- The server knows the person's recent places (`Modules/RecentVisits/`). No tool tells the agent.
- In the web app:
  - Quick create: press C, type, pick the place. It remembers the last project, not the list (`frontend/src/components/organisms/QuickCreateTask/`).
  - The command palette: "new task" with a name opens quick create (`CommandPalette.vue`, `paletteRows.js`).
  - Message to task: the name is filled in; project and list are picked by hand every time (`frontend/src/components/organisms/MainChat/MakeTaskSheet.vue`).
  - With a server key: Ask builds up to 20 tasks from an answer with a ticked preview (`AskBuildTasks.vue`, `Modules/AI/askBuild.js`); notes become tasks (`Modules/AI/notesToTasks.js`).

**Missing**
- The agent does not know where the person is. A change made by a connected agent is not shown in the web app as it happens. Message to task is not a tool. In the web app the place is still picked by hand.

**Scope**
- **Over MCP (first pull request):**
  - A "where is the person" tool: the project, list, task or chat the person last had open, and how long ago. Older than a set time, the agent is told to ask.
  - A "message to task" tool: a chat message becomes a task that holds its text and links back.
  - One preview card in the web app, used by every slice in this task. When a connected agent's change waits, the card appears on the person's screen at once: each change on a line, the place it was inferred from with a "change" link, Approve, Edit, Reject. When a change is applied directly, a notice says what was done, by which agent, with Undo.
  - Which changes wait is the project's choice (AI-4c).
- **In the web app, with no model (second pull request):**
  - Quick create and message to task start on the list the person is in.
  - The palette reads "new task … for … due …" in code and shows the same preview card.
- **In the web app, with a server key (third pull request, optional extra):** the Ask box takes the same sentence, plans it with the model, and shows the same card.
- **Edits through the same road:** whatever the first AI-1 run shows a connected agent cannot do for jobs 7, 11, 17, 19 and 20 is added here as a tool, not as a new screen.

**Out of scope**
- Voice. Creating a whole project (S-2). Intake from email and forms (AI-6).

**Acceptance criteria**
- [ ] With the person on a list, "Add a task to fix the login bug, for Priya, due Friday", said to the connected agent, creates the task in that list, for Priya, due the coming Friday in the person's time zone. The web app shows what was done, with Undo.
- [ ] With the project set to "propose everything", the same sentence shows a preview card in the web app first, and nothing is created before Approve.
- [ ] When the person has had nothing open for a while, the agent asks where. It does not guess.
- [ ] A name that fits two people is asked about. The system never guesses between people.
- [ ] A person, project or list the person cannot open reads exactly like a name that does not exist.
- [ ] A chain of three subtasks is one sentence and at most one approval.
- [ ] From a chat message, the task holds the message text and lands in the list named, or the list the channel belongs to.
- [ ] In the web app with no server key, quick create and message to task need no click to pick the place when the person is on a list.
- [ ] Delegations 1, 2, 3 and 4 pass AI-1; with the edits, 7, 11, 17 and 19 pass.

**Tests**
- Server: the place tool (what it returns, its age, nothing the person cannot open); message to task; names inside and outside what the person can open; dates across time zones.
- Web: the preview card; the applied notice with Undo; the inferred place from each screen. One spec whose project check only knows a project it is handed (the trap noted for `checkApps`).
- Browser: `e2e/specs/intent-create.spec.js`, with the tool calls replayed.
- Conventions: `mcp-tool-scopes`, `mcp-tool-visibility`, `mcp-tool-annotations`, `tenant-scoping`, `i18n-check`.

**Files**
- New: `frontend/src/components/molecules/IntentPreview/`, a tools file for this group under `Modules/Mcp/`.
- Changed: `Modules/Agents/registry.js` (two actions), `Modules/Mcp/tools.js`, `propose.js`, `Modules/RecentVisits/` (read only), `Modules/Agents/proposals.js` (the event the card listens to), `QuickCreateTask.vue`, `quickCreateTask.js`, `MakeTaskSheet.vue`, `CommandPalette.vue`, `paletteRows.js`, later `Modules/AI/` and `AskPage.vue`, `en.js`.

**Size:** L (MCP and the card: M; the web app without a model: S to M; with a key: M). **Depends on:** AI-4b (the name shown), AI-4c (what waits), T-3 (the instructions that tell the agent to use it).

---

### AI-3 — Fields, views and automations from a sentence, with preview

Job 12 is 37 steps today. It should be one sentence and one approval.

**Exists**
- **Fields:** made by hand, one form per field (`Modules/CustomField/controller.js`, `helpers/fieldWrite.js`, `fieldTypes/`). A connected agent can list fields and set a value (`fields.list`, `task.field.set`). It cannot make a field.
- **Views:** saved views, view templates and the Everything page (`Modules/ViewTemplates/`, `Modules/Tasks/helpers/everythingViews.js`). No tool makes or opens a view.
- **Automations:** a rule catalogue, a check of a rule against it, a try against past events (`Modules/Automations/`, routes `registry`, `compile`, `backtest`, `dry-run`). No tool reads the catalogue or makes a rule.
- **With a server key:** "Automate with AI" drafts a rule from a sentence (`aiDraft.js`); the AI project generator makes up to 30 fields, for a new project only; assignment rules are drafted from a sentence.

**Missing**
- Tools to make fields, views and rules. A preview of them in the web app. Entries on the agent action list for the three.

**Scope**
- **Three groups of tools over MCP:**
  - **Fields:** make one or many fields in one call, with their types and options, and set values on a named task. A field that already exists by that name is reused, not made twice.
  - **Views:** make a saved view (filter, group, sort, columns, totals), and return a link to it. A view that is only looked at is a link and saves nothing (T-3's "show me").
  - **Automations:** read the rule catalogue, make a rule. The preview shows the rule as a sentence and how often it would have run in the last 30 days.
- **Three new entries on the agent action list:** make a field (medium risk), make a view (low), make a rule (high, so it always waits for approval).
- **The preview is the card from AI-2.** Making fields or a rule reaches the whole project, so it always waits for the person's approval in the web app, whatever the project's setting.
- **Undo for each:** a view is removed; a rule is removed; a field is removed only while it holds no value other than those set in the same change, and otherwise the undo says what stays.
- **In the web app, with a server key (later, optional extra):** the same three from the Ask box.

**Out of scope**
- A dashboard card from a sentence ("describe a card"): the next step after this slice, and reserve job 22.
- New field types. Changing or deleting existing fields by sentence.
- Statuses and whole-project setup (S-2 builds it on these tools).

**Acceptance criteria**
- [ ] Delegation 12: one sentence, one preview listing five fields with their types and five values, one approval. The task shows five values.
- [ ] Delegations 8, 9, 10 and 13: the view is opened or saved as asked. Looking needs no approval.
- [ ] Delegation 21: the rule is listed and on after one approval. A part that cannot be expressed is said, and nothing is created while the trigger cannot be expressed.
- [ ] Each tool asks for the same permission as the form it replaces.
- [ ] A field, person, status or list the person cannot see is never named in a preview.
- [ ] Undo after job 12 removes the five fields and their values. If someone else stored a value in between, that field stays and the undo says so.

**Tests**
- Server: each tool beside the web route it mirrors, for an owner, a member, a guest and a narrowed connection; undo; the "name already exists" case.
- Registry tests that already guard the action list: `agent-actions-rated`, `agent-permission-catalogue`, `agent-never-list`, `agent-undo-window`.
- Web: the three kinds of preview row.
- Browser: job 12 with the tool calls replayed.

**Files**
- New: a setup tools file under `Modules/Mcp/`, a requests file beside `Modules/Agents/workRequests.js`.
- Changed: `Modules/Agents/registry.js`, `actions.js`, `undo.js`, `Modules/Mcp/tools.js`, `scopes.js`, `Modules/CustomField/` and `Modules/Automations/` (called through their existing handlers; changed only where a handler cannot be called from outside a request), the saved-view store, `IntentPreview`, `docs/MCP-AGENT-GUIDE.md`, `en.js`.

**Size:** L (fields M, views M, automations M). **Depends on:** AI-2 (the preview card), AI-4c.

---

### AI-1 — The AI benchmark

Run over MCP, on the owner's own Claude plan. **It spends no API money.** It needs two things only the owner can do: switch the MCP flags on in the local build, and create a connection with the manage grant.

**Exists**
- The 25 jobs, their start states, end conditions and counting rules (`Tasks/active/046-better-than-clickup/benchmark-25-jobs.md`).
- Every MCP call is logged with the connection that made it; every write leaves an audit row with its undo (`Modules/Mcp/server.js`, `Modules/Agents/agentAudit.js`).
- Where AlianHub pays for the model, every call is booked with model, tokens and cost (`Modules/AICore/spend.js`, `usage.js`).
- The MCP suites already call the tools against a test database with no model (`tests/mcp-*.test.js`).

**Missing**
- A list of delegations. A way to run them and record the result. A result file. A replay in CI. Task 019 (backlog) plans a larger eval set and is not built; this slice is smaller and does not replace it.

**The 15 delegations**

Start states are those of the benchmark file, in project "QA Sandbox", with items named `[AI bench] …` so they do not collide with the earlier runs. Each sentence is typed to the connected Claude. "Here", "this list" and "this task" mean the screen the person has open in AlianHub.

| # | Job | The exact sentence | Start | Made to pass by |
|---|---|---|---|---|
| 1 | Create a task | Add a task "[AI bench] Write release note" for me, due tomorrow, high priority. | The list | AI-2 |
| 2 | Quick-create from anywhere | Add a task "[AI bench] Call supplier" to [AI bench] list. | Home | AI-2 |
| 3 | Message to task | Make a task in [AI bench] list from the last message in the scratch channel. | The chat | AI-2 |
| 4 | Three levels of subtasks | Under "[AI bench] Parent" add a subtask "Child", under that "Grandchild", and under that "Great-grandchild". | The parent task | AI-2 |
| 7 | Bulk-edit twenty | Set "[AI bench] bulk 01" to "bulk 20" to high priority and assign them all to (the teammate). | The list | AI-2 (edits) |
| 8 | Group by a custom field | Show me this list grouped by Stage. | The list | AI-3, T-3 |
| 9 | Filter and save a view | Show my tasks due this week and save it as a view called "[AI bench] Mine this week". | The list | AI-3 |
| 10 | Everything list | Show me all my tasks across every project. | Home | T-3 |
| 11 | Move a card | Move "[AI bench] Design" to In Progress. | The list | AI-2 (edits) |
| 12 | Five custom fields, filled | Add fields to this project: a text field Note, a number field Cost, a dropdown Stage with Alpha and Beta, a date field Review date and a people field Reviewer. On "[AI bench] Write release note" set them to: ok, 120, Beta, tomorrow, me. | The list | AI-3 |
| 13 | Totals of a number field | Show the total of Cost for each group, and show on "[AI bench] Parent" the total Cost of its subtasks. | The list | AI-3 |
| 17 | Manual time | Log 1 hour 30 minutes on this task for today. | The task | AI-2 (edits) |
| 19 | Dependency and shift | Make "[AI bench] Build" wait on "[AI bench] Design", then move Design two working days later. | The list | AI-2 (edits) |
| 20 | Sprint | Create a sprint "[AI bench] Sprint 9" for two weeks from today and add "[AI bench] bulk 01" to "bulk 05" to it. | The list | AI-2 (edits) |
| 21 | Automation rule | When a task's status changes to Done, send the assignees the notice "[AI bench] Done notice". | The project | AI-3 |

Three reserves are measured too and count only if one of the 15 fails: job 5 (folder, subfolder, list, move), job 15 (create a doc with one line) and job 22 (a dashboard with a tasks-by-status card).

Left out on purpose, with the reason:
- Job 6 (duplicate a project): it reaches a whole project. It stays a person's click until it has its own rated action.
- Job 14 (comment and reply): these are the person's own words.
- Jobs 16 and 18 (restore a doc version; approve a timesheet): these are a person's decisions, and already short.
- Job 23 (workload view) and job 24 (search): already one or two steps; nothing to delegate.
- Job 25 (invite a member; make a project private): an invitation sends mail, and access is never an agent's to change.

**What counts as success**
- **Pass:** the job's end condition, exactly as written in the benchmark file, is reached with one sentence, at most one approval and no correction. An approval asked by the AI app and an approval in AlianHub each count as one.
- **Pass with corrections:** the end condition is reached, but the person changed something in the preview or afterwards, or answered a question.
- **Fail:** the end condition is not reached, a second sentence was needed, or something was changed that the sentence did not ask for.
- Each delegation is run three times, each in a fresh conversation, because a model does not always answer the same way. A job counts towards the 15 only when at least two of three runs are a clean pass, and no run changed anything it was not asked to.

**What is recorded for every run**
- Result: pass, pass with corrections, fail; and the reason for a fail.
- Corrections: one for each value changed, each question answered, each retyped sentence and each undo.
- Approvals: how many, and where (the AI app or AlianHub).
- Time: seconds from sending the sentence to the end condition.
- Cost: over MCP the model is the person's own, so AlianHub cannot see its tokens. Recorded instead: the number of tool calls, the size of what the server sent back, and the plan usage the AI app shows, if it shows any. For a run through AlianHub's own AI, dollars from the spend record.
- Steps, counted with the rules of task 046, beside the click path of benchmark run 2.
- The AI app, its version and its model, at the top of the sheet.

**Where the result is written**
- `Tasks/active/047-ai-run/ai-benchmark.md`: the sheet, each run's table and the faults met.
- The AI row of `Tasks/active/046-better-than-clickup/scorecard.md`.

**Two parts**
- **AI-1a, the sheet and the measured runs.** A first run as soon as AI-4a and T-3 are in the local build shows how many of the 15 already work with today's tools. It is run again after AI-2 and AI-3.
- **AI-1b, the replay in CI.** For each delegation, the tool calls of a passing run are kept as a data file. A test replays them against the test database and checks the preview and the end state. It needs no model and spends nothing. It catches a break in a tool, a permission, the preview or the undo. It does not measure how well a model chooses the tools; only the measured run does.

**Expected cost**
- **Over MCP, on the owner's Claude plan: no API spend.** It uses plan usage: 18 delegations, three runs each, 54 short conversations.
- **Optional, only if the owner also wants AlianHub's own AI measured:** the local build is set to OpenAI `gpt-4o`, priced in `Modules/AICore/usage.js` at $2.50 per million input tokens and $10 per million output tokens. Assumed sizes: a simple create is about 6,000 tokens in and 800 out (about $0.02); a job that sends a catalogue is about 20,000 in and 4,000 out (about $0.09); a job with several steps is about 40,000 in and 3,000 out (about $0.13). One pass of the 18 is about $1, three passes about $3.50, with reruns up to $7. **Range $1 to $7, with a hard cap of $10** set as the budget before the run. On a top-tier model the range doubles. This optional run needs its own go-ahead.

**Scope**
- The sheet, the measured runs, the result file, the scorecard row.
- The data files of tool calls and the replay test.

**Out of scope**
- Fixing what the run finds (that is the other slices).
- Comparing AI apps or models. The larger eval set of task 019.
- ClickUp's AI. The comparison is our click path against our sentence path.

**Acceptance criteria**
- [ ] `ai-benchmark.md` holds the 15 delegations and three reserves with sentence, start, end condition and counting rules.
- [ ] A run is recorded with result, corrections, approvals, time and cost for every delegation, three runs each.
- [ ] The scorecard's AI row has a number and no longer reads "Not measured".
- [ ] The replay test runs in CI with no model and fails when a seeded break is put in a tool.
- [ ] Nothing the run made is deleted; everything is named `[AI bench] …` and listed at the end of the file.

**Tests**
- `tests/ai-benchmark-replay.test.js` (new): one case per delegation.
- A seeded-break case that proves the test can fail.

**Files**
- New: `Tasks/active/047-ai-run/ai-benchmark.md`, `tests/ai-benchmark/` (the delegations and the kept tool calls), `tests/ai-benchmark-replay.test.js`.
- Changed: `Tasks/active/046-better-than-clickup/scorecard.md`.

**Size:** S for the sheet and each run, M for the replay. **Depends on:** the owner (flags on locally, a connection with the manage grant); AI-4a and T-3 for the first run.

---

### S-6 — The newcomer tests

Costs nothing: the newcomer is a QA agent of the coordinator's, not AlianHub's AI.

**Exists**
- The setup wizard (`frontend/src/views/Setup/SetupWizard.vue`, `Modules/Setup/`), a sample project (`Modules/Setup/demoProject.js`; #1370, open, widens it).
- A five-step setup card and a four-stop first-visit tour, just refreshed (#1354, merged on 2026-10-01: `frontend/src/components/molecules/Home/SetupChecklist.vue`, `frontend/src/components/organisms/Tour/tourSteps.js`, `e2e/specs/onboarding.spec.js`).
- The benchmark method and the QA programme (task 034). Demo team accounts on the local build.

**Missing**
- The two tests written down. A brief for a QA agent that acts as a newcomer. A place for the result.

**Scope**
- Write the first-hour test and the ten-job test: the starting state, the ten jobs in a newcomer's words, what counts as "stopped", and what is recorded (minutes, screens visited, settings pages opened, help or tour opened, words not understood, the place the person stopped).
- A brief for the QA agent: it has never used a project tool, reads only what is on the screen, never opens a help page, never guesses an address.
- A first run on the local build as it is today, by hand, with no AI. It shows where newcomers stop now.
- A second run after T-1 and S-2, on the path of decision 30: sign up, connect Claude, say "set up my project", approve the preview.
- Write the results into `Tasks/active/047-ai-run/newcomer-tests.md` and add a row to the scorecard.

**Out of scope:** fixing what it finds (S-1, S-3, S-5 do). Real people as testers (later, and the owner's call).

**Acceptance criteria**
- [ ] Both tests are written so two people would run and count them the same way.
- [ ] One run of each is recorded, with the minutes and every place the newcomer stopped.
- [ ] Every stop is filed as a finding with the screen and the words on it.
- [ ] The first run spent no model budget.

**Tests:** none in code; the sheet is the test. **Files:** new `newcomer-tests.md`; changed `scorecard.md`. **Size:** S. **Depends on:** nothing. Run it on a local build that includes #1354.

---

### T-1 — Sign-up ends in "Connect your AI"

**Exists**
- The setup wizard for a new install, and the setup card and tour after sign-up (see S-6).
- A page where a person creates a token and copies the command that connects Claude Code (`frontend/src/views/Ai/AiAccounts.vue`, `mcpUrl.js`).
- A list of connected apps, where a person withdraws a grant or a whole connection (`ConnectedApps.vue`). A settings page where an owner or admin approves an app.
- The OAuth sign-in and consent screen for an app (`Modules/OAuthServer/`).
- The web app already knows when no model is set up, and has a notice for it (`frontend/src/composable/aiAvailability.js`, `AiModelNotice.vue`, `AiOffPage.vue`). The AI entry on the rail is hidden when AI cannot be reached (`Shell/navItems.js`).

**Missing**
- A "Connect your AI" step. A sign that the connection works. A check, surface by surface, that nothing looks broken when there is no server key.

**Scope**
- **A "Connect your AI" step** at the end of sign-up and in the install wizard, and a page of the same name that can be opened later:
  - Claude: the address to add as a connector, and what the person will be asked to allow.
  - ChatGPT: the documented path.
  - Claude Code and other tools: the token path that exists today.
  - "Skip for now" always works.
- **A live sign:** when the first call from the person's AI app arrives, the step says "connected" and offers the first sentence to say: "Set up my project".
- **An optional step for the server key** in the install wizard: one field, and a test that it answers. Clearly marked as an extra for AI that runs with nobody's app open.
- **No broken AI when there is no server key.** Each in-app AI surface (the AI entry on the rail, the Ask page and the Ask row in the palette, the Ask card, AI fields, "Write with AI", "Automate with AI", the AI project generator, in-product agents) is either hidden or shows "Connect your AI" with what connecting gives instead. With a key they work as today.
- **The honest limit in words:** the agent works while your AI app is open or scheduled.

**Out of scope**
- Switching the tool flags or OAuth on by default (the owner's open decision).
- A hosted allowance. An AlianHub app inside ChatGPT or Claude's own directory.
- Removing the tour (see T-3).

**Acceptance criteria**
- [ ] A new person lands on "Connect your AI" after sign-up, and can skip it.
- [ ] After connecting Claude, the step shows "connected" within a few seconds of the first call.
- [ ] On an install with no server key, no screen shows a failed AI call, an empty AI panel or a button that does nothing. Each surface is hidden or says "Connect your AI".
- [ ] On an install with a server key, every surface works as before.
- [ ] Where an admin has not switched connections on, the step says so in plain words and tells an admin what to switch on. It does not show a dead button.

**Tests**
- Web: the step in each state (not available, not connected, connected, skipped); each AI surface with and without a server key.
- Server: the "first call seen" signal, visible only to the person whose connection it is.
- Browser: `e2e/specs/onboarding.spec.js` extended.

**Files**
- New: `frontend/src/views/Ai/ConnectYourAi.vue`.
- Changed: `SetupWizard.vue`, the sign-up flow under `frontend/src/views/Authentication/`, `SetupChecklist.vue`, `useOnboardingChecklist.js`, `Modules/Users/helpers/onboardingRules.js`, `aiAvailability.js`, the AI entry points named above, `Modules/Mcp/server.js` (the signal), `docs/MCP-AGENT-GUIDE.md`, `en.js`.

**Size:** M. **Depends on:** AI-4a (a connection proven), T-3 (so the first sentence works). It builds on the setup card and rules that #1354 changed.

---

### S-1 — Simple mode

**Exists**
- The rail is built from one file, with eleven places and a More menu of four groups; each entry shows by permission (`frontend/src/components/organisms/Shell/navItems.js`, `GlobalRail.vue`, `MobileTabBar.vue`).
- A switch between two looks, and an accent colour, in My Settings (`Shell/looks.js`, `accents.js`, `frontend/src/views/Settings/MySettings/MySettings.vue`).
- Stored per-person navigation choices (`Modules/Users/helpers/navPreferencesRules.js`).

**Missing:** a Simple or Full switch; the five places; showing the rest as it is used.

**Scope**
- A switch in My Settings: Simple or Full. New people start on Simple. People who already have an account stay on Full.
- In Simple the rail shows Home, My work, Projects, Inbox and Ask. "My work" is the Everything page narrowed to me. With no server key, "Ask" opens "Connect your AI".
- A place appears on the rail once the person's projects use it (a project has a Gantt view, a rule, a dashboard) or the person opens it from search. Everything stays reachable from the command palette and from More.
- Nothing is hidden by permission that was not hidden before, and nothing is shown that was hidden before.

**Out of scope:** removing any screen; changing permissions; a different layout of the screens themselves.

**Acceptance criteria**
- [ ] A new account sees five places. An existing account sees what it saw yesterday.
- [ ] Every screen is still reachable from the palette in Simple.
- [ ] Opening a place once makes it stay on the rail for that person.
- [ ] The switch is one click and takes effect at once, on desktop and at 390 px.

**Tests:** web specs for the rail in both modes, the reveal rule and the switch; server test for the stored choice; `e2e/specs/onboarding.spec.js` extended. **Files:** `navItems.js`, `GlobalRail.vue`, `MobileTabBar.vue`, `shellState.js`, `MySettings.vue`, `Modules/Users/helpers/navPreferencesRules.js`, `schema.js`, `en.js`. **Size:** M. **Depends on:** S-6 for where newcomers stop. It builds on `navItems.js`, `shellState.js` and `MySettings.vue` as #1354 left them.

---

### S-5 — No dead ends

**Exists**
- A shared empty-state component (`frontend/src/components/atom/EmptyState/`). The setup card.
- One known dead end: a project with no currency cannot be duplicated (benchmark run 2, job 6). A fix is in flight in task 046.
- Other stops seen in run 2: a timer in an approved week only refuses at Stop; a Gantt drag on the Weeks scale snaps back with no message; an empty list says it cannot tell why it is empty.

**Missing:** a list of every setting a core flow needs; a default for each; a fix offered in place.

**Scope**
- List the settings each of the 25 benchmark jobs and the ten newcomer jobs needs.
- Give each a default at the moment a company or a project is created, and fill the gap for existing ones the first time the flow needs it.
- Where a refusal remains, the message says what is missing and offers the fix on the spot. A tool's refusal to a connected agent says the same, so the agent can tell the person.
- Fix the stops S-6 finds.

**Out of scope:** new features; changing what a permission refuses.

**Acceptance criteria**
- [ ] A fresh company completes each core flow without opening a settings page.
- [ ] No core flow ends in a refusal that names no cause.
- [ ] Each stop S-6 recorded is fixed or filed with a reason.

**Tests:** a server test that walks the core flows on a fresh company; web specs for the in-place fixes. **Files:** `Modules/Setup/createCompany.js`, `initalizations.js`, the project and company defaults, `Modules/ProjectDuplicate/`, the refusing routes found, `en.js`. **Size:** M. **Depends on:** S-6.

---

### AI-6 — Findings and the work queue (the project manager)

Per project, the system looks every day and says what needs attention. With decision 30 it is built in two layers: the facts come from rules on the server, with no model; the words and the changes come from the connected agent.

**Exists**
- Risk rules with no model: late, blocked, due in two days and not started (`Modules/UserDashboard/atRisk.js`); blocked chains (`Modules/Tasks/helpers/taskSignals.js`).
- Workload and capacity (`Modules/CapacityPlanning/`, the Workload view), working days per company.
- Four scheduled reports whose facts are read by queries (`Modules/Agents/schedules/reports.js`): daily briefing, deadline watch, mentions digest, weekly status. The model only writes the summary line. They belong to in-product agents, so they need a server key.
- `tasks.next`: the next task assigned to the person, for a connected agent (`Modules/Mcp/tools.js`).
- A suggested owner for a new task, with accept, dismiss and undo (`Modules/AssignmentRules/engine.js`); it asks a model, so it needs a server key.
- In-product skills: Reporter, Project Guide, Field Filler (`Modules/Agents/skills/seeds/`). A standup card on Home (`team.js`).
- Email to task and forms to task create the task from a fixed template, with no triage (`Modules/EmailIn/`, `Modules/Forms/`).

**Missing**
- A daily look per project. Findings as things a person can act on. A work queue a connected agent pulls from. Triage of new tasks. A chase for stale work.

**Scope**
- **A "project manager" switch per project,** off by default, with the project's level beside it (AI-4c).
- **Findings from rules, with no model,** on the project's working days:

| Finding | The rule | What is offered |
|---|---|---|
| A date is slipping | Past due, or the task it waits on now ends after it starts | Move the date, with the days and the cause |
| A person is overloaded | Planned hours above capacity this week | Reassign or move one named task |
| A chain is blocked | A task waits on one that has not moved | A comment to the blocker's owner, or a new date |
| No owner | Open, no assignee | An owner |
| No estimate | Open, no estimate | An estimate |
| Stale | Open, no change for a set number of working days | A comment asking for an update |
| New and untriaged | Created by email, a form or a quick create, with fields empty | Type, priority, estimate and owner together |

- **Each finding goes to two places:**
  - **The approval queue (AI-5),** with a reason written from the rule itself ("Due 3 days ago; waits on AP-12, which has not moved"). Where the fix needs no judgement (move a date by the days the blocker slipped; ask for an update with a fixed sentence), it comes as a ready proposal. Where it needs judgement (who should own it, how long it will take), it comes as a finding to hand to an agent.
  - **A work queue over MCP.** A tool gives the connected agent the next finding or handed-over task it may work on, and marks it as taken so two agents never take the same one. The agent reads, decides, and files the fix as a proposal with its own reason.
- **At most ten findings a day per project** reach the queue, the most urgent first. A fix that was rejected is not offered again for the same task and cause.
- **The morning plan, "what is at risk" and the status report** are T-3's prompts, run by the connected agent over these findings and the report facts. The numbers come from the server's queries, so they match the screen.
- **With a server key (optional extra, later):** an in-product manager agent does the same on a schedule with nobody's app open, at the level the project sets.

**Out of scope**
- One pipeline and one review screen for all intake (the advisor's first note, point 5). The connectors in flight (Slack, Google) are the intake side and stay in task 046. Here, a new task is triaged wherever it came from.
- Outside messages: a chase is a comment in the product, never an email or a Slack message.
- A living brief per project, and docs and tasks as one thing. After AI-5.

**Acceptance criteria**
- [ ] A project switches the manager on in its own settings. Other projects are untouched.
- [ ] On a seeded project with one case of each finding, the next daily look lists one finding per case, each with a reason a project manager can check against the screen. No model is called.
- [ ] A connected agent asked "what is at risk?" answers from the findings, and every number matches the screen.
- [ ] Two connected agents pulling work at the same time never get the same item.
- [ ] A finding never names a task, list or person that the one reading it cannot open.
- [ ] No more than ten a day per project. A rejected fix does not come back.
- [ ] **The one-week trial:** one real project runs seven days with the person only approving. The record shows how many proposals were approved, edited and rejected, how many changes were undone, and what the agent could not do. Needs the owner (their AI app, opened or scheduled each day).

**Tests**
- Server: each rule on a seeded project; the cap; no repeat after a rejection; the work queue's claim; what each reader may see; the report numbers against the queries Home uses.
- Existing: `agent-run-policy`, `agent-run-task-access`, the schedule suites, `mcp-tool-visibility`.
- Web: the project's settings card; the finding row with its facts.

**Files**
- New: `Modules/Agents/manager/` (the rules, the daily look, the work queue), a tools file for the work queue under `Modules/Mcp/`.
- Changed: `Modules/Agents/registry.js` (the queue's actions), `schedules/scheduler.js`, `schedules/reports.js` (facts read without a model), `proposals.js`, `Modules/Mcp/tools.js`, the project settings screen, `frontend/src/components/molecules/Home/`, `utils/mongo-handler/schema.js`, `en.js`; later `Modules/Agents/skills/seeds/` for the in-product manager.

**Size:** L (rules and the daily look: M; the work queue: M; triage and estimates: M). **Depends on:** AI-5 (the queue it fills), AI-4c (the project's settings block), T-3 (the prompts that use it).

---

### AI-5 — The approval queue in the Inbox

The person's main screen becomes a list of decisions, not a list of tasks.

**Exists**
- Proposals with what, why and the exact changes; approve, edit then approve, decline with a reason, undo (`Modules/Agents/proposals.js`). A change a connected agent could not make directly is filed the same way (`Modules/Mcp/propose.js`).
- Three screens show them today:
  - The Inbox shows a proposal as a row marked "Needs your approval", with Approve and Decline (`frontend/src/views/Inbox/Inbox.vue`).
  - The AI Inbox has the full set: approve, edit then approve, decline with reasons, undo, "Why", sort, days waiting, plus workflow approvals and reports (`frontend/src/views/Ai/AiInbox.vue`).
  - The Approvals page mixes timesheets, leave and agent proposals, with a "Why" dialog (`frontend/src/views/Approvals/Approvals.vue`). Benchmark run 2 found a timesheet sitting under nine proposals there.
- Home has a "Waiting on you" card with Approve (`frontend/src/components/molecules/Home/WaitingOnYouCard.vue`).
- A canned decline reason can become a preference the person accepts or dismisses, and every decision is kept as part of the run's record (`Modules/Agents/memory.js`).

**Missing**
- One queue instead of three. Edit from the Inbox. Approving several at once. "Always do this". A typed reason for a rejection reaching the agent. The reason visible on every row. Findings in the same place.

**Scope**
- A "Needs your approval" tab in the Inbox, first in the list, with its count on the rail. It holds proposals from connected and in-product agents, findings from AI-6, and workflow approvals. With no server key the tab is still there: connected agents and the rules fill it.
- Each row: who proposes ("Claude, for Priya", or "Project manager"), what, **why**, and what exactly changes. Approve, Edit, Reject, and "Always do this". A finding that needs judgement has "Hand to my AI" instead.
- Approve several rows at once, only for rows of the same kind, with the full list shown before the click.
- **"Always do this":** a stored rule for one agent, one kind of change and one project. From then on that change is done and shown in the Inbox as done, with Undo. It is offered only for low- and medium-risk changes that can be undone. It is never offered for an outside write, a close, a move, an archive, a new field or a new automation. It is listed in the project's agent settings and removed with one click.
- **Rejections reach the agent:** a canned reason keeps working as today. A typed reason is kept as a note for that project, shown in the project's memory list, where a person can edit or remove it. A connected agent gets the note with its next piece of work; an in-product agent reads it on its next run. The same change is not proposed again.
- The AI Inbox and the Approvals page read the same list. Timesheets and leave stay on Approvals, above agent proposals.
- Home's card opens the new tab.

**Out of scope**
- Changing what a proposal is or how it is applied.
- Approving from email or chat (that is an outside write). Approving from inside the AI app: the approval is the person's click in AlianHub.
- New kinds of agents.

**Acceptance criteria**
- [ ] One tab holds everything that waits for the person. The count on the rail matches it.
- [ ] Approve, edit then approve, reject with a reason and undo all work from the Inbox, and give the same audit row and undo as the AI Inbox does today.
- [ ] A person sees only proposals and findings for projects and tasks they can open. A proposal that needs an owner or admin shows as locked to everyone else.
- [ ] A connected agent cannot approve anything, its own proposals included.
- [ ] "Always do this" is offered only where the rules above allow. After it is chosen, the next matching change is applied and listed as done with an Undo. Removing the rule returns the agent to asking.
- [ ] A rule made with "Always do this" never lets an agent do more than the project's policy allows.
- [ ] After a typed rejection, the same change is not proposed again in that project, and the note is visible in the project's memory list.
- [ ] On the Approvals page a timesheet is never below an agent proposal.
- [ ] The tab works by keyboard, at 390 px and in dark mode.

**Tests**
- Server: the list a person may see; the standing rule (which actions may have one, how it is matched, removal, the ceiling); the note from a typed reason; approving several; no tool approves.
- Existing: `mcp-proposal-approval`, `mcp-oauth-approvals`, `agent-policy`, `agent-undo-window`, `agent-revert`.
- Web: the tab, the row, the edit form, the "Always do this" dialog, the count.
- Browser: `e2e/specs/inbox-triage.spec.js` extended.

**Files**
- New: `Modules/Agents/standingApprovals.js`.
- Changed: `Modules/Agents/proposals.js`, `controller.js`, `routes.js`, `policy.js`, `memory.js`, `Modules/Mcp/approval.js`, `Modules/Inbox/controller.js` and `helpers/`, `utils/mongo-handler/schema.js`, `Inbox.vue`, `AiInbox.vue`, `Approvals.vue`, `WaitingOnYouCard.vue`, `frontend/src/composable/agentProposals.js`, `frontend/src/components/organisms/Shell/inboxUnread.js`, `en.js`.

**Size:** L (the tab and the row: M; "Always do this" and the notes: M). **Depends on:** AI-2 (the preview card it reuses), AI-4c (the project's policy).

---

### T-2 — The agent as a named member

**Exists** (read in `Modules/Agents/team.js`, `chatAgents.js`, `triggers.js` and the catalogue)
- **The Team board** lists people and in-product agents together: who is working on what right now, hours this week, time off (`team.js`; `frontend/src/views/Ai/AgentTeammates.vue`, `AgentMemberRow.vue`, `PersonMemberRow.vue`). It lives in the AI section, not on the Members page.
- **On a task,** an in-product agent can be chosen beside the assignees, or named with @ in a comment; either starts a run. Guests cannot (`triggers.js`; `AgentPicker.vue`, `AgentMentionBox.vue`, in the task panel's side).
- **In chat,** an in-product agent named with @ or messaged directly answers, and may carry up to five changes: a comment, a task, a subtask, an edit (`chatAgents.js`, `chatController.js`).
- **A catalogue of agents** to add from templates, a wizard, and a library of skills (`AgentCatalogue.vue`, `agentTemplates.js`, `AgentWizard.vue`, `Modules/Agents/skills/catalogues.js`).
- **All of the above are in-product agents and need a server key** (`runs.canStart` refuses when no model is set or priced).
- **For an outside app:** a person can hand a task to an approved app. The task then shows the app's name, its progress lines, and whether it finished (`Modules/AgentSessions/`; the strip in `TaskDetailPanel.vue`). Off by default (`EXTERNAL_AGENT_SESSIONS`). The audit log names it "App, for Person".

**Missing**
- The connected AI as a member a person can see, pick and name. Today it has no row anywhere except "Connected apps" in the person's own account.

**Scope**
- **In the member list:** each person's connected AI appears under that person, clearly marked as an agent ("Claude, connected by Priya"), with when it last worked. It takes no seat and has no role of its own. In-product agents appear in the same list.
- **In the assignee picker:** a person sees "my Claude" and can hand it a task. The task goes to the agent's work queue (AI-6) and shows "handed to Claude, for Priya". The person stays the assignee, as the hand-over rule already says.
- **With @ in a comment or chat:** naming your own connected AI puts the task or the question in its work queue. Naming an in-product agent works as today.
- **Its name in history** comes from AI-4b. **Its "working now" state** comes from T-4.
- **With a server key (optional extra):** one built-in workspace agent is on from the start, made from the Project Guide template.

**Out of scope**
- Handing a task to another person's connected AI. An agent acts only for the person who connected it.
- A seat, a role or a login for an agent. Agents in billing.

**Acceptance criteria**
- [ ] After a person connects Claude, the member list shows it under that person, marked as an agent.
- [ ] A person can hand a task to their own connected AI from the assignee picker and with @. Nobody else can hand work to it.
- [ ] A handed task appears as the next item when that agent asks for work, and nowhere for another person's agent.
- [ ] Withdrawing the connection removes the row and returns its handed tasks to plain assigned tasks.
- [ ] On an install with no server key, the list, the picker and @ show connected agents only, and nothing that would fail.

**Tests**
- Server: who sees which agent rows; who may hand work to which agent; the hand-over and its undo; withdrawal.
- Existing: the agent-session suites, `agent-task-triggers`, `agent-chat-mentions`.
- Web: the member rows, the picker entry, the @ menu.

**Files**
- Changed: `Modules/Agents/team.js`, `triggers.js`, `Modules/AgentSessions/delegation.js`, `access.js`, `Modules/OAuthServer/personalGrants.js` (read), the Members page, `AgentPicker.vue`, `AgentMentionBox.vue`, `useRunnableAgents.js`, `schema.js`, `en.js`.

**Size:** M. **Depends on:** AI-4a, AI-4b, AI-6 (the work queue).

---

### T-4 — Agent work visible beside people's work

**Exists**
- A Board card shows a strip with the agent's name and a clock while an in-product agent runs on it, and a line with "Review" when a proposal waits (`frontend/src/views/Projects/Kanban/BoardViewDisplayCardComponent.vue`).
- The task panel shows the same strip for an in-product run and for a task handed to an outside app (`TaskAgentStrip.vue`, `TaskDetailPanel.vue`).
- The Team board and Home's standup card show who is on what (`team.js`).

**Missing**
- The mark on List and Table rows. The mark for a connected agent on the Board. A way to see only what agents are working on.

**Scope**
- A "working now" mark on a task in List, Table and Board, for in-product runs and for connected agents alike, with the agent's name and "for" whom.
- A waiting-proposal mark on the same rows, which opens the approval queue at that row.
- A filter "worked on by an agent", and "group by who is working on it", in List and Board.
- A connected agent says what it is doing through the progress tools that exist; a task it took from the work queue shows as taken until it finishes, fails or goes quiet for a set time.

**Out of scope:** a separate agent screen; a live log of the agent's thinking.

**Acceptance criteria**
- [ ] While an agent works on a task, the task shows it in List, Table, Board and the task panel, within a few seconds, for everyone who can open the task.
- [ ] The mark clears when the agent finishes, fails or goes quiet.
- [ ] The filter and the grouping show the same tasks as the marks.
- [ ] Nobody sees a mark on a task they cannot open.
- [ ] The marks do not slow a list of 10,000 tasks past the budget of task 046.

**Tests:** server tests for the "working now" read and who may see it; web specs for the row mark, the filter and the grouping; the list speed check. **Files:** `Modules/Agents/runs.js` (the summary), `Modules/AgentSessions/`, `Modules/Agents/manager/` (claims), the List, Table and Board row components under `frontend/src/views/Projects/`, the filter and group menus, `en.js`. **Size:** M. **Depends on:** AI-4b, AI-6 (claims), T-2.

---

### T-5 — Several agents at once

**Exists**
- One open run per in-product agent per task; a second start is answered with the first (`Modules/Agents/runs.js`).
- A limit on how many runs a company has in flight (`Modules/Workflows/concurrency.js`).
- A daily run limit per agent (40 by default), a spend cap per agent and per run, the company's monthly budget, "pause all" (`dailyRunLimit.js`, `budget.js`, `spendGuard.js`).
- A rate limit for OAuth sign-in and one shared limit for calls.

**Missing**
- A limit per project. A fair hand-out between agents. A clear answer when two changes meet. One place that shows how many are at work.

**Scope**
- A project setting: how many agents may work in the project at once (a small default), counted across connected and in-product agents.
- The work queue (AI-6) hands out one item per agent at a time and returns an item nobody finished.
- When an agent changes a task that changed since it read it, the change is refused with "changed since you read it", and the agent reads again. A person's edit always wins.
- The project's header shows how many agents are at work, and opens the list (T-4's filter).
- Where AlianHub pays for the model, the existing caps apply to each run. For connected agents the limits are the count and the call rate.

**Out of scope:** agents talking to each other; splitting one task between agents.

**Acceptance criteria**
- [ ] With the limit at three, a fourth agent asking for work in that project is told to wait, and gets work when one finishes.
- [ ] Two agents never hold the same item.
- [ ] An agent's stale change is refused and nothing is half-written.
- [ ] "Pause all" stops in-product runs and stops handing out work to connected agents.
- [ ] The count in the header matches the tasks marked "working now".

**Tests:** server tests for the limit, the hand-out, the stale-change refusal and pause; a test with several callers at once. **Files:** `Modules/Agents/manager/`, `runs.js`, `Modules/Workflows/concurrency.js`, `taskRequests.js` (the "changed since" check), the project settings, the project header, `schema.js`, `en.js`. **Size:** M. **Depends on:** AI-6, T-4.

---

### S-2 — Describe your project

**Exists**
- Over MCP: nothing creates a project. Lists can be created (`list.create`). Fields, views and rules come with AI-3.
- With a server key: the AI project generator. A brief (typed or uploaded), follow-up questions, a plan, then the project with statuses, task types, lists, tasks and up to 30 fields (`Modules/AIProjectGenerator/`: `briefExtractor.js`, `clarifier.js`, `orchestrator.js`, `schemaValidator.js`, `planRules.js`).
- A guided project start (task 015). A project template gallery (`Modules/ProjectTemplates/`), view templates, automation recipes (`Modules/Automations/templates.js`), a sample project.

**Missing**
- A way for the connected agent to set up a whole project. One preview of all of it. Views, rules and a dashboard as part of a setup.

**Scope**
- **A "set up a project" tool over MCP.** The agent sends one plan: the project's name, its statuses, lists, fields, views, rules and first tasks. The server checks the plan with the same rules the generator's plans are checked with, and files it as one proposal.
- **One preview in the web app,** in the card from AI-2: every part listed, each able to be unticked. One approval creates what is ticked. Rules arrive switched off until the person turns them on.
- **T-3's "Set up my project" prompt** asks the few questions and builds the plan.
- **"We also track budget"** on an existing project is AI-3's field tool plus a column on the current view.
- **With a server key (optional extra, later):** the in-product generator's plan gains views, rules and a dashboard, and shows the same preview.

**Out of scope:** new project templates; importing from another tool; deleting or reshaping an existing project.

**Acceptance criteria**
- [ ] "Set up my project", said to a connected Claude, ends in one preview in AlianHub with statuses, fields, views, rules and the first tasks. One approval creates what is ticked.
- [ ] Nothing is created before the approval. Undo within the undo window removes the project that was created.
- [ ] A person who may not create projects gets the same refusal as on the button.
- [ ] The first-hour test passes with it: a running project in under ten minutes, no settings page, no help and no tour.

**Tests:** the plan's checks; the create step for each part beside the web route it mirrors; undo; a browser test of the whole flow with the tool calls replayed. **Files:** the setup tools file from AI-3, `Modules/AIProjectGenerator/schemaValidator.js` and `planRules.js` (shared checks), `orchestrator.js` and `executeAgents.js` (the create step), `Modules/Agents/registry.js`, `undo.js`, `IntentPreview`, `Modules/Mcp/prompts.js`, `docs/MCP-AGENT-GUIDE.md`, `en.js`. **Size:** L. **Depends on:** AI-3, T-3, T-1.

---

### S-4 — Home as "what next"

**Exists**
- Home with cards that can be shown or hidden: My work, Agenda, Assigned comments, Waiting on you, Standup, Recents, Goals, the setup card (`frontend/src/views/Home/TodayOverdue.vue`, `frontend/src/components/molecules/Home/homeCards.js`).
- "Why" panels for an Ask answer and for a proposal (`frontend/src/views/Ai/AskWhyPanel.vue`, `frontend/src/views/Approvals/ProposalWhyDialog.vue`).

**Missing:** "today for you" and "needs your approval" first by default; a sentence offered on every empty screen; "Why?" on every AI line.

**Scope**
- Home opens with two things: today for you, and what needs your approval. The other cards follow and stay optional.
- Every AI action on Home and in the Inbox carries a "Why?" line.
- Each empty screen offers the one sentence that fills it. With a connected AI the sentence can be copied to say there; with a server key it runs in place.

**Out of scope:** new cards; a redesign of the cards.

**Acceptance criteria**
- [ ] A new person's Home shows today's work and the approvals first.
- [ ] A person who arranged their Home keeps their arrangement.
- [ ] The ten most-seen empty screens each offer a sentence.
- [ ] Every AI line has a "Why?".

**Tests:** web specs for the default order, a kept arrangement, the empty screens. **Files:** `TodayOverdue.vue`, `homeCards.js`, `WaitingOnYouCard.vue`, `Modules/Users/helpers/homeCardsRules.js`, the empty-state uses, `en.js`. **Size:** M. **Depends on:** AI-5.

---

### S-3 — Plain words (throughout)

**Exists**
- One source file for every string (`frontend/src/locales/en.js`), a check that every locale has every key, and a baseline that may only shrink (`tests/conventions/i18n-check.test.js`, `scripts/i18n-allowlist.json`).
- Plain labels for proposals (`frontend/src/views/Ai/plainLabels.js`).
- The slips benchmark run 2 listed: a new list announced as "Sprint created successfully", "Enter sprint name", "Select a sprint", "Enter directory name", a raw "SPRINT DATA REQUIRED", "1 tasks".

**Missing:** a list of words that must not reach the screen, and a test that holds it.

**Scope**
- A word list: internal terms and the plain word for each.
- A test that counts those words in `en.js` against a baseline that may only shrink.
- The sweep, in small batches by screen. A reworded string is deleted from every locale first and filled again, so no locale keeps the old text.
- Counts read correctly for one and for many.
- The same words in what the MCP server tells the agent, so the agent speaks the product's plain words.

**Out of scope:** renaming things in the code or the database; translating by hand.

**Acceptance criteria**
- [ ] The test is in CI and fails when a listed word is added.
- [ ] The slips from run 2 are gone.
- [ ] The baseline is lower after every batch.

**Tests:** `tests/conventions/plain-words.test.js` (new). **Files:** the test, `scripts/plain-words-baseline.json`, `en.js` and the locale files. **Size:** S for the test, then S per batch. **Depends on:** nothing. It touches `en.js`, as every slice does; merge by keeping both sides' keys.

## Order and parallel lanes

**The rule from the coordinator stands:** no new feature wave starts while more than about 15 merged builds are unused. This wave starts after batches 3 and 4 of task 046 are merged, built and looked at.

**The order follows the advisor's revised list.**

| Step | What | Runs side by side | Notes |
|---|---|---|---|
| 0, now | Writing only, and the owner's answers | S-6 first run · AI-1 sheet · S-3 test | Nothing here touches product code except the S-3 test |
| 1 | The road in | AI-4a (needs the owner) · AI-4b · AI-4d | The default-flags question is the owner's and is not planned as done |
| 2 | The agent knows the product | T-3 · then AI-4c · AI-2 over MCP with the preview card · then AI-3 | See the collision table: one holder of `registry.js` at a time |
| 3 | Measure | AI-1 first run over MCP (needs the owner) · AI-4e · S-6 written up | The first number for the AI row |
| 4 | The front door and the simple outside | T-1 · S-1 · S-5 · AI-2 in the web app without a model | T-1 and S-1 both change the setup card and the rail: one after the other |
| 5 | The system looks for you | AI-5 the tab and the row · AI-6 rules and the daily look · then the work queue · AI-5 "Always do this" | AI-5 before AI-6 |
| 6 | The teammate | S-2 · T-2 · T-4 · then T-5 · S-4 · AI-1b replay | S-2 after AI-3; T-2 and T-4 after the work queue |
| 7 | Prove it (needs the owner) | AI-1 again · the one-week trial · the newcomer tests again | Then the scorecard is rewritten |
| Later, optional | With a server key | The Ask box that plans with a model (AI-2, AI-3, T-3) · the in-product manager on a schedule (AI-6) · the generator's wider plan (S-2) · the built-in agent (T-2) | Only after the MCP road passes the finish lines |

S-3 batches run in any step, one at a time.

**The known collision points**

| File | Slices that change it | Order |
|---|---|---|
| `Modules/Agents/registry.js` | T-3 (one read action), AI-4c, AI-2 (two actions), AI-3 (three), AI-6 (the queue), S-2 | One at a time, in that order. A first small pull request may move each group of entries into its own file, so later slices stop meeting here |
| `Modules/Agents/actions.js`, `undo.js` | AI-3, S-2 (AI-4b changes wording in `actions.js`) | AI-4b first, then AI-3, then S-2 |
| `Modules/Agents/taskRequests.js` | AI-4b, AI-4c, T-5 | AI-4b, AI-4c, then T-5 |
| `Modules/Agents/proposals.js` | AI-2 (small), AI-5, AI-6 | AI-2, AI-5, AI-6 |
| `Modules/Agents/policy.js` | AI-4c, AI-5 | AI-4c first |
| `Modules/Mcp/server.js`, `tools.js`, `scopes.js` | T-3, AI-2, AI-3, AI-6, T-1 (the signal) | Each slice adds its own tools file; only the lists in `tools.js` and `scopes.js` are shared. Keep both sides |
| `Modules/Mcp/propose.js`, `approval.js` | AI-4c, AI-2, AI-5 | In that order |
| `utils/mongo-handler/schema.js` | AI-4b, AI-4c, AI-5, AI-6, T-2, T-5, S-1 | Small added blocks; keep both sides |
| `frontend/src/locales/en.js` and the locale files | Every slice | Keep both sides' keys, run the backfill again |
| `IntentPreview` | AI-2 makes it; AI-3, S-2 and AI-5 add row kinds | AI-2 first |
| `navItems.js`, `shellState.js`, `MySettings.vue`, `TodayOverdue.vue`, `SetupChecklist.vue`, `onboardingRules.js` | S-1, S-4, T-1 | S-1, then T-1, then S-4 |
| `docs/MCP-AGENT-GUIDE.md` | AI-4a, T-3, AI-2, AI-3, AI-6, S-2 | One section per slice; keep both sides |

**Size of the whole task:** about 34 pull requests. At the steady pace of task 046 that is four to five working days of agent time, plus the week the trial takes, plus the owner's steps.

## Risks

| Risk | What we do about it |
|---|---|
| A sentence is understood wrongly and something unwanted is created | A preview for anything wider than one task. Names are looked up, never guessed. Undo. The benchmark counts any unasked change as a fail |
| We do not control the person's AI app or its model | The server is the guard: every tool checks the person's rights, rates the change and can hold it. The instructions teach; they are never the only protection. The benchmark names the app and model it was run with |
| The agent only works while the person's AI app is open | Said plainly in the product. The findings and the queue come from rules on the server, so they are there every morning with no app open. A server key remains the path for round-the-clock agents |
| Tools that are off by default leave a fresh install with an agent that can do little | An open decision for the owner, with an access review first. Until then "Connect your AI" says honestly what an admin must switch on |
| Text from outside (an email, a form, a chat message) steers the agent | The existing outside-content marker sends risky writes to approval. A connected app is itself treated as outside. The existing injection tests are extended |
| The queue fills up and people approve without reading | A daily cap per project. Rows of one kind approved together only with the full list shown. "Always do this" only for small, undoable changes |
| "Always do this" grows into auto-approval | One agent, one kind of change, one project. Listed and removable. Never above the project's policy |
| The replay test gives false comfort | It is named a replay, not a measure. Only the measured run moves the scorecard |
| Simple mode hides something a person needs | Everything stays in the palette and in More. Existing accounts stay on Full |
| Many slices change the same agent files | The order above; one holder of `registry.js` at a time |
| More is merged than is used | The 15-build rule. Each slice is exercised on the local build, with a real connected Claude where it is an MCP slice, before it is called done |

## Open decisions for the owner

Each is a yes or no. The recommendation is what the coordinator will take if the owner says nothing, **except 1, 2, 3 and 4**, which wait for the owner because they change a security default, need the owner's own accounts, or spend money.

| # | Question | Recommendation |
|---|---|---|
| 1 | **Open, not planned as done.** Should `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` be on by default on a new install? | **Yes, but only after an access review of every tool behind them.** It changes a security default. Every write would still need the grant the person ticks on the consent screen, and every tool would still be held to that person's access. Note: `MCP_OAUTH` is off by default too, and "Connect your AI" in one click needs it; the same review should cover it. Until the owner confirms, an admin switches them on |
| 2 | Will the owner switch the three flags and `MCP_OAUTH` on in the local build and connect their Claude with the manage grant? | **Yes**, on the local build only. AI-1, AI-4a and AI-4e cannot run without it |
| 3 | May the one-week trial run on AlianHub's own project (AP), with the owner's Claude opened or scheduled each day? | **Yes**, with the project set to "propose everything", so nothing changes without approval |
| 4 | Should AlianHub's own AI also be measured in AI-1, with the server key, at a cap of $10? | **No, not now.** The MCP road is measured first and costs no API money. Ask again when the optional server-key path is built |
| 5 | May an agent mark a task Done without a person's approval? | **No, by default.** A project setting with three values, starting at "with approval". An owner or admin may set one project to "yes"; the close is then marked unchecked. The company's "a person must check" switch always wins |
| 6 | Over MCP, may a change to a single task be applied at once and shown with Undo, without waiting for approval in AlianHub? | **Yes**, as it works today, when the connection holds the grant. Anything wider than one task waits. A project may choose "propose everything" |
| 7 | Should a new token last 30 days by default, with a notice three days before it ends and a Renew button? | **Yes.** The maximum stays 365 days. An OAuth connection stays at 90 |
| 8 | May "Always do this" exist at all? | **Yes**, within the limits in AI-5, and each rule ends after 90 days unless renewed |
| 9 | May a typed rejection reason be kept as a note the agent reads, visible to the project's members? | **Yes**, per project, editable and removable in the memory list |
| 10 | May a person hand work to another person's connected AI? | **No.** An agent acts only for the person who connected it |
| 11 | Should connected agents appear in the member list, with no seat and no role? | **Yes**, under the person who connected them, clearly marked |
| 12 | May "Connect your AI" be skipped at sign-up? | **Yes.** The product must still work by hand |
| 13 | Should new accounts start in Simple mode, and existing accounts stay on Full? | **Yes** |
| 14 | May an agent create an automation or a field without a preview, at any level? | **No.** Both reach the whole project, so they are always previewed |
| 15 | Are the 15 delegations in AI-1 the right 15? | **Yes**, with jobs 5, 15 and 22 as reserves |
| 16 | Should the manager's in-product version (with a server key) start at "Suggest", where everything is proposed? | **Yes**, when it is built |

## What is deliberately left out

From the advisor's first note, section 7, deferred until the AI-run line is met:
- More field types: location, button and signature. Relationship and voting fields are already merged; nothing more is built on them in this wave.
- The whiteboard on the server is already merged; nothing more is built on it in this wave.
- Building the 12 missing dashboard cards by hand. "Describe a card" is built once instead, after AI-3.
- Polish of legacy screens (track B3 of task 046) beyond dark mode.

Left out by decision 30:
- A hosted model allowance from Alian.
- Asking for a model key as a required step of the install. It is an optional step.
- Round-the-clock unattended agents without a server key.

Also not in this task:
- A general block database in the style of Notion.
- A living brief per project, and docs and tasks as one thing. Planned after AI-5.
- One intake pipeline and one review screen. The connectors in task 046 come first.
- A meeting notetaker bot, a desktop hotkey app, native phone apps (out of scope in task 046 too).
- Comparing AI apps or models, and the larger eval set of task 019.
- Removing the first-run tour. #1354 refreshed it and it stays until the conversation is proven to replace it.

Kept at full pace in task 046, and not slowed by this task: speed at 10,000 tasks, the dense look and its tokens, proving hierarchy by use, the ClickUp importer, access fixes.

## Acceptance for the whole task

- [ ] Finish line eight holds: 15 of 25 by one sentence and one approval; a week on approvals only; every job measured.
- [ ] Finish line nine holds: the first-hour test and the ten-job test pass.
- [ ] Finish line ten holds: the first-hour test passes with no help and no tour.
- [ ] The scorecard has an AI row with numbers and a newcomer row with numbers.
- [ ] An install with no server key has a working agent after "Connect your AI", and no AI surface that looks broken.
- [ ] The six rules that do not bend are each covered by a test that fails when the rule is broken.
- [ ] Every slice was exercised on the local build, not only in CI.

## Resources

- `Tasks/active/046-better-than-clickup/benchmark-25-jobs.md`: the 25 jobs, the counting rules and both runs (run 2 is in PR #1358).
- `Tasks/active/046-better-than-clickup/scorecard.md`: the row this task fills.
- `Tasks/active/046-better-than-clickup/dogfood-findings.md`: what an agent could not do when this work was tracked through MCP.
- `Tasks/active/046-better-than-clickup/design-connectors.md`: the connector rules (propose-only outside writes, no web fetch after a connector read).
- `docs/MCP-AGENT-GUIDE.md`: every tool a connected agent has.
- The advisor review of 2026-10-01 (three notes, the owner's decision and the revised order) and the coordinator's reply: a working note in the main checkout, not committed. Its points are carried into this file.
