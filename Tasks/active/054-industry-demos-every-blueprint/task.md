---
id: 054
title: Industry demos for every blueprint, named by industry
status: active
priority: high
depends_on: [053]
created: 2026-10-17
---

# 054 — Industry demos for every blueprint, named by industry

This file is the PRD (Rule 2). The owner asked (2026-10-17) for a demo of every industry the README names, with company names that tell anyone which industry they are looking at, and answered the open questions the same day.

## Goal

A visitor signing into the demo picks from one company per industry. Each name says the industry first, so the workspace picker reads like an industry menu, and every company runs the same kind of story as the first four: process projects, people and role agents, real automations, simulated agent history, approvals, the dispatcher and a workflow waiting at an approval.

## Decisions (the owner's answers)

- **Industries: the README's eight company blueprints, and keep the current four.** The README names role agents for eight blueprints (`Modules/Agents/roles/`): IT company, manufacturing, agency, e-commerce, professional services, construction, education and clinic. TechNova covers IT; seven are new. FinEdge (finance), SwiftLogix (logistics) and PeopleFirst (HR) stay. That makes 11 companies.
- **Names: industry first**, as `<Industry> · <Brand>`.
- **Seed all eleven on the shared demo database** once built: reset the four (new names, new ids) and add the seven.
- **Later the same day:** the shared database is a shared-tier Atlas cluster capped at 500 collections, which holds eight demo companies next to the live workspace. The owner chose to keep the eight blueprint companies there (TechNova, Forgeline, Brightwave, Cartwheel, Northgate, Maple Grove, CareWell, Hartley & Moss) and remove FinEdge, SwiftLogix and PeopleFirst from it; all eleven stay in the code.

| Company | Industry key | Blueprint the role agents come from |
| --- | --- | --- |
| IT & Software · TechNova | it | it-company |
| Finance & Accounting · FinEdge | finance | ecommerce, professional-services |
| Logistics · SwiftLogix | logistics | ecommerce, manufacturing |
| HR & People · PeopleFirst | hr | several |
| Manufacturing · Forgeline | manufacturing | manufacturing |
| Marketing Agency · Brightwave | agency | agency |
| E-commerce · Cartwheel | ecommerce | ecommerce |
| Construction · Northgate | construction | construction |
| School · Maple Grove | education | education |
| Healthcare Clinic · CareWell | healthcare | clinic |
| Professional Services · Hartley & Moss | services | professional-services |

## Scope

1. Seven new scenario files in `scripts/demo/industries/scenarios/`, on the shape of the existing four: about six people, three process projects with their own statuses, types, fields, tags and 8 to 12 tasks in every state, role agents from the industry's blueprint plus a `digest.ceo` digest agent, two or three automations the story fires, a story (comments, moves into an automation's status, simulated runs, proposals), routing rules, a few hand-overs, a workflow of the company's own that waits at an approval (and the ready-made templates that fit: the agency's campaign launch, the three manufacturing ones), goals, a dashboard and a Start-here guide.
2. Rename the four existing companies and adjust their guide text to the new names.
3. An industry label for each new industry (`Demo.industry_<key>` in `en.js`, then `npm run i18n:backfill`).
4. Each new scenario passes the validator; the tests that hold for every scenario hold for all eleven.
5. `docs/DEMO-INDUSTRIES.md`: the company table and the workflow table for all eleven.
6. Seed all eleven on the shared database (both flags on, the four safety switches, the demo account) and check them in the browser.

## Out of scope

- New role playbooks or workflow templates (the scenarios use what exists).
- Patient, pupil or client data that could read as real: everything stays fictional and non-clinical.
- Changing the workspace picker, which still shows the industry label under each name.

## Acceptance criteria

- [x] Eleven scenarios, each coherent under `validateScenario`; `tests/demo-industries.test.js` passes for all of them.
- [x] Every company name starts with its industry; no two industries, domains or project codes collide.
- [x] On the shared database: the picker lists the eight blueprint companies (the cluster holds no more); each company's Home, boards, Company view and the workflow approval in AI → Inbox → Approvals work; no seeded text names a calendar month.
- [x] `npm run i18n:check` and `npm run style:check` pass; the docs list all eleven.

## Constraints

- Same as 052 and 053: Rule 3 for the labels, fictional `@<brand>.demo.test` people, the shared database's connection string never in the repo, a local server against it only with the four safety switches.
- Builds on task 053, which builds on task 052; neither is committed to `staging` yet, so this stays on the same branch and is not pushed until the owner decides on 052 and 053.
