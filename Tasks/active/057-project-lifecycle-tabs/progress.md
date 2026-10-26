# Progress: Projects settings — Open, Archived and Closed tabs; every undo returns the exact previous state

## Checklist

- [x] Server lifecycle helper and shared task-move helper
- [x] Project update route, Trash restore and auto-close use the helper; schema fields declared
- [x] Backend tests for the lifecycle table
- [x] Settings › Projects tabs and per-state row menu
- [x] Web cascades removed; project archive confirmation; i18n keys
- [x] Unit tests, `i18n:check`, `style:check`
- [ ] Integration test against a real database (written; runs in CI)
- [ ] In-app check

## Last step

Implementation done and unit-tested; full suites running; PR next.

## Blockers

No local MongoDB (Docker Desktop is not running and no `.env` exists), so the in-app check and `tests/integration/project-lifecycle.int.test.js` cannot run on this machine. CI runs the integration suite.

## Log

### 2026-10-26
- Task created from the close-vs-archive discussion. Decisions recorded in `task.md`.
- Branch moved onto `staging` (it had no commits of its own); 056 is taken there, so this is 057.
- Built `Modules/Project/helpers/projectLifecycle.js`: each change moves the project's live tasks from the key for its before-state to the key for its after-state (open 0, closed 8, archived 7, trashed 1 + `trashedWithProject`). `statusBeforeClose` and `trashedFromKey` are stamped on the project and are server-only fields.
- The task move itself (find ids, write, socket per task, cache clear) moved out of the `/api/v1/task` cascade into `Tasks/helpers/moveTasks.js`, shared by both. Auto-close passes `announce: false` so the nightly run sends no per-task sockets, as before.
- Found while building: Settings › Close moved tasks 8→0 rather than 0→8 (both branches of `colseProject` called `restoreChildTasks` with key 8).
- Web: Settings › Projects has Open / Archived / Closed tabs bucketed by `lifecycleOf`; the row menu follows the state, each action gated by its own permission; `reopenStatusOf` picks the pre-close status. `useProjectLifecycle`, `Item.vue` and the row component no longer move tasks.
- Found by `tests/project-agent-fields.test.js`: the route merged the stamped fields into the caller's `updateObject`; it now writes a copy, so a reused body never carries a server-only field.
- Full suites in four (backend) and two (frontend) shards. Every failure also fails on a clean `staging` checkout or passes when run alone (Windows path separators, phone CSS tokens, native crashes in the knowledge file parser, timeouts under load).
- Added `tests/integration/project-lifecycle.int.test.js` (archive/restore, close/archive/restore/reopen, archived → trash → Trash restore) against a real database; it runs in CI.
- Tests: `tests/project-lifecycle.test.js` (lifecycle table, undo round-trips, the writes), `reopenStatusOf` in `tests/lifecycle-mapping.test.js`, Trash restore in `tests/trash-controller.test.js`, `frontend/tests/unit/settingsProjectsTabs.spec.js`. `i18n:check` and `style:check` pass.
