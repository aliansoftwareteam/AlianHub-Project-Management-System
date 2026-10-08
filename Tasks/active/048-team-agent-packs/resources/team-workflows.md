# How the role agents work together

The role agents of task 048 do not work alone. Work passes between them the way it passes between people: one role finishes its part, hands the work to the next role, and a person approves at the points that matter. This file describes how, on top of what AlianHub already has.

## What already exists to build on

- **The workflow engine** (`Modules/Workflows/`, switched by `WORKFLOW_ENGINE`): steps of kind `agentRun` (an in-product agent), `externalAgent` (a connected outside AI, with `EXTERNAL_AGENT_SESSIONS`), `approval` (a person decides), `condition`, `fanOut` (several roles at once), `loop`, `wait`, `toolCall`. Runs show in AI > Pipeline.
- **The agent work queue** (`Modules/Agents/manager/workQueue.js`, AI-6): work waiting for an agent, claimed one item at a time, released when done (`queue.list`, `queue.claim`, `queue.release` over MCP).
- **Approvals** in the Inbox ("Needs your approval"), part by part for plans; **history and audit** naming each agent ("Claude, for Priya").
- **Several agents at once** in a project (T-5) with a limit per project, and **Pause all agents**.

## The model: a handoff is a visible change in AlianHub

1. **Every piece of work is a task.** A role never passes work in a hidden message: it updates the task (status, a role label, a comment with what it did and what the next role needs) and links what it made (a doc, subtasks).
2. **Each role has a queue.** A handoff puts the task in the next role's queue with a short note: what is done, what is expected, the due date.
3. **Gates are people.** At set points a step is an `approval`: the work waits in a person's Inbox (the team lead, the owner of the task) and goes on only when they approve, or goes back with their comment.
4. **One chain, one record.** The task's history shows the whole chain: which role did what, when, and who approved. Any step can be undone where the change itself can be.
5. **Each role keeps its own limits.** A role uses only its own tools (from its playbook), under the same agent rules as today: the project's policy, pauses, the per-project limit, the never-list.

## How it runs

- **With the person's own connected AI only (no server key).** A connected AI works only while its person has the conversation open; nothing runs by itself. So each person works a role's queue on purpose: "Work the Content Writer queue", "What is waiting for the Design Lead?". The handoffs, queues and gates are the same; the steps run when someone asks. Good for small teams and for trying a workflow.
- **With a server key.** The workflow engine runs each role's step as an in-product agent as soon as the work reaches it, stopping at every approval gate. Good for a team that wants work to move while nobody is watching.
- **Mixed.** A step can be `externalAgent`: a named person's connected AI takes it, through the queue, under that person's rights.

## Ready-made team workflows (proposed)

### Marketing: campaign launch
Campaign Manager plans the campaign (tasks, dates, owners) → **gate: marketing lead approves the plan** → Content Writer drafts each piece, SEO Specialist checks each draft (in parallel per piece) → **gate: Brand Guardian (Design) checks the pieces, then the marketing lead approves** → Social Media Manager prepares the post set and calendar → after the launch date, Marketing Analyst writes the results report.

### Design: from request to handoff
Design Lead turns a request into a design brief → **gate: requester approves the brief** → UI/UX Designer writes flows, states and specs → Brand Guardian checks against the brand guide → **gate: design lead approves** → Design Ops prepares the handoff checklist and asset list → hands over to Engineering (next workflow).

### Engineering: feature from design to release
Tech Lead plans the work into the sprint (tasks, estimates, order) → **gate: engineering lead approves the plan** → QA Engineer writes the test plan and test cases as subtasks → (people build) → Code Reviewer posts a review summary on each task when its pull request is linked → Design QA Reviewer (Design) checks the built work against the spec and files issues → **gate: engineering lead approves the release** → Release Manager writes the release notes and checklist.

### Support to Engineering: a customer bug
Support Agent triages the request (urgency, owner) and drafts a first reply for a person to send → if it is a bug: Bug Triager files it in Engineering with priority and steps → Tech Lead places it in a sprint → Release Manager notes the fix in the release → Support Lead drafts the reply that it is fixed, **gate: a person sends it** (agents never send messages outside AlianHub).

### Sales: new customer onboarding
Sales Development Rep's lead turns into a customer → Account Manager writes the account plan → Customer Success Manager builds the onboarding plan (tasks with dates) → **gate: account owner approves** → Support Lead is told what was promised, as a doc linked to the customer's project.

### Manufacturing: order to dispatch
Order Intake records the order and what is unclear → **gate: sales confirms the order** → Production Planner places it in the schedule (Schedule Change Watch flags any later change) → Purchase Request Preparer lists what to buy, **gate: a buyer approves**, Supplier Follow-up chases the dates → (people make it; Shift Handover Writer and Downtime Logger keep the record) → Inspection Checklist checks the batch → on a pass: Dispatch Checklist, then Delivery Tracker; Customer Update Writer drafts the customer note, **gate: a person sends it**.

### Manufacturing: a quality problem
Inspection Checklist finds a failure → Non-conformance Recorder records it → **gate: the quality lead decides (rework, scrap, accept)** → Corrective Action Tracker runs the eight steps → Work Instruction Keeper updates the instruction, Change Request Writer files any design change, **gate: engineering approves the change**.

### Manufacturing: a breakdown
Breakdown Triage records the stop and its urgency → Maintenance Planner places the repair → Spare Parts Watch checks the parts, Purchase Request Preparer asks for what is missing → Production Planner moves the affected orders, Schedule Change Watch tells the order owners.

## The company view

- **Org chart of roles.** In AI, a view of teams and their roles, and for each role the person who supervises it (gets its approvals and its questions).
- **Flow board.** Work moving between roles: what is in each role's queue, what waits at a gate, what is stuck, across teams.
- **One rule for crossing teams.** A handoff into another team's project needs that team's role to be on and the person's rights there; otherwise it waits for a person of that team.

## What stays the same

- No agent sends anything outside AlianHub, deletes anything, or changes permissions or billing.
- An agent acts only within its person's rights (connected AI) or the workspace agent's set (in-product).
- Every gate is a person, and a loop of handoffs stops at the existing chain limit.
