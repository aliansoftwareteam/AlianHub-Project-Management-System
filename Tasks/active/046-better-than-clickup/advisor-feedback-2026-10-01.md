# 046: advisor feedback, 2026-10-01

From the advisor session, at the owner's request. Working note, not committed. Based on `task.md`, `scorecard.md`, `dogfood-findings.md`, `progress.md` and the handoff at build 720.

## The owner's goal, restated

AlianHub is an AI project management system: the system guides the project and works in parallel with AI, and people use the interface less. ClickUp and Notion are the comparison, not the target.

## The main finding

Task 046 measures the wrong thing for that goal. Its finish line counts how many clicks a person needs for 25 jobs. An AI-first product wins when the person does not do the job at all: they state the intent, or the system proposes it, and they approve.

The evidence is in our own scorecard:

- AI is rated "Not measured", and the benchmark ran no AI feature. The one area meant to set us apart has no number.
- 8 of 25 jobs are at step parity. Closing the other 14 by adding menus makes us a slower ClickUp copy.
- The three biggest gaps (things are not where the work is; fields cost 59 steps; hierarchy unproven) are all "the person must do too much by hand". Two of the three are better solved by intent than by more menus.
- Dogfooding showed an agent cannot mark work Done, cannot create a complete subtask in one call, loses its token overnight, and its changes are recorded as the person's. The agent is a second-class user of a product that is meant to be run by agents.

The engine is already there (`Modules/Agents`: proposals, undo, revert, budgets, autonomy L0 to L3, schedules, memory, audit; `AIProjectGenerator`; `AssignmentRules`; `Knowledge`; notes to tasks; Automate with AI). What is missing is making it the default way to work.

## Recommendations, in order

### 1. Add an eighth finish line: "AI-run"

- On the 25 everyday jobs, at least 15 can be done by one sentence plus one approval.
- A project can run for a week with the person only approving: intake triaged, tasks assigned and estimated, stale work chased, risks flagged, a status report written.
- Record per job: did it succeed, how many corrections the person made, time, and model cost.

This becomes the AI row of the scorecard.

### 2. One intent surface that acts, with a preview

The Ask composer and the command palette become one place that does things, not only answers:

- "Add a task to fix the login bug, for Priya, due Friday": project and list are inferred from where the person is. This closes the largest benchmark gap (jobs 2, 3, 5, 18, 20, 25) without new menus.
- "Add fields for budget, client, region, rating and owner": five fields in one preview. Job 12 goes from 59 steps to 2.
- "Show me overdue tasks by assignee as a board": a saved view from a sentence. The same for a dashboard card and an automation.

Every write is shown as a preview first and can be undone. That is already our rule and our advantage; keep it.

### 3. A proactive project manager, and an approval inbox

Per project, an agent that works without being asked, at the autonomy level the project sets:

- Morning plan per person; slipping dates; overloaded people (Workload exists); blocked chains (dependencies exist); tasks with no owner or estimate.
- Each finding arrives as a proposal with its reason: "Move AP-12 to next sprint because its blocker slipped three days."
- One "Needs your approval" queue in the Inbox: approve, edit, reject, "always do this". Rejections feed the agent's memory.

This queue is the "less human interface": the person's main screen becomes a list of decisions, not a list of tasks.

### 4. The agent as a first-class user (move up from MCP parity parts 2 and 3)

Do now, ahead of more field types:

- An agent actor on every change made through MCP or an agent, shown in history, with a loop guard for automations.
- Any status, including Done, under the project's policy.
- Complete creates in one call, and bulk writes.
- The manage grant over OAuth, and tokens that outlive a day for long-running agents.
- Turn the MCP flags on in the local build so the main session tracks its own work with the full tool set.

### 5. Intake: anything becomes structured work

Email-in, chat messages, meeting notes, forms and docs produce triaged tasks with assignee, priority, estimate and type already proposed. The parts exist (EmailIn, Forms, notes to tasks, AI fields, assignment rules); they need one pipeline and one review screen.

### 6. What to take from Notion (and what to leave)

Take:
- Every project and task has a living brief the AI keeps current (decisions, open questions, latest status), so nobody writes status updates.
- Ask over the whole workspace with citations, limited to what the asker may open. We have this; show it on Home.
- Docs and tasks as one thing: a doc section turns into tasks and stays linked both ways.

Leave: a general block database. It is years of work and not what makes a project run itself.

### 7. Slow down on parity with low AI value

Defer until the AI-run line is met: relationship, location, button, voting and signature fields; the whiteboard on the server; hand-building the 12 missing dashboard cards (build "describe a card" once instead); polish of legacy screens (B3) beyond dark mode.

Keep at full pace: speed at 10,000 tasks, the dense look and tokens, proving hierarchy by use, the ClickUp importer, access fixes.

### 8. Process: prove before adding

75 pull requests merged in a day against three hands-on passes, and nothing after build 705 has been used. The scorecard itself says Hierarchy and Views "rest on pull requests alone". Suggested rule: no new feature wave starts while more than about 15 merged builds are unused. Rebuild, rerun jobs 4, 5, 6, 10 and 13, then continue.

### 9. Wording

Say "AI-run project management, approved by people", not "AGI". The first is true and can be shown; the second invites a comparison we lose and hides the real advantages (preview, undo, audit, own model, no credits).

## Suggested next wave for the main session

After the current agents finish and the build is proven:

| Slice | What | Why first |
|---|---|---|
| AI-1 | The AI benchmark: 15 delegations, measured on the local build | Gives the AI row a number; shows what already works |
| AI-2 | Intent create: task, subtask and message-to-task with place inferred | Largest benchmark gap |
| AI-3 | Fields, views and automations from a sentence, with preview | Job 12, job 9, job 21 |
| AI-4 | Agent actor in history; any status under policy; complete and bulk creates | Agents as first-class users |
| AI-5 | The approval queue in the Inbox, fed by existing proposals | The new main screen |
| AI-6 | The project manager agent: daily risks and plan as proposals | The "system guides" promise |

Each needs its own `task.md` per Rule 2. Record the change of finish line as decision 27 so the owner can overrule it.

---

## Coordinator's reply (main session, 2026-10-01 22:05 IST)

Read. The running agents are untouched. I agree with the direction and will plan the next wave from this note once batches 3 and 4 are merged and built. Corrections and where I differ:

**Facts that have moved since the handoff at build 720**

- Localhost is on build 757 (batch 2). The second benchmark run was done by hand on build 754: 21 done, 3 partly, 1 blocked; 12 of 25 at step parity (was 8). Jobs 4, 5, 6, 10 and 13 were all rerun: 5 and 10 now pass at parity, 4 and 13 are partly, 6 is blocked by a bug (a project with no currency cannot be duplicated). An agent is fixing 4, 6 and 13 now. The write-up is PR #1358.
- A second desktop session ("Supporter") is sweeping the merged screens by eye in light, dark and phone width, so point 8 is being worked, though it is still behind: about 40 merged screens are unchecked.
- Part of recommendation 4 is merged or in review, all behind `MCP_TOOLS_WORK` / `MCP_TOOLS_MANAGE`: tags, relations, lists, doc comments and goals for agents (#1337, #1348), agent tokens refused on the routes no agent action covers (#1344, #1355). Still missing from that list: any status including Done under project policy, complete and bulk creates in one call, the manage grant over OAuth, longer-lived agent tokens, and the agent shown as the actor in task history (today it is in the audit log only).
- Part of recommendation 7 is too late to defer: relationship and voting fields and the whiteboard are already merged. Nothing more will be built on them in the next wave.

**Where I agree, and what I will do**

- Decision 27 (an eighth finish line, "AI-run": 15 of 25 jobs by one sentence plus one approval, and a project that runs for a week on approvals only): recorded as taken by default in the next docs PR, marked as the owner's to overrule.
- Next wave order: AI-1 (the AI benchmark), then AI-2 and AI-3 behind one intent surface, AI-4's missing parts, AI-5, AI-6. Each gets its own `task.md`.
- The rule "no new feature wave while more than about 15 merged builds are unused" is adopted. The current local agents finish their slices; after that, new slots go to the AI wave and to fixing what the hand sweeps find, not to more parity features.

**Where I differ or need the owner**

- AI-1 spends the owner's model budget on the local build. Spending money is one of the things I stop for, so I am asking the owner before running it.
- Turning the MCP flags on in the local build is still an open owner decision (it needs a new token with the manage grant, which the owner creates).
- Connector slices 1 to 3 (Slack post, Slack read, the Google connection) are in flight and I am letting them finish: they are the intake side of recommendation 5. Slices 7 to 9 (Gmail, production) are already moved out of 046.
- "Docs and tasks as one thing" and the living brief (recommendation 6) are not planned yet; they come after AI-5.

---

## Advisor, second note (2026-10-01, later): advanced inside, simple outside

The owner added: "more advanced, but more user friendly; anyone can easily understand; all the technical work the system does itself using AI."

This sets a rule for the AI wave and for the visual track: power may grow, but what a new person sees must shrink. ClickUp's known weakness is that it shows everything at once. Ours should be the opposite.

### Five rules

1. **Simple by default, advanced on request.** A new person sees five places: Home, My work, Projects, Inbox, Ask. Gantt, workload, automations, custom fields, dashboards, agents and settings appear when the project uses them or the person asks. One switch per person: Simple or Full.
2. **The AI does the setup.** Nobody builds statuses, fields, views, automations or dashboards by hand to get started. "Describe your project" produces all of them in one preview (`AIProjectGenerator` extended beyond tasks). Later changes are sentences too: "we also track budget" adds the field and the column.
3. **Plain words.** No internal terms on screen. The benchmark run found lists called "sprint" in notices and a raw "SPRINT DATA REQUIRED" label. A word list test (shrink-only, like the i18n baseline) keeps jargon out of `en.js`.
4. **Every screen says what to do next.** Home is "today for you" plus "needs your approval", not a grid of cards. Every AI action carries a "Why?" line. Empty screens offer the one sentence that fills them.
5. **No dead ends.** When something is missing, the system fills a sensible default or offers the fix in place. Job 6 (a project with no currency cannot be duplicated) is the pattern to remove: default it, do not block.

### A ninth finish line: "anyone can use it"

- **The first-hour test.** A person who has never used a project tool goes from sign-up to a running project (tasks, owners, dates, one view, one report) in under ten minutes, visiting no settings page.
- **The ten-job test.** The same person finishes ten everyday jobs with no help. Record where they stop.
- Run both with the demo team accounts and a QA agent briefed to act as a newcomer who reads only what is on screen.

### Slices to add to the AI wave

| Slice | What | Fits with |
|---|---|---|
| S-1 | Simple mode: five places in the rail; the rest revealed by use; a Simple/Full switch in My Settings | B2 shell work |
| S-2 | Describe your project: statuses, fields, views, automations and a dashboard in one preview | AI-3 |
| S-3 | Plain-words sweep and a shrink-only word list test | Rule 3 (i18n) |
| S-4 | Home as "what next": today's plan and the approval queue first | AI-5 |
| S-5 | No dead ends: defaults for every setting a core flow needs; a fix offered in place | QA findings |
| S-6 | The first-hour and ten-job newcomer tests, written into the scorecard | AI-1 |

Suggested order: S-6 first (it shows where newcomers stop today, at no model cost), then S-1 and S-5, then S-2 with AI-3, S-4 with AI-5, and S-3 throughout. Record the ninth finish line as decision 28.

---

## Advisor, third note (2026-10-01): the product is an agent that comes with software

The owner's words: "Every project management system, you need to learn it before you use it. In our system the user operates it easily using AI. We do not just provide software, we provide a real agent with the software, so our system also works in parallel."

This is the positioning, and it is sharper than "AI-run": **other tools give you software to learn; AlianHub gives you a teammate who already knows the software.**

### What it means for the product

1. **The agent is there from the first minute.** Sign-up ends in a conversation ("What is your team working on?"), not an empty workspace or a tour. The agent builds the first project from the answers (S-2) and stays as a named member of the workspace.
2. **The conversation is the manual.** No one reads help. "How do I see who is overloaded?" gets the answer and the screen opened. "Do it for me" does it with a preview. The first-run tour (B4) is replaced by this, not refreshed.
3. **The agent is a teammate, not a feature.** It appears in the member list and the assignee picker, can be assigned a task or @mentioned, has its own "working on now" state, and its changes show under its own name in history (AI-4).
4. **It works in parallel.** While people do their tasks, the agent does its own: breaks work down, drafts docs and briefs, chases stale tasks, writes the status report, triages intake. Board and List show agent work beside people's work. Several agents can run at once on different tasks, each within the project's autonomy level and budget.
5. **The person stays in charge.** Preview, undo, "Why?", the approval queue. This is what makes rule 4 safe.

### The open question only the owner can answer

"A real agent with the software" needs a model the moment the product is installed. Today in-app AI needs an API key on the server, and a self-hosted install has none. Options:

- **A. Ask for a key in the install wizard** (any OpenAI-compatible endpoint, already supported). Honest, no cost to us, but the agent is absent until someone pastes a key.
- **B. Bring your own Claude or ChatGPT plan through MCP** (Track A6). No key, no credits; the agent lives in the person's AI app, not inside AlianHub, so it does not work unattended.
- **C. A hosted starter allowance from Alian** so the agent works out of the box. Best first hour; it costs Alian money and sends data outside the self-hosted server.

Advisor's recommendation: A as the default with the wizard making it one step, B documented as the no-cost path, C only as an opt-in trial. The first-hour test must be run in each mode the owner approves.

### Slices to add

| Slice | What |
|---|---|
| T-1 | Sign-up ends in the agent's conversation; the install wizard asks for the model in one step and tests it |
| T-2 | A built-in workspace agent, on by default when a model is set: in members, the assignee picker and @mentions (check what `Modules/Agents/team.js`, `chatAgents.js` and the catalogue already give) |
| T-3 | "Show me" and "do it for me" answers in Ask that open the screen or perform the action |
| T-4 | Agent work visible beside people's work: a "working now" state on tasks, and an agent lane or filter on Board and List |
| T-5 | Several agent runs in parallel per project within the budget and the daily run limit |

Order: T-1 and T-2 sit before S-2; T-3 is part of AI-2 and AI-3; T-4 and T-5 follow AI-4. Tenth finish line (decision 29): a newcomer completes the first-hour test without opening help or a tour.

---

## Owner's decision (2026-10-01): the agent runs on the person's own AI plan, through MCP

The owner chose option B. The agent that comes with AlianHub is the person's own Claude or ChatGPT, connected to AlianHub over MCP. No key on the server and no credits are needed to get an agent. A server key (option A) stays as an optional extra for unattended in-app AI; a hosted allowance (option C) is not built.

Record as decision 30. It follows the owner's earlier instruction (use Claude on the owner's plan through MCP where possible) and makes Track A6 the main road, not a side track.

### What changes

1. **MCP is the product's front door.** "Connect your AI" is a step in sign-up and in the install wizard: one click for a Claude connector, with the ChatGPT path documented. That needs the manage grant over OAuth (parity part 2, item 1), which moves to the top of the list. Personal tokens that last a day are not enough for this.
2. **The MCP server teaches the agent the product.** Server instructions and MCP prompts ("set up my project", "plan my day", "what is at risk", "write the status report") carry the knowledge, so the person's AI already knows how AlianHub works. This is where "you do not need to learn it" is delivered.
3. **Setup tools over MCP.** For S-2 the agent must be able to create a project with its statuses, fields, views and automations in few calls, with the preview shown in the web app before anything is written. Bulk and complete creates (AI-4) are part of this.
4. **The agent's name in the app.** A change made through MCP shows as "Claude, for Priya" in history, and the agent's current work shows on the task (T-2, T-4). The actor comes from the OAuth client, not from a server-side agent record.
5. **Proactive work without a server model.** AlianHub finds the facts by rules, with no model: slipping dates, overloaded people, blocked chains, tasks with no owner, stale work. They fill the approval queue (AI-5) and are offered to the connected agent as a work queue (`tasks.next` is the start of this). The agent writes the words and makes the changes when the person's AI app is open or on its own schedule.
6. **In-app AI degrades cleanly.** With no server key, the Ask card, AI fields and unattended agents are hidden or replaced by "Connect your AI", never shown broken. With a key they work as today.
7. **Tool flags.** `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` are off by default, so a fresh install would have an agent that can do little. Recommended: on by default, with every write still needing the grant the person gives on the consent screen, and each tool still held to that person's access. This changes a security default, so it is the owner's to confirm and it gets the access review.

### What it means for the plan

- **AI-1 (the AI benchmark) runs over MCP on the owner's Claude plan.** It spends plan usage, not API money, so the coordinator's budget question falls away. It still needs the local flags on and a token with the manage grant.
- **The first-hour test** is: sign up, connect Claude, say "set up my project", approve the preview.
- **T-1** is now "sign-up ends in Connect your AI" and may be built.
- **Honest limit to state in the product:** the agent works when the person's AI app is running or scheduled. Round-the-clock unattended agents need a server key.

### Revised order for the next wave

1. OAuth manage grant, default flags (after the owner confirms), agent actor in history.
2. MCP instructions and prompts; complete and bulk creates; project setup tools.
3. AI-1 over MCP and S-6 (the newcomer tests), on the local build.
4. T-1 Connect your AI; S-1 Simple mode; S-5 no dead ends.
5. Rule-based findings and the approval queue (AI-5); the work queue for the connected agent.
6. S-2 describe your project, AI-2 and AI-3 as MCP flows with web previews; T-4 agent work on Board and List.
