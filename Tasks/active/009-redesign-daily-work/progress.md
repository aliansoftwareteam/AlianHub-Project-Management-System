# Progress: Redesign stages 2–3

## Checklist
- [x] Wave 1 (partial — agents cut off by a usage limit; delivered work integrated): Home/Planner/Personal List · Task detail overlay · Auth flows + Create company/project + tour · Settings shell (18a/b/c, 11d, 15a–d) · Inbox/⌘K/error states/changelog/offline · Docs hub/editor/wiki · Chat/calls/meeting notes · Timesheet/approvals/workload/capacity/variance
- [ ] Wave 2 (after wave 1): Projects list, Board, List, Calendar, Gantt, Forms, Members, relations/quick menu, sprints & folders, recurring tasks, mobile Board
- [ ] Integration pass: build, route/menu wiring (Approvals in More menu), kiln alias removal, dark theme sweep
- [ ] Visual QA against mocks (needs an authenticated session — the owner must log in; Claude cannot enter credentials)

## Last step
Wave 1 integrated. Landed: Home/Planner/Personal List, task detail overlay, auth + create company + tour, settings shell, Inbox/⌘K/error states/changelog/offline, Docs hub/editor/wiki, Chat/calls/meeting notes, Timesheet/approvals/workload/capacity/variance. Not started: wave 2 (projects list, Board, List, Calendar, Gantt, Forms, Members, relations, sprints/folders, recurring, mobile Board).

## Blockers
- Authenticated screens can't be screenshotted by Claude (credential entry is off-limits). Owner to log in and review.

## Log

### 2026-09-03
- Task created; wave 1 agents launched.

### 2026-09-03 (wave 2 landing)
Branch `feat/redesign-project-views`. Landed and independently verified by the main session (tests re-run, eslint re-run — not taken on the agent's word):
- **Members / relations / sprints / recurring / people** — 18 tests. Found `RecurringTasksManager` was orphaned (no route, no importer), so mock 17c had never been reachable; added the route. Declined to invent a "leave leftovers where they are" sprint-close option the API does not support, and dropped an org chart because no manager field exists in the schema.
- **Calendar / Gantt / Workload / Forms** — 9 critical-path tests. Baseline bars drawn only where a real earlier planned date exists. Forms "on submit" left read-only because the automation registry has no `form.submitted` trigger.
- **Milestone billing (task 011, 19a–19d)** — 53 tests. Client view is a strict allow-list built field-by-field with no spread/delete; tests assert no hours/estimates/salary/margin/comments can reach a guest. Money in integer minor units.

Still running: projects list + board, list + table, reports, dashboards, custom fields/import/RTL, agent parity.

**Process fix:** the brief told every agent to verify with a full `vue-cli-service build`. Nine ran concurrently and starved the machine (load 200–440; one agent's build got ~5 CPU-seconds per 10 minutes). The brief now has agents verify their own slice (eslint + `@vue/compiler-sfc` compile + `node --check` + their own jest) and leaves one integration build to the main session.

### Integration to-do (main session, after all wave-2 agents land)
- **Fold the bulk-bar workaround into `Projects.vue`.** `Projects.vue` mounts the legacy `<BulkActionBar />` for every view. The List/Table agent could not edit that file (another agent owned it), so `ListView.vue` / `TableView.vue` add a `body.ah-listv2-active` class and `ListBulkBar.vue` hides the old bar with `body.ah-listv2-active .bulk-action-bar { display: none }`. That works but is fragile: the legacy bar still mounts and binds listeners, and the hiding depends on CSS order. Replace with a `v-if` in `Projects.vue` and delete the body-class dance in all three files.
- Re-run the full build once, on a quiet machine, as the authoritative check.
- Re-test the Home checklist "Create project" CTA on a stable server (an earlier attempt looked broken but the API had crashed).
