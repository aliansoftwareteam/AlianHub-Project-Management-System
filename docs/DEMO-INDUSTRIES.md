# Industry demos

`npm run demo:industries` builds one demo company per industry, each running its business in AlianHub: process projects with their own pipelines and fields, named people, role agents made from the real role playbooks, automations that fire, approvals waiting, exceptions, goals, a dashboard and a **Start here** page. One demo account belongs to every demo company, so the workspace picker at sign-in is the industry picker.

| Company | Industry | Projects |
| --- | --- | --- |
| TechNova Solutions | IT and software | Customer Support · Platform Engineering · IT Operations |
| FinEdge Finance | Finance and accounting | Accounts Payable · Month-End Close · Client Billing |
| SwiftLogix | Logistics and supply chain | Shipments and Exceptions · Warehouse Operations · Suppliers and Purchasing |
| PeopleFirst HR | People operations | Hiring Pipeline · Onboarding · Compliance and Training |

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

## On the public demo instance

1. Set `DEMO_MODE="true"`, `DEMO_EMAIL` and `DEMO_PASSWORD` (already the case on demo.alianhub.com).
2. Run `npm run demo:industries` on the server. With `DEMO_MODE="true"` it accepts the instance's database; anywhere else it only runs against `localhost`.
3. A first-time visitor clicks **Try the demo**, picks an industry in the workspace picker, and lands on Home. The banner then shows the industry, a **Guide** link to the company's Start-here page and **Switch industry** (the profile menu, where each company shows its industry).
4. Reset on a schedule, for example nightly: `0 3 * * * cd /app && npm run demo:industries -- --reset`.

The instance's own placeholder workspace stays as it is; remove it from Settings if visitors should only see the industries.

To preview a branch locally against the demo instance's database, run the local server with `MIGRATIONS_AUTO=false`, `CRON_ENABLED=false`, `AUTOMATION_QUEUE_DRIVER=inline` and `KNOWLEDGE_INDEXER=off`, so it neither migrates the shared database nor takes the live server's queued jobs, reminders or indexing.

Optional flags make more of the product visible in the demo: `DISPATCHER=on` adds the Company view (org chart of the role agents) and `WORKFLOW_ENGINE=on` the workflow builder. Neither is needed.

## What is real, simulated and illustrative

| | In the demo |
| --- | --- |
| **Real** | Projects, pipelines, task types, fields, tags, dependencies, checklists, history. Automations: the seed fires them through real status changes, so their run history is genuine, and a visitor moving a card fires them again. Approving a proposal applies its changes (priority, comment, assignee, subtask, due date), with Undo for 15 minutes; declining drops it. Goals with task targets, the dashboard and project health are counted from the tasks. Each company's digest agent (`digest.ceo`) really runs without an AI model: **AI → Agents → Run now** on its digest task posts the counts from the board. |
| **Simulated** | Earlier role-agent runs, the comments they left and the proposals waiting for approval were written by the seed. They carry `simulated: true` and show a **Simulated** chip on the comment, the Inbox and AI proposal cards and the run page. Their spend is zero. |
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

## Adding an industry

1. Write `scripts/demo/industries/scenarios/<key>.js` on the shape of an existing one: company, owner title, people, projects (statuses, types, fields, tags, tasks), agents (a role from `Modules/Agents/roles/` or the `digest.ceo` skill), automations, the story (comments, moves, simulated runs, proposals), goals, a dashboard and the guide.
2. Add it to `scenarios/index.js`, and a `Demo.industry_<industry>` label to `frontend/src/locales/en.js` (then `npm run i18n:backfill`).
3. `npx jest tests/demo-industries.test.js` checks it is coherent: one opening and one closing status per project, every status, type, person, field, tag, dependency, role and automation status named exists, open past-due work is marked as intended, no two proposals by one agent wait on one task, no calendar month in the text.

## Safety

- Without `DEMO_MODE="true"` the command refuses any database but `localhost` or `127.0.0.1`, and it refuses `NODE_ENV=production`. There is no `--force`.
- It writes only to companies marked `demoShowcase.by = "demo-industries"`, and removes a company only when it carries that mark.
- Removing a company deletes its database, storage and row, and the people it made who belong to no other company. Everyone else (including the demo account) only loses that company from their list.
- An existing account that already uses a demo address is never changed; the build stops instead.
