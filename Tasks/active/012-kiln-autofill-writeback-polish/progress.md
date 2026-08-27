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
- [x] Comments pane lists existing Alian comments for the open taskId (no empty pane with badge 1)

## Last step
Leftover 4: `#/<cid>/pages?page=` is redirected in `beforeEach` to `#/<cid>/projects/<pid>/pages?page=` before PagesPanel mounts, so first paint is Local Smoke + write-back strip. Fail-fast if the page has no project/access.

## Blockers
None. Live Local Smoke is not in this VM (no Mongo), so Ctrl+K / board / pages were not browser-verified here.

## Log

### 2026-08-27
- Task created. Stacked on PR 521 (`feat/agent-writeback-status-page-comment-0b24`).
- Autofill card dropped the kind column; rows are labeled by field name with per-row checkboxes. Assignee and Owner stay two writes. After apply, Fill empty + copper in-field mark. Date custom fields no longer crash on missing `fieldPastFuture`.
- Write-back posts one Activity Log row (copper Alian mark) instead of a new comment per event. Project toggle is checked before that write. Page briefing stays a replace-in-place strip with dismiss/collapse.
- Search/Home/deep URL resolve the task `ProjectID`. Search result titles open the task. Empty projectId fails fast (one kiln line + Back to search) instead of a spinner skeleton. List/board empty copy is "No matching filters". Standup briefing height is capped; SOURCES collapse to a count.
- List/board bind: sprint GET matches string or ObjectId `projectId`; dangling `folderId` still lands in `sprintsObj`; cache no longer returns another project's sprints. Empty status columns no longer skip the task fetch.
- Jest 116 passing; frontend production build succeeded. PR 522 updated.
- QA P0 leftover 2 retry: sidebar Local Smoke / sprint click still left the URL on `#/<cid>/project` because sprint rows used JS-only `router.push({ path })` without a real href, and search rows `@click.prevent`ed an empty hash. Both now use named routes with `cid` (`taskOpenRoute`) and a real `<a :href>` from `router.resolve`. Title and OPEN share that href (no `target=_blank`). PROJECTS without an id `router.replace`s onto the first listed project + first sprint.
- QA P0 leftover 3 (SMOKE-7 comments): badge 1 with empty Comments pane. Thread fetch now uses `taskId` even when `selectedProject` is `{}`, does not AND sprintId on a task thread, and keeps pid/sid/tid in the hash while the modal is open. Empty projectId is still 400 only when there is no valid taskId either.
- Bot 3 GET `/get-paginated-messages` with Local Smoke ids returned `{data:[]}` while 5 Alian comments exist with string `taskId`. The list query no longer ANDs `projectId`/`sprintId` (mongoose ObjectId-cast dropped string-stored thread ids) and matches `$toString(taskId)`. Empty/`undefined` projectId is 400, not a 500 ObjectId cast.
- Bot 3 leftover 2: Ctrl+K OPEN was a real `<a href>` (new tab after Ctrl+K) and `GET taskData` `$lookup $expr` on `_id` never hydrated (skeleton). OPEN/title are in-app buttons; taskData is an indexed `findOne` on the task; 8s fail-fast instead of an infinite shimmer.
- Bot 3 leftover 2 split: enter-to-open already hydrates same-tab. The middle external-link icon failed because `openInApp` returned on `ctrlKey` and let the native `<a>` open a new tab. Title + enter-to-open + middle icon now share one `taskHref`; click always `preventDefault` + `router.push`. Comments tab label no longer swallows the click (and the overflowing title no longer sits on the tab). Hash replace refuses to drop `taskId` while the modal is open.
- S3.2 write-back confirmed via PROJECTS → Local Smoke; not re-implemented. Pages deep-link now carries `?page=&project=` so the picker lands on that project (strip visible, no duplicate Ask smoke race from a second fetch).
- Bot 3 leftover 4 CONFIRMED FAIL: `#/<cid>/pages?page=` still first-painted Workspace pages (no strip) because PagesPanel mounted before a project was in the hash. Router `beforeEach` now GET-resolves the page’s ProjectID and `next`s to `#/<cid>/projects/<pid>/pages?page=` so PagesPanel’s first paint already has Local Smoke (strip, Turn into tasks, STANDUP). No project/access → kiln fail-fast, not Workspace. getPage also returns a string `projectId`. Write-back was not re-implemented.
- Overlay 360 P0 1: Ask smoke deep-link still landed on `&unresolved=1`. GET `projectId` used `String(ProjectID)` (`[object Object]` for `$oid`/Buffer). Resolve now passes the URL `cid` as `companyId`, parses GET via `pageFromGetResponse` + `firstId`, and getPage writes a hex `projectId` (linked-task fallback if the page row has none).
- Overlay 360 P0 2: Local Smoke list showed the sprint header over a white void because `emptyKind` counted sprint groups (`groupedTasks.length`) as `boardCount`. It now counts store task rows (`countSprintBoardTasks`). Task find matches string or ObjectId `ProjectID`/`sprintId`; list/board look up the sprint bucket by coerced id. Failed bind is copper Retry, not a blank panel. Gantt was not started. Write-back was not re-implemented.
- Bot 2 copy lock: Ask smoke hydration is not ACL. `#/<cid>/pages?page=` shows pine “Opening {title}…” then replaces to Local Smoke with the write-back strip. True no access is “You don't have this page.” True missing is “This page isn't in {project}.” Both pine Back to Pages. Sprint header stays; loading is cream “Loading this board…”; failed bind is “Couldn't load this board.” + “This sprint has {count} tasks. They didn't show here.” + copper Retry; honest empty is “No tasks in this sprint.” + pine Create.
