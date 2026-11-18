# 042 — Non-AI UX fixes from the ClickUp comparison

## Goal
Fix the non-AI problems found in the 2026-09-28 re-comparison with ClickUp (`Tasks/active/034-end-to-end-qa-programme/findings/ux-comparison-clickup-2026-09-28.md`). The owner asked on 2026-09-28 to start fixing them alongside task 041. The first three slices come from the live walk-through of build 519.

## Scope (one slice and one PR each)
1. **Every view type can be added.**
   - The owner's workspace catalogue (`project_tab_components`) holds 3 of the 20 view types (Dashboard, List, Gantt View). Add View therefore can't offer Board, Table, Calendar, Workload, Timeline, Mind Map, Forms and the rest; another company on the same server has all 20.
   - Find why a company ends up with a partial catalogue.
   - Make company creation seed the full catalogue.
   - Self-heal existing companies idempotently, as `ensureDashboardTab` already does for Dashboard, and add a migration for the missing records.
   - Clear the `ProjectTabs:<companyId>` cache.
2. **Views and pages polish.**
   - The Add View menu closes on a view switch, a route change, Esc and an outside click. Today it stays open over Board with the old search text.
   - The Planner's day grid fills the page, with working hours in view and earlier or later hours reachable by scrolling. Today the grid ends at 17:00 above empty grey space.
   - Dashboard cards in the list show a real preview, or a clear static summary, instead of grey loading bars.
3. **Phone layout (390 px).**
   - The LIVE agent strip fits the width: 520 px of content currently scrolls sideways in a 390 px viewport.
   - The project page doesn't overflow (396/390).
   - Inbox is reachable from the phone tab bar.
   - The List filter toolbar takes one row, with the other filters in a sheet.

4. **Saved views that save the view.**
   - A view stores its filters, group, sort, columns and Me on the server.
   - "Save for everyone" and "Save for me", "Save as new", a default view per project, and an unsaved-changes marker.
   - It replaces the per-browser `projectViewPrefs` storage.
5. **Custom fields and a column chooser in List and Table.**
   - Custom field values show as columns, and a column chooser lets you pick them.
   - Table cells can be edited in place (status, assignee, due, priority, estimate, points, custom fields).
   - Story points appear on rows, with a total per group.
6. **Threaded and assigned comments.**
   - Replies in a thread.
   - A comment can be assigned to someone and resolved.
   - Assigned comments show on the task, as an Inbox kind and as a Home card.
7. **Task templates.**
   - "Save as template" on a task: description, checklist, subtasks, fields, relative dates.
   - "Apply template" in the add row and the task menu.
   - An optional default template per project.
8. **Project tree and favourites.**
   - The project → folder → sprint tree, with counts, on project pages.
   - One favourites store on the user, covering projects, sprints, tasks and docs, with a star on the breadcrumb.
   - The sprint crumb in the project header is a link.
9. **Workspace import.**
   - A "Bring your work in" checklist step.
   - A ClickUp importer (API token or CSV export).
   - A UI for the existing workspace export jobs.
10. **One task detail and a lasting tray.**
    - Home opens the overlay panel instead of the legacy task detail.
    - The minimised-task tray survives a reload.
11. **Keyboard and accessibility basics.**
    - The skip link is rendered.
    - A "?" shortcut sheet, with `/` for search, `g h`, `g i` and `g p` to move around, on by default.
    - A high-contrast theme.
    - An accessibility statement in `docs/`.
12. **Recurrence and time on the task.**
    - Set a recurrence from the task panel.
    - Add time manually in the panel and see the task's time entries there.
    - The timer is available to anyone who may log time on the task.
13. **List row menu and sorting.**
    - Archive, delete, move to a project and duplicate from the row menu, with undo.
    - Sort by due, priority, created, updated and name.

## Out of scope
These wait for an owner decision: nested subtasks, a task in several lists, views across projects (Everything), Goals, chat threads, and docs presence and version history.

## Acceptance
- Failing-first tests for each slice: jest for the catalogue seed, self-heal and migration; vitest for components; e2e for the 390 px checks where the harness supports them.
- Every string goes through i18n and the allowlist doesn't grow.
- Dark mode and 390 px checked; keyboard access; no regression in the axe checks.
- Company scoping and access rules unchanged.
