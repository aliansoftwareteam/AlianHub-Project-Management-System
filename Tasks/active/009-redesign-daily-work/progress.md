# Progress: Redesign stages 2–3

## Checklist
- [x] Wave 1 (partial — agents cut off by a usage limit; delivered work integrated): Home/Planner/Personal List · Task detail overlay · Auth flows + Create company/project + tour · Settings shell (18a/b/c, 11d, 15a–d) · Inbox/⌘K/error states/changelog/offline · Docs hub/editor/wiki · Chat/calls/meeting notes · Timesheet/approvals/workload/capacity/variance
- [x] Wave 2 (all nine agents landed, integrated, PR #525): Projects list, Board, List, Calendar, Gantt, Forms, Members, relations/quick menu, sprints & folders, recurring tasks, mobile Board
- [x] Integration pass: build + 1031 tests green; bulk-bar hack replaced with a v-if
- [ ] Visual QA against mocks (needs an authenticated session — the owner must log in; Claude cannot enter credentials)

## Last step
Wave 2 committed and pushed as PR #525 (196 files). Wave 1 integrated. Landed: Home/Planner/Personal List, task detail overlay, auth + create company + tour, settings shell, Inbox/⌘K/error states/changelog/offline, Docs hub/editor/wiki, Chat/calls/meeting notes, Timesheet/approvals/workload/capacity/variance. Not started: wave 2 (projects list, Board, List, Calendar, Gantt, Forms, Members, relations, sprints/folders, recurring, mobile Board).

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

### 2026-09-03 (integration to-do closed)
- **Bulk-bar workaround folded in.** `Projects.vue` now mounts the legacy `<BulkActionBar />`
  behind `v-if="!hasOwnBulkBar"`; the `body.ah-listv2-active` class dance is gone from
  `ListView.vue`, `TableView.vue` and `ListBulkBar.vue`. The legacy bar no longer mounts at
  all on List and Table, so nothing depends on CSS order.
- **Authoritative build re-run on a quiet machine.** Exit 0. The `webpackChunkName` magic-comment
  warnings in the router are pre-existing (unquoted chunk names) and do not fail the build.
- **Checklist "Create project" CTA re-tested live, as owed.** It works: the create-project
  sidebar mounts with Search templates / Enter Project Name / Select Project Due Date. The
  earlier "dead button" report was wrong — the API had crashed — and that correction is now
  backed by a test rather than an argument.
- **But the same test found two genuinely dead buttons.** `SetupChecklist` renders every
  not-done, not-active step as a real `<button>`, and any step can become the primary CTA, yet
  `onChecklistAction` had no branch for `board` or `notifications`. Verified by arming a capture
  listener before clicking, so the miss is proven, not inferred: the click reached the button and
  produced no route change and no modal. Both now navigate — board to the first project's Board
  tab (or create-project when there is no project), notifications to Settings › Notifications —
  and both steps already tick themselves on arrival via `firstRunProgress`.
- **Pre-existing, not a redesign regression:** the server serves the SPA only at `/`
  (`index.js:98`), so any deep link or hard refresh on a real route returns "Cannot GET". Worth
  a decision now that the redesign has shareable URLs.

### Integration to-do (main session, after all wave-2 agents land) — CLOSED
- **Fold the bulk-bar workaround into `Projects.vue`.** `Projects.vue` mounts the legacy `<BulkActionBar />` for every view. The List/Table agent could not edit that file (another agent owned it), so `ListView.vue` / `TableView.vue` add a `body.ah-listv2-active` class and `ListBulkBar.vue` hides the old bar with `body.ah-listv2-active .bulk-action-bar { display: none }`. That works but is fragile: the legacy bar still mounts and binds listeners, and the hiding depends on CSS order. Replace with a `v-if` in `Projects.vue` and delete the body-class dance in all three files.
- Re-run the full build once, on a quiet machine, as the authoritative check.
- Re-test the Home checklist "Create project" CTA on a stable server (an earlier attempt looked broken but the API had crashed).
