# 046 — Follow-ups and hand checks

State at build 766, 2026-10-02 01:10 IST. The owner's local server runs build 766: nothing is merged and not built.

The first part of this file was written at build 720 and has been cleaned of what later PRs fixed. What builds 721 to 758 left is in the second part, "Added at build 758". What builds 759 to 766 left, and what the hand-check sweeps found, is in the third part, "Added at build 766".

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
- #1254: a parent with more than 35 subtasks shows the first 35.
- #1254: the List no longer ticks loaded subtasks when a task is selected; Table and Board still do.
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
- #1248: `watcherFun` is referenced but not defined in `ConvertToSubTaskSidebar.vue` (a Vue warning; check, #1273 may have fixed it).
- #1249: a person's group now matches tasks whose assignees contain them (before: exactly them).
- #1191: a Board sort leaves drag on; a Board card logs a `groupValue` prop type warning.
- #1220: Board first cards: p95 1.8 s against a 1.5 s budget.

## Table
**By hand**
- #1212: compact density in Table, and saving it (not tested in pass 2).
- #1255: rows that arrive after the Table opened get an order.

**Left**
- #1212: the Table has no row menu.
- #1191: no assignee sort in Table.
- #1246: the Table has its own paging and its header shows the loaded count.

## Task panel
**By hand**
- #1252, in dark: Priority and Task Planning values; custom field rows and the dropdown chip; one value size and left edge with several assignees.
- #1252, in dark: the Add Task Planning sidebar; the Linked Docs, Epics and Custom Field action buttons.
- #1252: native date inputs at `/time/log` and in Add time; legacy pages, sidebars, menus and modals still look right in dark; public and share pages; 390 px.
- #1240: the breadcrumb with long names; the phone ancestor row; the "2/5" child count; the picker note when subtasks fill two levels; the create row keeps the typed name after a refusal.
- #1216: task panel row alignment for the four new field types.

**Left**
- #1240: `taskDepth.js` restates the server rule. Replace it with the `@taskTreeRules` alias from #1254.
- #1240: the panel lists only the first 35 children.
- #1245: the convert picker should handle the `PARENT_IS_DESCENDANT` refusal (check in #1240).
- #1230: the panel still polls agent runs every 15 seconds while a run is live, and does not pause in a hidden tab.
- #1252: mono time figures look heavier at the new row font size.
- #1252: a white card inside a redesigned page may get dark native controls in dark mode.
- #1215: the properties column overflowed by 9 px (check after #1252); variant C wraps the "Task Planning" and "Remaining Hours" labels.
- Pass 3: the people picker's avatar `alt` is a stray string (#1216); the new field types' descriptions start in lower case.

## Tasks and subtasks
**By hand**
- #1255: move, duplicate, convert to task and convert to list from the sidebar, the List row menu and the bulk bar.
- #1249: move, duplicate and convert a task from the sidebar. If any answers "Update operators are not accepted", fix it the way #1249 did.

**Left**
- #1226: the template skip uses `canNest` without the stale-chain guard (check now that migration 066 repairs chains).
- #1238: a restore after a delete now brings the subtasks back (a behaviour change).
- #1238: a move of one subtask alone is refused (`SUBTASK_MOVES_WITH_PARENT`).
- #1238: how the web store handles an update event for a carried subtask is unchecked (check; #1254 rewrote the store's placement).
- #1245: merging a task into one of its own subtasks leaves that subtask under the deleted task.
- #1245: a held row that leaves a tree keeps its state with no stamp.
- #1245: `verify()` for migration 066 is a re-plan check; watch it in e2e.
- #1245: other locales hold English for the reworded confirm text.

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
- #1211: dialog backdrops use an rgba literal. #1293 added the `--scrim` token; move them to it.
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
- #1231: no live refresh of other open editors after a restore (none for a normal save either; it belongs with presence).
- #1231: moved blocks show as removed and added; the list is capped at 300.
- #1229: the `useFocusTrap` fallback now affects all 12 dialogs when the opener is gone.
- #1237: the native date icon in the public link dialog was dark on dark in pass 3 (check after #1252).
- #1237: lower `PublicShareModal`'s entry in `scripts/style-baseline.json` when #1210 is regenerated.
- #1242: `Inbox.vue`, `PagesSpace.vue`, `useMentionLinks.js` and `AskAnswer.vue` still build the doc route by hand; move them to `docRoute`.
- #1196: public share pages do not show uploaded doc images; an image stays in storage when its block is never saved; Editor.js drop and paste routing is untested.
- #1198: a doc holds at most 500 comments.

## Folders
**By hand**
- #1235: archive and restore; an orphaned subfolder; the pickers; the refusal toast; dark and 390 px; the keyboard; permissions (not tested in pass 3).
- #1235: the header crumb on a list inside a subfolder (possible since #1265).
- #1235: click through lists in folders; the selected project must not jump (a new computed over `sprintsfolders` in `Projects.vue`).
- #1247: inline rename; the archive and delete dialogs with their counts; the undo toasts; leaving an archived folder's page.
- #1247: Trash > Folders and restore; the live update in a second tab; the task breadcrumb after a rename; the menu position on the last rows.

**Left**
- Pass 3: Convert to List shows folder names in title case.
- #1235: the task panel crumb names the parent folder only when the open project's folders are in the store. #1257 added `parentFolder` to the task read; use it.
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
- #1222: the builder has no control for `reactToAutomation`, so "all subtasks done" does not run when an agent or an automation closes the last subtask.
- #1222: `subtasks_done_close_parent` on "any project" uses the first project's done status name.
- #1222: the new `tasks.DueDate` index builds on every tenant at startup.
- #1222: no company time zone exists.

## Dashboards
**By hand**
- #1224: each of the 11 card bodies inside the shell, in light and dark (pass 3 saw eight cards). Pass 3 saw no request for "Free Resources".

**Left**
- #1224: "Try again" does not re-import a failed cards chunk.
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
- #1261, #1270, #1337: what an agent still cannot do, and the oddities, are in `dogfood-findings.md`.
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
- #1260: due buckets follow the List (no "This week" on a Saturday); the header count includes subtasks when they are shown.
- #1260: filter options come only from loaded projects; assignee and due date are read-only in the row.
- #1262: the Board drag is native HTML5: no touch and no keyboard. The card's status control is the other way.
- #1262: empty Board columns come from the store's project list and can show a status the person cannot use.
- #1262: a saved view stores the search text but the working state does not; no socket event for view changes.

## Design
**By hand**
- #1259 (the default look changed for everyone): Home, List, Board, Table, the task panel and Settings, in light and dark, at 1440 and 390 px.
- #1259: the four-card picker (Dense, Regular, Airy, Classic); buttons at 32 px and inputs at 34 px on pages nobody opened; phone status pills at 40 px.
- #1215: the variants at 390 px and on subtask rows (not tested in pass 3).
- #1209: date triggers with a per-screen `::placeholder` colour may be black on dark (`CalenderCompo`, `ProjectDetailRightSide`, the dashboard css, `TrackerTimesheet`); the `.vue__time-picker` dropdown is white. Check each screen listed in #1209.
- Light-mode contrast (not tested in pass 3).

**Left**
- #1259: the legacy panel blocks are not converted (#1280 converted the tree, tabs and cards).
- #1210 (in review): regenerate the baseline against `beta` once the open visual PRs merge.

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

# Added at build 758

What the PRs of builds 721 to 758 left or could not verify, brought up to date at build 766. One line per item. "In review" marks a PR that is not merged; its checks apply once it is. Access detail is not listed; see the private notes.

Checked by hand on build 754 and not repeated below: Home's empty state, the Goals page and its panel, the dense List and its list menu, Board, Gantt, Calendar, chat and Dashboards in dark, the accent picker, the Docs hub in dark, and doc autosave. The results are in `dogfood-findings.md`.

## List, Board and Table
**By hand**
- #1265: "+ New → New list" on a folder page and a subfolder page creates the list there and opens it; the folder row menu's "New list"; an empty folder page.
- #1269: a List with 13 columns at 1440 px keeps 240 px for the name, scrolls sideways, and keeps the checkbox and Task columns in place; drag and drop with the stuck cells.
- #1275: a Board card's count button opens a nested list and stays open after a drag; a level-two row adds a subtask and a level-three row does not; the Table nests three levels; Calendar chip titles name the parents.
- #1311: a Board card with nested subtasks and a comment count; the create form, the WIP popover, the skeleton and the density control; Table sticky columns while scrolling sideways; the Table at 390 px; dark; Classic.
- #1315: the Total row under its columns in light and dark; a partly loaded group's total after an edit.
- #1317: the "⋯" beside the list name in the project header at 1440 px; the List heading's expand target, now the name and count only; archive, delete and restore of a list from the tree and the header, with the redirect and the undo toast.
- #1347: a task shown in a list it was added to, with its "home" mark; "Remove from this list"; the bulk "Add to another list".

**Left**
- #1265: a list created from the folder row menu is not opened.
- #1271: changing a task's type still asks for a signed address of the type image.
- #1275: a parent shows 35 children with no "load more"; the List keeps its own copy of the task menu; AI column fill on the Table does not see nested rows.
- #1311: the Classic card title sits 5 px further left; the filter toolbar does not go compact on a Board; a row with a two-line AI summary is 44 px in dense.
- #1315: a failed save with "Save and add another" starts the next field after the error.
- #1317: a list cannot be duplicated (no server action); quick-create does not start in the last-used place; Board and Table headings do not show the list menu.
- #1334: an agent's undo of a sprint move does not put back an extra-list entry the move pulled; the task "⋯" menu and the row menu have no "Add to another list".
- #1347: a list's header count can be lower than the sum of its groups, because an added task is shown and not counted. The other three items it left were fixed by #1371.

## Tasks, subtasks and templates
**By hand**
- #1273, #1286: duplicate a task into another project with "Copy Assignees" and "Copy Watchers" ticked, and move a task across projects; check who is kept.
- #1281: move a task and check that its stored list holds only the id, the name and the folder fields. Migration 068's `verify()` re-runs the plan; watch it in e2e.
- #1268: the CSV wizard's two new mapping targets ("Task key or ID", "Parent task") and its result lines; the rollup help text; an export with Parent and Level columns, imported again.
- #1282: "Save as template" in the project menu and the list row menu; the dialog in light, dark and at 390 px; the create-project picker with saved templates, Edit and Delete; a project made from a template (folders, three task levels, dates offset from the start, automations switched off); a template of more than 300 tasks shows progress.

**Left**
- #1268: the CSV preview does not warn about tree problems; a CSV with a parent column goes in one request of up to 2,000 rows; `rollupScope: 'sprint'` is saved and never sent; `flatTasks` and two legacy `allTasks` builders still flatten one level.
- #1282: task types are not checked against the company's settings; views and automations are not rewritten when they name a skipped status or field; saving 2,000 tasks runs inline and is untimed; empty objects in the stored snapshot are untested on real MongoDB.

## Fields
**By hand**
- #1298: the relationship picker, its chips in narrow cells and the inline picker in the task panel; the vote button and voter avatars; the group-by icons.
- #1289: in Settings → Custom Fields, untick a project on a field in a stale tab and see the refusal with a re-read; a field change refreshes the definitions in other tabs.
- #1315: the field drawer's three footer buttons in a 374 px drawer; focus lands in the name while the drawer slides in.

**Left**
- #1298: a relationship field shows nothing on Board cards; a role whose custom-field permission is unset has no vote button.
- #1320: link rows are kept when a project is deleted, so a restore brings them back; `tests/integration/field-votes.int.test.js` first ran in CI.
- #1289: an open project picker loses unsaved ticks when a field change arrives.
- #1315: an API client that posts a field with no name now gets a 400.

## Docs
**By hand**
- #1287: assign and resolve a doc comment (the Home "Assigned comments" card and the Inbox row open the doc at the comment); reactions; a file on a comment (upload, open, remove; Safari may block the open); the mention picker at the foot of the panel; the 500-comment notice.
- #1319: replace a doc's first text after a few minutes and restore it from History; edit one doc in two tabs and see the conflict banner and "Keep mine as a copy"; go offline, type, come back; close the tab mid-edit and reopen; a mention notice arrives once, after the pause; 390 px and dark.
- #1304, #1312: older text descriptions and stored doc pages. Behaviour changes to confirm: images in older text descriptions are not drawn, stored imgur embeds become links, and imported attachment links no longer show in the project's Files & Links panel.
- #1345, #1352: a doc opened by a named viewer (the "View only" chip, the title, no edit controls, real content); the "Shared with me" view; the Docs hub as a guest; dark and 390 px.
- #1349: save a doc with a link, an image, a table, an embed and coloured text; edit a task description; import a CSV with descriptions; run `scripts/rich-text-audit.js` against the local MongoDB (it only reads) and record the counts.

**Left**
- #1287: no index on `pageComments.assigneeId` (needs a migration); a file stays in storage when a save fails; a fast Enter after "@" submits the comment; the Inbox wording for an assigned doc comment.
- #1319: the quiet timers live in the server process, so a restart loses them and several instances can send a notice twice; a tiny doc can keep junk "rewrite" versions; the `Docs.unsaved` key is unused.
- #1312: `OldDescription/Description.vue` can be deleted; the Files & Links panel should read `task.links`.
- #1345: adding `sharedWith` to the vector index filter makes existing Atlas indexes rebuild.
- #1349: image captions and similar short fields are kept as plain text, not cleaned as HTML; the audit script has not run against a real database.

## Whiteboard and forms
**By hand**
- #1300, #1321: drag a card, see "Saved", reload; a second browser sees the move; add a note and a text, recolour, resize, edit, delete; restore from History; touch drag at 390 px (real touch is unverified); archive the list (read-only), trash it (gone), restore it (back). Light and dark.
- #1292: "Show this question when…" in the form builder, its summary line, the stale-rule notice and the preview; on the public page a submit brings in the newly shown questions with earlier answers kept; a picked file must be chosen again.

**Left**
- #1321: a note cannot become a task; a duplicated project does not carry the board; no shapes or images; Backspace deletes a focused note, with History as the only undo.
- #1292: the builder edits one level of conditions; multi-choice has no "does not include"; the public page's strings are hard-coded English.

## Goals
**By hand**
- #1327: a target counted from tasks, drawn and edited on the page.
- #1335, #1341: the Home "Goals" card (off by default); the "Counts toward" chips in the task panel; "Count toward a goal…" in the list menu and the task menu; a reached notice.

**Left**
- #1308: list, folder and project archive, a trash restore, a duplicate and the legacy status route do not tell the counter; the ten-minute recount heals them. The recount is unmeasured at 10,000 tasks.
- #1348: goal actions are tied to the task-list permission until goals have a key of their own; one mutation check was left unproven.
- #1363: the goal summary has not been pressed by hand (the button was seen on build 762).

## Import
**By hand**
- #1288: with a real ClickUp export, if the owner can give one: the preview counts, the summary table, comments on all three levels, fields created and values set or dropped, checklists, attachment links.
- #1338: import the sample CSV twice into QA Sandbox (skip, then update); undo it from the dialog's last step and from Recent imports; an edited imported task makes undo ask; day-first dates; the ignored-columns note.

**Left**
- #1288: the cell format of Comments and Checklists in a real export is not documented; people columns match by email only; phone fields get a US default; money has no currency; European number format is dropped.
- #1331: the preview miscounts a subtask whose parent is in another list; a repeated Task ID attaches subtasks to the last parent; a member without the project-details permission, with "Add missing statuses and tags" ticked, gets a bare 403; dependencies are not imported.
- #1338: a repeat import is recognised within one project only.
- #1356: a first import still lets automations run once per imported task.

## AI
**By hand**
- #1266: open `[QA 046] dash` four times and see one ask; the "Ask again when older than" setting; the stale note.
- #1274: the automation builder: scope defaults to the project, validation only after a touch, one dry-run headline, numbered step names, the "also run when another automation or an agent made the change" box.
- #1295: the Table's Summary and Area columns show "Generate" and make no model call on scroll; "Generate for N rows" with a confirm over 25; the "Post to chat" dialog over the palette; the held-back dialog; how a posted answer looks in chat.
- #1333: the Talk to Text row in the budget; the "(own week)" chip on a self-approved week.

**Left**
- #1302: a channel in a workspace with more than 50 active seats cannot take a posted answer with sources (the cap counts workspace seats, not channel members); a refused area shows a generic error in the Table row, not the budget text.
- #1333: the default price, 0.006 a minute, was written from memory. Confirm it.

## MCP and connectors
**By hand**
- #1307: the consent screen when a client asks for a manage scope; the person's Withdraw.
- #1337: the `MCP_TOOLS_WORK` tools through the local endpoint (needs the flag and a new token).
- #1350: no screen was seen and the real Slack API was never called. No sample skill ships, so nothing posts until a skill uses `slack.message.post`.

**Left**
- #1337: list and doc-comment writes use the `tasks:write` scope; add `projects:write` and `docs:write`, or reword the consent text. Still missing: watchers, checklists, folders, resolving a doc comment, reactions.
- #1350: the signing secret is stored and unused until slice 9; a message is at most 3,000 characters, to public channels, from a list of at most 50.

## Design, dark mode and phone
**By hand**
- #1272: project details in dark at 1440 px and on a phone; the custom field drawer (name, close, Cancel, Back, Escape, tabs, first-error focus); the assignee and priority pickers everywhere.
- #1284: agent chips in the Inbox; milestone, country and currency menus; a project's Comments and Activity tabs in dark (bubbles, the reply box, the mention list, a quoted reply were not seen).
- #1279: the milestone report with real rows; the time-off list; SCIM; Settings → Projects cards; custom report chart colours.
- #1280, #1285: the type tokens changed for everyone: the filter toolbar (41 px in dense), tree rows (28 px), `--text-small` at 11.5 px in about 277 places, headings at 17 px, tabs, cards; the Airy and Classic looks.
- #1290: Home "My Work" rows, the setup checklist's "Show all steps", the Inbox density control, Docs hub rows, phone controls at 40 px.
- #1293: project, tracker and "my" timesheets; the integrations hub; the confirmation sidebar (13 px text, was 16); the project settings sidebar; the sprint settings dialog; instance pages.
- #1303, #1329: a destructive confirm uses the danger button; a toast; the image slider; a menu as a phone sheet at 390 px; list column menus and timesheet detail menus (themed by the new default, never opened); every sidebar; Classic and high contrast.
- #1316, #1318: the chat thread, details and search panes; reaction chips; the meeting notes page; the dashboard grid and burndown colours; Gantt row and scale heights, the shift panel; planner blocks; the calendar on a phone.
- #1322: each accent under Home, the List, the task panel and the Board (blue and orange at least); high contrast keeps its brand; menus, the confirm dialog, the undo toast and the tooltip with reduced motion off and on.
- #1328: the 18 converted empty states; the "?" shortcut sheet and its search; key hints.
- #1296, #1325: the screens the two phone sweeps fixed, at 390 px; run the atlas again at 390 px and read its layout block.
- #1354: the setup card at 1440 and 390 px, light and dark; the tour's popover position; My Settings opened at the Look section.

**Left**
- #1278: the screenshot check has no baseline. Let the Visual workflow run once on `beta`, run `npm run visual:accept -- <run id>`, look at the pictures, commit `e2e/visual-baseline/`, tune the thresholds, then make "Core screens" required. #1311 changes the Board and Table shots.
- #1284: in the Comments tab, the scroll-to-bottom button, media borders, the recording bar and message menus; the month picker popup sits under the cards to its right; the AI gradient's pink end is 3.0 to 3.3:1 on light.
- #1290: Home sidebar items are under 40 px on a phone.
- #1293: utility classes still in templates: `red` in 52 files, `bg-white` 42, `gray81` 40, `black` 40, `blue` 28, `btn-primary` 38, `form-control` 26.
- #1303: `views/Projects/ProjectDetail` passes its own alert colours (3.85:1).
- #1316, #1318: the phone month grid has chips under 40 px and needs a day or agenda layout; white initials on four of the eight chat avatar colours are under 4.5:1; a chat message body renders a blank line under its text.
- #1322: about 274 lines in some 70 legacy files hard-code the indigo and do not follow the accent; orange, green and pink sit near the warn, ok and danger colours.
- #1325: scoped star rules no longer reach dialogs moved to `body`; the Board's 12 px buttons on a phone (check after #1311).
- #1354: the sample seeder is unchanged; the legacy tour panel in `ShellPanels.vue`, its store and its locale keys can be removed; its e2e spec was edited and not run locally.

## Speed and the app shell
**By hand**
- #1339: set a non-English language and reload: the first paint is in that language; switch language in My Settings and in Language and region; the Arabic preview; on a slow network, English after 5 seconds and then the switch.
- #1351: stylesheet order may have changed. Check a chart, the dashboard grid, a date picker, the first task opened, a List with field columns, the field form and both import screens.
- #1306 (in review): the 14 checks in `.claude/test-cases/PWA.md`; push delivery after the worker's scope change; Safari and Firefox.

**Left**
- #1324: unmeasured: 50,000 tasks, a person who can open only some projects, and the Board and Table modes. Look at sort indexes again near 90,000 tasks over 200 projects.
- #1351: the build with the final size budget first runs in CI.
- #1306 (in review): now that #1351 is merged, its offline list must add the task panel, custom field, form and language chunks; it needs `beta` merged in and its env doc regenerated.

## Timesheets and reports
**By hand**
- #1294: the Portfolio, Workload and Capacity pages as a plain member and as the owner, in light and dark.
- #1317: the Approvals tab and the More menu entry as owner and as member; Reopen on an approved week (the owner's week of 2026-09-28 is approved in the local data).

## Tests, CI and tooling
- #1323: C3 slice 2 (#1361, in review) should remove the three `skipConsoleGuard` calls and the approvals allowlist entry now that #1346 is merged. Not reproduced: the List opening empty right after a create.
- #1336: no convention guard was possible. The follow-up, a CI job that runs the unit suites with the clock moved forward, is merged (#1359).
- #1297: `docs/API.md` and `docs/api/openapi.json` were regenerated at build 766, with the 38 routes that had no description described. Feature PRs keep adding routes with a one-line entry; the next docs PR runs `npm run api:doc` again.
- #1342: the doomed CI runs of the afternoon could not be cancelled from the session; the Actions cache is at its 10 GB limit.
- Local storage has no folder for the main company; after the next rebuild, check where an upload lands.
- `git` on the owner's Mac has no `user.name` or `user.email`.

## Found by the second benchmark run (#1358; build 754)
Each line says which PR fixed it, or that it is open. None of the fixes has been measured by a third run.
- Job 6: duplicating a project fails with a server error when the source project has no currency set. Fixed by #1375 and #1391; a duplicate was made by hand on build 762.
- Job 4: the task panel offers two levels of subtasks, not three, and says nothing at the limit. Not a defect: the task itself is the first of the three levels, and the panel has a line at the limit.
- Job 4: "Add subtask" in the panel puts the focus in the List's add row, so the name typed becomes a top-level task. Fixed by #1375; not tried by hand.
- Job 13: a rollup field shows a dash until a subtask's value is saved again. Fixed by #1375, from at most 500 subtasks; not tried by hand.
- Wording: "sprint" is used for a list in several places; "Enter directory name"; "2 tasks across 1 projects". Fixed by #1375 (16 strings); 51 more are in review (#1407, task 047). In the other languages the reworded strings hold English until they are translated.
- A timer in an approved week starts, and only Stop refuses it. Fixed by #1377; not tried by hand.
- A new empty list says a task was created. Check: #1375 added "List created successfully".
- The Approvals card's totals disagree with the timesheet's, and timesheets sit below agent proposals. Fixed by #1377.
- The quick-create assignee list lacks the person creating the task. Fixed by #1379.
- Search ranks another project's task above the doc that was asked for. Open.
- A date field needs a press on Select and stores a time; the people picker stays open after a pick. #1379 stores a date-only field as a date and closes a one-person picker. The press on Select stays, because new date fields default to "allow time": an open decision.
- Job 20, planning a sprint, takes 15 steps; job 3, a message to a task, takes 6 because nothing is remembered. Open in the web app; over MCP a message becomes a task in one call (#1398, task 047).
- Seen once and probably the script: a two-day drag in the Gantt's Weeks scale snapped back.

## QA leftovers added on builds 752 and 754
- A private goal `[QA 046] goal`, owned by the owner.
- The text "Autosave check on build 754" in `[QA 046] doc 2`.
- Items named `[QA bench]` and `[QA bench2]` from the two benchmark runs, in QA Sandbox, and two stray "Child" tasks, QAS-48 and QAS-49.
- The owner's approved week of 28 September to 4 October was reopened and approved again by the second benchmark run, with 1 h 31 min more on it.
- 300 "Scale Small" projects with 3,000 tasks inside the Scale Test company; `npm run scale:seed -- --drop` removes them with the rest.
- From the hand-check sweeps, all named `[QA 046] …` unless said: the goal `hand-check goal`; a Table view, a Whiteboard view and a "Project Details" view on QA Sandbox, named by the app; the note `hand-check note`; the project `copy`; the docs `hand-check doc` (shared with one member as an editor) and one empty "Untitled" doc; the tasks `live add` and `A live`; task `B`, left in Sprint 1; a few comments and chat messages; 38 imported tasks in `list`, and 38 more in the trash from two undone imports.

# Added at build 766

What builds 759 to 766 left or could not verify, and what the Supporter session's sweeps found that is still open. Task 047's slices are included, because they share the screens. Access detail is not listed; see the private notes.

## Defects found by the hand-check sweeps, still open
- With the network down, an instant edit is not taken back and shows no toast: the offline write queue answers as if it succeeded, and minutes later the rows return to their old value silently (#1372). A refused write is right: it returns in about 300 ms with one toast carrying the server's reason.
- An import's "update from the file" does not refresh a project page that is already open; the old status stays until a reload. The confirm button still reads "Import N task(s)" when it is updating (#1356).
- The Add View menu runs off the right edge, further with each view. #1384's clamp places the menu once, before its content has loaded. In review: #1403.
- One bare avatar request (`/<userId>_<n>_profile.png`) still answers 404 on Home, List, Board, the task panel, chat and Docs. In review: #1389, which also covers the title lost on click-away, panels that outlive their route, and Undo after "Remove from this list". Its avatar change does not reach the People directory, Goals, field values, Workload, Approvals, the mention pickers and three more components.
- Home's "Open in AI Inbox" link goes to the AI inbox, not to the new "Needs your approval" tab (#1392).
- "Hand to an agent" stays on a task after the Project manager switch is turned off, until a reload (#1404).
- Turning the Project manager switch on filled "What needs attention" at once and filed no proposal; the Inbox row "The system, for <project>" was not seen. It may need the daily run (#1396).
- A timer that is running when its week gets approved loses its tracked time at Stop (#1377 found it; not fixed).
- Small: the "Not connected yet" strip on Connect your AI has a blank space where an icon would be (#1397); "Save" is lit on a doc that was just reloaded; the List's add-task row stays open after a task is added; the tour's key hint says "Ctrl+K" on a phone; "DONE BY" and "BUDGET" headers touch at 1440 px with every column on; the Table group header reads "To Do 5 5 pts".
- Read from the code while writing the API reference, not seen in a browser: the save of a project's agent policy sends its live event without the company id, while the project manager's save beside it names it (`Modules/Agents/projectPolicyController.js`). Check that a second open tab sees a policy change without a reload.

## By hand, not done yet
- Needs a second person: the unread counts on the rail; a doc opened as a view-only reader (#1352).
- #1371: a task of another project added to a QA Sandbox list: the "From other projects" section at the foot of the List at 1440 and 390 px in light and dark, the Board, the chip on Everything rows, the palette's "+N lists" line, a real drag that snaps back, a search and a filter with an added task, and a live refresh in two browsers. It needs a second sandbox project.
- #1372: instant priority, assignee, due date and title edits; the Board; counts when grouped by assignee.
- #1375: "Add subtask" with the List's add row open; a rollup on a parent; the reworded strings on screen.
- #1377, #1379: a timer start after a hard reload in an approved week; a one-person people field; a date-only field; the quick-create assignee list; a folder restore.
- #1349: an image, a checklist and coloured text in a doc; rich text in a task description; a CSV import with descriptions; `scripts/rich-text-audit.js` against the local MongoDB (it only reads).
- #1351: as a first load: a chart, the dashboard grid, the calendar date picker and the field form.
- #1354: the five-step setup card (the sweep account shows none). #1370: the sample project (this workspace has none).
- #1367: live updates of a whiteboard note, a custom field value and a goal in two tabs.
- #1384: `<html lang>` after a language switch.
- #1391: the company's currency on a goal's money target and on a new project.
- #1397, #1400: Connect your AI, the Ask tile and the "say it" row on empty screens with no AI set up (AI is set up on this install).
- #1386: the expiry notice in the Inbox; Renew (nothing was created or renewed).
- #1387, #1390, #1398, #1402 and the agent side of #1404: they need the MCP flags on and a connected AI, which wait for the owner.
- #1350, #1362, #1381: no connector screen has been seen and no real Slack or Google call has been made. How the Slack summary demo is started from a screen has not been traced.
- At 390 px, only the Simple-mode phone bar, Project Details, Connect your AI, the Inbox and the "What next" line were looked at among the new screens.

## Left
- #1351: the build with the final size budget first ran in CI. The warm-up of the task panel and the field chunks runs when the browser is idle.
- #1354: the legacy tour panel in `ShellPanels.vue`, its store and its locale keys can be removed.
- #1356: a first import still lets automations run once per imported task.
- #1369: a paged search by list was not tested.
- #1371: the Table does not show rows from other projects; Everything has no list filter; opening a List or a Board makes one more request.
- #1372: filtered copies of a row follow the server; team assignee counts; a late echo can flicker; a Board drag's place is not taken back on a refusal.
- #1385: only the open list's room is heard; a server count that lands later than 800 ms is off until the next event.
- #1370: restoring the sample project brings back its tasks and not its lists, folders and docs (each can be restored on its own); removal goes by the project code `WELCOME`, so a person's own project with that code would go to the trash with it.
- #1391: ten questions in `Tasks/active/047-ai-run/resources/dead-ends.md` (a default project type, a default template, five more composers, the desktop tracker's owner, storage not set up, no screen to change the default currency).
- #1359: the moved-clock job runs the unit suites; the integration suites are not in it.
- #1361 (in review): written on an older base; its backend and e2e checks failed.

## How a batch is checked now
- The merge queue merges only a PR that is not a draft and whose backend, frontend and e2e checks succeeded. A skipped check is not a pass: #1394 was merged on skipped checks once, and its own run passed afterwards.
- On every combined branch, before the push: each merged PR's own test files; `tests/permission-task-write-keys.test.js`; the conventions project; `node scripts/env-doc.js --check`; `npm run i18n:check`; and every frontend spec that mentions a changed file.
- A spec that mounts `App.vue` must mock `@/config/warmChunks`. It failed three batches.
- A helper is never added as a method of the task write mixins (`Modules/Tasks/helpers/taskMongo/`): every method there is a task action.
- After a fix is pushed to a queued PR, wait about a minute before restarting the queue runner, or it reads the old failed check.
