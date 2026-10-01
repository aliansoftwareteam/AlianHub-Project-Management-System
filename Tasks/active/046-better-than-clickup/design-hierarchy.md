# 046 M2 — Hierarchy design (Track A2)

From a read-only pass over the code at `origin/beta` on 2026-10-01. Three features: nested subtasks (three levels), subfolders, and an "Everything" view. Each slice below is one pull request. File references are to `beta` at that date; check them before relying on a line number.

## Facts that are easy to get wrong
- `isParentTask: true` means "top-level task", not "has children". `subTasks` is the count of direct children.
- The one-level rule lives in `Modules/Tasks/helpers/taskMongo/bulk.js` (about l.1062, "a subtask cannot be a parent").
- The task schema is strict: a field that is not declared in `utils/mongo-handler/schema.js` is dropped on save.
- The next free migration numbers are **064** (task ancestors) and **065** (Everything indexes). Check again before pushing: another slice may have taken one.

## 1. Nested subtasks, three levels

### Model
- `ParentTaskId` stays the source of truth. `isParentTask` keeps meaning "top-level", so the twelve reports and about sixty frontend files that count top-level tasks stay correct.
- One new server-owned field on tasks: `ancestors: [String]`, root first, `[]` for a top-level task. Depth is `ancestors.length`; no separate depth field.
- Why stored: every cascade becomes one indexed `updateMany({ ancestors: id })`, the cycle check is an array lookup, and client pipelines cannot use `$graphLookup` (`taskQueryGuard.js`).
- All rules live in one helper, `Modules/Tasks/helpers/taskTree.js`, used by every writer. New index `{ ancestors: 1 }`.

### Invariants
- At most three levels (`ancestors.length` ≤ 2). No cycles.
- A descendant always has its root's `ProjectID`, `sprintId`, `sprintArray` and `folderObjId`. The server copies them from the stored parent; a client-sent value is overridden.
- Only top-level tasks move; descendants follow.
- Archive, delete and restore cascade to every descendant. Restore brings back only the rows the cascade itself changed.
- Subtask to task: its subtree follows. Task to subtask: refused, with a reason, if the result would exceed three levels (today it flattens silently).
- Convert to list: direct children become tasks; grandchildren stay under them.
- A row's "7/9" counts direct children. Reports keep counting top-level tasks only.

### Migration `064-task-ancestors`
- Per company: read `_id`, `ParentTaskId`, `sprintId` for tasks with a parent and build each chain.
- `bulkWrite` in batches of 500 with `timestamps: false`; each filter names the `ParentTaskId` that was read (the pattern in `migrations/046-task-sprint-placement.js`). Idempotent, with a dry run.
- Top-level tasks are not written: a missing `ancestors` reads as `[]`.
- Counted and left alone: orphans, cycles, and subtasks in a different sprint from their root.
- Rows deeper than level three are re-hung on their level-two ancestor, with `subTasks` corrected. Such rows can exist: the automation and agent `createSubtask` (`Modules/Automations/engine/tools.js`) has no depth check.
- `verify()` reports what is left; then the index is created and checked, as migration 063 does.

### What breaks silently if missed
- **High:** the store looks for a row's parent among top-level rows only, so a level-three row is dropped (`frontend/src/store/ProjectData/mutations.js`).
- **High:** archive, delete and move reach direct children only, and the sprint count maths uses `subTasks + 1` (`taskMongo/structural.js`, `bulk.js`).
- **Medium:** List rows render one hard-coded nested level; selection and the bulk bar assume one level (`ListView/`, `useTaskSelection.js`, `bulkPlacement.js`, `bulkUndo.js`); the task panel hides "Add subtask" on a subtask and shows one parent in its breadcrumb; import and duplicate lose levels.
- **Low:** Gantt and Mind map already build a tree from `ParentTaskId`.

### Access
No new rule: a subtask inherits its root's project and sprint, so the existing read checks cover it. Permission keys stay `task.sub_task_create` and `task.task_convert_to_subtask`.

## 2. Subfolders

### Model
- One new optional field on folders: `parentFolderId`. Absent means root, so there is no data migration.
- Tasks and sprints keep pointing at their immediate folder; URLs and the flat `project.sprintsfolders[folderId]` map that 81 frontend files read stay as they are. Each map entry gains `parentFolderId`, and only the tree renderers nest.

### Invariants
- The parent is in the same project and not deleted. No cycles.
- Two levels only: folder, then subfolder.
- Chat categories, which share the folders collection, never nest.
- Archive, delete and restore cascade through subfolders to their sprints and tasks.
- Moving a folder writes only `parentFolderId`.

### What breaks silently if missed
- **High:** the folder delete cascade collects sprints by `folderId` only (`Modules/Sprints/helpers/listWrites.js`), so a subfolder's sprints would stay live under a deleted folder.
- **Medium:** the folder view would not list sprints in subfolders; project templates and project duplication would lose nesting (not traced); breadcrumbs and history text name one folder.

### Access
Folders carry no privacy; the project rule and the sprint's own privacy decide. Reuse the `project.project_folder_*` keys: a new key would deny every existing company.

## 3. Everything view

### Model
- A dedicated read endpoint, `POST /api/v2/tasks/everything`, under the already guarded prefix. The client sends filter, group, sort and cursor as data; the server builds the pipeline.
- The server always applies:
  - `ProjectID` within `visibleProjectIds(uid)`, for owners and admins too;
  - private sprints hidden from people who are not on them;
  - no chat rows and no deleted rows;
  - closed and archived projects excluded by default;
  - a forced page size of at most 100, with a keyset cursor on `(sortKey, _id)`.
- Group counts come from a second `$group` query.
- Frontend: a new page `frontend/src/views/Everything/` with its own store module, reusing row-level parts (List row, Board card, Table cells, filter and sort controls). It does not mount `Projects.vue`, which is bound to one project.
- Saved settings use the existing private-view store.
- Do not reuse `visibilityStage` from `taskQueryGuard.js` for this: it applies no scope for owners and admins.

### Indexes (migration 065)
`{ ProjectID: 1, deletedStatusKey: 1, updatedAt: -1, _id: 1 }` and `{ ProjectID: 1, deletedStatusKey: 1, DueDate: 1, _id: 1 }`. Whether a long `ProjectID $in` list sorts in memory past a few hundred projects is not measured; slice E4 measures it on the 10,000-task data set.

## Decisions (taken by the integrator on 2026-10-01 under the owner's standing instruction)
1. A task with subtasks that would exceed three levels when converted under a parent is refused with a reason.
2. A row's progress counts direct children.
3. Reports keep counting top-level tasks.
4. Folders nest one level: folder, then subfolder.
5. Owners and admins see private sprints in Everything, as elsewhere, but never other people's personal lists.
6. Board columns across projects merge by status name; a drop is allowed only when the task's own project has that status.
7. Everything shows subtasks behind a toggle that is off by default.
8. Everything refetches on focus and after the person's own edits; a company-wide live room comes later.
9. Task templates and recurring tasks keep one level of subtasks in M2.
10. The automation `createSubtask` depth check and the agent sprint move are fixed inside N2 and N3a.

## Slices, in order

| # | Slice | Owns | Can run alongside |
|---|---|---|---|
| N1 | `ancestors` in the schema, the index, `taskTree.js`, migration 064 | `schema.js` (tasks block), `createSchema.js`, `Modules/Tasks/helpers/taskTree.js`, `migrations/064` | F1 |
| N2 | Create paths set placement and `ancestors` from the stored parent; level-ordered import; depth refusal | `taskMongo/create.js`, `taskWriteFields.js`, `Modules/Automations/engine/tools.js`, `TaskTemplates/templateRules.js`, `AIProjectGenerator/orchestrator.js`, `utils/sampleTasks.js` | F1, E1 |
| N3a | Archive, delete, restore and move cascade by `ancestors`; count maths; agent move | `taskMongo/structural.js` (archive, move), `bulk.js` (move), `Modules/Agents/actions.js`, `projectSetting/autoArchive.js`, `Sprints/scrum.js` | After N2; not with N3b |
| N3b | Convert, merge, duplicate, convert to list; the one-level refusal becomes the depth rule | `structural.js` (convert), `mongo_helper.js`, `mergeDuplicate.js`, `bulk.js` (convert) | After N3a |
| N4 | Store tree and recursive List rows; selection; bulk bar | `store/ProjectData/mutations.js`, `actions.js`, `ListView/*`, `useTaskSelection.js` | N5a, E2; not with F2 |
| N5a | Task panel: add a subtask at level two, full breadcrumb, parent picker | `TaskDetailPanel.vue`, `SubTasks.vue`, `ConvertToSubTaskSidebar/*`, `TaskDetailAction.vue` | N4 |
| N5b | Board, Table, Calendar, legacy item list | `Kanban/*`, `TableView/*`, the calendar view, `organisms/ItemList`, `organisms/Task` | After N4 |
| N6 | ClickUp and CSV import keep three levels; field rollups; unread rollup to the root; export column | `Importers/helpers/clickupRules.js`, `CustomField/controller.js`, the notification count, the export helper | N4, N5 |
| F1 | `parentFolderId`; add and move rules; cascade | `schema.js` (folders block), `Modules/Sprints/controller.js`, `helpers/listWrites.js`, `Sprints/routes.js` | N1, N2 |
| F2 | Tree, sidebar, pickers, breadcrumb | `useProjectTree.js`, the folder part of `mutations.js`, `ProjectTreePanel.vue`, the sidebar folder list, `folderSprints.js`, `NewInProjectMenu.vue` | Before or after N4, not during |
| F3 | Project templates and project duplication keep nesting | the template and create-project code | N slices |
| E1 | Endpoint, pure query builder, migration 065 | `Modules/Tasks/controller/everything.js`, `helpers/everythingQuery.js`, `Tasks/routes.js`, `migrations/065` | After N1 (shared `createSchema.js`) |
| E2 | Route, rail item, List mode, filter, group, sort | `views/Everything/*`, the router, the rail's nav items, a new store module | N4, F2 |
| E3 | Board and Table modes | `views/Everything/*` | After E2 |
| E4 | Saved view; measure at 10,000 tasks and fix | `views/Everything/*`, indexes | After the scale seed is merged |

## Tests to write first
- **N1:** the migration (a dry run writes nothing; a second run plans nothing; `updatedAt` is kept; orphans, cycles and too-deep rows are counted) and the tree rules (depth, cycle, subtree height).
- **N2:** creating under a level-two task is refused; a client-sent `ancestors` or foreign `sprintId` is overridden; the automation `createSubtask` respects depth. Update `tests/fixtures/taskWriteBodies.js`.
- **N3:** archive, restore and move reach grandchildren; sprint counts match; a convert past three levels is refused. These are the first server tests for these rules.
- **N4, N5:** extend `listSubtaskRows.spec.js`, `listBulkPlacement.spec.js`, `bulkUndo.spec.js`, the task panel spec and `tests/list-subtask-progress.test.js`.
- **N6:** `tests/clickup-import-rules.test.js` pins the flattening today; change it on purpose.
- **F1:** a parent in another project is refused; a cycle is refused; the depth cap; a chat category is refused; delete cascades to a subfolder's sprints and tasks; restore brings back only those.
- **F2:** `useProjectTree.spec.js`, `folderSprints.spec.js`.
- **E1**, in the style of `tests/task-query-guard.test.js`: a member sees only visible projects; an owner does not see another person's personal list; private sprints are hidden from people not on them; chat rows never appear; the page size is forced; a token narrowed to one project sees only that project.
- **Conventions that apply to all:** tenant scoping, route guard coverage, the v2 guard, i18n, unused components, naming.
