# 046 M3 — A task in several lists, and Goals (Track A2)

From a read-only pass over the code at `origin/beta` (`7e4e395c`) on 2026-10-01. Two features: a task that lives in several lists, and Goals. No product code changes in this slice. Each slice below is one pull request unless it is marked L. File references are to `beta` at that date; check them before relying on a line number.

**What ClickUp offers.** `Tasks/active/034-end-to-end-qa-programme/findings/clickup-recheck-2026-09-30.md` lists both as open gaps ("a task in several lists", "Goals and OKRs") and says no more. The rest is general product knowledge, not measured here; another agent is measuring it:
- "Tasks in Multiple Lists": a task has one home list and can be added to others. It keeps its home list's statuses.
- "Goals": a goal has targets (number, true/false, currency, task), goal folders, and a progress rollup.
- Not confirmed: whether adding a task to a list in ClickUp shares the task with that list's people.

## Facts that are easy to get wrong
- **"Placement" is taken.** In this code it means a task's home fields: `PLACEMENT_FIELDS` (`Modules/Tasks/helpers/taskTreeRules.js`, `taskWriteFields.js`), `placementFrom`, `sprintPlacement.js`, `bulkPlacement.js`. The new thing is called **extra lists** everywhere: field `extraLists`, helper `taskExtraLists.js`, actions `addToList` and `removeFromList`.
- A "list" is a row in the `sprints` collection. Chat channels are sprints too, in a chat space that is not in the `projects` collection (`Modules/Sprints/helpers/chatAccess.js`).
- `tasks.sprintId` is required. A task always has exactly one home.
- The task schema is strict. A field not declared in `utils/mongo-handler/schema.js` is dropped on save.
- The create route accepts **every** declared task field except five: `CREATE_DATA_FIELDS` in `taskWriteFields.js` is built from `Object.keys(schema.tasks)`. A new field is writable by a client on create unless it is added to that exclusion.
- 174 server files and 176 frontend files read `sprintId` or `sprintArray`. Any model that changes what `sprintId` means touches all of them.
- `sprint.tasks` counts every live row with that home, subtasks included (`sprintCountChange`, `mongo_helper.js` `moveTaskFunction`). The sidebar, the List header and the Table read it from the sprint document, not from a query.
- The List sends its own Mongo pipeline to `POST /api/v1/task/find`. The server prepends a scope on the task's **home** `ProjectID` and home `sprintId` (`taskQueryGuard.js` `visibilityStage`). The match is built in one place: `sprintTaskMatch` in `frontend/src/store/ProjectData/taskQueries.js`. The Table builds its own (`actions.js`, about l.339).
- List groups by status match on `statusKey`, which is a number local to one project. Status **names** are what two projects can share.
- A task's manual order is one number per task (`groupByStatusIndex` and three more), not one per list.
- Comments, unread counters, history and time logs are keyed by the home project and home list (`Modules/Comments`, `Modules/notification-count/controller.js`, the `timesheet` block).
- A task event goes to the room `project_sprint_<ProjectID>_<sprintId>` with the **whole document** (`socket/controller/taskSocket.js`). The room was joined after a check on that list only (`socket/roomAccess.js` `canOpenSprintBoard`).
- A cross-project move rewrites `TaskKey` and converts the status through the old project's `convertStatus` map (`mongo_helper.js` `moveTaskFunction`).
- Duplicate copies the stored row with a spread (`mergeDuplicate.js` `duplicateTask`, `...parsedMap`). Any new task field is copied unless it is removed there.
- "Done" is defined three ways today: `'close'` (epics, burndown, `completion.js`), `'close'|'done'` (portfolio), and `['close','done','default_close']` (`Modules/Tasks/helpers/taskSignals.js` `CLOSED_STATUS_TYPES`, the agent registry).
- A permission key with no rule row answers `null`, which refuses members and guests (`Config/rulePermissions.js`, `Config/permissionGuard.js`). Owners and admins pass.
- Migrations `064` to `067` are used on `beta`. No open pull request adds one. The next free number is **068**. Check again before pushing.

## Part 1 — A task in several lists

### Model
A task keeps one **home**: today's `ProjectID`, `sprintId`, `sprintArray`, `folderObjId`. The home decides access, the task key, statuses, custom fields, comments, time and the subtask tree. Nothing about the home changes.

A task gains **extra lists**: other lists it also shows in. Two shapes were compared.

| | A. `extraLists` array on the task | B. `task_placements` collection |
|---|---|---|
| Shape | `extraLists: [{ projectId, sprintId, addedBy, addedAt }]`, ids only | one row per task and list, with the home project and list copied in for access checks |
| A list's rows | one query on tasks: `sprintId = L` or `extraLists.sprintId = L`. Sort, filter, group and page as today | two steps: ids from placements, then tasks by `_id $in`. The web's client pipeline cannot do it: `$lookup` targets are an allowlist in `taskQueryGuard.js` |
| Counts | `$facet` or `$group` on the same match | a join, or the copied home fields, which every home move must then update |
| Index | multikey `{ 'extraLists.sprintId': 1, deletedStatusKey: 1 }` | `{ sprintId: 1 }`, unique `{ taskId: 1, sprintId: 1 }` |
| Strict schema | one declared field | new collection: `Config/schemaType.js`, `Config/collections.js`, `createSchema.js` |
| Data migration | none: a missing field means no extra lists | none |
| Archive, delete, restore | nothing to write: the field rides on the row and readers already filter `deletedStatusKey` | every writer must also touch the second collection. There are no transactions here (`reconcileTaskCount.js` says why), so rows drift and need a repair job |
| Move the home | one `$pull` in the same update | a second write, plus the copied home fields |
| Convert to subtask | one `$unset` in the same update | a second write |
| Merge | nothing: the merged row is trashed with its field | a second write |
| Duplicate | must strip the field (the spread copies it) | nothing: not on the row |
| Three-level tree | same in both: only top-level tasks have extra lists | same |
| Readers that must change | only those that list one list's rows by membership | the same readers, each with a join |
| Who sees the list ids | anyone who can read the task sees the ids (never names) | only what the reader endpoint returns |

**Recommended: A.** One document, one write, no drift. Every existing reader keeps working without a change and keeps scoping by home. The cost is that the ids of a task's extra lists are visible to anyone who can read the task. Names are never stored on the task, so a rename needs no cascade. Task relations already keep the ids of related tasks on the row in the same way.

### Invariants
1. A task has exactly one home. The home is never among its extra lists.
2. Only a top-level task has extra lists (`ancestors` empty). A subtask shows in an extra list only nested under its parent, and never on its own.
3. An extra list is a live task list in a live project in the `projects` collection. Never a chat channel, never a personal list, never a Scrum sprint or backlog (`isScrum`, `isBacklog`).
4. A task whose home is a personal list, and a chat row (`mainChat`), have no extra lists.
5. At most 10 extra lists per task.
6. `extraLists` is written only by `addToList`, `removeFromList` and the cascades in `Modules/Tasks/helpers/taskExtraLists.js`. A value sent by a client on any other write is dropped.
7. **The access invariant:** see Access below.
8. A task is counted once, at its home, by every stored counter and every report.

### Statuses across projects
- The task keeps its home project's status, task type and custom field values. An extra list never changes them.
- Extra list in the **same project**: same statuses and fields. The row behaves like any other row.
- Extra list in **another project**: the row shows its own status name and colour.
  - Board: the card sits in the column with the same status **name**. A status with no column of that name goes to a last column, "Other statuses".
  - List grouped by status: the same rule, with a last group.
  - A status change from the extra list is allowed only when the task's home project has a status of that name. It writes the home project's status. This is the Everything Board's rule (`dropDecision` in `frontend/src/views/Everything/everythingRequest.js`, decision 6 of `design-hierarchy.md`). Reuse the function; do not write a second one.
  - The permission is judged in the home project. `projectsForRequest` in `Config/permissionGuard.js` already resolves a task's project from the stored row.
  - Columns for the other project's own custom fields are empty and read-only on such a row.

### Access
Two answers were weighed.

| | "Yes": an extra list gives its readers the task | "No": the home alone decides |
|---|---|---|
| What it is | an access grant made by whoever adds the task | a pointer, shown only to people who can already open the task |
| Existing readers | all 174 server files scope by home. Each must learn a second way in, and so must comments, files, time, history, the AI index and the socket rooms | none changes |
| A missed reader | a task opens without its comments, or a count is wrong | nothing: it keeps scoping by home |
| Who can widen access | anyone allowed to add a task to a list | nobody |
| Cost | a row can be invisible to some viewers of a list | counts for a list must be worked out per viewer |

**Recommended: "No".** Stated as the invariant:

> **A task is read only by people who can open its home. An extra list never gives access to a task. Anything shown for a list (rows, counts, events, exports) includes an extra task only for a viewer who passes the home check.**

The home check is the existing one: `canReadTask` (`Modules/Tasks/helpers/taskReadAccess.js`) for one task, and the Everything scope for a set (`visibleProjectIds`, `hiddenSprintIds`, `ownOrNotPersonal`, no chat rows, the home project's task list permission).

How each case falls out:

| Case | Result |
|---|---|
| Home in a private project the viewer is not on | the row is not there for them, and no count includes it |
| Home in a private sprint the viewer is not on | the same. Owners and admins read past sprint privacy, as elsewhere |
| Personal list | refused both ways by invariants 3 and 4. A personal list stays its owner's alone, for every role |
| Chat rows | never have extra lists and never appear in one |
| Token narrowed to some projects | sees an extra row only when the **home** project is in its list (`Config/tokenNarrowing.js` runs inside `visibleProjects`). Adding or removing needs both projects in the list |
| MCP grant | the tools read through `Modules/Mcp/visibility.js` `taskClause`, which is home-scoped. No new grant |
| Guest | a role like any other: the home rule decides |
| Viewer can open the home but not the extra list | sees the task. Does not see that list's name: names are resolved per viewer, and a list they cannot open is left out, with no "+1 more" |
| Public share of a list | home rows only. An anonymous viewer passes no home check (`Modules/PublicShares/publicRenderer.js`) |

Every reader that must apply the rule:

| # | Reader | How |
|---|---|---|
| 1 | Rows of a list, same project | `sprintTaskMatch` gains the `or`. The server's `visibilityStage` already prepends the home scope |
| 2 | Group counts of a list | the same match, so a count is the number of rows the viewer gets |
| 3 | Rows of a list, other projects | a server-built read on `everythingQuery.js` (`buildMatch` plus `extraLists.sprintId`). The caller must also be able to open the list |
| 4 | Names of a task's lists | a server read that returns only lists the viewer can open |
| 5 | Live events | the relay sends to an extra list's room only for sockets that pass the home check. Nothing at all goes to the others |
| 6 | Everything rows | one row per task; its lists resolved as in 4 |
| 7 | MCP `tasks.search` with `sprintId`, and `taskRows.js` | the `or` under `taskClause`; lists resolved as in 4 |
| 8 | Agents | the registry actions go through `Modules/Agents/access.js` on the task's home |
| 9 | History and notifications | text written for an add or remove names the list only when it is in the home project. Otherwise it says "a list in another project" |
| 10 | Stored counters, reports, exports, search, public shares, the AI index | unchanged: home only |

### Counts and reports

| Reader | Counts a task | Change |
|---|---|---|
| `sprint.tasks`, `archiveTaskCount` (sidebar, List header, Table, plan limit) | at home | none. It can never reveal a hidden extra row |
| List and Board group counts | home rows plus the extra rows this viewer can open | the match in reader 1 |
| Velocity, burndown, sprint insights, sprint hours, Scrum commitment | at home | none. Invariant 3 keeps extra lists out of Scrum sprints |
| Project dashboard, Home and dashboard cards, portfolio, epics | at home | none |
| Timesheets, billing, milestones, invoices | time is logged once on the task and billed to the home project | none |
| Workload | once per assignee | none |
| Custom reports (dimension `sprintId`), variance | at home | none |
| Export of a list | home rows | an "Also in" column later; not in M3 |
| Global search, the palette, advanced filter | one result, with the home path | none |
| Everything | one row, with all the lists the viewer can open | reader 6 |
| Automations and webhooks | a rule sees a task by its home only. A change to `extraLists` is a `task.updated` event | none |
| Trash | one row, at home | none |

### Writers

| Writer | Rule | Where |
|---|---|---|
| Add to a list | new action `addToList` on `PATCH /api/v2/tasks`. Needs `task.task_move` in the home project **and** in the list's project: the same entry shape as `moveTask`. The server reads the list from the database and applies invariants 1 to 5; the caller must be able to open the list | `Config/taskWritePermissions.js`, `taskWriteFields.js`, `taskMongo/` |
| Remove | `removeFromList`. Needs to read the task, and `task.task_move` in the home project **or** the list's project | the same |
| Bulk add | `bulkAddToList` on `POST /api/v2/tasks/bulk`, per task, with the skipped ones reported | `taskMongo/bulk.js` |
| Permission key | `task.task_move`, which exists in every company. A new key would refuse every existing member | — |
| Create | `extraLists` is excluded from `CREATE_DATA_FIELDS` | `taskWriteFields.js` |
| Move the home | if the new home is one of the extra lists, that entry is pulled in the same update. The others stay | `structural.js`, `bulk.js`, `mongo_helper.js`, `Modules/Agents/actions.js` (`task.sprint.move`), `sprintPlacement.js` |
| Archive, delete, restore | nothing to write | — |
| Duplicate | the copy has no extra lists | `mergeDuplicate.js`, `bulk.js`, `mongo_helper.js` `duplicateSubTaskFunction` |
| Convert to subtask | the task loses its extra lists, and the confirm says so | `structural.js`, `bulk.js` |
| Convert to task, convert to list | the new top-level tasks start with none | — |
| Merge | the kept task is unchanged. The merged task keeps its field in the trash and gets it back on restore | `mergeDuplicate.js` |
| List archived or trashed | entries stay. The list is not shown, so neither are they; a restore brings them back | — |
| Import, task templates, recurring tasks | never set the field. Assumed, not traced: each copies a stored or uploaded row | `Importers`, `TaskTemplates`, `RecurringTasks` |
| Agents and MCP | registry actions `task.list.add` and `task.list.remove`, undoable; MCP tools of the same names behind `MCP_TOOLS_MANAGE` | `Modules/Agents/registry.js`, `actions.js`, `Modules/Mcp/manageTools.js`, `scopes.js` |

### Web
- **Add.** Three places, all opening the list picker the Move sidebar already has (`ConvertToSubTaskSidebar`):
  - task panel: "Add to another list" next to Move (`TaskDetailAction.vue`);
  - row menu: a new item after `move` in `TASK_MENU` (`frontend/src/views/Projects/composables/taskMenu.js`, `useListRowMenu.js`);
  - bulk bar: the sprint control gains "Add to list" (`ListBulkBar.vue`, rules in `bulkPlacement.js`).
- **Breadcrumb.** Unchanged: it is the home path. Under it, a row of "Also in" chips, one per list the viewer can open, each with a remove button when allowed.
- **Marker.** In an extra list the row shows a small link icon with the home list in its tooltip, and the project's colour dot when the home is another project. In the home list the row shows "+2 lists".
- **Row menu in an extra list.** "Remove from this list" is added. Move still moves the home.
- **Store.** Two row objects, one per list bucket. The store is already keyed `tasks[projectId][sprintId]`, and one list room is joined at a time. Three things change:
  - the rule that evicts a row when its `sprintId` changes (`mutations.js`, about l.292) keeps the row while the list is still in `extraLists`;
  - a person's own edit is pushed to the bucket being viewed, not to the bucket named by the row's own `ProjectID` and `sprintId` (`useListInlineEdit.js`, `TaskDetailPanel.vue`);
  - subtasks of an extra row are read by the parent's home list, since a descendant always has its root's home.
- **Drag and drop in an extra list.** A drop on another group writes the field (status, assignee, priority, due date), under the rules above. The manual position is not written: the index is per task, and `POST /api/v1/taskIndex` would reorder the home list.
- **Opening the panel.** The opener passes the row's home project, not the project being viewed. The unread key uses the home ids.
- **Other projects.** Rows from another project are shown with the Everything row parts and that endpoint's project cards (statuses, edit rights). In the List they sit in a section at the foot, "From other projects"; on the Board they follow the status-name rule.
- **Live updates.** Reader 5. A removal reaches the room it left, so the row goes away.

### What breaks silently if missed
- **High:** `extraLists` left in `CREATE_DATA_FIELDS`. A client could create a task already placed in any list, past every check.
- **High:** the socket relay fanning out to an extra list's room without the per-socket home check. The whole task document would reach people who cannot open it.
- **High:** any reader that shows a list's rows by `extraLists` without the home scope. The two planned ones get it from `visibilityStage` and `everythingQuery.js`; a third written by hand would not.
- **High:** a stored counter that includes extra rows. It would be the same number for every viewer.
- **Medium:** duplicate copies the field; the copy appears in lists nobody added it to.
- **Medium:** a home move into a list that is already an extra list leaves the task in that list twice.
- **Medium:** history or notification text that names a list in another project.
- **Medium:** the store's eviction rule drops an extra row on any home move; own edits go to a bucket that is not loaded and do nothing.
- **Medium:** a manual reorder in an extra list rewrites the home list's order.
- **Medium:** the panel opened with the viewed project instead of the home project shows the wrong statuses and fields.
- **Low:** Gantt, Calendar and Mind map were not traced. Assumed to read the same store buckets.

### Migration
- No data migration: a missing `extraLists` reads as none.
- One index migration, `068-task-extra-lists-index`, in the pattern of `067-everything-indexes.js`: `createIndexes` per company, since an index declared in `createSchema.js` is built only for a workspace made afterwards. Without it the reader scans the tasks collection.

## Part 2 — Goals

### What exists, and what not to duplicate

| Exists | What it is | Goals and it |
|---|---|---|
| Epics (`Modules/Epics`, `epicId` on tasks) | a task group inside one project, with done/total worked out on read | a goal does not replace it. A "tasks done" target may later take an epic as a source |
| Portfolio (`Modules/Portfolio`) | a named set of projects with a rollup and a cached AI digest | reuse its maths (`helpers/portfolioRules.js` `progressPct`) and its digest cache idea; do not add a second rollup of projects |
| Milestones (`Modules/Milestone`) | billing: amounts, refunds, sign-off | not a goal. A currency target is a plain amount with a code from `currency_list` |
| Sprint goal (`sprints.goal`) | free text on a Scrum sprint | unchanged |
| Dashboards (`Modules/UserDashboard`) | layout is shared; each card recomputes for the viewer | one new card; no new sharing model |
| Home cards (`homeCards.js`, `homeCardsRules.js`) | a registry and a server allow-list | one new card |
| Notifications | need a project id today; page mentions are the precedent without one (`Modules/Pages/helpers/pageMentionNotices.js`, `Modules/notification/docNotices.js`) | follow that precedent |
| MCP tools and the agent registry | each tool names a registry action and a scope | three new tools |

Nothing goal-like exists beyond these: no OKR, key result or target model was found.

### Model
One new collection, `goals`. Targets are embedded: a goal is read and shown whole, and a goal has at most 20 targets.

- **Goal:** `name`, `description`, `ownerUserId`, `periodStart`, `periodEnd`, `visibility` (`workspace`, `people`, `private`), `sharedWith` (user ids), `color`, `progressPct` (stored rollup), `targets`, `createdBy`, `deletedStatusKey`.
- **Target:** `id`, `name`, `kind`, `weight` (default 1), `progressPct`, `reachedAt`, and by kind:

| Kind | Fields | Progress |
|---|---|---|
| `number` | `start`, `target`, `current`, `unit` | `(current − start) / (target − start)`, held between 0 and 1. Works downwards too |
| `currency` | the same, plus `currencyCode` | the same. No conversion between currencies |
| `boolean` | `done` | 0 or 1 |
| `tasks` | `sources: { taskIds, sprintIds }`, and the stored `counted: { done, total, at }`, `dirty` | `done / total` |

- **Rollup:** the goal's progress is the weighted mean of its targets' progress. Equal weights unless set.
- **"Tasks done":** a list source counts the top-level tasks whose **home** is that list, as the reports do. A task source counts that task, whatever its level. Done means `CLOSED_STATUS_TYPES` from `taskSignals.js`: one shared definition, not a fourth.
- **Folders or flat:** flat, grouped on the page by period. A folder field can be added later without a migration.
- **No new permission key in M3.** Creating a goal needs an active seat that is not a guest. A key can come later with a migration that back-fills role entries (the pattern of `migrations/011-member-default-rules.js`).

### Access
Who sees a goal:

| Visibility | Readers | Editors |
|---|---|---|
| `private` | the owner alone, for every role, like a personal list | the owner |
| `people` | the owner and `sharedWith` | the owner |
| `workspace` | every active member who is not a guest | the owner, owners and admins |

A guest sees a goal only when it is shared with them by name.

A "tasks done" number is information about tasks. One stored number is shown to every reader of the goal, so the rule is the one the AI replies use for a shared thread (`Modules/AI/publicSources.js`: "a reply everyone in a thread reads may only draw on what every one of them can open"):

> **A goal's stored progress is built only from tasks that every reader of the goal can open.**

- `private`: any list or task the owner can open.
- `people`: only lists and tasks in projects every reader can open (`sharedProjects`), outside private sprints. Past 50 readers (`READER_CAP`) the goal is treated as `workspace`.
- `workspace`: only lists and tasks in public projects, outside private sprints.
- Never a personal list (except the owner's own, on a private goal). Never a chat row.
- Checked when a source is added: a source that does not qualify is refused, with the reason and the two ways out (make the goal narrower, or use a number target).
- Checked again on every count: a source that no longer qualifies (the project became private) is left out of the number and flagged to the owner alone.
- Widening a goal's visibility re-checks its sources and names the ones that would drop out before saving.
- Linking a task or a list needs read access to it.
- The task list under a target is read per viewer through the Everything scope. With the rule above it is the same set; this is a second check, not the first.
- A token narrowed to some projects reads a goal only when it has task sources and all of them are inside the token's projects. A goal with no task source is company-wide and is not given to a narrowed token: the rule `Modules/Mcp/visibility.js` applies to pages outside every project.
- A dashboard or Home card that names a goal the viewer cannot see shows an empty state, without the goal's name.

Dashboards avoid the question differently: every card recomputes for the viewer. That does not fit a goal. Its progress would differ per person, and "62%" has to mean one thing.

### Computation
- **Where:** on the server, in `Modules/Goals`. The client never counts.
- **Stored, not live:** each `tasks` target stores `counted` and a `dirty` flag. A read returns the stored numbers at once.
- **Recount:** one aggregation per target: match on `sprintId $in` or `_id $in`, live, top-level for lists; group to `total` and `done`. Always a full recount, never `$inc`: the epic counters drifted that way (the comment in `Modules/Epics/controller.js`).
- **When:** on a read, if the target is dirty or its count is older than 10 minutes. At most once per target every 30 seconds, and one at a time.
- **What marks it dirty:** a listener on `event/domainEventBus.js` for `task.created`, `task.status_changed`, `task.sprint_changed`, and a `task.updated` whose `changedFields` hold `deletedStatusKey` (archive, delete, restore). The envelope carries the task id and its home list. The listener finds targets that name either and sets the flag. Events for the same list within 5 seconds are folded into one write.
- **A missed event** is healed by the 10-minute rule.
- **At 10,000 tasks:** one pass over one list on `{ sprintId: 1, deletedStatusKey: 1 }`, which exists. Not measured. Slice G2 measures it on the scale seed and adds `statusType` to an index only if a recount takes over 100 ms.
- **While it loads:** the page shows a skeleton on first open, then the stored numbers with their age. If a recount is running the bar keeps its old value and a small "updating" mark; the client asks once more after 2 seconds. No spinner over a number that is already known.
- **Live:** refetch on focus and after the person's own edits, as Everything does. A live room can come later.

### Surfaces
- **Goals page:** `frontend/src/views/Goals/`, route `/:cid/goals`, a rail item in `Shell/navItems.js`, its own store module. Goals grouped by period, a "mine" filter, a goal view with its targets, an editor.
- **Home:** a "My goals" card: goals the person owns or is named on. Registered in `homeCards.js` and in `HOME_CARD_IDS` (`Modules/Users/helpers/homeCardsRules.js`), or the server drops it on save.
- **Dashboard card:** one entry in `plugins/dashboard/cardCatalog.js` and `cardRegistry.js`, with a new "goal" setting type. Its endpoint applies the goal's access for the viewer.
- **Task panel:** next to the epic picker (`TaskDetailTab.vue`): the targets this task counts for, among goals the viewer can see, and "Link to a goal". A list's menu gains "Link list to a goal".
- **Notifications:** one when a target reaches 100% and one when the goal does, to the owner and `sharedWith` only. `reachedAt` makes it fire once per crossing. New keys in `Config/notificationKey.js`; the settings item is added the way `docNotices.js` adds one.
- **MCP:** `goals.list` and `goal.get` (read, filtered), `goal.target.set` (write: the current value of a number, currency or true/false target). A `tasks` target cannot be set by hand. Each names an action in `Modules/Agents/registry.js` and a scope in `Modules/Mcp/scopes.js`.
- **AI summary:** on request only. A "Summarise" button; never on open.
  - Built from the goal's own name, dates, targets and numbers. No task text, so every reader of the goal may read it, and one kept summary serves them all.
  - Kept with a hash of what it was built from. The page shows it with its age, and says "numbers have changed since" when the hash differs. Only the button asks the model again.
  - This is the kept-answer pattern proposed for the dashboard Ask card in pull request #1266 (open at the time of writing), and the idea behind the portfolio digest's cache key. If #1266 merges first, reuse its store shape.

### Migration
None. `goals` is a new collection and is small; no index is needed for correctness. A missing goal means none.

## Decisions proposed
Each has a recommendation. All are reversible unless marked.

**A task in several lists**
1. Shape: an `extraLists` array on the task, not a second collection. *Reversible with a data migration; decide before L1.*
2. Access: the home alone decides. An extra list gives nobody the task.
3. The ids of a task's extra lists are visible to anyone who can read the task. Names are not.
4. Only top-level tasks have extra lists. Subtasks show nested under their parent.
5. Not into or out of personal lists; not for chat rows; not into Scrum sprints or backlogs. The Scrum rule is the one most likely to be asked for later.
6. At most 10 extra lists per task.
7. Reuse `task.task_move`, in both projects to add, in either to remove.
8. Every stored counter and report counts a task once, at its home.
9. In another project a status change is allowed only when the home project has a status of that name.
10. Duplicate, merge and convert to subtask do not carry extra lists.
11. A manual position is not kept per list.
12. Automations see a task by its home only. No "added to list" trigger in M3.
13. The web ships same-project extra lists first (W2), other projects after (W3). The server allows both from L2.
14. Export of a list holds home rows only.

**Goals**
15. Targets are embedded in the goal; at most 20.
16. Flat list grouped by period; no goal folders in M3.
17. Visibility: workspace, people, private. A private goal is its owner's alone, for every role.
18. A goal's number is built only from tasks every reader can open; private sprints are left out of shared goals altogether.
19. No new permission key in M3. Guests see only goals shared with them by name.
20. Done means `CLOSED_STATUS_TYPES`. A list source counts top-level tasks at home.
21. Progress is stored and recounted on read when dirty; never `$inc`.
22. No currency conversion.
23. The AI summary is on request, kept, and built from numbers only.
24. Notifications go to the owner and the named people, not to the whole workspace.

## Slices, in order
Server before web. Sizes are rough: S, M, or L. An L slice may need to be split in two when it is built, as the plan allows.

| # | Slice | Owns | Size | Can run alongside |
|---|---|---|---|---|
| L1 | `extraLists` in the schema; the index and migration 068; the pure rules; the create exclusion | `schema.js` (tasks block), `createSchema.js`, `Modules/Tasks/helpers/taskExtraLists.js`, `taskWriteFields.js` (`CREATE_DATA_FIELDS`), `migrations/068` | S | Not with G1 (same two schema files) |
| L2 | `addToList`, `removeFromList`, `bulkAddToList`; history text; the names read | `Config/taskWritePermissions.js`, `taskWriteFields.js`, a new `taskMongo/extraLists.js`, `Tasks/routes.js` | M | G1, G2 |
| L3 | Cascades in the existing writers: move, convert, duplicate, merge, the agent move | `structural.js`, `bulk.js`, `mergeDuplicate.js`, `mongo_helper.js`, `sprintPlacement.js`, `Modules/Agents/actions.js` | M | After the hierarchy N slices and #1268 are merged: same files |
| L4 | The server-built read of a list's rows from other projects; Everything rows carry their lists; MCP `tasks.search` by list | `Modules/Tasks/controller/`, `everythingQuery.js`, `Modules/Mcp/manageTools.js`, `taskRows.js` | M | L3, L5 |
| L5 | The relay to extra-list rooms, with the per-socket home check | `socket/controller/taskSocket.js`, `socket/roomAccess.js` | S–M | L3, L4 |
| L6 | Agent actions and MCP tools to add and remove | `Modules/Agents/registry.js`, `actions.js`, `Modules/Mcp/manageTools.js`, `scopes.js` | S | After L2 |
| W1 | Task panel: "Also in" chips, add and remove | `TaskDetailPanel.vue`, `TaskDetailAction.vue`, `ConvertToSubTaskSidebar/*`, locales | M | After L2; with L3 to L6 |
| W2 | List, Board and Table show same-project extra rows; the store rules; row menu; bulk bar; drag rule | `store/ProjectData/*`, `ListView/*`, `Kanban/*`, `TableView/*`, `taskMenu.js` | L | After L5; not with another store slice |
| W3 | Rows from other projects in List and Board | `ListView/*`, `Kanban/*`, shared Everything row parts | M | After W2 and L4 |
| W4 | Everything and search show a task's lists | `views/Everything/*`, the palette | S | After L4 |
| G1 | `goals` schema, module, routes, access, the progress maths for number, currency and true/false | `schema.js` (new block), `Config/schemaType.js`, `Config/collections.js`, `createSchema.js`, `Modules/Goals/*`, `Config/setMiddleware.js` | M | Not with L1 |
| G2 | "Tasks done": the source rule, the recount, the dirty listener; measured at 10,000 tasks | `Modules/Goals/goalSources.js`, `goalCounts.js`, a listener on the event bus | M | L2 to L6 |
| G3 | Goals page, route, rail item, store | `views/Goals/*`, the router, `navItems.js`, locales | L | After G1; with G2 |
| G4 | Home card and dashboard card | `homeCards.js`, `homeCardsRules.js`, `cardCatalog.js`, `cardRegistry.js`, one endpoint | S–M | After G2 |
| G5 | Link a task or a list to a target | `TaskDetailTab.vue`, the list menu | S–M | After G3; not with W1 (same panel) |
| G6 | Notifications when a target or goal is reached | `Config/notificationKey.js`, `Modules/Goals`, the settings item | S | After G2 |
| G7 | MCP tools and registry actions | `Modules/Agents/registry.js`, `Modules/Mcp/*` | S | After G2; not with L6 (same files) |
| G8 | AI summary on request, kept | `Modules/Goals/goalSummary.js`, the goal view | S | After G3 |

## Tests to write first

**Access tests, by name.** These are the ones that must exist before the code.
- `tests/task-extra-lists-access.test.js` (L2, L4), in the style of `tests/everything-endpoint.test.js`:
  - a member who cannot open the home project does not get the row in the extra list, and the group count does not include it;
  - the same for a home in a private sprint the member is not on; an owner does get it;
  - a task in a personal list cannot be added anywhere, and nothing can be added to a personal list, for an owner too;
  - a chat row cannot be added; a chat channel cannot be a target;
  - a token narrowed to the extra list's project does not get a row whose home is outside it, and cannot add or remove across the boundary;
  - the names read leaves out a list the viewer cannot open and gives no count of what it left out;
  - adding needs `task.task_move` in both projects; a project with its own rules is judged by its own.
- `tests/task-extra-lists-create.test.js` (L1): a create body carrying `extraLists` saves a task with none. Add the case to `tests/fixtures/taskWriteBodies.js` and to `tests/permission-task-write-keys.test.js`.
- `tests/task-find-extra-lists.test.js` (L2), beside `tests/task-query-guard.test.js`: the List's new match, run through the guard as `tests/list-group-counts-query.test.js` does, returns no row outside the caller's scope.
- `tests/socket-extra-list-relay.test.js` (L5), beside `tests/socket-room-access.test.js`: a socket in the extra list's room that cannot open the home receives nothing; one that can receives the update; a removal reaches the room it left.
- `tests/mcp-extra-lists.test.js` (L4, L6), beside `tests/conventions/mcp-tool-visibility.test.js`: `tasks.search` by list stays inside `taskClause`.
- `tests/goal-access.test.js` (G1): private is the owner's alone, for an owner or admin too; `people` is the named people; a guest sees only what is shared by name; a narrowed token gets no goal without task sources.
- `tests/goal-sources.test.js` (G2):
  - a private project's list is refused on a workspace goal and accepted on a private one;
  - a private sprint is refused on any shared goal;
  - a personal list is refused unless it is the owner's own on a private goal;
  - a source that stops qualifying is left out of the next count and flagged to the owner only;
  - widening visibility names the sources that would drop;
  - a reader's task list under a target never holds a task they cannot open.

**The rest.**
- **L1:** the pure rules (home never among the extras, the cap, top-level only, the refused list kinds); the migration plans nothing on a second run.
- **L3:** a move into an extra list leaves one entry less; duplicate, merge and convert carry none; the sprint counters do not change on add or remove. Extend `tests/task-tree-cascade-writers.test.js` and `tests/task-tree-other-writers.test.js`.
- **L4:** `tests/everything-query.test.js` gains the list clause.
- **W1 to W4:** the eviction rule, the own-edit bucket, the subtask read by the parent's home, the drag rule; `dropDecision` reused, not copied. Extend `listSubtaskRows.spec.js`, `listBulkPlacement.spec.js`, the task panel spec.
- **G1:** progress maths (downward targets, zero range, weights, the rollup); at most 20 targets.
- **G2:** the count matches a hand count; a status change marks the target dirty; two reads inside 30 seconds recount once; a count older than 10 minutes is redone.
- **G4:** a card for a goal the viewer cannot see shows the empty state with no name. `homeCardsRules` accepts the new id.
- **G6:** one notification per crossing; none on a recount that stays at 100%.
- **G8:** opening the goal makes no model call; the button makes one; an unchanged goal shows the kept text.
- **Conventions that apply to all:** tenant scoping, route guard coverage, the v2 guard, MCP tool scopes and annotations, i18n, unused components, naming.

## Risks
- **The home-only rule surprises people.** Someone adds a task to a shared list and a colleague cannot see it. The add dialog must say who will see it: "People who can open <home project> will see this task here."
- **Extra-list ids on the row** (decision 3). If that is not acceptable, shape B is the answer and L1 to L4 grow by about half.
- **W2 is the largest slice** and touches the store the hierarchy slices also changed. It should not start until those are merged and used in the running app.
- **Rows from other projects** carry statuses, fields and permissions of a project the page did not load. W3 depends on the Everything parts being reusable outside that page; not verified.
- **The dirty listener** depends on every task writer emitting through the event bus. Bulk writers and the `updateMany` cascades were not all traced; the 10-minute recount is the safety net.
- **Shared goals over private work** are refused by design. Teams that keep everything in private projects will meet the refusal often; the message must offer the number target.
- **`workspace` goals and roles without the task list permission:** a public project's count is shown to a member whose role cannot list its tasks. Accepted for M3 and recorded here; narrowing it needs the per-project rule Everything applies.

## What was read, and what is assumed
- **Read:** the files named in the brief for tasks, access, the Everything endpoint and the socket relay; `Config/taskWritePermissions.js`, `permissionGuard.js`, `projectAccess.js`, `tokenNarrowing.js`; `Modules/Mcp/visibility.js`; `Modules/TimeSheet/helpers/timeScope.js`; `Modules/Epics/controller.js`; `Modules/Portfolio/controller.js`; the dashboard sharing code in `Modules/UserDashboard/controller.js`; `frontend/src/store/ProjectData/taskQueries.js` and the socket handlers in `actions.js`; the description of pull request #1266.
- **Surveyed by search, not read in full:** reports, custom reports, exports, global search, automations, webhooks, agents, the List, Board and Table components, the task panel, Home and dashboard card registries, notifications, the MCP tool list.
- **Assumed:** Gantt, Calendar and Mind map read the same store buckets; import, templates and recurring tasks copy rows in a way that could carry a new field; every task writer reaches the event bus; ClickUp's behaviour as described at the top.
- **Not measured:** the multikey index at 10,000 tasks; a goal recount at 10,000 tasks.
