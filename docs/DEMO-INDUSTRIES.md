# Industry demos

`npm run demo:industries` builds one demo company per industry, each running its business in AlianHub: process projects with their own pipelines and fields, named people, role agents made from the real role playbooks, automations that fire, approvals waiting, exceptions, goals, a dashboard and a **Start here** page. One demo account belongs to every demo company, so the workspace picker at sign-in is the industry picker; each company's name starts with its industry (`<Industry> · <Brand>`). There is a company for each of the eight company blueprints the role agents come from (IT, manufacturing, agency, e-commerce, professional services, construction, schools, clinics), plus finance, logistics and HR.

| Company | Industry | Projects |
| --- | --- | --- |
| IT & Software · TechNova | IT and software | Customer Support · Platform Engineering · IT Operations |
| Finance & Accounting · FinEdge | Finance and accounting | Accounts Payable · Month-End Close · Client Billing |
| Logistics · SwiftLogix | Logistics and supply chain | Shipments and Exceptions · Warehouse Operations · Suppliers and Purchasing |
| HR & People · PeopleFirst | People operations | Hiring Pipeline · Onboarding · Compliance and Training |
| Manufacturing · Forgeline | Manufacturing | Customer Orders · Quality · Maintenance |
| Marketing Agency · Brightwave | Marketing agency | Client Campaigns · Content Studio · Accounts and Billing |
| E-commerce · Cartwheel | E-commerce | Orders and Customer Service · Catalogue and Promotions · Stock and Suppliers |
| Construction · Northgate | Construction | Site Works · RFIs and Variations · Quality, Safety and Handover |
| School · Maple Grove | Schools and education | Curriculum and Exams · Pastoral and Attendance · Admissions and Events |
| Healthcare Clinic · CareWell | Healthcare clinic | Front Desk and Appointments · Billing and Insurance · Compliance and Facilities |
| Professional Services · Hartley & Moss | Professional services | Client Intake · Engagements · Billing and Close-out |

## Why a company per industry

Every company is its own database, and the agent layer is company-scoped: the blueprint, role agents, Company view, dispatcher, automations, Home and Inbox. One company per industry keeps each demo a believable workspace with its own people and settings, never mixes invoices with incidents in "My work", and resets by dropping one database. Inside each company, each business process is a project. The comparison with one company holding a project per industry is in `Tasks/active/052-industry-demo-experience/task.md`.

## Commands

```bash
npm run demo:industries                           # build the demo companies that are missing
npm run demo:industries -- --only finedge,technova
npm run demo:industries -- --reset                # drop and build again (all, or --only)
npm run demo:industries -- --drop                 # remove them
npm run demo:industries -- --owner you@example.com
npm run demo:industries -- --list
```

- **The demo account** is `--owner`, else `DEMO_EMAIL`, else `demo.visitor@industries.demo.test`. An account that does not exist is made: with `DEMO_PASSWORD` when it is the `DEMO_EMAIL` account, otherwise with a random password written to `.demo-industries.local.json` (git-ignored, mode 0600).
- **People** in each company get `@<company>.demo.test` addresses and random passwords that are never printed.
- A company already built is left alone; one that stopped halfway (no guide yet) is rebuilt.
- Restart a running server afterwards so it reads the new members.

## How many fit in one database

Every company is a database of its own with about 44 collections. A shared-tier MongoDB Atlas cluster (M0, M2, M5) allows 500 collections across all its databases, so next to an ordinary workspace it holds eight demo companies at most; the build stops with "cannot create a new collection" past that. On such a cluster, choose the companies with `--only`. The demo database used on 2026-10-17 holds the eight blueprint companies: `--only technova,forgeline,brightwave,cartwheel,northgate,maplegrove,carewell,hartleymoss`. A dedicated cluster (M10 and above) or a self-hosted MongoDB takes all eleven.

## On the public demo instance

1. Set `DEMO_MODE="true"`, `DEMO_EMAIL` and `DEMO_PASSWORD` (already the case on demo.alianhub.com).
2. Run `npm run demo:industries` on the server. With `DEMO_MODE="true"` it accepts the instance's database; anywhere else it only runs against `localhost`.
3. A first-time visitor clicks **Try the demo**, picks an industry in the workspace picker, and lands on Home. The banner then shows the industry, a **Guide** link to the company's Start-here page and **Switch industry** (the profile menu, where each company shows its industry).
4. Reset on a schedule, for example nightly: `0 3 * * * cd /app && npm run demo:industries -- --reset`, with the same `--only` list the database was seeded with when it cannot hold all eleven (see above).

The instance's own placeholder workspace stays as it is; remove it from Settings if visitors should only see the industries.

To preview a branch locally against the demo instance's database, run the local server with `MIGRATIONS_AUTO=false`, `CRON_ENABLED=false`, `AUTOMATION_QUEUE_DRIVER=inline` and `KNOWLEDGE_INDEXER=off`, so it neither migrates the shared database nor takes the live server's queued jobs, reminders or indexing.

## The dispatcher and workflows

Two instance flags add the agentic layers. Neither is needed; the command reads them when it builds a company, and leaves out (from the data and the guide) whatever is off.

| Flag | What each company gets |
| --- | --- |
| `DISPATCHER=on` | Every process project's dispatcher in **suggest** mode, with its role agents' roles on and the scenario's routing rules (task type, status or tag → role agent). The seed routes every open task through the dispatcher itself (rules only, no model): a matching task gets a suggestion, any other waits under **Needs routing**. Then the project leads accept a few suggestions, which puts those tasks in the role's queue. **AI → Company view** shows the org chart (roles, agents, who supervises them) and the flow board (per role: suggestions waiting for a lead, tasks queued). |
| `WORKFLOW_ENGINE=on` as well | The ready-made team workflows that fit the industry (TechNova: support to engineering and design to release; Forgeline: the three manufacturing ones; Brightwave: campaign launch), installed switched off, and the scenario's own workflow, switched on and started by an admin on one task: hand-overs to roles, then a human approval the demo account owns. The engine runs it for real up to that approval, which waits in **AI → Inbox → Approvals** and under **Waiting on you** on Home. |

| Company | Its workflow | Waits at |
| --- | --- | --- |
| IT & Software · TechNova | Customer bug: support → bug triage → approval → Tech Lead, on SUP-2201 | Pull the fix into this sprint |
| Finance & Accounting · FinEdge | Invoice exception: Reconciliation Checker → approval → Reconciliation Checker, on INV-4523 | Approve how the exception is settled |
| Logistics · SwiftLogix | Shipment exception: triage → customer update draft → approval → delivery tracker, on SH-88231 | Send the customer update |
| HR & People · PeopleFirst | Offer to first day: Document Drafter → approval → Onboarding Coordinator, on Amara Nwosu | Approve the offer |
| Manufacturing · Forgeline | Quality: Inspection Checklist → Non-conformance Recorder → approval → Corrective Action Tracker, on NCR-121 | Decide: rework, scrap or accept |
| Marketing Agency · Brightwave | Content: Agency Content Writer → SEO Specialist → Agency Brand Guardian → approval → Client Approval Tracker, on CNT-412 | Send it to the client for sign-off |
| E-commerce · Cartwheel | Returns: Order Issue Triage → Returns Coordinator → approval → Customer Service Agent, on ORD-58213 | Approve the refund |
| Construction · Northgate | Variation: RFI Tracker → Change Order Recorder → approval → Material Order Preparer, on VO-014 | Approve the variation |
| School · Maple Grove | Attendance: Attendance Watch → Parent Update Writer → approval → Attendance Watch, on ATT-034 | Send the update to the family |
| Healthcare Clinic · CareWell | Billing: Billing Query Sorter → approval → Front Desk Request Sorter, on BQ-1182 | Approve the refund |
| Professional Services · Hartley & Moss | New client: Client Intake Preparer → Document Drafter → approval → Engagement Planner → Client Status Reporter, on ENQ-094 | Approve the engagement letter |

Approving the gate is real: the run resumes and hands the task to the next role's queue, where the Company view shows it. Switching a flag on after the companies were built does not add the parts: run `--reset` (the company marker records which parts it has under `demoShowcase.layers`).

Restart a server after switching a flag; the dispatcher reads it on every call, but the workflow engine registers the hand-over step at start.

## What is real, simulated and illustrative

| | In the demo |
| --- | --- |
| **Real** | Projects, pipelines, task types, fields, tags, dependencies, checklists, history. Automations: the seed fires them through real status changes, so their run history is genuine, and a visitor moving a card fires them again. Approving a proposal applies its changes (priority, comment, assignee, subtask, due date), with Undo for 15 minutes; declining drops it. Goals with task targets, the dashboard and project health are counted from the tasks. Each company's digest agent (`digest.ceo`) really runs without an AI model: **AI → Agents → Run now** on its digest task posts the counts from the board. The dispatcher's settings, its suggestions (from the rules, no model) and the hand-overs the leads accepted; the workflow definitions, the engine's run, its hand-overs to each role's queue and the approval, and everything that follows a visitor's decision. |
| **Simulated** | Earlier role-agent runs, the comments they left and the proposals waiting for approval were written by the seed. They carry `simulated: true` and show a **Simulated** chip on the comment, the Inbox and AI proposal cards and the run page. Their spend is zero. In each workflow run, the roles finishing their steps before the approval: the seed makes the write a finished hand-over makes (`leftQueue.simulated` on the queue row) and marks the step and the run `simulated: true`; the run page, its steps, the approval in the AI Inbox and on Home show the chip. |
| **Real but switched off** | Each role agent's skill is its real playbook. It is paused, as every team-pack agent is, with a $2 spend cap. With an AI model connected, switching it on makes it run for real. |
| **Illustrative** | The companies, people, customers, suppliers and amounts are fictional. Seeded text uses no calendar month, so a reset never reads stale; due dates are relative to the day of seeding. |

## Presenting

Open the company's **Start here** page (Docs, or **Guide** in the banner). It lists the cast, the agents, the pipelines, the automations and six or seven "try this" steps, all generated from the same data as the company, so it cannot drift. The strongest moments, in each company:

1. A card in an exception column, with the automation's comment, priority and assignee on it.
2. Moving another card into that column and watching the automation answer within seconds.
3. **Inbox → Approvals**: approving an agent's proposal and seeing the task change.
4. A dependency chain that puts a deliverable at risk (Blocked by).
5. Running the digest agent on its task.
6. Goals and the dashboard moving as work moves.
7. With the flags on: **AI → Company view**, where each role's lane shows what waits for it; accepting a suggestion on a task moves it into the role's queue.
8. With the flags on: approving the workflow's gate in **AI → Inbox → Approvals**, and the run handing the task to the next role.

## Adding an industry

1. Write `scripts/demo/industries/scenarios/<key>.js` on the shape of an existing one: company, owner title, people, projects (statuses, types, fields, tags, tasks), agents (a role from `Modules/Agents/roles/` or the `digest.ceo` skill), automations, the story (comments, moves, simulated runs, proposals), `routing` (per project, `{ agent, types | statuses | tags }`, first match wins), `handOvers` (`{ task, by }`: a lead accepting the suggestion), `workflows` (`templates` from `Modules/Workflows/templates.js`, and `own`: steps `{ id, agent }` or `{ id, approval: { title, prompt, owner } }` with a `run: { task, by }`), goals, a dashboard and the guide.
2. Add it to `scenarios/index.js`, and a `Demo.industry_<industry>` label to `frontend/src/locales/en.js` (then `npm run i18n:backfill`).
3. `npx jest tests/demo-industries.test.js` checks it is coherent: one opening and one closing status per project, every status, type, person, field, tag, dependency, role and automation status named exists, open past-due work is marked as intended, no two proposals by one agent wait on one task, no calendar month in the text. For the agentic parts: a routing rule names a role agent working in that project and its own types, statuses and tags; a hand-over is of a task open once the story has played, matched by a rule, by the project's lead, and not the workflow's task; templates exist; a workflow starts with a hand-over, has an approval owned by a member, runs on an open task and is started by an admin.

## Safety

- Without `DEMO_MODE="true"` the command refuses any database but `localhost` or `127.0.0.1`, and it refuses `NODE_ENV=production`. There is no `--force`.
- It writes only to companies marked `demoShowcase.by = "demo-industries"`, and removes a company only when it carries that mark.
- Removing a company deletes its database, storage and row, and the people it made who belong to no other company. Everyone else (including the demo account) only loses that company from their list.
- An existing account that already uses a demo address is never changed; the build stops instead.
