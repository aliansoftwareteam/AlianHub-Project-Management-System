# 037 progress

- [x] 1 List view filters and remembered views (#958)
- [x] 2 Create a task from anywhere (#957)
- [x] 3 Task panel: Esc, undo and one timer (#961)
- [x] 4 Bulk edit (#956)
- [x] 5 First run and the Getting started card (#962)
- [x] 6 Inbox keyboard triage and invites (#959, #960)

## Log
- 2026-09-24: flow audit and ClickUp comparison written; six slices started in parallel.
- 2026-09-24: slice 6 in review. #959: Inbox focus on load and after clear or snooze, j/k without a click, Open task as the overlay over /inbox?task=. #960: plain mail-failure message with Copy link, join link with its token, Member role by default, optional designation. Open: invitees who already have an account still need the emailed link (no signed-in accept on /invitation yet).
- 2026-09-24: slice 1 in PR #958: List reads the searched tasks like Board and Table, Clear filters on an empty result, group, Me and search remembered per user per project, Assignee grouping, Add View menu labels.
- 2026-09-24: slice 3 (task panel) — Esc closes the open picker, date picker, properties sheet or add row before the panel and leaves a text field without clearing it; Undo (6 s, Ctrl/Cmd+Z) on status, assignee, priority and due-date changes through the same update path; Home and Time read the panel's per-user timer; the desktop hand-off is "Open in desktop tracker" in the more menu.
- 2026-09-24: slice 2 (ranks 4, 5) on `feat/create-task-anywhere`: one create dialog from the palette, the rail, the mobile tab bar, `c` and a project's + New; commands rank above Ask AI; the List add row stays open; Home's add field keeps focus.
- 2026-09-24: slice 4 (bulk edit) done: bar above the tab bar at 390 px, shift-click and Shift+Space/Arrow range selection in List, Board and Table, Undo on "Updated n tasks." including archive and delete (both soft).
- 2026-09-24: slice 5 (first run) done: the floating Getting started card is merged into the one Home checklist, per role (members see personal steps only), hidden while a task panel, bulk bar or modal is open; dismissal and progress on the user record via PUT /api/v2/users/onboarding; the shell tour starts from the checklist and screen tours offer once per user; new projects start Blank.
- 2026-09-24: all slices merged as builds 425–431; localhost on build 431. Follow-ups 128 and 129 in task 034.
