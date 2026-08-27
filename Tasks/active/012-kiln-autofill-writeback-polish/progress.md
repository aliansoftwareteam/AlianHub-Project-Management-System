# Progress: Kiln polish after Autofill + write-back

## Checklist
- [x] Autofill card: named rows, per-row apply, Fill empty, copper marks, due date
- [x] Write-back: activity log instead of Alian comments; page strip dismiss/collapse
- [x] Search/Home/deep URL ProjectID; search title click
- [x] Honest list/board empty copy; standup height + SOURCES count
- [x] Tests: skip-filled per field, Owner-without-Assignee, activity vs comment
- [ ] Draft stacked PR; tests green

## Last step
Stacked Jest suite 108 passed. Frontend `npm run build` succeeded. Committing and opening the stacked draft PR.

## Blockers
None.

## Log

### 2026-08-27
- Task created. Stacked on PR 521 (`feat/agent-writeback-status-page-comment-0b24`).
- Autofill card dropped the kind column; rows are labeled by field name with per-row checkboxes. Assignee and Owner stay two writes. After apply, Fill empty + copper in-field mark. Date custom fields no longer crash on missing `fieldPastFuture`.
- Write-back posts one Activity Log row (copper Alian mark) instead of a new comment per event. Project toggle is checked before that write. Page briefing stays a replace-in-place strip with dismiss/collapse.
- Search/Home/deep URL resolve the task `ProjectID`. Search result titles open the task. List/board empty copy is "No matching filters". Standup briefing height is capped; SOURCES collapse to a count.
