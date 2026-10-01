# 046 progress

## M1 Foundation
**Track A — fields and views**
- [ ] A1.1 Field types: people, URL, rating, progress
- [ ] A1.2 Field type: files
- [ ] A1.3 View templates
- [ ] A1.4 List density, and Board and List menu parity
- [ ] A1.5 Bulk timesheet approve
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
- [ ] #1206: the project page offers custom fields to group by
- [ ] Hands-on pass in the running app: doc mentions and comments, "Who can see this", the Gantt shift preview, custom-field filter and sort

## M2 Core, M3 Depth, M4 Lead and proof
Not started. The slices are listed in `task.md`.

## Log
- 2026-10-01: the owner confirmed the plan with the recommended definition of "great" and asked to start M1. Wave 1 started: A1.1, A1.3, A1.4, A1.5, B0 (atlas and variants), B1.1, B1.2, C1.1.
  - Agents run only the test files they touch and leave the full suites to CI, after the overload of 2026-09-30.
  - A slice counts as done only after its main flow is used in the running app: #1191 passed CI with its headline feature not working on the project page.
