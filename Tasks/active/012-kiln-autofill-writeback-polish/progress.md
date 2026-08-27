# Progress: Kiln polish after Autofill + write-back

## Checklist
- [x] Autofill card: named rows, per-row apply, Fill empty, copper marks, due date
- [x] Write-back: activity log instead of Alian comments; page strip dismiss/collapse
- [x] Search/Home/deep URL ProjectID; search title click; fail-fast if id missing (no skeleton)
- [x] Honest list/board empty copy; standup height + SOURCES count
- [x] Bind Local Smoke sprint rows onto list/board (id coerce, dangling folder, sprint GET $in)
- [x] Tests: skip-filled per field, Owner-without-Assignee, activity vs comment
- [x] Draft stacked PR; tests green

## Last step
Fail-fast for empty projectId is on the same PR. Search hits stringify ProjectID; missing id shows one kiln line + Back to search, never a skeleton.

QA confirmed leftover 3 is UI-side: POST /search SMOKE returns SMOKE-1..7 and GET project is 200, but list/board stayed empty because sprints never bound (strict projectId ===, dangling folderId dropped, sprint GET ObjectId-only). Bind + $in match so sprint tasks can load; empty copy stays "No matching filters" when the list is still empty.

## Blockers
None.

## Log

### 2026-08-27
- Task created. Stacked on PR 521 (`feat/agent-writeback-status-page-comment-0b24`).
- Autofill card dropped the kind column; rows are labeled by field name with per-row checkboxes. Assignee and Owner stay two writes. After apply, Fill empty + copper in-field mark. Date custom fields no longer crash on missing `fieldPastFuture`.
- Write-back posts one Activity Log row (copper Alian mark) instead of a new comment per event. Project toggle is checked before that write. Page briefing stays a replace-in-place strip with dismiss/collapse.
- Search/Home/deep URL resolve the task `ProjectID`. Search result titles open the task. Empty projectId fails fast (one kiln line + Back to search) instead of a spinner skeleton. List/board empty copy is "No matching filters". Standup briefing height is capped; SOURCES collapse to a count.
- List/board bind: sprint GET matches string or ObjectId `projectId`; dangling `folderId` still lands in `sprintsObj`; cache no longer returns another project's sprints. Empty status columns no longer skip the task fetch.
