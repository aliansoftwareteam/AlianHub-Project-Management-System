# Test Cases — COLLAB-06 Notepad (personal notes) (AHE-3757)

Quick personal notes, convertible to tasks. Built **additively** (new `notes` collection +
`Modules/Notes` + a Notepad panel), with convert-to-task **reusing the existing task-create
flow** (no new task-write path).

## Architecture
- **Collection** `notes` (new): `{ userId, companyId, title, content, convertedTaskId, deletedStatusKey }`. Registered additively across schemaType / collections / schema.js / createSchema.js (indexed `{userId,deletedStatusKey}`) / mongoQueries.
- **Module** `Modules/Notes/` — init/routes/controller + `notesRules.js` (pure helpers). Endpoints: `POST/GET/PATCH/DELETE /api/v1/notes` (company-scoped, soft delete, list filtered by userId + deletedStatusKey:0).
- **UI:** a `NotepadPanel` overlay opened from a new header icon (mirrors the existing StickiesPanel pattern — additive, no nav restructure). Create / edit (debounced autosave) / delete personal notes.
- **Convert-to-task** (`ConvertNoteToTask.vue`): pick a target project + sprint, then calls the existing `taskClass.create()` (→ `POST /api/v2/tasks`) with the **same payload shape `CreateTask.vue` builds** (status from `default_active`, first task type, sprintArray, etc.) + the existing per-sprint permission guard. On success the note is stamped `convertedTaskId` (kept, badged "Converted").

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Open notepad | click the notepad icon in the header | panel opens; lists my notes |
| M2 | Create / edit | add a note, type title + content | autosaves; persists (`GET /api/v1/notes` returns it) |
| M3 | Delete | delete a note | soft-deleted; removed from the list |
| M4 | **Convert to task** (core) | a note → Convert → pick project + sprint → Convert | a real task is created in that project/sprint (via the existing create flow); success toast; note shows "Converted" with `convertedTaskId` |
| M5 | Validation | convert with name < 3 chars / no project / no sprint | blocked with a clear message |
| M6 | Plan limit | convert into a sprint at the task plan limit | shows the existing upgrade/limit toast (reuses the guard) |
| M7 | Per-user scoping | another user's notepad | only their own notes (userId-scoped) |

## Guards / non-regression
- New collection + module + UI only; collection wiring additive (existing schema/switch untouched). Header edit mirrors StickiesPanel (additive icon + panel). jest 509 pass (incl. new notes-rules suite); frontend build clean.
- Convert reuses the existing `taskClass.create` / `/api/v2/tasks` path — no task-write path modified.
- Known limitation: the convert project list shows only projects whose task metadata (`taskStatusData`/`taskTypeCounts`) is loaded in the store, so the create payload is always well-formed; opening a project loads it. (Follow-up: on-demand fetch for any project.)
