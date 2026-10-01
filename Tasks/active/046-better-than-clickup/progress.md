# 046 progress

## M1 Foundation
**Track A — fields and views**
- [ ] A1.1 Field types: people, URL, rating, progress
- [ ] A1.2 Field type: files
- [ ] A1.3 View templates
- [ ] A1.4 List density, and Board and List menu parity
- [x] A1.5 Bulk timesheet approve (#1208, build 674)
- [ ] A1.6 AI field columns sort from the Table header; number fields can be grouped; AI ratings use the rating type

**Track B — visual refresh**
- [ ] B0.1 Screenshot atlas of every screen (light, dark, desktop, 390 px)
- [ ] B0.2 Three reference screens in switchable variants; the owner picks one
- [ ] B1.1 Convention test: no hard-coded colours or legacy classes, shrink-only baseline
- [ ] B1.2 Date pickers follow the theme
- [ ] B1.3 Screenshot regression test for the core screens

**Track C — proof**
- [ ] C1.1 Projects seeded with 10,000 and 50,000 tasks, speed budgets, first measurements

**Carried over from task 045**
- [x] #1206: the project page offers custom fields to group by (build 672)
- [ ] Hands-on pass in the running app: doc mentions and comments, "Who can see this", the Gantt shift preview, custom-field filter and sort

**Started early from later milestones** (they collide with nothing in wave 1)
- [ ] A3 Automation engine: "due date passed" and "all subtasks done" triggers, a notify action
- [ ] Access follow-ups: #1213 (the project list and project search check the active seat first), then a second PR for archive search, the shared rule in search, and task queries

## M2 Core
The hierarchy design is in `design-hierarchy.md`: fifteen slices (N1–N6, F1–F3, E1–E4).
- [ ] N1 Task `ancestors`, the tree rules and migration 064
- [ ] F1 Subfolders on the server

## M3 Depth, M4 Lead and proof
Not started. The slices are listed in `task.md`.

## Log
- 2026-10-01: the owner confirmed the plan with the recommended definition of "great" and asked to start M1. Wave 1 started: A1.1, A1.3, A1.4, A1.5, B0 (atlas and variants), B1.1, B1.2, C1.1.
  - Agents run only the test files they touch and leave the full suites to CI, after the overload of 2026-09-30.
  - A slice counts as done only after its main flow is used in the running app: #1191 passed CI with its headline feature not working on the project page.
- 2026-10-01, later: the owner said to continue without waiting and to make the decisions. The plan's seven decisions were taken as recommended (see `task.md`), and the ten hierarchy questions as recorded in `design-hierarchy.md`.
  - Merged so far: #1206 (672), #1207 (673, this plan), #1208 (674).
  - The style baseline test (#1210) is held until the other wave 1 PRs are in, then regenerated once.
  - The hands-on pass runs in the QA Sandbox project with a dedicated agent.
