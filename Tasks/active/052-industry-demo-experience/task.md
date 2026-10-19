---
id: 052
title: Industry demo experience — one demo company per industry, built from shared scenario data
status: active
priority: high
depends_on: []
created: 2026-10-17
---

# 052 — Industry demo experience

This file is the PRD (Rule 2). The owner's brief (2026-10-17) asked for a decision between two structures and for the work to go ahead without waiting, so the decision is recorded here and building starts at once.

## Goal

A prospective customer signs into the demo, picks the industry closest to their business and sees AlianHub running that business: the work in a pipeline that fits the trade, who owns each step (people and role agents), the automations that fire and why, the approvals waiting for a person, the exceptions and how they are resolved, and what is done, outstanding and achieved. Every agent action that did not really run is labelled as simulated.

## What exists (read from the code on 2026-10-17)

- **Every company is its own MongoDB database** (`utils/mongo-handler/mongoConnector.js`); users and companies live in `global`. One user can belong to several companies (`users.AssignCompany`). Login shows a workspace picker when a person has more than one and nothing is remembered (`Login.vue`); the rail's profile menu switches workspace with a full reload (`GlobalRail.vue` → `App.vue changeCompany`).
- **The agent layer is company-scoped**: 8 industry blueprints and 145 role playbooks (`Modules/Agents/companyBlueprints.json`, `Modules/Agents/roles/`), team-pack agents (`dispatcher/packAgents.js`), the Company view and dispatcher (behind `DISPATCHER`), the workflow engine (behind `WORKFLOW_ENGINE`), automations (on by default, no AI), agent runs and proposals (`AGENT_RUNS`, `AGENT_PROPOSALS`). Approving a pending proposal applies its changes for real with no model call.
- **A company can be created from a script** with `createFirstCompany` (`Modules/Setup/createCompany.js`), as `scripts/seed-scale.js` does, and dropped as a whole (`scripts/scale/lib/drop.js`).
- **The public demo** (demo.alianhub.com, `DEMO_MODE`) has one workspace with placeholder tasks ("Task 25", "222222222222"). `scripts/demo` seeds a QA team into one existing company and only against a local database.
- **Nothing marks a record as illustrative**: runs, proposals and comments have no such field, and schemas are strict.

## Decision: one company per industry, process projects inside it, one shared engine

| | A — a company per industry | B — one company, a project per industry |
|---|---|---|
| Fit with the data model | Each industry is its own database; blueprint, roles, org chart, dispatcher, automations, Home and Inbox are per company, as the product intends | Blueprint, org chart, Home "My work", Inbox and AI would mix invoices with incidents and shipments |
| Realism | Its own name, people, roles, agents, settings — a customer-like workspace | Reads as a sandbox with folders of examples |
| Switching | Login picker on first visit; profile menu after that (a full reload, about two seconds) | No reload, but every list mixes industries |
| Separation | Complete (separate databases) | Project visibility only; owners and admins see everything |
| Reset | Drop one company's database and seed it again; others untouched | Unpick one industry's rows from shared collections |
| Growth | A new industry is one data file and one more company | One company grows with every industry |
| Reuse | Shared engine and role playbooks; data per industry | Same |
| Effort | The company-creation and drop code already exist | Slightly less at first, harder to keep clean |

**Chosen: A, with B's idea used inside each company.** Each industry is a demo company; inside it, each business process is a project with its own pipeline. One demo account belongs to every demo company, so the login picker doubles as the industry picker. Everything is generated from one engine and one scenario file per industry.

## Scope

1. **Engine and command** (`scripts/demo/industries/`): `npm run demo:industries` creates the missing demo companies; `--only <keys>`, `--reset` (drop and seed again), `--drop`, `--owner <email>`, `--list`. Every company carries a `demoShowcase` marker; the command never writes to or drops a company without it, and never deletes a user who belongs to any other company. Allowed against a local database, or on an instance that declares itself a public demo (`DEMO_MODE=true`). All writes go through the app's own code paths (company creation, members, projects, tasks, comments, automations, agents, pages, goals, dashboards).
2. **Four industries first**, chosen for what the product does best and what the blueprints cover:
   - **TechNova Solutions — IT and software**: support desk to engineering, incidents and changes, sprint delivery (IT-company roles).
   - **FinEdge Finance — finance and accounting**: accounts payable with three-way matching and exceptions, month-end close, client billing from timesheets (professional-services and e-commerce roles).
   - **SwiftLogix — logistics and supply chain**: shipment exceptions, warehouse and inventory, carrier and supplier follow-up (manufacturing and e-commerce roles).
   - **PeopleFirst HR — people operations**: hiring, onboarding, compliance and training (roles from several blueprints).
   Each has 3 process projects with their own statuses, task types and fields; 5 to 7 named people; role agents made from the real playbooks; 2 to 3 automations; work in every state including exceptions; pending approvals; goals; a dashboard; a "Start here" guide.
3. **What runs for real, shown as such**: automations (the seed fires them through real status changes, so their run history is genuine; a visitor moving a card fires them again); approving or declining a pending proposal applies or drops its changes; dashboards, goals with task targets and project health read the seeded data; role agents carry their real playbook skill and run when switched on with a model.
4. **What is simulated, labelled as such**: past agent runs, their comments and pending proposals were written by the seed. They carry `simulated: true`; the task comment, the Inbox and AI proposal cards and the run page show a "Simulated" chip with the hint "Written for this demo to show how the agent works. No AI model ran." Their spend is zero.
5. **Navigation**: the login workspace picker and the profile-menu switcher show each demo company's industry under its name; on a `DEMO_MODE` instance the demo banner offers "Switch industry" and "Guide" (the company's Start-here page).
6. **Docs**: `docs/DEMO-INDUSTRIES.md` — how to seed, reset and present; what is real, simulated and illustrative; how to add an industry.

## Out of scope

- Workflow-engine runs and installing workflow templates (instance flags off by default); the dispatcher's routing rules and queue rows. Both are listed as next steps.
- A scheduled reset inside the server (a cron line running the command is documented instead).
- Translating the seeded business content (it is data, not UI copy).
- Changing what agents may do, approval rules or billing.
- Removing the existing placeholder workspace on demo.alianhub.com (an operator decision).

## Acceptance criteria

- [x] `npm run demo:industries` on an empty local database (after the setup wizard) creates the four companies; a second run creates nothing; `--reset --only finedge` rebuilds FinEdge alone; `--drop` removes all four, their people, storage and company rows, and nothing else.
- [x] The command refuses a remote database unless `DEMO_MODE=true`, refuses to touch a company without the marker, and keeps an owner who belongs to other companies.
- [x] Signing in as the demo account shows the workspace picker with the four companies and their industry; switching from the profile menu works.
- [x] In each company: projects show the process pipeline with work in every column, custom fields filled, exceptions marked; Home shows the owner's work and approvals; the Start-here page explains the scenario, the cast, the try-this steps and what is real or simulated.
- [x] Moving the documented card to its exception status fires the automation (comment, priority, assignee) and adds a run to the rule's history.
- [x] Approving a seeded proposal changes the task and the proposal leaves the pending list; declining drops it.
- [x] Every seeded agent run, agent comment and proposal shows "Simulated"; no simulated record reports spend.
- [x] Dashboards and goals agree with the task data.
- [x] Unit tests: every scenario is coherent (one default and one closing status per project, every task's status, type, people, fields and tags exist, every role exists in the playbooks, every automation names a real status); the guard refuses what it must. `npm test`, `cd frontend && npm test`, `npm run i18n:check`, `npm run style:check` pass.

## Constraints

- Rule 3: the chip, the banner links and the industry labels go through `en.js` (`Demo` namespace) and `npm run i18n:backfill`.
- Rule 5: no colour literals in `.vue`/`.css`; the chip reuses `ah-chip` classes and tokens.
- Rule 4: one `feat` PR into `staging`; no route is added.
- Seeded people use `@<company>.demo.test` addresses with random passwords that are never printed; the demo account's password comes from `DEMO_PASSWORD` or is written to the git-ignored `.demo-industries.local.json`.
