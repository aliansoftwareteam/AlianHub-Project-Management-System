# 046 — Follow-ups and hand checks

State at build 720, 2026-10-01. The owner's local server runs build 705, so anything merged after #1242 is not in it yet.

How to read this file:
- **By hand** lines are checks to do in the running app after the next rebuild. Use the QA Sandbox project.
- **Left** lines are things a PR did not do, or a defect found by use.
- "check" marks a line that a later PR may have fixed; confirm before working on it.
- Items that a later merged PR fixed are not listed. Access detail is not listed; see the private notes.
- Items from tasks 044 and 045 that are still open are included, with the PR that left them.

## List
**By hand**
- #1232: the bulk bar between 800 and 1100 px, also in Table and Board (not tested in pass 3).
- #1246: Scale Test project: the List opens with no pause; a 165-task group pages by scroll and by "Load more"; the header stays at 165.
- #1246: Board column paging still works (it shares the store action).
- #1246: the new group select-all checkbox shifts the group name by about 28 px.
- #1254: add a subtask to a subtask from the List; open both levels and edit the sub-subtask (status, assignee, due date).
- #1254: convert a sub-subtask to a task and back from a second tab; select a task, archive, undo.
- #1254: the "DONE BY" header sits on the line of the others; the Tags column is narrow when no row has a tag and widens when one appears.
- #1212: List row menu: convert, merge, restore.

**Left**
- Pass 3: with four custom field columns on, at 1440 px with the project tree open, the Task column shrinks to about 32 px and the names vanish; the List does not scroll sideways. A fix is running.
- #1254: a refused create from the List shows nothing until #1240 merges.
- #1254: a parent with more than 35 subtasks shows the first 35.
- #1254: the List no longer ticks loaded subtasks when a task is selected; Table and Board still do.
- #1254: the legacy `Task.vue` treats a non-empty `subtaskArray` as loaded. N5b is running.
- #1246: the List sorts on the client, so a partly loaded group sorts only its loaded rows.
- #1246: the List's own optimistic edits do not move header counts when grouped by assignee or custom field.
- #1246: Gantt, Timeline, Canvas, Mind map, Map and Whiteboard still load the next page on each mount.
- #1232: the legacy DropDown panel is white in dark mode everywhere.
- #1248: the List has its own inline copy of the task menu markup; adopt `TaskMenuPopup`.
- #1235: the bulk bar's Sprint menu lists lists by name only, with no folder.
- #1212: undo of an archived-row delete writes two history entries.
- #1212: `TaskQuickMenu` and `TaskDetailAction` still have their own menu lists.
- #1200: ticking all subtasks no longer selects the parent; the done tick on subtask rows became the status picker (two clicks).
- #1186: a selection persists unseen on tabs with no bar (Gantt); the convert picker is titled "Move task"; `bulkDelete` has no web caller.
- #1191: dropping a task with several labels onto another dropdown group replaces all its labels.

## Board
**By hand**
- #1248: at 390 px the card menu is the fixed popup, not a bottom sheet.
- #1248: the header at 1440, 1024 and 390 px (a two-row header is possible).
- #1248: the Move, Duplicate, Create and Queue sidebars in dark, including Duplicate's legacy checkboxes.
- #1248: the subtask create form in a 262 px card; a click on a card's due date opens the picker, not the task.
- #1249: open Table and Board with the console open: no 400 on the task order save.
- #1249: group by assignee and drag a task within one person and between people.

**Left**
- #1248: legacy colour classes are overridden inside the sidebar, not removed.
- #1248: `watcherFun` is referenced but not defined in `ConvertToSubTaskSidebar.vue` (a Vue warning). Tied to the #1255 item under "Tasks and subtasks".
- #1249: a person's group now matches tasks whose assignees contain them (before: exactly them).
- #1191: a Board sort leaves drag on; a Board card logs a `groupValue` prop type warning.
- #1220: Board first cards: p95 1.8 s against a 1.5 s budget.

## Table
**By hand**
- #1212: compact density in Table, and saving it (not tested in pass 2).
- #1255 (in review): rows that arrive after the Table opened get an order.

**Left**
- #1212: the Table has no row menu.
- #1191: no assignee sort in Table.
- #1246: the Table has its own paging and its header shows the loaded count.
- #1249: the Table repairs task order only on mount. Fixed in #1255 (in review).
- #1249: under a due-date group every repaired task gets position 0. Fixed in #1255 (in review).

## Task panel
**By hand**
- #1252, in dark: Priority and Task Planning values; custom field rows and the dropdown chip; one value size and left edge with several assignees.
- #1252, in dark: the Add Task Planning sidebar; the Linked Docs, Epics and Custom Field action buttons.
- #1252: native date inputs at `/time/log` and in Add time; legacy pages, sidebars, menus and modals still look right in dark; public and share pages; 390 px.
- #1240 (in review): the breadcrumb with long names; the phone ancestor row; the "2/5" child count; the picker note when subtasks fill two levels; the create row keeps the typed name after a refusal.
- #1216: task panel row alignment for the four new field types.

**Left**
- #1240: `taskDepth.js` restates the server rule. Replace it with the `@taskTreeRules` alias from #1254 once #1240 merges.
- #1240: the panel lists only the first 35 children.
- #1245: the convert picker should handle the `PARENT_IS_DESCENDANT` refusal (check in #1240).
- #1230: the panel still polls agent runs every 15 seconds while a run is live, and does not pause in a hidden tab.
- #1252: mono time figures look heavier at the new row font size.
- #1252: a white card inside a redesigned page may get dark native controls in dark mode.
- #1215: the properties column overflowed by 9 px (check after #1252); variant C wraps the "Task Planning" and "Remaining Hours" labels.
- Pass 3: a date custom field shows its value as the input's placeholder, not its value (#1227).
- Pass 3: the custom field sidebar: the dialog is labelled "Title", its close control is an image and not a button, and Cancel returns to the type list.
- Pass 3: the people picker's avatar `alt` is a stray string (#1216); the new field types' descriptions start in lower case.
- Pass 3: a task type image request answers 404 each time a task panel opens. A fix is running.
- Pass 3, dark: the legacy sidebars (Create Channel, List Of User, Select Priorities, Select Task Status, Convert to List, Custom Field) are white; the phone custom-field block is white; the custom field sidebar's legend cannot be read. A fix is running (dark batch 2).

## Tasks and subtasks
**By hand**
- #1255 (in review): move, duplicate, convert to task and convert to list from the sidebar, the List row menu and the bulk bar.
- #1249: move, duplicate and convert a task from the sidebar. If any answers "Update operators are not accepted", fix it the way #1249 did.

**Left**
- #1226: the import's `adjusted` list is not passed through `Importers/controller.js`. N6 is running.
- #1226: the template skip uses `canNest` without the stale-chain guard (check now that migration 066 repairs chains).
- #1238: a restore after a delete now brings the subtasks back (a behaviour change).
- #1238: a move of one subtask alone is refused (`SUBTASK_MOVES_WITH_PARENT`).
- #1238: how the web store handles an update event for a carried subtask is unchecked (check; #1254 rewrote the store's placement).
- #1245: merging a task into one of its own subtasks leaves that subtask under the deleted task.
- #1245: a held row that leaves a tree keeps its state with no stamp.
- #1245: `verify()` for migration 066 is a re-plan check; watch it in e2e.
- #1245: other locales hold English for the reworded confirm text.
- #1255: Duplicate's chosen assignees and watchers never reach the request, so a duplicate always gets the task's own.
- #1255: older tasks may hold more than a placement in `sprintArray` from earlier moves; no clean-up exists.

## Views
**By hand**
- #1211: add a view from a template in another project and see the "left out" toast (not tested in pass 2).
- #1211: a private view made from a template shows in the tab bar without a reload; the template list updates live for a second session.
- #1251: the lock on private tabs and their order (a private copy sits after its shared view); rename in the tab.
- #1251: Add view shows templates first and selects the new tab; pin and delete on a private tab leave the shared view alone.
- #1251: the Group by and Filters popups in dark; the phone view switcher lists private views; 390 px.

**Left**
- #1211: task type and tag filters are not fitted when a template is applied; status filters compare keys across projects.
- #1211, #1251: someone with only `project.project_details` has no view menu entry.
- #1211: phones cannot save a template.
- #1211: no scrim token exists (dialog backdrops use an rgba literal). Add `--scrim` in B1.
- #1251: "Save for me" on a shared view can overwrite a private view of the same kind that was made from a template.
- #1251: black CSS arrow images in the Filters popup on phones in dark.

## Docs
**By hand**
- #1231: the History panel as a phone sheet, and in dark.
- #1237: create a public link, copy it, switch the two checkboxes, delete it; with requests on, accept and reject one. In light, dark and at 390 px.
- #1237: a team-only member of a private project sees the "New doc" entry.
- #1242: a doc row in the palette opens in a new tab and as a copied link; a recent doc; the old `/pages?page=<id>` address redirects; a person row opens Members filtered to them.
- #1198: on real MongoDB, the notification settings' Docs section gets the two comment items added to an existing section.
- #1252: the Docs title, meta row and first block start on one gutter.

**Left**
- #1231: a restore asks through the browser's own confirm dialog.
- #1231: no live refresh of other open editors after a restore (none for a normal save either; it belongs with presence).
- #1231: moved blocks show as removed and added; the list is capped at 300.
- #1229: the `useFocusTrap` fallback now affects all 12 dialogs when the opener is gone.
- #1237: the native date icon in the public link dialog was dark on dark in pass 3 (check after #1252).
- #1237: lower `PublicShareModal`'s entry in `scripts/style-baseline.json` when #1210 is regenerated.
- #1242: `Inbox.vue`, `PagesSpace.vue`, `useMentionLinks.js` and `AskAnswer.vue` still build the doc route by hand; move them to `docRoute`.
- #1196: public share pages do not show uploaded doc images; an image stays in storage when its block is never saved; Editor.js drop and paste routing is untested.
- #1198: doc comments have no assignment, reactions or attachments; they keep their own mention input instead of `DocMentionPicker`; 500 comments per doc.

## Folders
**By hand**
- #1235: archive and restore; an orphaned subfolder; the pickers; the refusal toast; dark and 390 px; the keyboard; permissions (not tested in pass 3).
- #1235: the header crumb on a list inside a subfolder (pass 3 could not put a list in a folder; #1265 makes it possible).
- #1235: click through lists in folders; the selected project must not jump (a new computed over `sprintsfolders` in `Projects.vue`).
- #1247: inline rename; the archive and delete dialogs with their counts; the undo toasts; leaving an archived folder's page.
- #1247: Trash > Folders and restore; the live update in a second tab; the task breadcrumb after a rename; the menu position on the last rows.

**Left**
- Pass 3: the web app has no way to create a list inside a folder, and an empty folder page shows the generic "No tasks to show here" text. Both are fixed in #1265 (in review).
- Pass 3: Convert to List shows folder names in title case.
- #1235: the task panel crumb names the parent folder only when the open project's folders are in the store. #1257 added `parentFolder` to the task read; use it after #1240 merges.
- #1235: Convert to List offers live folders only; the duplicate-name check is among siblings only.
- #1247: restoring a folder from the Trash brings back every trashed task in its lists, including ones deleted on their own earlier.
- #1247: `foldersChanged` goes to the whole company (it carries only the fact of a change).
- #1247: chat categories cannot be restored from the Trash.
- #1247: leaving an archived folder's page works only while the tree panel is mounted.

## Projects
**By hand**
- #1257: the menu entry lines up with its legacy neighbours; the list row menu; the dialog at 390 px and in dark.
- #1257: a copy with a folder, a subfolder, lists and a view filter that names a list; three-level tasks with fresh keys.
- #1257: a copy of more than 300 tasks shows progress; an automation arrives switched off; a project with its own permissions.

**Left**
- #1257: milestones, epics, recurring tasks, forms, docs and attachments are not copied. Offer them as options later.
- #1257: no socket event for the new project (project create emits none either).
- Found by the #1257 work: a custom field's project list is saved as a whole list from the client, and changes are not broadcast, so a stale tab can drop a project from a field on its next edit. The field API needs add and remove, and a change event.
- Found by the #1257 work: a field cannot be deleted for one project; the only delete is the workspace-level off switch.

## Fields
**By hand**
- #1216: a 10-star rating in the 112 px List column; the progress bar and input in a narrow cell; empty stars in editable rating cells.
- #1216: people sort in Table and group by people against real MongoDB.
- #1234: a date field in French or Gujarati; an older translated field; a phone field with no country.
- #1234: whether a task's date picker enforces Past and Future (not tested in pass 3).
- #1236: the legacy drawer offers the four new types and the small editor; the edit pencil on new-type rows in the task panel.
- #1236: the AI rating builder asks for a maximum; Table header sort on an AI field.
- #1243: add by click and by drop; thumbnails; remove with a confirm; the count chip in List, Table and Board.
- #1243: the cap and the kinds in the builder; filter "is set" and "is empty"; a duplicate with "Attachments" ticked copies field files.

**Left**
- Pass 3: the task panel lists the workspace's task types, not the project's, when it edits a workspace field or creates one of the four new types (#1227).
- Pass 3: in the date field form, Description is required and its error sits on the General tab while Save is pressed from Limits (#1234).
- #1234: the legacy List phone cell has no company-country fallback; the date settings form still has bare "Lite Mode", "24 Hour" and "AM/PM"; saving a phone value end to end is untested.
- #1236: `droppedFieldValues` is returned but no screen shows it; the import result should.
- #1236: a moved task's people field can name someone who cannot open the new project.
- #1236: project-level fields cannot use the new types.
- #1243: a files change has no undo; the count chip's list is `position: fixed` and does not follow a scroll.
- #1243: real storage, local and Wasabi, never ran: upload, signed download, delete, the duplicate's copy.
- #1193, #1195: an AI bulk fill should skip tasks of other types up front; computed fields still store values on other types.
- #1193: an AI date uses the filler's time zone; no workspace time zone exists.
- #1192: the Field Filler skips a task whose description is under 40 characters; three `AgentCatalogue.blocked_*` keys are unused.

## Automations
**By hand**
- #1222: a rule that really fires puts a row in the Inbox (pass 3 used the dry run and the backtest only).

**Left**
- Pass 3: "New automation" from a project's Automate screen defaults to "any project"; raw validator text shows before any input; the dry run says "Would run" beside "this trigger would not run now"; a step is labelled "s1". A fix is running.
- #1222: the builder has no control for `reactToAutomation`, so "all subtasks done" does not run when an agent or an automation closes the last subtask.
- #1222: `subtasks_done_close_parent` on "any project" uses the first project's done status name.
- #1222: the new `tasks.DueDate` index builds on every tenant at startup.
- #1222: no company time zone exists.

## Dashboards
**By hand**
- #1224: each of the 11 card bodies inside the shell, in light and dark (pass 3 saw eight cards). Pass 3 saw no request for "Free Resources".

**Left**
- #1224: the Ask card can send two requests when the user id arrives after availability; it waits forever when AI availability never resolves. A fix is running.
- #1224: "Try again" does not re-import a failed cards chunk.
- #1188: the Ask card asks once per viewer per open (30 minute cache).
- #1199: Burndown, Velocity and Ask are not offered on Home; a changed layout is not pushed to other devices; no touch drag.
- #1221: `/personal` shows an error state for a first-time visitor in the atlas's read-only mode.

## Chat
**By hand**
- #1228: the `?thread=` link; deleting a root that has replies; `@ai` inside a thread (not tested in pass 3).
- #1228: the bell entry for a thread reply may show a blank task or project name.

**Left**
- #1228: follow and unfollow a thread, and per-thread unread, are not built.
- #1228: footer counts are stale after a socket reconnect until a reload.
- #1228: the kept-deleted-root query never ran on real MongoDB.
- Pass 3: a just-sent message shows "·" with no time until the feed renders again.
- #1197: an agent's reply does not bump the DM's unread count or last message; a refused start shows no reason; a chat run does not go through the Workflows queue.
- #1194: "Who can see this" checks each member in turn (slow for thousands); no frontend unit test for the modal; chat channels in the sprint collection get a 404.

## Agents and polling
**By hand**
- #1230: a hidden tab makes no agent requests; a 429 shows "The server is busy…" and not raw text (not tested in pass 3).

**Left**
- Pass 3, item 14: while the socket is connected, poll at the idle pace even during a live run.
- #1230: a person's timer line can lag two minutes.
- #1230: the request limit is one shared bucket per address. A proposal, not built: key it on the user or the token, with separate read and write buckets. Tell the owner first; it is a tightening.

## Search
**Left**
- #1185: two unused i18n keys (`Projects.search_everything`, `Projects.no_search_results`); `RecentVisitsDropdown` still lists tasks only.

## Working days and Gantt
**By hand**
- #1239: both workload grids under a week that is not Monday to Friday; the greyed estimate table columns.
- #1239: the "log your time" reminder skips a non-working day, also from the manual trigger; the project history entry for a working-days change.
- #1225: the pickers at 390 px.

**Left**
- Pass 3, dark: the project details tab keeps a light body under light text, so the working-days block cannot be read. A fix is running (dark batch 2).
- #1239: a project's working-days override does not update live in other clients.
- #1239: the reminder's "today" uses the server's local time.
- #1225: moving the blocker itself is not snapped to a working day; only the dependants it pushes are.
- #1203: the shift preview shows only on a drag, not on a date edit in the panel; the preview panel covers the bars.
- #1203: only finish-to-start links shift; dependants in other projects or without dates are ignored; a loop shows the panel on any later move upstream.
- #1189: capacity in points and tasks is set by each person only; the defaults are 10 and 10.

## Storage and the desktop tracker
**By hand** (important: uploads are now checked on every path)
- #1253: attach and remove a file on a task; a comment file in a task, a channel and a direct message, including the first file of a new direct message.
- #1253: a doc image; a project icon and a project attachment; a profile image; the company logo; a voice note; a clip; a cloud import; a custom field file.
- #1253: watch the server log for an "unknown layout" warning.
- #1256: post a clip in chat; duplicate a task whose comments have files.
- #1256, #1258: on a build of the desktop tracker, a capture still uploads while a timer runs; stopping the timer from the web ends tracking in the app with the new sentence; a lost connection does not.

**Left**
- #1258: the desktop tracker (`time-tracker-app/`) was never built or run for this change; it has no i18n.
- #1258: captures queued offline are replayed outside this path; a refused one is dropped and does not stop the timer.
- Owner decision: the stored-file download switch (`STORAGE_DOWNLOAD_SCOPE`); see `Tasks/HANDOFF.md`.

## MCP
- #1261: the plan for part 2 and the oddities are in `dogfood-findings.md`.
- #1261: the flags are off by default. Turning them on locally waits for the owner.

## Everything
**By hand**
- #1260: the rail item between Home and Projects, also on a short screen; rows from several projects with the project dot and key.
- #1260: search; each filter chip; each group option; sort; "Hide done" on by default; group paging by scroll and by "Load more".
- #1260: open a task (next and previous in the panel follow the rows); inline status and priority with that project's own statuses; refetch on focus.
- #1260: the phone layout and the filter sheet above the tab bar; dark; the skeleton.
- #1262: the List, Board and Table switch; a Board drag between columns, the toast for a refused drop, dimmed columns; the Board at 390 px.
- #1262: Table sort headers and the sticky header; the views switcher (save, save changes, rename, delete, default star, leave); the toolbar at 390 px; dark.

**Left**
- #1250: a read-only API token cannot call the endpoint (a POST needs the write scope, as `task/find` does).
- #1250: status names match exactly, so "To Do" and "To do" are separate groups.
- #1250: a timezone that Node accepts and MongoDB rejects gives a 500 when grouping by due date.
- #1250: without `JWT_SECRET`, a cursor stops working when the server restarts.
- #1250: index use with a long project list is unmeasured (E4).
- #1260: due buckets follow the List (no "This week" on a Saturday); the header count includes subtasks when they are shown.
- #1260: filter options come only from loaded projects; assignee and due date are read-only in the row.
- #1262: the Board drag is native HTML5: no touch and no keyboard. The card's status control is the other way.
- #1262: empty Board columns come from the store's project list and can show a status the person cannot use.
- #1262: a saved view stores the search text but the working state does not; no socket event for view changes.

## Design
**By hand**
- #1259 (in review; the default look changes for everyone): Home, List, Board, Table, the task panel and Settings, in light and dark, at 1440 and 390 px.
- #1259: the four-card picker (Dense, Regular, Airy, Classic); buttons at 32 px and inputs at 34 px on pages nobody opened; phone status pills at 40 px.
- #1215: the variants at 390 px and on subtask rows (not tested in pass 3).
- #1209: date triggers with a per-screen `::placeholder` colour may be black on dark (`CalenderCompo`, `ProjectDetailRightSide`, the dashboard css, `TrackerTimesheet`); the `.vue__time-picker` dropdown is white. Check each screen listed in #1209.
- Light-mode contrast (not tested in pass 3).

**Left**
- #1259: the List's filter toolbar is not converted and looks tall beside 34 px rows; convert it in B2.
- #1259: `ProjectTree`, the legacy panel blocks, `.ah-tab` and `.ah-card` paddings are not converted.
- #1210 (in review): regenerate the baseline against `beta` once the open visual PRs merge.
- Atlas, build 672: Home "My work" titles truncate while the project column takes fixed space; mono-spaced micro labels fight the main type.
- Atlas, build 672, dark: the milestone report, the SCIM card and the time-off cards stay light.

## Speed (#1220, measured at build 672 with 10,000 tasks)
- List first rows took 2.27 s against a 1.5 s budget. #1246 removed the one-second wait; measure again.
- Filters and search return the whole project in one answer (3.1 MB for a priority filter).
- 31,000 DOM nodes for 210 rows, about 150 a row.
- 50,000 tasks have not been seeded or measured.

## Tests and tooling
- `tests/permission-task-write-keys.test.js` and `tests/ai-chat-summary.test.js` pass but do not exit on their own when run alone.
- #1184: on a shared browser, a local language setting saved before #1184 is adopted once by the next person who has no account copy.

## QA leftovers to clean up
In the QA Sandbox project and the workspace, all named `[QA 046] …`:
- Tasks QAS-15 to QAS-19.
- Docs: `doc`, `doc 2`, `doc 3 (palette)`, `doc 4 (+New)`, `stray workspace doc`.
- Dashboard `dash`; folder `folder` with subfolder `sub`; list `list`; private channel `channel`.
- View templates `template 2` and `template B`; views `template` (shared), a private copy, and `template B`.
- Five workspace custom fields: `people`, `url`, `rating`, `progress`, `date`.
- One automation rule, left switched off.
- The Scale Test company with its 10,000-task project is still in the local MongoDB. Remove it with `npm run scale:seed -- --drop`.
