---
id: 012
title: Run the rest of the redesign from inside AlianHub (dogfood)
status: queued
priority: high
depends_on: [009]
created: 2026-09-03
---

# Run the rest of the redesign from inside AlianHub (dogfood)

## Goal
Manage the remainder of the redesign in AlianHub itself, so the product is exercised in anger by the people building it. Two outputs: a real backlog of what is left, and a list of product gaps that only show up when you actually try to run a project here.

## Why it is queued, not started
The dev server cannot stay up while the app is being rebuilt underneath itself — nodemon restarts on every backend save, and nine agents were editing `Modules/` concurrently. Dogfooding needs a stable instance. Start this once task 009's agents have landed and `npm run build` + `npx jest` are green on a quiet tree.

## Scope
- Create a project "AlianHub Redesign" in the local workspace **through the product's own UI**, not the database — the friction in that flow is part of what we are measuring.
- Five sprints, one per handoff stage (turn 23a): Shell · First run · Daily work · AI system · Money & scale.
- Load the backlog from `coverage.md` (129 option ids, verified 2026-09-03): 9 not-started items as To do, 42 in-flight as In progress, 61 built as Done. Set each task's description to the mock's own one-line label and its key to the option id (`27a`, `28c`…) so a task traces back to a screen.
- Use it for real for at least a few days: List and Board for the remaining work, the task panel for detail, sprints for the stages, the timer for time, the AI Inbox if an agent proposes anything.
- Keep a running list of friction and gaps in `progress.md` as they are hit — that list is the actual deliverable.

## The 9 genuinely-not-started screens this backlog starts from
- `27a`–`27d` Personal Claude Code accounts — three modes, linking, attribution, edge cases. Backend exists (`Modules/Agents/accounts.js`, `agentAccount` on API tokens); the UI does not.
- `28a`, `28c` Pipeline and Release & deploy — task → staging → production with one hard stop where a human signs. The safety boundary is built and tested; the screens are not.
- `29b` Provenance badge — the Done column, list column and filter. The data model (`completion.workBy/checkedBy/closedBy`) is built.
- `25e` External data & coding agents.
- `24d` Mobile Planner — one day at a time, drag from the tray below.

## Out of scope
- `17a` whiteboard and `17b` mind map: cut by the handoff's own build order (turn 23a) as the least-used surfaces in every tool that has them. Do not add them to the backlog.
- The 15 research/plan/audit options (turns 1–4, 23, 24e, 25f) have no screen to build.

## Acceptance criteria
- [ ] The redesign project exists in AlianHub with five sprints and the backlog loaded, created through the UI.
- [ ] Every task carries its handoff option id, so a row traces back to a mock.
- [ ] `progress.md` holds a dated list of friction and product gaps found by using it.
- [ ] Any gap severe enough to block real use is raised as its own task rather than left in the list.

## Resources
- `coverage.md` — all 129 option ids with verified status.
- Handoff canvas: `/Users/mevil/Downloads/Alianhub UI mockups and redesign.zip` → `AlianHub Login Review.dc.html`.
