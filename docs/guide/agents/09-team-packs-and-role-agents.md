# Team packs and role agents

A role playbook is a written job description for an AI. It says who the AI is in a team, what it looks after, what it needs before it starts, what it hands over, and what it never does. It is plain text. It gives no new power: your AI still acts as you, with your rights.

AlianHub ships playbooks for several company blueprints, for example an IT company and a manufacturer. Each playbook names its team, such as engineering or quality. The full, current set lives in [Modules/Agents/roles](../../../Modules/Agents/roles), one folder per blueprint. A person who runs your server can switch the features on or off. See "Who switches what on" at the end.

## Roles, grouped by team

A team groups the roles that work together. The tables below show, for example, how two blueprints are grouped. The set grows, so read the folder above for the roles your server has.

### For example, an IT company

| Team | Roles |
|---|---|
| Engineering | Bug Triager, Code Reviewer, Documentation Writer, Incident Scribe, QA Engineer, Release Manager, Tech Lead |
| Design | Brand Guardian, Design Lead, Design QA Reviewer, UI/UX Designer |
| Product | Feedback Collector, PRD Writer, Risk Watch, Roadmap Keeper, Status Reporter |
| Sales | Account Manager, Proposal Writer, Sales Development Rep |
| Support | Knowledge Base Writer, Support Agent, Support Lead |

### For example, a manufacturer

| Team | Roles |
|---|---|
| Production | Downtime Logger, Shift Handover Writer, Work Instruction Keeper |
| Planning | Production Planner, Schedule Change Watch |
| Maintenance | Breakdown Triage, Maintenance Planner, Spare Parts Watch |
| Quality | Corrective Action Tracker, Inspection Checklist, Non-conformance Recorder |
| Sales and orders | Customer Update Writer, Order Intake, Quote Preparer |
| Purchasing | Purchase Request Preparer, Supplier Follow-up, Supplier Scorecard |
| Logistics | Delivery Tracker, Dispatch Checklist |
| Health and safety | Safety Incident Reporter, Training Due Watch |
| Engineering | Change Request Writer |

A team is not the same as a department. Several departments can share one team: in the IT company, the QA and DevOps roles sit in Engineering, and the Leadership roles sit in Product.

## Team packs

Team packs, and the grouping by team above, arrive with pull request #1585. Until it is merged, the app does not group roles by team.

### Turn on a team pack with one click

Open **AI**, then **Team packs**. Pick a company blueprint, tick one or more teams, tick the projects to turn them on in (up to 50 at a time), then choose **Turn on**.

- The pack turns the team's roles on in each project's dispatcher, and nothing else. Each project keeps its dispatcher mode. A project whose dispatcher is off routes nothing until someone switches it on in the project's settings.
- You can pick a project only if you are a workspace admin or may change that project's details. A project you cannot pick says why.
- Every project is checked first, so the pack is turned on in all the projects you picked or in none.
- Afterwards, **Undo** turns off the roles that pack turned on, and no other role.
- Turning a pack on, and undoing it, are written to the audit log.
- If the dispatcher is switched off on the server, the page says so and cannot turn a pack on.

### Browse roles by team in the catalogue

The agent catalogue has a **Team** filter. Choose a blueprint and a team, for example "IT company · Engineering", to see that team's roles. Each card shows the role, its department, a short summary and the tools it uses, and the search box narrows the list. **Turn on as a team pack** opens the Team packs page. Leave the filter on "Any team" to see the templates as before.

## What is in a playbook

Every playbook has the same parts:

- **Who it is** and **what it is responsible for**.
- **When to use it**: things you can say to it.
- **What it needs before it starts**. If something is missing it asks. It does not guess.
- **How it works**, step by step.
- **What it delivers** in AlianHub, and where.
- **A quality checklist** it runs before it hands over.
- **When it hands over to a person**, and **what it never does**.
- **Who it hands work to**: for example the Bug Triager hands to the Tech Lead.
- **Gates**: the person who must say yes. For the Bug Triager, the engineering lead confirms Urgent bugs. For the Quote Preparer, the sales owner approves price and lead time before anything goes to the customer.

Many roles prepare work and stop there. A person sends the customer message, places the order, signs off the inspection or releases the shipment.

## Use a role from your own AI

First connect your AI app. See [Connect your AI app](01-connect.md). A role can then reach your AI in two ways.

### As a ready-made ask

Your AI app lists one ask for each role, named `work_as_` and the role, for example `work_as_bug_triager`. In the app it is titled "Work as the Bug Triager". Choose it, and say what to work on in your own words. Leave that empty and the AI asks you.

- The AI follows the playbook. It asks for what is missing before it starts, and shows you what it will change before it changes it.
- A role shows up only if your connection may use every tool the playbook names. If you did not tick a permission the role needs, that role is not listed. This is not an error.
- If the tool "queue.list" is available to you, the AI is told to work from the role's queue. See "The queue" below.

### As a Claude skill

You can also download a role as a skill and install it in Claude. You get a zip file with one folder named `alianhub-` and the role, for example `alianhub-bug-triager`. Inside is a `SKILL.md` with the playbook.

- Only a signed-in person who is a member of the workspace can download one.
- The skill works through the AlianHub connector. Connect AlianHub to your AI first.
- The download address is `/api/v2/agents/roles/<team pack>/<role>/skill`, for example `it-company/bug-triager`. There is no button for it in the app yet.

A skill, like an ask, is fixed text. It gives the AI no tool and no right it did not already have.

## The dispatcher

The dispatcher decides which role should take a task. It does not do the task.

It works per project. An owner or admin, or anyone who may change the project's details, sets it up on the **Dispatcher** card in the project's details.

### Modes

- **Off**: nothing is routed. This is the default.
- **Suggest a role**: the dispatcher shows "Dispatcher suggests {role}" on the task. A lead accepts it, dismisses it or picks another role.
- **Send to the role's queue**: the task goes into the role's queue at once, with no one asked.

### What it looks at

A task is looked at when it is created, and again when its title, description, type, tags, priority, status, list or custom fields change. A finished task is left alone. So is a task already in a queue, and a task a person took out of the queue.

### Roles on

On the card, "Roles on in this project" lists the roles by team pack. Only roles you tick are used. A rule that points at a role you left off does nothing; the dispatcher goes on to the next rule.

### Routing rules

Rules are checked in order. The first one that matches wins. A rule names a role and at least one condition:

- Task type is
- Has tag
- Priority is
- Status is
- List is
- Field equals (a custom field and a value)

When a rule names several conditions, all must hold. When a condition lists several values, any one is enough. Up to 50 rules.

### AI guess

The settings have a model guess switch and a confidence level, but the guess does not run yet: no guesser ships with AlianHub. Turning the switch on changes nothing today.

### Needs routing

If no rule matches, the task waits in the project's **Needs routing** list. Nobody is chosen for it. A lead opens the task and picks a role.

### Who is a lead

For the dispatcher, a lead is anyone who may change the project's details, such as an owner or admin. Only a lead can accept, dismiss or change a suggestion, or save the dispatcher's settings. It must be a person: an AI cannot do these, even if it acts for a lead.

If a lead sends the same task type to the same role three times, the dispatcher offers to add that as a rule: "Always send it there?" The rule is added only if a lead chooses **Add rule**.

### The queue

A role's queue is the list of tasks routed to that role. An agent takes one item at a time, which holds it for a time (30 minutes), and then finishes it or gives it back. A project can limit how many agents work at once. See [Limits, and pausing agents](05-limits-and-pause.md).

Routing a task only puts it in the queue. It does not change who is assigned to the task. If an agent that plays the role is set up in AlianHub, the one with the fewest open items in the queue is named for the work.

Your own AI can work a queue: ask it to "Work the Bug Triager queue."

## What never happens on its own

- Nothing is routed if the dispatcher is off, the role is not on for the project, or agents are paused in the project or for connected agents in the workspace.
- In Suggest mode, nothing enters a queue until a lead accepts or picks a role.
- The dispatcher never adds a routing rule by itself. It only offers.
- A suggestion is never forced: a lead can dismiss it. The task stays where it was.
- A person who took a task out of the queue is not overruled. The dispatcher will not put it back.
- A playbook gives an AI no new tool or right. It still needs your approval for what the project says needs approval. See [Approve, decline or edit in the Inbox](03-approve-in-the-inbox.md).
- The playbooks themselves never send a message to a customer, close a bug, place an order, or release a shipment. Each names the person who does.
- Every routing, and every choice a lead makes, is written to the audit log. See [The audit log](07-audit-log.md).

## Who switches what on

The person who runs your server sets two switches. Both are off by default.

- **MCP_ROLE_PROMPTS**: when off, your AI lists no role asks, and the skill download is refused.
- **DISPATCHER**: when off, no task is routed, the Dispatcher card has no effect, and the dispatcher's save, accept, dismiss and route actions answer as if they did not exist.
