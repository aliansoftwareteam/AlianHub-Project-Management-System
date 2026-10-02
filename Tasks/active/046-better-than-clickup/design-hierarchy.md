# 046 M2 — Hierarchy design (Track A2)

From a read-only pass over the code at `origin/beta` on 2026-10-01. Three features: nested subtasks (three levels), subfolders, and an "Everything" view. Each slice below is one pull request. File references are to `beta` at that date; check them before relying on a line number.

Updated later on 2026-10-01 with what was built: the migration numbers, the slice that replaced F3, where saved Everything views live, and the endpoint contract (the appendix). Progress per slice is in `progress.md`.

## Facts that are easy to get wrong
- `isParentTask: true` means "top-level task", not "has children". `subTasks` is the count of direct children.
- The one-level rule lives in `Modules/Tasks/helpers/taskMongo/bulk.js` (about l.1062, "a subtask cannot be a parent").
- The task schema is strict: a field that is not declared in `utils/mongo-handler/schema.js` is dropped on save.
- The migrations this design used: **064** task ancestors (N1), **065** catch-up for subtasks created between 064 and N2, **066** repair after convert, merge and duplicate (N3b), **067** Everything indexes (E1). The first plan gave 065 to the Everything indexes. The next free number is 068; check again before pushing, because another slice may have taken it.

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
- Saved views live in their own collection, `everything_views` (#1262). The first plan was the existing private-view store; a private view is tied to one project, so it did not fit.
- Do not reuse `visibilityStage` from `taskQueryGuard.js` for this: it applies no scope for owners and admins.

### Indexes (migration 067)
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
| N2 | Create paths set placement and `ancestors` from the stored parent; level-ordered import; depth refusal; migration 065 (catch-up) | `taskMongo/create.js`, `taskWriteFields.js`, `Modules/Automations/engine/tools.js`, `TaskTemplates/templateRules.js`, `AIProjectGenerator/orchestrator.js`, `utils/sampleTasks.js` | F1, E1 |
| N3a | Archive, delete, restore and move cascade by `ancestors`; count maths; agent move | `taskMongo/structural.js` (archive, move), `bulk.js` (move), `Modules/Agents/actions.js`, `projectSetting/autoArchive.js`, `Sprints/scrum.js` | After N2; not with N3b |
| N3b | Convert, merge, duplicate, convert to list; the one-level refusal becomes the depth rule; migration 066 (repair) | `structural.js` (convert), `mongo_helper.js`, `mergeDuplicate.js`, `bulk.js` (convert) | After N3a |
| N4 | Store tree and recursive List rows; selection; bulk bar | `store/ProjectData/mutations.js`, `actions.js`, `ListView/*`, `useTaskSelection.js` | N5a, E2; not with F2 |
| N5a | Task panel: add a subtask at level two, full breadcrumb, parent picker | `TaskDetailPanel.vue`, `SubTasks.vue`, `ConvertToSubTaskSidebar/*`, `TaskDetailAction.vue` | N4 |
| N5b | Board, Table, Calendar, legacy item list | `Kanban/*`, `TableView/*`, the calendar view, `organisms/ItemList`, `organisms/Task` | After N4 |
| N6 | ClickUp and CSV import keep three levels; field rollups; unread rollup to the root; export column | `Importers/helpers/clickupRules.js`, `CustomField/controller.js`, the notification count, the export helper | N4, N5 |
| F1 | `parentFolderId`; add and move rules; cascade | `schema.js` (folders block), `Modules/Sprints/controller.js`, `helpers/listWrites.js`, `Sprints/routes.js` | N1, N2 |
| F2 | Tree, sidebar, pickers, breadcrumb | `useProjectTree.js`, the folder part of `mutations.js`, `ProjectTreePanel.vue`, the sidebar folder list, `folderSprints.js`, `NewInProjectMenu.vue` | Before or after N4, not during |
| F3 | Replaced by "duplicate a project" (#1257). Neither project templates nor project duplication existed, so there was no nesting to keep. "Save a project as a template" moved to M3 | `Modules/ProjectDuplicate/*`, the duplicate dialog | N slices |
| E1 | Endpoint, pure query builder, migration 067 | `Modules/Tasks/controller/everything.js`, `helpers/everythingQuery.js`, `Tasks/routes.js`, `migrations/067` | After N1 (shared `createSchema.js`) |
| E2 | Route, rail item, List mode, filter, group, sort | `views/Everything/*`, the router, the rail's nav items, a new store module | N4, F2 |
| E3 | Board and Table modes; saved views (#1262 built the saved views here, ahead of E4) | `views/Everything/*`, `controller/everythingViews.js` | After E2 |
| E4 | Measure at 10,000 tasks and fix | `views/Everything/*`, indexes | After the scale seed is merged |

One slice was added outside this table: folder row actions (rename, archive, delete), folders in the Trash and a `foldersChanged` live update (#1247).

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

## Appendix: the Everything endpoint contract

Copied from the descriptions of #1250 (E1) and #1260 (E2), with the field lists checked against `Modules/Tasks/helpers/everythingQuery.js` and `Modules/Tasks/controller/everything.js` on `beta` at build 720.

`POST /api/v2/tasks/everything`, under the guarded `/api/v2/tasks` prefix. The client sends data, never a pipeline. `Config/taskWritePermissions.js` lists the route as a read.

### Request

Every key is optional. An unknown key at any level is a 400.

| Key | Value | Default |
|---|---|---|
| `filter` | An object; its keys are in the next table | `{}` |
| `group` | `none`, `status`, `assignee`, `project`, `priority` or `dueDate` | `none` |
| `sort` | `{ by, dir }`. `by` is `updatedAt` or `DueDate`; `dir` is `asc` or `desc` | `updatedAt`, newest first. `DueDate` defaults to `asc` |
| `cursor` | The `nextCursor` of the page before | First page |
| `limit` | A whole number from 1 | 50; never more than 100 |
| `includeSubtasks` | `true` or `false` | `false`: top-level tasks only |
| `includeClosedProjects` | `true` or `false` | `false`. `true` adds back closed projects only |
| `timezone` | An IANA timezone name, used for due-date groups | `UTC` |

| `filter` key | Value |
|---|---|
| `status` | Up to 100 status names or whole-number keys. Names match exactly |
| `statusType` | Any of `default_active`, `active`, `done`, `close`, `default_close`. "Hide done" sends the two open ones |
| `assignee` | Up to 100 user ids, or `unassigned` |
| `priority` | Up to 100 priority names |
| `dueDate` | `{ from, to, none }`. `from` and `to` are ISO dates or times in milliseconds. `none: true` means "no due date" and cannot be combined with a range |
| `taskType` | Up to 100 task type names or keys |
| `tags` | Up to 100 tag ids |
| `search` | Text of at most 200 characters |
| `projectIds` | Up to 500 project ids. It can only narrow what the caller may read |

### What the server applies, whatever the client sends

- An active seat is required, and it is read before anything else.
- `ProjectID` within `visibleProjectIds(uid)`, for owners and admins too. A token narrowed to some projects reads only those.
- Other people's personal lists never appear, for any role. The caller's own does.
- Private sprints are hidden from people who are not on them. Owners and admins read past sprint privacy, as elsewhere.
- No chat rows, and no deleted or archived rows.
- Closed and archived projects are left out. Restricted projects are left out.
- A project drops out when the caller's role may not read its task list (`task.task_list`), judged by the project's own rules when it has them.

### Response

```
{ status: true, statusText: "Tasks fetched successfully.", data: { rows, groups, nextCursor, projects } }
```

| Key | Value |
|---|---|
| `rows` | Up to `limit` tasks. Each carries `_id`, `TaskName`, `TaskKey`, `status`, `statusKey`, `statusType`, `Task_Priority`, `AssigneeUserId`, `DueDate`, `startDate`, `ProjectID`, `sprintId`, `folderObjId`, `TaskType`, `TaskTypeKey`, `tagsArray`, `subTasks`, `ancestors`, `ParentTaskId`, `isParentTask`, `createdAt`, `updatedAt`. No custom field values |
| `groups` | On the first page: a list of `{ key, count }` for the chosen `group`, counted over the same match. `key` is `null` for "no value". With `group: none` it holds one entry with the total. On a later page (a `cursor` was sent) it is `null` |
| `nextCursor` | A string when more rows exist, otherwise `null` |
| `projects` | A map by project id, for the projects the rows name (and the group keys, when grouping by project). A project a row names carries the whole card: `_id`, `ProjectName`, `ProjectCode`, `projectIcon`, `taskStatusData`, `taskTypeCounts`, `apps`, `statusType`, `isPersonal` and `edit: { status, priority }`. A project that is only counted carries what a heading shows: `_id`, `ProjectName`, `ProjectCode`, `projectIcon`, `statusType` and `isPersonal` (E4: the whole cards were 538 kB with 301 projects) |

The page shows priority only where the project's `apps` include the Priority app, and opens a status or priority picker only where `edit` allows it.

### Paging and groups

- A keyset cursor over `(sortKey, _id)`. Rows with no value for the sort key (no due date) come last, in both directions.
- The cursor is signed. It is good only for the same company, person, filter, sort and the two `include` switches; anything else is a 400. The page size and the grouping may change between pages.
- Group counts come from a second `$group` query over the same match, on the first page only.
- A group reads its own rows by sending the group as a filter, each with its own cursor.
- The page folds due dates into Overdue, Today, This week, Later and No due date in the viewer's timezone, the same buckets the project List uses.

### Refusals

| Status | When | Body |
|---|---|---|
| 400 | An unknown key, a wrong type, a value out of range, or a cursor that does not fit the request | `{ status: false, statusText: "Request refused", message, field }` |
| 401 | No signed-in user | `{ status: false, statusText: "Unauthorized", message }` |
| 403 | No active seat in the company | `{ status: false, statusText: "Forbidden", message }` |

### Saved views (#1262)

`GET` and `POST /api/v2/tasks/everything/views`, `PATCH` and `DELETE /api/v2/tasks/everything/views/:id`. A view keeps a name and the page's settings (mode, filters, group, sort, toggles) and has no project. It belongs to the person who made it; a view that is not the caller's answers "not found". The settings pass a cleaner that refuses unknown keys.

### The contract test

`tests/everything-fixture.test.js` builds requests with the page's own request builder (`frontend/src/views/Everything/everythingRequest.js`), has the real handler answer them, and checks the result against `frontend/tests/fixtures/everythingResponses.json`. A request the server would refuse, or a changed response shape, fails there.
