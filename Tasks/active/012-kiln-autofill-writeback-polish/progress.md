# Progress: Kiln polish after Autofill + write-back

## Checklist
- [x] Autofill card: named rows, per-row apply, Fill empty, copper marks, due date
- [x] Write-back: activity log instead of Alian comments; page strip dismiss/collapse
- [x] Search/Home/deep URL ProjectID; search title click; fail-fast if id missing (no skeleton)
- [x] Honest list/board empty copy; standup height + SOURCES count
- [x] Bind Local Smoke sprint rows onto list/board (id coerce, dangling folder, sprint GET $in)
- [x] Ctrl+K title + OPEN: same-tab in-app hash with ProjectID (no blank tab, no overlay)
- [x] Ctrl+K TaskKey (`SMOKE-7`) hits AdvancedGlobalFilter TaskName **or** TaskKey
- [x] PROJECTS tab without a selected project auto-selects/loads first project + first sprint
- [x] Comments list matches string or ObjectId taskId; empty projectId is 400
- [x] Tests: skip-filled per field, Owner-without-Assignee, activity vs comment
- [x] Draft stacked PR; tests green

## Last step
Ctrl+K from Home (Local Smoke not selected): title click and OPEN now share one in-app `taskOpenPath` href and `router.push` (no `window.open`, no `[object Object]` project segment). TaskKey queries hit the same AdvancedGlobalFilter `$or` as TaskName. PROJECTS tab without an id auto-binds the first listed project (Local Smoke in the smoke company) and loads sprints so Tags/AI and the board can bind SMOKE-1..7. Comments `$in` string+ObjectId; missing projectId is 400.

## Blockers
None. Live Local Smoke is not in this VM (no Mongo), so the Home Ctrl+K and PROJECTS auto-select paths are covered by source/unit tests, not a browser pass.

## Log

### 2026-08-27
- Task created. Stacked on PR 521 (`feat/agent-writeback-status-page-comment-0b24`).
- Autofill card dropped the kind column; rows are labeled by field name with per-row checkboxes. Assignee and Owner stay two writes. After apply, Fill empty + copper in-field mark. Date custom fields no longer crash on missing `fieldPastFuture`.
- Write-back posts one Activity Log row (copper Alian mark) instead of a new comment per event. Project toggle is checked before that write. Page briefing stays a replace-in-place strip with dismiss/collapse.
- Search/Home/deep URL resolve the task `ProjectID`. Search result titles open the task. Empty projectId fails fast (one kiln line + Back to search) instead of a spinner skeleton. List/board empty copy is "No matching filters". Standup briefing height is capped; SOURCES collapse to a count.
- List/board bind: sprint GET matches string or ObjectId `projectId`; dangling `folderId` still lands in `sprintsObj`; cache no longer returns another project's sprints. Empty status columns no longer skip the task fetch.
- Jest 116 passing; frontend production build succeeded. PR 522 updated.
- QA P0 leftover 2 retry: sidebar Local Smoke / sprint click still left the URL on `#/<cid>/project` because sprint rows used JS-only `router.push({ path })` without a real href, and search rows `@click.prevent`ed an empty hash. Both now use named routes with `cid` (`taskOpenRoute`) and a real `<a :href>` from `router.resolve`. Title and OPEN share that href (no `target=_blank`). PROJECTS without an id `router.replace`s onto the first listed project + first sprint.
