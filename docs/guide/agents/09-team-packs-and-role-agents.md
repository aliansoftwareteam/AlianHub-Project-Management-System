# Team packs and role agents

A role playbook is a written job description for an AI. It says who the AI is in a team, what it looks after, what it needs before it starts, what it hands over, and what it never does. It is plain text. It gives no new power: your AI still acts as you, with your rights.

AlianHub ships 44 playbooks in two team packs. A person who runs your server can switch the features on or off. See "Who switches what on" at the end.

## The 44 roles

### IT company (22)

| Team | Roles |
|---|---|
| Engineering | Bug Triager, Code Reviewer, Documentation Writer, Release Manager, Tech Lead |
| Design | Brand Guardian, Design Lead, Design QA Reviewer, UI/UX Designer |
| Product | Feedback Collector, PRD Writer, Roadmap Keeper |
| Sales | Account Manager, Proposal Writer, Sales Development Rep |
| Support | Knowledge Base Writer, Support Agent, Support Lead |
| QA | QA Engineer |
| DevOps | Incident Scribe |
| Leadership | Risk Watch, Status Reporter |

### Manufacturing (22)

| Team | Roles |
|---|---|
| Production | Downtime Logger, Shift Handover Writer, Work Instruction Keeper |
| Production planning | Production Planner, Schedule Change Watch |
| Maintenance | Breakdown Triage, Maintenance Planner, Spare Parts Watch |
| Quality | Corrective Action Tracker, Inspection Checklist, Non-conformance Recorder |
| Sales and orders | Customer Update Writer, Order Intake, Quote Preparer |
| Purchasing | Purchase Request Preparer, Supplier Follow-up, Supplier Scorecard |
| Warehouse and logistics | Delivery Tracker, Dispatch Checklist |
| Health, safety, environment | Safety Incident Reporter, Training Due Watch |
| Engineering | Change Request Writer |

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

If no rule matches, the dispatcher can ask a model to guess, but only if all of these are true: the project's model guess is on, a model is set up on the server, and the guess is at least as sure as the project's confidence level (50 to 100, default 80). It sees only the task's title, type, tags and description, and the names of the roles that are on. On a server where nothing is plugged in, no guess is made.

### Needs routing

If no rule matches and there is no sure guess, the task waits in the project's **Needs routing** list. Nobody is chosen for it. A lead opens the task and picks a role.

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
