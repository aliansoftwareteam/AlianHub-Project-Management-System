---
id: 006
title: Remove auto-assignee from task creation
status: done
priority: medium
depends_on: []
created: 2026-10-06
---

# Remove auto-assignee from task creation

## Goal
New tasks start unassigned. The creator is no longer pre-filled as assignee when a task is created.

## Scope
- Inline create row (`frontend/src/components/atom/CreateTask/CreateTask.vue`) — the `addDefaultAssignee` prop and `defaultAssignee()` pre-fill.
- Board card create (`frontend/src/views/Projects/Kanban/BoardViewTaskCreate.vue`) — same pre-fill.

## Out of scope
- Recurring tasks "Assign to me" checkbox (explicit opt-in, separate feature).
- Backend task creation (no auto-assign logic exists there).
- Users still being able to pick assignees manually.

## Acceptance criteria
- [x] Creating a task from the inline row leaves assignee empty unless the user picks one.
- [x] Creating a task from the board card leaves assignee empty unless the user picks one.
- [x] Creating several tasks in a row stays unassigned each time (reset path too).
- [x] Manually picked assignee is still saved and cleared correctly after save.

## Constraints & notes
- Introduced in f9d36fa5d; reset-after-save logic must keep returning a fresh array.
