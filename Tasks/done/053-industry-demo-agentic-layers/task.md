---
id: 053
title: Industry demos — the dispatcher, the Company view and workflow runs
status: done
priority: high
depends_on: [052]
created: 2026-10-17
---

# 053 — Industry demos: dispatcher, Company view and workflow runs

This file is the PRD (Rule 2). The brief came from the session that built task 052 and names the scope, the flags and what done means, so building starts at once; the decisions it left open are recorded here.

## Goal

Each industry demo company (task 052) also shows the two agentic layers 052 left out: work routed to role agents by the dispatcher, visible per role in **AI → Company view**, and a workflow that moved a task across roles and now waits at a human approval in the Inbox. What did not really run is labelled **Simulated**, as in 052.

## What exists (read from the code on 2026-10-17)

- **Dispatcher** (`Modules/AssignmentRules/dispatcher/`, behind `DISPATCHER`): per-project settings on the assignment-rules row (`mode` off/suggest/apply, `roles`, `rules` on task types, tags, priorities, statuses, fields). `gate.route` matches a task against the rules (no model unless `modelGuess`) and writes a `dispatch_decisions` row: `suggested`, or `needs_routing` when no rule matches. A lead accepting a suggestion (`decisions.accept`) puts the task in the role's queue with `queue.put`: a `project_findings` row, rule `handed_over`, `facts.role`. The Company view reads only projects whose mode is not off and that have roles: the org chart (roles, their agents, supervisors) and the flow board (per role: suggestions waiting for a lead, queued, held, stuck; plus "Needs routing").
- **Workflows** (`Modules/Workflows/`, behind `WORKFLOW_ENGINE`): saved definitions (disabled until a person enables them), runs and step runs, a `role_handoff` step that puts the task in a role's queue and waits until the row is finished (needs `DISPATCHER` too), a `human_approval` step that opens a `workflow_approvals` row the AI Inbox's Approvals tab and Home's "Waiting on you" list. `templates.js` holds eight ready-made team workflows; only two are IT, three manufacturing, one agency, one design, one sales. None is finance, logistics or HR.
- A run is moved forward by `queue.dispatch`, which ticks in process when no automation queue is running.
- The run page has no label for `role_handoff` steps (they read "Unknown step").

## Decisions

1. **Gated on the instance's flags, not forced.** The dispatcher part runs only when `DISPATCHER` is on in the seed's environment, the workflow part only when `WORKFLOW_ENGINE` and `DISPATCHER` are both on (what installing a template needs). Off, the seed skips the part, says so in its output, and the Start-here guide leaves it out, so a visitor never reads about a screen the instance does not have. Switching a flag on later and running `--reset` adds it.
2. **Routing is real.** Each process project's dispatcher is saved in **suggest** mode through the settings route, with the roles of the role agents working there and starter rules from the scenario (task type or tag → agent). The seed then routes every open task through `gate.route`: rules only, no model. Hand-overs are people's acts in the story (a lead accepts a suggestion through `decisions.accept`), so the queue rows are real too. Nothing in the dispatcher part is simulated.
3. **Workflow runs are real engine runs with simulated role work.** The fitting ready-made templates are installed through the install route (disabled). Each scenario also has one workflow of its own (no template fits finance, logistics or HR, and TechNova's chain needs a gate before the sprint), created and enabled through the workflow routes, and started on a task by a person through the start route. The engine hands the task to each role for real; the role finishing its part is what the seed simulates (the same write a release with `finished` makes, marked `simulated` on the queue row), then the engine moves on, until it opens the human approval and waits. The run and the simulated steps carry `simulated: true`. Approving the gate is real: the run resumes and hands the task to the next role's queue.
4. **Order:** dispatcher settings (the hand-over steps need their roles on) → workflows → routing every open task (a task in a workflow is skipped by the dispatcher) → people's hand-overs → guide.
5. **The automation engine** the story starts is returned to its not-started state when the story ends, so a workflow dispatched later ticks in process instead of on the stopped in-process queue.

## Scope

1. Scenario data, per industry: `routing` (per project: `{ agent, types | tags }`), `handOvers` (`{ task, by }`), `workflows` (`templates`: keys from `templates.js`; `own`: one definition with steps `{ id, agent }` and `{ id, approval: { title, prompt, owner } }`, and its `run: { task, by }`).
2. Validator: agents named by routing work in that project and have a role; types and tags exist; a hand-over's task is open once the story has played, matches a rule and is handed over by its project's lead or the demo account, and is not the workflow's task; templates exist; workflow steps are well formed (ids start with `s`, unique), name role agents, have an approval owned by a member, and start with a hand-over before the first approval; the run's task is open after the story and its starter is the demo account or an admin.
3. Build: the four parts above through an adapter, as 052 does; the report counts routed tasks, suggestions, hand-overs, workflows and runs.
4. Simulated marker: `workflowRuns.simulated`, `workflowStepRuns.simulated`; `leftQueue.simulated` on the queue rows the seed finished. The approvals list carries `simulated` from its run. The "Simulated" chip on the run page (head and steps), the approval row and detail in the AI Inbox, and Home's "Waiting on you" (052 already reads `source.simulated`).
5. Run page: `role_handoff` becomes a known step type ("Hand to a role"), and a finished hand-over says who finished it.
6. Guide: "Who routes the work" (rules per project, where to see it) and "Workflows" (installed templates, the run, the waiting approval), extra try-this steps, and the real/simulated section, each only when seeded.
7. Docs: `docs/DEMO-INDUSTRIES.md`.

## Out of scope

- Model guesses in routing (`modelGuess`), apply mode, "stuck" items (they would need back-dated tasks).
- Changing the dispatcher, the engine or the templates' behaviour.
- New templates for finance, logistics or HR in `templates.js` (each scenario's own workflow is data, not a product template).
- Turning the flags on for the live demo (an operator decision).

## Acceptance criteria

- [x] `validateScenario` checks the new parts; every scenario is coherent; `tests/demo-industries.test.js` covers the validator, the build order with the flags on, and that nothing of either part is written with them off.
- [x] Against a database with `DISPATCHER=on` and `WORKFLOW_ENGINE=on`: each company's AI → Company view shows its roles, agents and supervisor, and the flow board shows suggestions waiting and tasks queued per role; the AI Inbox's Approvals tab and Home show the workflow's approval with the Simulated chip; approving it moves the run on and puts the task in the next role's queue.
- [x] With both flags off the command still builds every company, and the guide has neither section.
- [x] `npm run i18n:check` and `npm run style:check` pass; the frontend specs for the changed views pass.
- [x] `docs/DEMO-INDUSTRIES.md` describes the parts, the flags and what is real or simulated.

## Constraints

- Rule 3: new UI strings in `en.js` under `Workflows`, then `npm run i18n:backfill`.
- Rule 5: no colour literals; the chip is 052's `SimulatedChip`.
- Rule 4: a `feat` PR into `staging` after task 052's; no route is added.
- The validation database is shared with the live demo: its connection string stays out of the repo, and a local server against it runs with `MIGRATIONS_AUTO=false`, `CRON_ENABLED=false`, `AUTOMATION_QUEUE_DRIVER=inline`, `KNOWLEDGE_INDEXER=off`.
