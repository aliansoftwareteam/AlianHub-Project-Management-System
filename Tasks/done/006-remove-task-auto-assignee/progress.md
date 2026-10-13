# Progress: Remove auto-assignee from task creation

## Checklist
- [x] Remove pre-fill from CreateTask.vue
- [x] Remove pre-fill from BoardViewTaskCreate.vue
- [x] Verify unused `userId` refs/imports

## Last step
Done.

## Blockers
None.

## Log

### 2026-10-06
- Task created. Assumed recurring-task "Assign to me" is out of scope.
- Completed. Removed the creator pre-fill (prop, mount default, reset default) from CreateTask.vue and BoardViewTaskCreate.vue; reset is back to an empty array. Not browser-tested.
