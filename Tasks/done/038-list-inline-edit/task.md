# 038 — Edit tasks from List rows

## Goal
Change the common properties of a task straight from a List row, without opening the task, as ClickUp does. Chosen by the owner on 2026-09-24 as the next step after task 037 (the "out of scope" item there).

## Scope
1. **Status circle** at the start of each row, in the status colour. Click (or Enter/Space on focus) opens the project's status picker grouped by type (to do, active, done); one pick changes the status. Two clicks, task stays closed.
2. **Inline cells** for assignee, due date and priority on each row: the value, or an empty-state icon on hover/focus. Click opens the existing picker for that property. Priority only when the project has it turned on.
3. **Row actions** on hover and on keyboard focus: rename in place, add subtask, copy link, open in a new tab, and the existing row menu.
4. **Undo** in the toast for every inline change, reusing the shared undo toast from #961.
5. **390 px**: the status circle stays; the cells fold into a compact line under the title; row actions move into the row menu.

## Out of scope
New properties or custom-field cells in List; column reordering; changes to Board or Table.

## Acceptance
- Changes go through the existing task update paths, so history, notifications, socket events and caches behave as when edited in the task panel.
- People without edit rights see values but no pickers; guests and members keep today's permissions.
- Filters, grouping and sorting from #958 update when a change moves a task out of its group or filter.
- Failing-first tests (unit and e2e: status from the list in two clicks, assignee set inline, Undo reverts); i18n for every string; dark mode and 390 px screenshots; keyboard access and accessible names; axe clean.
