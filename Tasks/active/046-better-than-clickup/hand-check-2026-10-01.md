# Hand check, 2026-10-01 (build 757, batch 2)

Not committed. One line per item: OK or DEFECT, theme and width, what I did, what I saw, console error if any.

How it was checked: the Browser pane is 1024 px wide, and the List drops its Est, extra-field and Total columns at 1024 or less, so items 6 and 9 were also looked at in a 1440 px emulated window. Dark was checked by a DOM scan for large light backgrounds and dark-on-dark text on every screen below, plus screenshots of the import dialog, the Table, the whiteboard and the task panel's list picker. 390 px was checked by a horizontal-overflow scan (no overflow anywhere) and screenshots.
Created in QA Sandbox: goal "[QA 046] hand-check goal" with two targets, a Table view and a Whiteboard view (both named by the app, not "[QA 046] …"; I did not delete them), a note "[QA 046] hand-check note", story points 5 on "[QA 046] A", and two imports (38 tasks; both undone, tasks are in the trash). Theme and language were switched and put back.

## Console

- DEFECT, every page load, light: `PUT /api/v1/user` answers 403 "You are not a member of that company." (axios error in the console). Once per app load. Sent to the coordinator by message; not written up anywhere else.
- No other console error on any screen checked.

## 1. Goals

- OK, light 1024: Goals page lists goals; "New goal" saves and opens the panel. Number target "[QA 046] Ship demos" 4 of 10 shows 40%. "Counted from tasks" target with one QA Sandbox task saves and shows "0 of 1 tasks done"; the goal shows 20%.
- OK, light 1024: Home > Manage cards > Add cards > Goals "Add" puts a Goals card on Home with both goals and their bars and an "All goals" link.
- OK, light 1024: task menu (...) has "Count toward a goal…"; the dialog opens with Goal, Target and Target name. Cancelled without saving.
- OK, dark 1440 and light 390: Goals page, goal panel, target form, Home card and the dialog have no light surfaces and no overflow; at 390 the panel is full width.
- DEFECT (small), light 1024: the goal chip under "COUNTS TOWARD" in the task panel is 212 px wide but holds 230 px, so the percentage spills out of the chip. At 390 the chip fits (358 of 358). Fix in the agent's PR #1366.

## 2. A task's lists

- OK, light 1024: "Add to another list" opens a side panel (project, search, folder and list tree); picking "[QA 046] list" and Add shows "Added to [QA 046] list." and a chip with a remove ×; × removes it with "Removed from [QA 046] list.".
- DEFECT, light 1024 (the panel beside the page): the Lists row stays 24 px tall while its chips take 52 px, or 80 px with one extra list. The chips and the "Add to another list" button draw over the Type and Tags rows. Cause: `.ah-detail__props` is a scrolling flex column and rows have `min-height: 24px` with the default flex-shrink. Fix in #1366.
- OK, dark 1440 and light 390: the list picker panel is themed and full width at 390; at 390 the Properties sheet gives the Lists row 44 px and nothing overlaps.
- Cosmetic, all widths: in the list picker the "Project" label sits directly under the help sentence with no gap.

## 3. Import (ClickUp CSV)

- DEFECT, light 1024, fresh page load: Settings > Import & export > ClickUp > file > "An existing project" > pick QA Sandbox: the List dropdown stays empty and Next stays disabled. The dialog reads the project's lists from the store (`sprintOptionsOf`, `sprintsObj` and `sprintsfolders`), which are empty until the project has been opened once (QA Sandbox: 0 lists until opened, then 6 lists and 6 folders). Being fixed on `fix/import-dialog-loads-lists`.
- OK, light 1024: preview ("38 task(s) from 2 list(s)", per-list counts, new statuses, tags, fields, warnings, what comes in and what is left out); Import creates 38 tasks ("Website relaunch: 20", "Bugs: 18"); the summary lists the skipped rows, the unreadable date and the deeper-than-three-levels note.
- OK, light 1024: second run of the same file says "38 task(s) of this file are already in the project", offers "Leave them as they are" or "Update them from the file", shows "Tasks 0, 38 left as they are", and "Import 0 task(s)" is disabled.
- OK, light 1024: "Recent imports" lists both imports; "Undo this import" asks in the app ("Move the 18 task(s) this import created to the trash? They can be restored from the trash.") and the row then reads "Undone". Did the same for the 20.
- OK, dark 1440: dialog source, file, target and existing-project steps and the undo confirm have no light surfaces.
- DEFECT (small), 390: in the preview the "What this import will bring in" table breaks "Comments" mid-word ("Comment s") and wraps "Subtasks of subtasks" over three lines; the card scrolls inside itself so Back and Import are at the very end of the scroll.
- Cosmetic, all widths: the file input, the two selects and the radios are native browser controls in a different font and size from the app.

## 4. Timesheet approval

- Not verifiable: no "[QA 046]" week exists, and the Approvals page (Time filter) says "Queue clear". My timesheet's week of Sep 28 to Oct 4 shows the chip "Approved" with "Reopen" and the history card "Reopened by Local PM on Oct 1, 21:31"; the stored approval has `selfApproved: false`, no "approve" entry in its history, and totals of 91 min and 2 entries against the week's 182 min and 4 entries. The current code sets `selfApproved` and a history entry on approve, so this approval was almost certainly made by an older build; the "(own week)" wording could not be seen. Did not approve or reopen anything.

## 5. Language

- OK, light 1024: My settings > Select Language > Français > "Save changes" switches the app (rail shows "Projets"); most other labels stay English, which is the known English-copy fallback without `TRANSLATE_API_KEY`. No raw key (`Namespace.key`) text on Goals, Home or Everything, and none sampled for 6 s after a reload. Switched back to English and saved.
- DEFECT (small), all widths: `<html lang>` is only set at boot. After switching to Français it stayed "en" until a reload; after switching back to English it stayed "fr". Screen readers get the wrong language.

## 6. Table view

- OK, light 1440: "Add View" > Table creates the view (named "Table"). Columns Tasks, Status, Assignee, Due, Priority, Est, Points, Tags, Summary (AI "Generate"), Risk and the custom fields scroll inside the table (6158 px of content). Points cell opens a chip picker (1 2 3 5 8 13 21, Clear); choosing 5 saves ("Story points updated", Undo) and the group header reads "To Do 5 · 5 pts". Dark 1440 and light 390: no light surfaces; at 390 the table scrolls inside its own box.
- Not seen: column resizing (no drag tried); a group footer. The Table has no Total row yet (the group header shows the points sum only).
- Cosmetic: the header reads "To Do 5 5 pts"; the count and the points sit next to each other.

## 7. Whiteboard

- OK, light 1440: Add View > Whiteboard opens "Whiteboard, 5 cards, Saved" with Add note, Add text, History, Auto-arrange; "Add note" creates a note, typing "[QA 046] hand-check note" and clicking the canvas keeps it. Dark 1440: themed (note is brown, text readable). 390: cards stack in a column, no overflow.
- DEFECT (small), light and 390: a new note always lands at the top left, on top of the first two cards (it hides the title of QAS-17 and QAS-19).
- Not seen: Whiteboard "on a list" named "[QA 046] board"; the view is project-wide and can be renamed from its tab (not done).

## 8. Quick custom field from a List header

- NOT PRESENT on build 757, light 1440: no "+" in the List header, none in the Columns popover (it ends with "Reset to default"), none after the last Table column. Not merged yet, or in batch 3.

## 9. List group totals

- OK, light 1440: every status group ends with a "Total" row under Points, Budget and Story Points. In Progress shows Story Points 11 (8 + 3) and Budget 12500, matching the two rows that have values; empty groups show 0. At 1024 or less the whole Total row is hidden by `@media (max-width: 1024px)` (`.lv2__totals { display: none }`), by design.
- OK, dark 1440: themed.
- Cosmetic: "DONE BY" and "BUDGET" headers touch each other at 1440 with all columns on.

## 10. Themed pieces in dark (1440)

- OK: goal side panel, task panel, task "..." menu, "Count toward a goal…" dialog, list picker side panel, import dialog and its steps, undo confirm, Add View popover, Table, Whiteboard. No light surface or dark-on-dark text found by the scan.
- Not looked at in dark: a toast.
- DEFECT, light and dark, 1024 and 1440: the Add View popover is not kept on screen. Its right edge was 1603 px in a 1440 px window with 7 view tabs, 1671 with 8 and 1757 with 9, so "Board", "Table", "Dashboard" and "Comments" are cut off, and it gets worse with every view added. (Its position is `fixed` from the button.)

## Other things seen

- Task panel at 390 px: the Repeat row has its label centred above a truncated value ("Doesn't rep…"), unlike the rows around it, and the Start and Due date rows show a stray dotted-bar icon next to the date.
- A "Removed from [QA 046] list." toast stayed on screen for minutes while the pane tab was not in front; with the tab in front toasts dismissed normally. Not a defect.
- Column picker in the List stays open after a synthetic outside click; it closed on Escape. Not tried with a real outside click.
- The List column picker marks the view "Unsaved changes" (Save, Save for me, Save as new view, Reset); I used Reset.

---

# Second sweep, build 759 (batch 3), 2026-10-01 22:30 to 23:20

Light 1024, dark 1440 (DOM scan for light surfaces and dark-on-dark text, plus screenshots), and 390 px (horizontal-overflow scan on every screen, plus screenshots). Two tabs of the same account for A. PRs from sweep 1: #1366, #1373, #1384 (drafts, final, in coordinator's batch 5). Created in QA Sandbox this round: task "[QA 046] live add" (moved to Sprint 1), "[QA 046] A live" (renamed; added to "[QA 046] list" and removed again), two task comments, a chat message in "[QA 046] channel", doc "[QA 046] hand-check doc" (private, shared with Anita Desai as "Can edit"; a link, a list and a table).

## A. Live updates (two tabs, no reload)

- OK: status change (To Do to In Review) reached the second tab, group counts agreed.
- OK: task title rename (via the title's Enter key) reached the second tab.
- OK: assignee removed and re-added reached the second tab (the row's avatar went and came back).
- OK: a new task added in the List reached the second tab.
- OK: a move to another list (Sprint 1): the task left "List" in the second tab and "To Do" fell from 5 to 4.
- DEFECT: in the second tab the header of the group the task moved INTO stayed at the old count: "Sprint 1" read 12 while the group held 13 rows (seen after expanding it; the first tab read 13). Needs a reload. A fix agent has it (draft PR on top of batch 4).
- OK: a task comment appeared in the second tab's open panel; a chat message appeared in the second tab's open channel.
- NEEDS THE OWNER: unread counts. With one account my own actions never raise the rail's Inbox or Chat badge (Inbox stayed at 1), so "the unread count must move" could not be checked.
- Console: no error from these actions in either tab except the usual avatar 404s (below).

## B. Docs

- OK, light 1024: new doc, the Private toggle, "Share this doc" with "Add people": ticking Anita Desai added her as "Can view" at once, the doc header then read "Shared with 1 person"; changing her to "Can edit" saved (still "Can edit" after a reload). Dark 1440 and light 390: themed, no overflow, the dialog fits.
- OK, light 1024: a link, a bulleted list and a table pasted into the doc survive Save and a reload (link intact). Not tried: coloured text (the editor dropped the colour style on paste; it needs the toolbar), an image, a checklist, and rich text in a task description.
- NEEDS THE OWNER: opening a doc as a view-only reader ("View only" chip, no Save). It needs a second account.
- DEFECT (small), light and dark: the people list in the Share dialog is unstyled: a bulleted list with native checkboxes and tiny avatars, unlike the rest of the dialog.
- DEFECT (small): a new doc's title field holds the real text "Untitled", not a placeholder, so typing a title gives "Untitled[your text]"; I had to replace it through the DOM.
- Nit: the Share dialog's switch is labelled with the current state ("Private") but is on when the doc is Shared, so a private doc shows a switch that is off next to the word "Private".
- Nit: "Save" is lit on a freshly reloaded doc with no changes.

## C. First run

- OK, light 1024 and 390, dark 1440: More > "Take the tour" opens "STEP 1 OF 4" as a small card at the top left (bottom, above the tab bar, at 390), it does not block the page behind it (the page is still clickable), "Next" goes to step 2, Escape (sent through the DOM) closes it. Themed in dark.
- Not seen: the five-step setup card on Home. This account shows no card (it needs "not dismissed and not complete"). Skipped by agreement.
- Nit, 390: the tour's keyboard hint says "Ctrl+K" under the mobile emulation and "⌘K" on desktop.

## D. A task in a second list

- OK, light 1024: adding "[QA 046] A live" to "[QA 046] list" from the task panel shows it in that list's List, Board and Table, each with the "Lives in List" home mark. "Remove from this list" is in the row menu and removes it at once.
- Note: no confirmation and no Undo toast for "Remove from this list" (the task stays in its home list).
- By design, kept: the list's header and its sidebar entry read 0 and "0 tasks" while the list shows the added task (home-only count). A "+N added" hint is being tried in the same draft as the group-count fix.
- Note: the project Board (all lists) shows an added task once, at its home list, with no mark; the mark appears on the list's own page.

## E. Integrations

- OK, light 1024: as before, "Sweep hook" connected plus the Available chips (Google Drive, Dropbox, Slack webhook, Discord webhook, JSON webhook); no Slack connector card, no console error. 390: no overflow. Dark: themed.

## F. First load

- OK: reloading a project's List view in a fresh page: DOM content loaded in 98 ms (a warm cache), 15 stylesheets, 40 scripts, 256 KB transferred, layout shifts 0. I could not watch for a one-frame unstyled flash by eye.
- Not exercised as a first load: chart, dashboard grid, calendar date picker, field create form.

## G. Calendar in dark

- OK: collapsed list headers now follow the theme; no light surface found by the scan.
- DEFECT (small), light and dark: the "sprints" chips of "[QA bench] Sprint 9" and "[QA bench2] Sprint 9" are drawn on top of each other above the first week, so their text is garbled.

## H. `#/projects` without the company id

- It redirects to Home with the company id in the URL (no 404, no blank page). The 403 on `PUT /api/v1/user` appeared in the console right after. Fix is in batch 4.

## Other things seen in this round

- DEFECT (small): clicking away from the task title while renaming discards the edit; only Enter saves (`editFocusOut` clears it). Easy to lose a rename on a phone.
- DEFECT (small): panels outlive their route. The assignee picker stayed open after the route changed, and the task panel stayed open over the Chat page and after the `?task=` part was removed from the URL.
- DEFECT (small), every project page: the avatar is requested as `GET /<userId>_<number>_profile.png` at the site root and answers 404, repeatedly (console: "Failed to load resource 404"). The signed-URL fetch beside it succeeds.
- Nit: the List's inline add-task row stays open after adding a task.

---

# Fix PRs from the hand check (drafts, FINAL, nothing seen in a browser)

- #1366 task panel property rows keep their height; goal chip border-box. Merged into batch 5 by the coordinator.
- #1373 the import dialog loads a project's lists when it is picked. Merged into batch 5.
- #1384 sweep 1: popover clamp, `<html lang>`/`dir`, 390 px import table, Repeat row and date icon, cosmetics, whiteboard note at the centre. Merged into batch 5.
- #1385 `fix/moved-into-group-count`, from `chore/integrate-046-batch-4`, depends on #1378. FINAL. Status-group counts on a move (`moveHomeCounts`) and the list header and sidebar counter (`sprint.tasks`) by a debounced re-read (`queueSprintCounts`, `refreshSprintCounts`). Limits: only the open list's room is heard; other projects in the sidebar read `treeCache`; a server counter that lands later than 800 ms is off until the next event. "+N added" skipped (needs a server count).
- #1388 `fix/hand-check-sweep-2-docs-calendar`, from `beta`. FINAL. Calendar sprint lanes (`assignLanes`), doc Share dialog (own picker styles, switch titled "Shared with this project", `role="switch"`), new doc title "Untitled" is a placeholder. Wording "project" versus "workspace" is open.
- #1389 `fix/hand-check-sweep-2-panels`, from `chore/integrate-046-batch-4`, depends on #1378. FINAL. Title saves on blur (`commitName`); `closeOnRouteChange` and `Sidebar.vue` close on route change (a route to another page that still carries the same `?task=` keeps the panel open, by decision); `AvatarImage` and `useSignedProfileUrl` stop the bare avatar request (covers ListAssigneeCell, TaskSubtaskList, SubTasks, Members; NOT People directory, Goals, field values, Workload, Approvals, mention pickers, ChatListItem, TaskDetailAction, SprintsList); Undo toast on "Remove from this list" (row menu and chip ×).

To hand-test when batch 4 and 5 are built: a two-tab move (list header and sidebar count in the second tab), the Undo toast after "Remove from this list", the title saving on blur and discarding on Escape, the assignee picker and task panel closing on route changes, no `/<userId>_<n>_profile.png` 404s on the List view, the calendar lanes (light, dark, 390 px), the Share dialog (list, switch), and a new doc's title placeholder.

---

# Third sweep, build 762 (batches 4 and 5 together), 2026-10-02 early

Build 762 contains batch 5 (#1395: my #1366, #1373, #1384, #1385, #1388 and batch 4). Light 1024 unless said; dark checked by a DOM scan on the Inbox, My settings, AI accounts (with the token form open), Calendar, Share dialog; 390 px only for the Simple-mode phone bar (the new screens were not otherwise looked at at 390). Messaging to the coordinator was paused ("sessions messaging each other automatically"), so this file is the report. Created in QA Sandbox: project "[QA 046] copy" (duplicate, no tasks), 38 imported tasks in "[QA 046] list" (two imports, one update from the file; not undone this time), a second new doc (empty, "Untitled"), comments "[QA 046] live comment b5", a chat message, "[QA 046] B" moved to Sprint 1 (left there).

## My own fixes, by hand

- OK: task panel Lists row with an extra list: row 80 px = content 80 px, the Type row starts below it (no overlap). Goal chip not re-measured on a task that has a goal.
- OK: import dialog on a fresh load: pick a project, the List dropdown fills (disabled while loading), "Next" enables; the selects now look like the app's.
- OK: a task that moves lists: in a second tab, without a reload, "Sprint 1" went 13 to 14, "List" 6 to 5 and the status group "To Do" 4 to 3.
- OK: Calendar, two same-date sprints: each has its own lane (bands 22 px apart, 18 px high), dark scan clean. Not looked at in light or at 390 px (the pane was not displayed for screenshots).
- OK: doc Share dialog opened right after a reload, before the Goals page was ever opened: no bullets, rows 44 px, avatar 22 px; the switch row reads "Shared with this project" and is off for a private doc.
- OK: a new doc's title is empty with the placeholder "Untitled"; the breadcrumb reads "Untitled".
- Not on this build (they are in #1389): Undo on "Remove from this list" (the chip's × still gives a plain toast), title saves on blur, panels follow the route, avatar requests.
- Not re-checked: `<html lang>` after a language switch; the Add View menu near the right edge.

## Batch 4 list

1. Instant edits: OK in the List. A status change shows at once. With a refused write (a fake 400) the row went back to the old value in about 300 ms with one red toast carrying the server's reason ("Refused by the test"); a quick double status change settled on the last value with no flash back. NOT as described: with the network down (a request to a dead port) nothing is rolled back and no toast appears; the app's offline write queue (`offline.handleOfflineFailure`) answers as if it succeeded, so the row keeps the new status. Minutes later the rows I had changed that way were back at their old status without a toast ("Check page speed", "Slow list with 500 rows"). Priority, assignee, due date, title and Board were not tried; grouped-by-assignee counts not tried.
2. Rows from other projects: NOT TRIED. It needs a task of another project added to a QA Sandbox list, which changes a task outside QA Sandbox. Needs the owner or a sandbox pair of projects.
3. Import, update from the file: OK after a reload. A second run of the same file offered "Update them from the file"; with a task set to "Complete" in the app beforehand, the update (38 updated, 0 created) put it back to "In Progress" (the file's status). The preview says "A task counts as already here only in the project it was imported into. Importing this file into another project creates its tasks again." DEFECT (small): the open project page kept showing "Complete" after the update until I reloaded (the import writes are not pushed to an open page). Nit: the confirm button still reads "Import 38 task(s)" when it is updating. Board position and completion mark not looked at.
4. Duplicate project: the dialog is on the Projects page ("Duplicate project" in the row's "Project actions"), has Tasks, Assignees and Dates unchecked by default; the copy ("[QA 046] copy") opens with the folders and lists. Its currency is `ProjectCurrency` INR (code INR, symbol ₹; its `symbol_native` reads "টকা"); QA Sandbox itself has no currency field.
5. Add subtask with the Add-task row open: NOT TRIED.
6. Rollup on a parent: NOT TRIED.
7. Wording: the strings are in `en.js`: "Enter list name", "List created successfully", "Enter folder name", "Folder restored successfully", and `tbs_sub` "{tasks} across {n} project | {tasks} across {n} projects". Not seen on screen (the bulk bar and Home card were not opened).
8. `#/projects` without a company id: redirects to Home with the company id. One load showed the `PUT /api/v1/user` 403 once; a later `#/projects` load and an ordinary reload showed none.
9. Live updates in two tabs on 762: OK for a move, a comment (appeared in the second tab's open task panel) and a chat message. A goal change could not be tested (my edit of the target value did not commit), and the whiteboard note, custom field value, unread badge were not re-run.
10. Integrations (checked on 759, not repeated).

## Batch 5 list

2. Inbox: OK. The first tab is "Needs your approval" (9) with the agent proposals and Approve, Edit and Decline (not pressed); "Approve selected" is disabled until something is ticked; "Primary" still works. Home's "Waiting on you" per-card "Open" lands on `inbox?tab=approval`; the card's "Open in AI Inbox" link still goes to the AI inbox (`#/ai/inbox`).
3. Simple mode: OK. My settings > "How much to show" > Simple: the rail shows Home, My work, Projects, Inbox, Ask (plus More); More has a "MORE PLACES" section (Goals, Planner, Chat, Docs, Dash, Time); opening Planner put it on the rail. At 390 px the bar reads Home, My work, Inbox, Ask, New task, More (no Projects, as in Full, which has no Projects either). Back to Full: exactly the old rail (Home, Everything, Goals, Projects, Inbox, Planner, Chat, AI, Docs, Dash, Time, More). Left on Full.
4. Tokens: OK. AI > Accounts > My account > "New token" only opens the form (checked in the code first); "Expires after" has 7, 30, 90, 180 and 365 days with 30 preselected, with the line "You are told in your Inbox three days before it ends, and can renew it here."; a "Renew" button sits beside the existing token. Nothing created or renewed.
5. Task activity: OK. The History tab of a task has "All" and "Made by an agent"; with no agent changes it says "No changes made by an agent". The project's activity log was not looked at.
6. Not tried: timer after a hard reload (it would log into the owner's approved week); the company currency on a goal's money target and on a new project.
7. Not tried (no "[QA 046]" week).
8. Pickers (one-person people field, date-only field, quick create assignee, folder restore): not tried.
9. Table totals: a "Total" row exists per group in the Table under number columns (for example Points 5 after my edit); not compared line by line with the List.
10. Goals: the goal panel has a "Summarise" button (AI is configured on this instance, so it is expected); not pressed.
11. Connections: no "My connections" card; the page shows the MCP server, the external agents, and the app chips; no broken card, no error.

## New defects from this round

- Offline: a failed network write is queued and shown as done; it later reverts without a toast (see batch 4, item 1).
- Import update does not refresh an open page (batch 4, item 3).
- Nit: "Import N task(s)" button when updating.

---

# Fourth sweep, build 764 (batch 6 and the agent policy), 2026-10-02 00:20

Light 1024; dark by DOM scan and a screenshot; 390 px by overflow scan (no overflow on the Project Details view, Connect your AI and the Inbox). The pane stopped being displayed during this round, so screenshots came from a new tab. Messaging to the coordinator was still paused by the harness; this file is the report. Left: theme Light, mode Full, "Agents and Done" back on "With approval", Project manager switch OFF.

1. Project Details (added the "Project Details" view to QA Sandbox): OK. "Agents in this project": two radio groups ("Agents and Done": Never, With approval, Yes marked unchecked; "Connected agents": Propose everything, Act on single tasks propose anything wider), one sentence under each choice. Defaults are "With approval" and "Act on single tasks". Picking "Never" shows "Saved." and is still "Never" after a reload; put back to "With approval". "Project manager" is below, a switch, off by default: turned on once, "What needs attention" filled at once with 10 "Date slipping" rows (for example QAS-96 "Due 314 days ago", "Choose a new date."), the switch stayed on after navigating away and back, then turned off (the list disappears). NOT SEEN: rows saying "Review in Inbox" and the Inbox row "The system, for QA Sandbox ...": turning the switch on filed no proposal (Inbox "Needs your approval" stayed at 9); it needs the daily run.
2. Connect your AI (`#/ai/connect`): OK. Says "Not connected yet. This line changes by itself when your AI app makes its first call."; Claude and ChatGPT cards say "Connecting an app by its address is switched off on this install ... Setting to switch on: MCP_OAUTH"; "Claude Code and other tools" has "Create a token" (not pressed); "What your AI can do here" lists the read tools and what is "SWITCHED OFF ON THIS INSTALL" with MCP_TOOLS_DATA, MCP_TOOLS_MANAGE and MCP_TOOLS_WORK. Nit: the "Not connected yet" strip has a blank space where an icon would be. The Home setup card is not shown for this account.
3. Simple mode, Ask tile: it opens the Ask page, which is right here because AI is set up on this install; "Connect your AI when no AI is set up" could not be seen. Mode put back to Full.
4. Ask page, "Automate with AI", the agent catalogue "with no AI model": NOT TESTED (AI is on).
5. A proposal that files a new task with a preview card: none exists (the project manager filed none), skipped.
6. Regression: no script error and no failed resource (0 responses of 400 or more) on Home, a project List and Board, a task panel, chat and Docs after the rebuild. The avatar 404s are gone on those pages.
7. Dark: Project Details, Connect your AI: no light surface or dark-on-dark text (the scan flags `div.section-right.bg-white` on Project Details but its dark children cover it completely). 390 px: no overflow.
8. Carried over: the Add View menu is still unclamped on this build: left 866, right 1348 in a 1024 px window, because #1384's `positionPanel` places the panel only once, before the view catalogue has loaded (the panel is nearly empty then and grows to 482 px afterwards). Draft #1403 (`fix/add-view-menu-stays-on-screen`) fixes it with a ResizeObserver (`followPanelSize`) in `DropDown.vue` and `CustomDropDown.vue`; spec failed first ("expected 1348 to be less than or equal to 1016"); not seen in a browser; one risk: a resize loop between placing and re-measuring, guarded by comparing sizes. FINAL, no more pushes.

---

# Fifth sweep, build 765 (batch 7), 2026-10-02 00:50

Light 1024, dark by computed colours, 390 px by overflow scan and a screenshot. Messaging was still paused, so this file is the report.

1. Home "What next": OK. A line above the cards reads "WHAT NEXT / 9 things need your approval." with a Review button. Review opens `inbox?tab=approval` and the tab's badge reads 9, the same number. Dark: dark surface (rgb 24,24,28), light text, lavender button with dark text, themed. 390 px: full-width Review button (44 px high), no overflow. Keyboard order: Skip to content, then a visually hidden "Review queue" button (a skip link to the queue), then the rail, the header (… Available, Manage cards, + New, the Planner toggle, which is named by its title) and then Review, then the "To Do / Done / Delegated" tabs; so Review comes after the header and before the cards, as it should. Keys themselves could not be sent through the pane; this is read from the tab order in the DOM.
2. Empty screens: OK. An empty project (the "[QA 046] copy" duplicate) shows its List groups with 0 and an empty Board with dashed "Drop a task here" zones in each column; Everything with a search that matches nothing says "No tasks match these filters / Change or clear the filters to see more." with "Clear filters"; Goals > Archived says "Nothing archived / Archived goals show here, and can be restored." No "say it" row on any of them (AI is connected on this install, so "with no AI connected" could not be tested). Not reached: an empty folder's own page (clicking the folder in the sidebar only toggles it).
3. Sample data: skipped. There is no WELCOME sample project in this workspace.
4. Regression: no script error, no unhandled rejection and no "AxiosError: Network Error" on Home, a project List and Board, a task panel, chat, Docs, Goals and the Inbox (hooked `console.error`, `error` and `unhandledrejection`). One failed resource remains over those routes: `GET /<userId>_52097645091_profile.png` answers 404 (the bare avatar request; one instance now, where there were many before #1389).

---

# Summary for the coordinator (batches 4 to 7), worst first, plus FINAL lines

FINAL, no more pushes, all drafts: #1389 (panels: title on blur, panels follow the route, avatar, Undo), #1388 (docs and calendar), #1403 (the Add View menu clamp). #1385 was declared final earlier.

1. Offline writes. With the network down, an instant edit is not rolled back and shows no toast: the offline write queue answers as success; minutes later the rows I had changed reverted silently. A refused write (HTTP 400) is right: reverts in about 300 ms with one red toast carrying the server's reason.
2. An import "update from the file" does not refresh an already open project page (the old status stays until a reload); the confirm button still says "Import N task(s)" when it is updating.
3. The Add View menu was still unclamped on 764 (right edge 1348 in a 1024 px window). Cause: the first placement runs before the view list has loaded. #1403 re-places it with a ResizeObserver; not seen in a browser; risk: a resize loop (guarded).
4. One bare avatar request still returns 404 (`/<userId>_<n>_profile.png`) over Home, List, Board, task panel, chat and Docs on 765.
5. Home's "Open in AI Inbox" link still goes to the AI inbox, not to the new "Needs your approval" tab.
6. Not seen: rows saying "Review in Inbox" and the Inbox row "The system, for QA Sandbox"; turning the Project manager switch on filed no proposal (it needs the daily run).
7. Nits: the "Not connected yet" strip on Connect your AI has a blank space where an icon would be.
Working on 762 to 765: Lists row, import dropdown on a fresh load, move counts in a second tab, calendar lanes, Share list and switch, doc title placeholder, instant edits with a refused write, Simple and Full mode, token form, Inbox tab, Connect your AI, the project agent cards (they persist), the "What next" line (9 equals the badge, dark and 390 px fine), empty states, no console errors.

---

# Sixth sweep, build 766 (batch 8), 2026-10-02 01:10

Light 1024, QA Sandbox only. Messaging was still paused. Left: Project manager switch OFF; "[QA 046] B" is not handed to an agent.

1. "Hand to an agent": OK. With the Project manager switch ON for QA Sandbox, the task panel of "[QA 046] B" (it has an Owner, Local PM) shows a "Hand to an agent" button. Pressing it turns the line into "Waiting for an agent to take it · Handed to an agent" with a "Take it back" button. The Project manager card on the Project Details view lists "Handed to an agent / QAS-17 [QA 046] B / A person handed this task to an agent / The agent that takes it does what the task asks." (the card has no "Take it back" button of its own). "Take it back" removes the line from the panel and from the card.
2. Switch OFF: after a reload the task shows no "Hand to an agent" button. DEFECT (small): without a reload, in the same session, the button was still there after the switch was turned off (the project's setting is read once).
3. Regression: no script error, no unhandled rejection on Home, List, Board and the task panel; the task panel's rows and actions are as before. One failure remains: the bare avatar request `/<userId>_<n>_profile.png` answers 404 (three of them over these four routes).

---

# Seventh sweep, build 769

Light 1024; dark by computed colours and DOM scan (Project Details with the new cards, the Inbox approvals tab with the Decline panel open, Members); 390 px by overflow scan (Project Details, the Inbox with the Decline panel open, Members, List: no overflow on any). Messaging to the coordinator was still paused, so this file is the report. Theme is back on Light, viewport desktop; "[QA 046] B" is back on its original title.

1. Project Details, owner view: OK. "What the agents remember" is there (decisions and constraints with "Add", "Show retired (4)", recent runs). The standing-approvals card is titled "Always do this": "Changes a connected agent makes here without asking, because a person chose "Always do this" on an approval. Each one ends after 90 days." with "None yet. Choose "Always do this" on an approval in the Inbox to add one." Dark: themed (the scan flags `div.section-right.bg-white` as before; its dark children cover it). 390: no overflow. NOT CHECKED: the plain member view (needs a second account; owner needed).
2. Inbox "Needs your approval": 8 approvals now. "Always do this" is not on any of these rows: the button is only drawn for a proposal with `p.always` (eligible changes from connected agents), none of the eight; so it was not exercised (and I would not press it: it creates a standing approval). Decline, checked without submitting: the panel reads "WHY DECLINE?" with the reasons "Too many changes", "Wrong tone", "Needs a person", "Not now", a text field "Or say it in your own words", "Decline" (disabled until a reason is chosen or typed; enabled after typing), "Cancel" and "Decline without a reason". Themed in dark; at 390 the panel is 346 px wide inside the screen. Nothing was declined.
3. Plain words: nearly clean. No "sprint" in the rail, the List, Board, Calendar, Gantt, task panel, Everything, Goals, Planner, Timesheet, Dashboards, Docs, Ask, Automations, Approvals. Left: the Projects page footnote says "...otherwise from overdue count and sprint burn-down."; Settings > Projects and the Table view show an item "Sprint Planning" (a view or project-tab name). The assignee picker lists the agent "QA Reviewer" twice.
4. Agent work in view: partly. List, Table and Board each carry an "Agent working" pill beside the "Done by" menu, but it is hidden at the moment (no agent is working on a task in QA Sandbox), and so is the agent mark on rows; I could not see either.
5. Members: the page lists "claude-code · Agent", "Connected by Local PM · Last worked 11h ago · Takes no seat and has no role of its own" (named claude-code, not "My Claude"). NOT FOUND: "My Claude" in the assignee picker (it lists Local PM, 8 members and 10 agents, without claude-code) and in the @ list in a comment (the popup did not open for a typed "@" in this pane, so inconclusive). Possibly needs the MCP flags; untested.
6. #1389 on 769: the title saves on blur (changing "[QA 046] B" and clicking away saved it); Escape discards; a blank title is ignored and the old one stays; the original was restored. The task panel closes when the route stops naming a task (back), reopens on forward, closes on a move to Chat; an open assignee picker closes on the route change. Undo: removing "[QA 046] list" from a task shows an Undo button; pressing it put the list back (toast "Added to [QA 046] list."). Bare avatar request: none on the List or the Board; one `/<userId>_<n>_profile.png` 404 appears when the Table opens and stays on Members and the task panel loads: the Table (and possibly others) still has one.
7. Add View menu on 769: STILL OFF SCREEN at 1024 px: left 850, right 1332 (inline `left: 849.961px; top: 49.79px`). #1403 is merged (`followPanelSize` is in the source), yet the ResizeObserver did not re-place the menu when the view list loaded and it grew to 482 px. A plain `window` resize event placed it correctly at once (left 518, right 1000, aligned to the trigger's right edge), so `positionPanel` works when called; the observer path is not firing for this menu in a real browser (the spec faked it). At 390 px the Add View sheet is full width (-1 to 391) and fits.
8. Home: the "What next" line renders ("8 things need your approval." with Review; it equals the badge) and there is no console error on Home, the List, Members, the Inbox, Project Details.

Defect count this round: the Add View menu (item 7), the bare avatar request on the Table (6), the missing "My Claude" in the picker (5), the leftover "sprint" wording (3), the duplicate "QA Reviewer" agent (3).

---

# Eighth sweep, build 772

Task 047 (AP-441), builds 770 to 772, 2026-10-02 about 11:00 to 11:35, owner "Local PM". Light at 1024 x 768 (emulated; the pane itself is 557 wide); dark by setting `data-theme="dark"` on `<html>` and scanning computed colours (the stored theme `ah.theme` was never changed, it is still `light`); 390 x 844 by a fresh load of each page and an overflow scan, plus one screenshot. Driven with `javascript_tool`; console read with `read_console_messages` between two markers. No code changed, nothing committed.

Left behind: task "[QA 047] place 1" (QAS-131) in QA Sandbox > "[QA 046] list", assignee Priya Shah, due 15 Oct, with one manual time entry of 5 m on Fri 25 Sep ("[QA 047] manual entry"). Put back: "Agents at work at once" is 3 again, agents resumed, "[QA 046] A live" has its title again, the workspace switch "A person checks before Done" is off again, the dashboard card period is "This week" again, theme Light, viewport desktop.

1. Add View menu at 1024: NOT REPRODUCED on 772, the menu stays on screen. The trigger sits at 932 to 1024 once the view row is scrolled to its end. Opened the moment the button exists after an in-app navigation: at 0 ms the panel is 150 px wide, left 866, right 1016 (height 0); at 20 ms it is 482 wide, left 534, right 1016; the same at 100 ms, 300 ms, 600 ms, 1 s and 3 s (`left: 534px; top: 103.789px`). After a full reload (opened 5 s and 13 s after the load): left 534, right 1016 at 20 ms, at 1 s and at 3 s. With the trigger pushed half off screen (1014 to 1106) the menu is still 534 to 1016. So the re-placement that did not fire on 769 fires here. Note: at 1024 the view row is 716 px wide for 1442 px of tabs (12 views), so "Add View" starts at x 1658 and is only reached by scrolling the row sideways.
2. Project Details, QA Sandbox.
   - DEFECT (large), "Agents working at the same time": the card floats over the page instead of sitting in the column. `section.pal` (`data-test="project-agent-limits"`) is hit by the command palette's global rule `.pal` in `app.*.css` (`position: absolute; top: 12vh; left: 50%; transform: translateX(-50%); width: 640px; overflow: hidden; box-shadow: var(--shadow-modal)`) on top of its own scoped `.pal[data-v-2435aa0c]`. Measured at 1024: card at left 386, top 112, right 946, bottom 286 (341 when paused), with the modal shadow, over the description (359,154 to 695,226), over "What the agents remember" (359,246 to 695,612) and over the Details column; its top edge is above the bottom of the view tab row (117). It takes no room in the column: "Agents in this project" ends at 1236 and "Always do this" starts at 1256. Its hint lines are cut: `.pal__hint` also gets the palette's `white-space: nowrap` and mono font, so the first hint is 835 px of text in a 560 px box, the second 583 in 560, the third 698 in 398.
   - DEFECT (blocking at phone width), same card at 390: the palette's `@media (max-width: 767px)` rule (`top: 0; left: 0; width: 100vw; height: 100dvh`) makes the card 0,20 to 390,864. It covers the whole Project Details view, it does not move when the page behind it scrolls, and `elementFromPoint` at y 30 to 600 is the card. Only the top 20 px of the header and the bottom bars stay reachable. Screenshot taken: a white screen with the title, the select, "Pause all agents" and three cut hint lines.
   - The number: changed 3 to 5, "Saved." appears, still 5 after a reload; put back to 3 ("Saved.").
   - Pause: "Pause all agents" works at once, no confirm; the card then says "Agents are paused in this project. They take no work and change nothing here until someone resumes them." with "Resume agents / Agents can take work and make changes here again." My own edit while paused works: renamed "[QA 046] A live" from the task panel, toast "Task name updated successfully", the row changed; renamed back.
   - DEFECT (small), header chip: "Agents paused" (span `ph2__agents--paused`, 509,39 to 607,65, background rgb(26,26,26), white text) is NOT shown after pressing Pause, neither on Project Details nor after switching to the List; it appears after a reload. After "Resume agents" the chip stays (still there 5 s later) until the next reload. After the reload: no chip, button reads "Pause all agents", number 3.
   - Agent settings card ("Agents in this project"): as on 769; "With approval" and "Act on single tasks" are selected. "Always do this": same text as on 769, "None yet. Choose "Always do this" on an approval in the Inbox to add one." Nothing pressed.
   - Dark: the card, its select and its button are themed (rgb 24,24,28 with text rgb 242,241,246); the scan flags only `div.section-right.bg-white` (covered, as before) and one avatar image. The placement defect is the same in dark.
3. Quick create: OK. With "[QA 046] list" open, then the Inbox, "New task" opens "NEW TASK" on Project "QA Sandbox", List "[QA 046] list", Status "To Do", Assignee "Local PM", no due date, Priority "Medium". Created "[QA 047] place 1" with Priya Shah and 15 Oct: toast "Task created / Open"; the row shows Priya Shah, Oct 15, Medium. Opened again with the c key (a dispatched keydown on the body opens it) about 10 s later: Priya Shah and 2026-10-15 are carried over, the name is empty, Project and List are the same. QUESTION: it was still carried over 13 min 45 s later and after several full reloads (stored in `localStorage` as `ah.quickCreate.created.<company>.<user>` with an `at` time); I did not find where it ends. At 390 the dialog is 16 to 374, no overflow.
4. Plain words.
   - OK: project tree "0 tasks", "1 task", "91 tasks"; Everything "251 tasks" and, with a search that leaves one, "1 task"; the dashboard card "Tasks by status" reads "2 tasks across 1 project" and, for last week, "1 task across 1 project"; header "0 watchers". The List bulk bar reads "1 selected" (no noun). Notifications: "Project List Create" and "Project Folder Create", no "sprint". Permissions, Simple tab: no "sprint". Integrations > JSON webhook form: "Name", "Webhook URL", "Events"; no "Payload URL" anywhere. No "sprint" on Notifications, Routing policy, Time Tracking, Integrations, Connections, Automations, Approvals, the Milestone, Variance and Capacity reports, Ask, AI Inbox, AI Agents, Routing, Accounts, Health, Quality, Release, Connect your AI, Members, Home, My timesheet.
   - LEFTOVER, plurals: List row badge title "Risk 4 — Only 0 of 1 subtasks done"; Everything row badge title "1 subtasks" (three rows); AI > Teammates "1 projects · 1 skills"; Dashboards list "1 CARDS".
   - LEFTOVER, "sprint": the report tab bar "Portfolio | Sprint | Velocity | Milestones | Variance | Custom" (seen on Portfolio and Custom Report); Custom Report group button "Sprint" and the templates "Tasks by sprint" and "Story points by sprint"; AI > Skill library "task.sprint.move / Move a task between sprints"; Permissions > Advanced, seven descriptions ("Add a new list or sprint inside a project.", "Rename a list or sprint.", "Move a list or sprint out of the way without deleting it.", "Delete a list or sprint.", "Bring an archived list or sprint back.", "Switch a list between a plain list and a sprint.", "Move a task to another list, sprint or project."); Settings > Projects still shows "Sprint Planning" (as on 769).
5. AI > Accounts > Modes, "A person checks before Done" (OWNER AND ADMIN): OK. Ticking "A person checks an agent's work before a task is closed" shows "Saved."; still ticked after a reload; the project's agent card then carries the line "The workspace has a person check an agent's work before Done, so a person closes every task here whatever is chosen below." (the radios under it stay enabled). Unticked: "Saved.", and unticked after a later reload. Dark: card rgb 24,24,28, nothing flagged; the note on the project card is themed. 390: card 16 to 372, no overflow.
6. Time: the timer could NOT be run. "Start timer" on "[QA 047] place 1" is refused (twice by a scripted click, the same toast both times; a pane click by coordinate did nothing, most likely a miss under the emulated viewport) with "That day is in an approved timesheet period, so time can't be added to it."; the timer stays idle. Cause: the owner's own week SEP 28 – OCT 4 is "Approved" in My timesheet (with a "Reopen" button); I did not reopen it, it is not sandbox data. So the approved-week refusal is seen (at the start, in plain words) and the 70 second start and stop is NOT CHECKED. "Add time" on a day of last week works: "Time saved", the entry "Local PM / Fri 25 Sep, 09:00 / [QA 047] manual entry / 5m / Edit" appears and the head reads "5m logged"; no console error. DEFECT (small): the Minutes field has `step="5"`, so 1 minute is refused by the browser's own check ("Please enter a valid value. The two nearest valid values are 0 and 5.") and "Save time" does nothing, with no message from the app. Nit: a hidden `<audio class="d-none" src="">` in the task panel fires a load error each time the panel opens (no console line).
7. Offline edit: NOT CHECKED. The pane has no way to cut the network.
8. Import: NOT CHECKED. No earlier file is offered: "Start an import" opens "Bring your work in / Where is your work now?" with the six sources and then wants a file from disk; "Recent imports" only lists the past runs with "Undo this import". Nothing imported, nothing undone.
9. Home and Inbox: OK. "WHAT NEXT / 8 things need your approval." with Review. The card "Waiting on you 8" lists the approvals (each with WHY, Approve, Open) and ends with the link "Open in the Inbox", which goes to `inbox?tab=approval` (fixed since the note of sweeps 4 to 7); the tab opens with its badge at 8, the same number. Inbox > "Needs your approval": 8 rows render. There is no card for a batch, a project setup or an automation among them; all eight are agent runs. One card's lines: "Daily PM wants to Break a brief into subtasks · 6 changes on QAS-1 / 12 Sept / WHY The task involves reproducing and fixing a login issue on Safari ... / WHAT CHANGES / New subtask / Reproduce the issue on Safari / Under / Login fails after a password reset on Safari" (five such), "Post the breakdown summary and open questions", then Approve, Edit, Decline. Decline on that row opens "WHY DECLINE?" with "Too many changes", "Wrong tone", "Needs a person", "Not now", a text field, "Decline" (disabled), "Cancel", "Decline without a reason"; Cancel closes it; still 8 rows. Dark: nothing flagged. 390: panel 23 to 369, no overflow. Nothing approved, nothing declined. Note: the rail's Inbox link (`/inbox`) landed on `inbox?tab=approval&kind=all`.
10. Connect your AI: the "Not connected yet" line now has an icon, a 14 px clock (`svg.cya__waiting`) before the text; the connected line has a green 8 px dot. 390: the strip is 16 to 372, no overflow (the AI section nav scrolls sideways inside itself, 604 in 324). DEFECT (small): this workspace is connected, yet after a fresh load the strip reads "Not connected yet. This line changes by itself when your AI app makes its first call." for about 10 s (read at 3.2, 5.0, 7.0 and 9.0 s) and only then turns to "Connected. Your AI app was last seen here around 01/10/2026, 22:13:13." (from 11.0 s). Dark: nothing flagged.
11. Members: the row reads "My claude-code / Agent / Connected by Local PM · Last worked 13h ago · Takes no seat and has no role of its own" and, under it, "You can hand it a task from the assignee list in any project where the project manager is on." (it was "claude-code" on 769). Dark: nothing flagged. 390: no overflow.
12. Console: no error and no warning between the two markers over fresh loads of Home, the Inbox, QA Sandbox List, Board and Table, Project Details and AI > Accounts, and none during the rest of the round. No response of 400 or more on any of those loads: the bare avatar 404 on the Table is gone. The older "net::ERR_CONNECTION_REFUSED" and "AxiosError: Network Error" lines in the pane's console are from before this round (the server restart).

Also seen: Settings > Integrations has one connected webhook, "Sweep hook", JSON, `https://example.com/sweep-hook`, "All task events", "Last: 405 · 02/10/2026, 11:15:06", so every task event of this install is posted there; not mine, left as it is. The footer strip "LIVE / Daily PM is on AP-116 · Code Reviewer is on AR-49 / Pause all agents" is on every page (at 390: "2 agents working"); I did not press its Pause.

Defect count this round: the floating "Agents working at the same time" card (2, blocking at 390), the "Agents paused" chip that needs a reload (2), "Not connected yet" for the first 10 s (10), minutes only in steps of 5 with no message (6), the leftover plurals and "sprint" wording (4). Not checked: the timer run (the owner's week is approved), offline, import with the same file, the "Not connected yet" state on a workspace that is truly not connected, a plain member's view (needs the owner).

---

# Ninth sweep, build 782

Task 047 (AP-441), 2026-10-02 about 12:20 to 12:55, owner "Local PM". Settings > Instance > Upgrade reads "v14.36.0-beta.782". Light at 1024 x 768 (emulated; the pane is 557 wide) and once at 1440 x 900; dark by the app's own switch (Settings > My settings > Theme > Dark, which sets `data-theme` and `ah.theme`), fresh loads, a scan of computed colours and six screenshots; 390 x 844 by fresh load plus an overflow scan of 24 routes. Driven with `javascript_tool`; console read between markers. No code changed, nothing committed.

Left behind: one more time entry on "[QA 047] place 1" (QAS-131), 1 m on Fri 25 Sep, "[QA 047] one minute" (the head now reads "6m logged"; I do not delete entries). "[QA 047] list" and "[QA 047] folder" are in the Trash (Lists and Folders tabs, each with Restore). The audit log has my `agent.project_policy_changed` rows of 12:28. Put back: "Tasks a connected agent changes on its own" is 10 again, "Agents at work at once" was not touched (3), agents resumed, the test list was made a plain list again before it was deleted, theme Light (`ah.theme` = light), viewport desktop.

## The eighth sweep's defects

1. "Agents working at the same time": FIXED. The section is now `section.plim` (no `.pal` class), `position: static`, no shadow. At 1024: 359,1256 to 695,1539, inside the column (340 to 713), after "Agents in this project" (ends 1236) and before "Always do this" (starts 1559). At 1440: 359 to 919, the same order. At 390: 0,288 to 390,564 in the flow (previous card ends 268, next starts 584), `elementFromPoint` on it is the card, nothing fixed or absolute larger than 300 x 500 on the page. The four hints wrap (`white-space: normal`, scrollWidth = clientWidth: 336/336 at 1024, 560/560 at 1440, 390/390 at 390), Inter Tight, not mono. Second control "Tasks a connected agent changes on its own" (1 to 100, was 10): set to 12, "Saved.", still 12 after a reload, set back to 10, "Saved.". Its hint: "A connected agent changes up to this many different tasks in 10 minutes without asking. Its change to one more task waits for a person's approval. New tasks and docs count too." Dark: select and button rgb(24,24,28) with text rgb(242,241,246), border rgba(255,255,255,0.16); nothing flagged but the covered `section-right.bg-white`.
   - DEFECT (small, 390 only): four cards have no side gutter, their text starts at x 0: "Agents in this project", "Agents working at the same time", "Always do this", "Project manager" are 0 to 390 with margin 0 and padding 0, while "What the agents remember", "Default task template" and "Assignment rules" are 16 to 374. The column also scrolls sideways by 40 px (`.project__detail-component` scrollWidth 430 in 390; `.projectRightside` is 0 to 430). The document itself does not overflow.
2. "Pause all agents": FIXED. No chip before; 50 ms after the press none yet, at 200 ms the chip "Agents paused" is in the header (515,45 to 613,71, background rgb(26,26,26)) and stays; the card switches to "Agents are paused in this project…" with "Resume agents". After "Resume agents": chip still there at 50 ms, gone at 200 ms and after; the button reads "Pause all agents". No reload either way.
3. Connect your AI: FIXED. Three fresh loads in a same-origin frame sampled every 16 ms and one top-level load sampled every 50 ms: the strip is either "Checking whether your AI app is connected…" (seen from 223 ms and from 472 ms) and then "Connected. Your AI app was last seen here around 01/10/2026, 22:13:13." (at 629 to 1376 ms), or goes straight to "Connected.". "Not connected yet" was never shown.
4. Add time: FIXED. The Minutes field has no `step` now (min 0, max 59), the form is `novalidate`. Hours 0, Minutes 1 on Fri 25 Sep: toast "Time saved", the entry reads "1m", the head "6m logged". Minutes 75: the form stays, an inline line (`p.ah-time__error`, `role="alert"`) and a toast both say "Enter whole hours from 0 to 23 and whole minutes from 0 to 59."; 1.5 gives the same line; 0 and 0 gives "Enter a date and a duration above zero." Same at 390 (under the Properties tab).
   - DEFECT (small): the form's inputs overrun their cells. `.ah-time__input` is `box-sizing: content-box`, width 164 px plus 8 + 8 padding and the border, in two 164 px columns with an 8 px gap. At 390: Date 27 to 209 and Start 199 to 381 overlap by 10 px, Hours and Minutes the same, and the right column and Note end at 381 where the grid ends at 363. The same 10 px overlap at 1024.
5. Counts and wording: FIXED for every place listed. List badge title "Risk 4 — Only 0 of 1 subtask done"; Everything "1 subtask" (three rows) and "2 subtasks"; AI > Teammates "1 project · 1 skill" (four), "11 projects · 1 skill", "11 projects · 2 skills"; Dashboards "1 CARD", "0 CARDS", "3 CARDS", "5 CARDS"; Custom Report group "List", templates "Tasks by list" and "Story points by list"; Skill library "Move a task to another list"; Permissions > Advanced: "Add a new list inside a project.", "Rename a list.", "Move a list out of the way without deleting it.", "Delete a list.", "Bring an archived list back.", "Switch a list between a plain list and a sprint.", "Move a task to another list or project."
   - LEFTOVER (not on the fix list): Docs > Wiki "1 PAGES"; the report tab bar still reads "Portfolio | Sprint | Velocity | Milestones | Variance | Custom"; the Skill library's key column shows `task.sprint.move`; Docs > Templates has "Sprint retro".
   - DEFECT (medium, may be older): Settings > Security & permissions is plan-locked for this workspace (`div.sp.sp--locked`; the body has `filter: blur(3px)`, opacity 0.5, `pointer-events: none`, "Save changes" disabled) and the notice that says so ("Upgrade to Unlimited To Unlock Security & Permissions / That feature isn't available on your current plan / Upgrade Your Plan") is centred in the 4975 px tall block, at y 2370 to 2735. At the top of the page the owner sees only a blurred table with no reason (screenshot taken).
6. Task panel media: FIXED. The hidden `<audio class="d-none">` has no `src` attribute (networkState 0, no error object); a capturing `error` listener on the document caught nothing while the panel opened, the time form was used and the panel closed; no console line.

## New on this build

7. Empty screens.
   - OK, says what the place is for and has one action: Inbox > Other ("Nothing from things you watch / Updates on items you only watch land here. Anything assigned to you or mentioning you stays in Primary. / Back to Primary"), Later ("Nothing saved for later / Press S on a row, or choose Snooze…"), Cleared ("Nothing cleared / Rows you clear stay here for 30 days, then they are deleted."); "Back to Primary" works; "Clear all" is disabled on the empty Later tab. An empty folder: "[QA 047] folder has no lists yet / Tasks live in lists. Add the first list to this folder and its tasks will show here. / New list / Or say it: Add a list called Backlog to this folder. / Copy / Ask it here"; "New list" opens "New list in [QA 047] folder". An empty dashboard: "This dashboard has no cards yet. / Add your first card", which opens "Add a card". Portfolio: "No portfolio yet / Group the projects you are accountable for…/ New portfolio", which opens the form. Gantt of an empty list: "The Gantt chart shows your plan in time / … / Add a task".
   - DEFECT (medium): a list created seconds ago shows the unexplained-empty text on the List and the Table: "No tasks to show here / A task was created in this project at some point and nothing is narrowing this view, so we cannot tell you why it is empty. The tasks may have been archived or deleted, or this view may have failed to load them — reloading rules that last one out." with "Create task" (works: it focuses the inline "Task name" row) and "Learn more" (`https://help.alianhub.com/tasks`, new tab). A new list needs the first-run wording the empty folder has. On the Board the three columns only say "Drop a task here".
   - DEFECT (small): after "Move to folder…" the address stays on the old `/s/<listId>` route; on that address after a reload the same empty state has no "Create task" button, only "Learn more". Through the tree link (`/fs/<folderId>/<listId>`) the button is there.
   - Explains but offers no action: Approvals > Time and Leave ("Queue clear / Nothing waiting for you. Submitted timesheets and leave requests show up here."), Docs > Agent-drafted ("No agent drafts waiting / When an agent writes a page … it lands here for your review."), Docs > Shared with me ("Nothing is shared with you yet / A doc that someone shares with you by name shows up here."), Docs > a project with no docs ("No docs in this project yet. / … Use New doc above to start one."), Goals > Archived ("Nothing archived / Archived goals show here, and can be restored."), AI Inbox > Approvals ("No workflow is waiting on you / …") and Reports ("No reports yet / Reports from scheduled agents that run as you appear here.").
   - Weak: Dashboards > Shared with me has no line at all, only the "Start from a template" tile. Audit log > "Outside agents" and "Refusals" (0 events) say "Nothing has been recorded yet. / This is the record of who changed what in this workspace, and when.", which is the text for an empty log, not for an empty filter.
   - Not empty for this account, so not seen: Goals (2), Docs (13 pages), Dashboards, Automations, Approvals (8), Trash.
8. Folders and sprints: OK. "+ New > New folder" (name, Enter): "Folder created successfully", the row "[QA 047] folder 0" appears. "+ New > New list": "List created successfully", the list opens. Tree row menu > "Move to folder…": the card "Choose where [QA 047] list goes" lists "Top level of the project ✓" and seven folders; choosing "[QA 047] folder" gives "List moved" and the row becomes a level 3 row under the folder. "Make it a sprint": "Sprint settings / Run this list as a sprint" with goal, start date (today), duration (1 to 4 weeks, Custom) and end date; Save gives "Sprint updated" and the menu then offers "Start sprint", "Sprint settings", "Make it a plain list". "Make it a plain list" asks "Make [QA 047] list a plain list? / Its sprint dates are cleared. Its tasks stay where they are."; confirmed: "[QA 047] list is a plain list now", the menu is back to "Make it a sprint". Delete: "The list and its tasks move to the trash." and, for the folder, "The folder is empty. You can restore the folder from the Trash." with an Undo on the toast (the list's toast, "[QA 047] list deleted", has none).
   - DEFECT (medium): the tree row menu only opens downward. For a row at y 535 in a 768 px high window the menu is 561 to 835: "Make it a sprint" (720 to 752) is under the LIVE bar (from 728; `elementFromPoint` at y 740 is the bar), "Archive" (765 to 797) and "Delete" (797 to 828) are below the window, and the tree has no scroll of its own. I reached them by script only. With the row at y 359 the menu fits (387 to 661).
9. Plain labels for what an agent did: PARTLY.
   - OK: AI Inbox (Waiting, Done by AI, Declined, the detail pane) shows no raw key; the detail reads "WHAT CHANGES · 1 ACTION · SOME CANNOT BE UNDONE / Post the breakdown summary and open questions / not reversible". In the audit log the known skills read "Add a comment", "Attach a link", "Change the status", "Add a subtask", each with its key in the `title` (`task.comment`, `task.link`, `task.status.set`, `subtask.create`).
   - DEFECT (medium), raw keys still in the EVENT column (mono, no label): All tab `agent.project_policy_changed` (14), `agent.workspace_policy_changed` (2), `agent.proposal_decided` (1), `automation.task.comment` (5), `workflow.automation_rule` (2; 24 of the 25 rows under "Agents only"); Gated actions `docs.read`, `model.call`, `tasks.next`, `tasks.search`, and two rows with a bare `task.status.set`.
   - Also raw in the same table: the thing acted on is often a 24-character id ("Add a comment 6a9954186dd786246031e496", `agent.workspace_policy_changed 6a8ee973…`), reasons read "approved proposal 6ab3ef04… by 6a8ee972…", "not_visible: the task is not one the person behind this token can open", "spend_cap_exceeded: …", "brief.parse finding".
   - Small: AI Inbox > Declined has a row whose title is the word "undefined" (Intake Bot, 21 days ago); one row kind reads "Qa brief summary"; a detail titled "6 changes on QAS-4" lists "1 ACTION" (approved with edits).
10. Colours.
   - Dark, by the real switch, fresh loads of Home, Inbox (approval, Primary, the empty Later tab), List, Board, Table, Chat, the task panel, the project tree with its row menu, the empty list, Connect your AI, AI providers, My settings: no white box and no text under 4:1 against its background anywhere (lowest seen 6.6:1, the purple links rgb(168,146,255) on rgb(24,24,28)). The scan flags only the active rail tile (white, with a black icon: intended) and the covered `section-right.bg-white` on the Board. Borders are there on cards, inputs and the menu (rgba(255,255,255,0.09 to 0.16)). At 390 in dark: nothing flagged on 24 routes.
   - Nit (dark): "Start timer" in the task panel is rgb(0,0,0) with a 0 px border on the panel's rgb(24,24,28), so its edge is hard to see; "Add time" beside it has a border.
   - Light: Home, Inbox, List, Board and Table looked as usual in the screenshots (the pane shows 1024 px at 0.54 scale, so this is a coarse look, and I have no earlier picture to compare against).
11. Console: no error on fresh loads of Home, Inbox, QA Sandbox List, Board, Table, Project Details, AI > Accounts, Settings > Instance > AI providers and Connect your AI in light, nor on the dark loads (the same plus Chat and the task panel). The only two error lines of the round are 404s from my own probes for a version address. `settings/providers` is a 404 page ("We can't find that page"); the page is `settings/instance/providers`. `settings/agent-clients` lands on My settings.

## Also seen

- DEFECT (medium): the rail does not fit a 768 px high window. Its content is 849 px (`nav.ah-rail` scrollHeight 849, clientHeight 768): "More" is 750 to 802, cut by the window edge, and the profile picture is 812 to 848, off screen. `.ah-app` is `overflow: hidden` with scrollHeight 849, so focusing the picture (Tab reaches it) scrolls the whole shell up by 81 px: the header goes to y −81 and there is no scrollbar to bring it back. I found the shell at scrollTop 81 twice during the round (task panel, AI Inbox). At 1440 x 900 the rail fits exactly (900 of 900, picture 854 to 890).
- 390: no document overflow on Home, Inbox (Later, approval), the empty list, List, Board, Table, AI Inbox, Audit log, Connect your AI, Chat, Dashboards, the empty dashboard, Goals, Docs, Approvals, Automations, Portfolio, Permissions, Everything, Teammates, Skill library, Custom Report, Project Details, the task panel with the time form. Inner rows that scroll sideways inside themselves: the Inbox tabs (461 in 374), the audit tabs (412 in 334), the AI section nav (638 in 326), the Board and the Table.
- Nits: the "New portfolio" form (`div.rp-modal`) has no `role="dialog"`; the empty-state block is 40 px wider than its column (padding outside the width: 308 to 1480 in a 1440 window, 304 to 1028 at 1024, −4 to 394 at 390), so its content sits 20 px right of centre; a tool artefact, not a defect: while the pane reported `visibilityState: hidden`, slide-in transitions stalled half way (the task panel stayed at `translateX(24px)`).

Defect count this round: the wrong empty state on a new list (7), the rail at 768 px height, the tree menu cut at the bottom (8), raw keys and ids in the audit log (9), the blurred Permissions page with its notice 2,300 px down (5), the time form's overlapping inputs (4), the missing gutter and sideways scroll on Project Details at 390 (1), "1 PAGES" and the other wording leftovers (5), the "undefined" row in AI Inbox > Declined (9). Fixed since 772: the floating card, the pause chip, "Not connected yet", minutes in steps of 5, the plurals and "sprint" wording on the list, the audio load error. Not checked: a plain member's view and "Always do this" (needs the owner); "Not connected yet" on a workspace that has never been connected (this one is connected); a running timer (the owner's week is still approved; not retried); light-mode colours against an earlier picture (none to compare with).

---

# Tenth sweep, build 802

Task 047 (AP-441), 2026-10-02 about 13:15 to 14:37, owner "Local PM". The build changed three times under the sweep (792 → 793 at about 13:20, → 794 at 13:34, → 802 at 14:16; the server restarted at 13:32 and 14:09, each time with the web build missing for some minutes). Checked on 792/793: first load and the shell panels (1), projects live (2), the Notepad and the plan state (9), making the two fields (3). Checked on 794: field values (3), dashboards (4), agent settings and the Inbox (5, 11, 12, 13), colours (6), lists and folders, also live (7, 10), 390 px (8), timesheet and export (14), list search and filter. Checked on 802: docs (15), the 802 list (16), checklists, task delete, the Trash, the panels again, the console. Desktop at 1280 x 900 (emulated); dark by the app's own switch (My settings > Theme > Dark, `ah.theme` = dark, fresh load) and a scan of computed colours; 390 x 844 by fresh load and an overflow scan. Driven with `javascript_tool`. The pane reported `visibilityState: hidden` from about 13:47 and drew the page at about a quarter size, so the screenshots of this round are too small to judge by eye: colours are from the scan, not from looking. No code changed, nothing committed.

## DEFECTS

1. LARGE, task panel, checklists (794 web on the batch 21 server, and 802; not tried on 782, may be older). "+ Add a checklist" looks dead: nothing appears in the open panel, no toast, no error. Each press does store one: `PATCH /api/v2/tasks` answers 200 "Checklist updated successfully". After a reload QAS-132 had seven "Checklist (0/0)" rows, one per press. Deleting a checklist (bin icon, "Confirm / Are you sure you want to delete??", Confirm) is the same: PATCH 200, the row stays until a reload. Seen on QAS-132 and QAS-131, both in "[QA 046] list". To see it: open any task there, press "+ Add a checklist" once, wait, reload.
2. MEDIUM, computed fields. A Formula field `{subtask_count} * 10` shows "—" on a new task and does not follow the subtasks: with one subtask it was "—" (also after a reload), it became 10 only after a field on the subtask was edited, and with two subtasks it stayed 10 (also after a reload) until the next field edit, then 20. A new Rollup (SUM of "[QA bench] Cost", subtasks) showed 0 right after the first subtask was added and "—" after a reload. What works: the rollup follows a subtask's value (5, then 7, then 10 with the second subtask's 3) each time the parent is reopened.
3. MEDIUM, Settings > Custom Field Manager (may be older): there is no control to delete or archive a field, though the page says "Deleting a field keeps its values for 30 days in case you change your mind.", and a field is always for the whole workspace (no project choice). A formula or rollup row opens an editor with "Save field / Cancel" only; a plain row opens "Edit Custom Field" with "Cancel / Save" only. The two "[QA 047]" fields could not be removed.
4. MEDIUM, list search (older: `$regex: searchStr` in `useProjectSearch.js`). The text is used as a pattern. "[QA 047] parent" finds nothing; "QA 047] parent" finds the task; "[QA 047]" also lists "Print layout breaks" and "Session ends too early"; "[QA" gets `POST /api/v1/task/find` 500 "Regular expression is invalid: missing terminating ] for character class", a console line "ERROR in search tasks", and six empty groups with no message.
5. MEDIUM, archived lists have no place. The confirm says "Its tasks are archived with it. You can restore it from the archived lists." There is no such list: the tree does not show the archived list, More > "Show Archive" gives the chip "Archived List" and "No Archived Data Found". Restore exists only in the header's "Actions for …" menu (Copy link, Restore, Delete), and the header names the archived list only on its folder's page and on the project root while Show Archive is on; on another list the header names nothing. The toast's Undo is the other way back.
6. MEDIUM, AI > Accounts > "Connected agents / Pause every connected agent in this workspace" (new in 794). Ticking it shows "Saved." and holds after a reload, and unticking works. Nothing else shows the state: the LIVE bar still reads "LIVE Daily PM is on AP-116 · Code Reviewer is on AR-49 / Pause all agents", the rail says "2 running", Project Details has no word of it, and the card has no "paused" line beside the ticked box. I did not press "Pause all agents" in the bar (it would stop the two agents on AP-116 and AR-49).
7. MEDIUM, task panel > More actions > Delete (older: `conformationmsg.delete` in `TaskDetailAction.vue`). The confirm reads "This Project's tasks and templates will all be erased. Type project name to confirm that you really do wish to delete all tasks, templates, and this project." and then asks to "Type delete". It deletes the task only (toast "Task deleted successfully", the project count went from 95 to 92). After the delete the panel stays open on the deleted task and the address keeps `?task=`.
8. MEDIUM, dark, Settings > Company: the company name "Local360" is `span.black`, rgb(0,0,0) on rgb(24,24,28), 1.2:1. Same at 390. The page also holds an unknown element `<createcompnayinsideviewcomponent>` (no such component in `frontend/src`), so whatever tile it was meant to draw is missing.
9. MEDIUM, Dashboards (older: `destroy` in `DashboardsHub.vue`): "Delete" in a tile's More menu deletes at once, with no confirm, no toast, no Undo, and the dashboard is not in the Trash. "Remove card" is the same, and works while the dashboard says "Locked".
10. SMALL, folders live: when a folder is deleted in one tab, the other tab's tree drops it but its open folder page stays ("[QA 047] folder has no lists yet … New list"), with no notice, 6 s later too.
11. SMALL, field builder wording. "+ 24 more" under the formula box is a plain `span` (cursor default, nothing happens), so the other 24 fields can only be typed from memory. The rollup source says "Count of children" where the rest says subtasks, and lists two "Story Points" and two "Budget" with nothing to tell them apart. The line "Formulas are evaluated on the server…" also stands under a rollup. Saving a new field says "Field Updated Successfully". The formula box has no label, and its placeholder "logged_hours * billable_rate" is not in the `{token}` form the buttons insert. The task panel's own "Edit Custom Field" for the same formula lists other names ("{[QA bench] Cost}, {Story Points}, {[QA 047] rollup}"). "Preview:10" has no space.
12. SMALL, dark: the Notepad and Clips headers are white on rgb(168,146,255), 2.6:1 (light: white on rgb(47,57,144), fine). In "New project" the chosen filter "All" is rgb(17,17,20) on rgba(255,255,255,0.1).
13. SMALL, requests: Timesheet > Tracker opens with 25 calls to `/api/v1/timesheet/tracker` (all 200, then none). Every page polls `/api/v1/getTime` about every 5 s and `/api/v2/users/favourites` about every 10 s.
14. SMALL, list filter: choosing Priority Is High asks for `/api/v1/download/<company>/taskPriorities/priority_high.png` and gets 404; the line "Please select all valid options" stays after a valid choice. The filter itself works (12 rows, all High).
15. SMALL, Docs delete: the bin opens the browser's own confirm, "Delete this doc and every sub-page under it? This cannot be undone.", yet the doc goes to Docs > Trash. (This pane answers such confirms with No, so the button looked dead here until I let it answer Yes.)
16. Nits: the rail's New task button has the title "New task (C) (C)"; "Are you sure you want to delete??"; at 390 the Talk to Text panel starts at x 0 (0 to 374) and Notepad, Clips and Reminders sit 8 to 376; the "+ Dashboard" form (`div.dash__modal-panel`) has no `role="dialog"`; the audit log's reason column still says "task.comment via MCP" and "subtask.create is outside this agent's allowed actions"; the "Project pulse" card says 12 active while Projects says 11; the timesheet CSV has no task column ("User,Project,Date,Description,Billable,Hours"); the delete confirm of a project says "This affects [QA 047] live and everything in it." without saying it goes to the Trash; "New list" and "New folder" dialogs have a name box and no button.

## PASSED

1. First load (792): Home, QA Sandbox List and the Inbox reloaded with no console line but "Silence Is Golden" and the service worker note. Shell panels, on 792 and again on a fresh load of 802: Notepad, Clips, Reminders, Talk to Text, the New task dialog (by its button) and the command palette each drew their content 3 to 60 ms after the press, with no error and no blank panel; the list delete and archive confirms open as `role="alertdialog"` and Cancel leaves the list alone. Dark: the panels are rgb(24,24,28) with a border and a shadow.
2. Projects live (793): "[QA 047] live" made in tab 1 (no password or invite asked; Blank, "Everyone in Local360"). Tab 2 was hidden and by design reads only when seen: it showed the project the moment it was fronted, with no reload ("12 ACTIVE"). With tab 2 in front: Archive ("Type archive") reached it in 0.7 s ("11 ACTIVE · 1 ARCHIVED"), Restore in 1.1 s, Delete ("Type delete") in 1.0 s. The project is in Trash > Projects.
3. Fields: both fields saved and show on every task; the rollup follows a subtask (see defect 2 for the rest). 794 dropped "Across: Subtasks / List" from the rollup editor. A save that hit the 13:32 restart said "Network Error" and kept the form as typed; the second press saved.
4. Dashboards (794): "[QA 047] dashboard" made, "My work" and "Project pulse" added, a card dragged (with "Unlocked") from x 86 to 577 and still there after a reload, a card removed, the dashboard deleted (see defect 9 for how).
5, 13. Project Details (794): "Agents at work at once" 3 to 5 and "Tasks a connected agent changes on its own" 10 to 12, "Saved.", held after a reload, put back. The four policy choices each answer "Saved." and are back on "With approval" and "Act on single tasks". Pause shows the chip "Agents paused" and the paused text at once, Resume removes both. AI > Accounts: "A person checks before Done" on and off, "Saved."; "Save policy" is disabled until something changes. No control answered with an error or "needs a person".
11, 16. Inbox > Needs your approval (794 and 802): 8 rows, each with its card ("WHAT CHANGES" and the lines), Approve, Edit, Decline; no "undefined", no ids, no raw fields. Decline opens "WHY DECLINE?" and Cancel closes it; Edit shows "Drop" on each line and "Done editing". Nothing approved or declined. No setup plan and no connected agent's single change is waiting, so neither card could be seen.
6. Colours. Dark, real switch, fresh load: My settings, General, Members, Security & permissions, Custom Field Manager (also with the editor open), Projects, Templates, Task templates, Teams, Integrations, Time Tracking, Notifications, Sign-in & security, Language, Audit log, Import & export, Routing policy, SSO, SCIM, Time Off, Instance (Health, Upgrade, Settings, Stats), Connect your AI, AI Accounts, AI Agents, Dashboards, Inbox, Projects, Home, the More menu, New task, the palette: no light box, no text under 3:1, inputs and cards keep an edge, except defects 8 and 12. Light: no text under 3:1 on fourteen settings screens. The Members role select has no border by design (transparent in both themes).
7, 10. Lists and folders (794), tab 2 watching (the pane was hidden, so I made tab 2 report itself visible; the code waits while a page is hidden): new list, rename, new folder, move into the folder ("Choose where … goes"), archive, restore and delete each showed in tab 2's tree with no reload, about 2 s after the press; tab 2's folder page followed the archive and the restore too.
8. 390 px, dark and light: Home, Inbox, QA Sandbox List, Project Details, Settings > Members, Custom Field Manager (editor open, 12 to 378), AI Accounts, Dashboards, Projects, Company, Security & permissions: no document overflow, nothing cut. New task dialog 16 to 374. Inner rows that scroll by themselves as before (Inbox tabs, AI nav, the permissions table); Project Details still has the 430 in 390 column of the ninth sweep.
9. Plan (793): the company row still carries the plan ("enterPrise", 37 features on, none off, limits empty); Members says "14 · UNLIMITED"; of twenty settings screens only Security & permissions is plan-locked, as in the ninth sweep; no new upgrade notice; the web app makes no call to `/api/v1/subscription*` at all, and nothing failed on those loads. Notepad: "[QA 047] note" made, edited (title and text), still there after closing and reopening, deleted through its own confirm.
14. Settings > Company and Instance > Upgrade load. Timesheet (794): Mine shows the week's rows (3:02) and last week's "[QA 047] place 1 0:06"; Project, Workload and Tracker load with no failed call. Export: `POST /api/v1/timesheet/export-csv` 200, a CSV of the header and my four rows; I held the download back and read the text in the page, so no file was saved.
15. Docs (802): NOT REPRODUCED. A new doc in QA Sandbox, title and one line typed, Save not pressed: "Saving…" then "Saved", three `PUT /api/v2/pages/<id>` each 200 "Page saved."; after a reload the title and the line are there. Renamed, "Saved", one more PUT 200, there after a reload and in the Docs list. A second doc made from the project's "+ New > New doc" and typed into within a second of opening was kept too.
16. On 802: the audit log's Event column is in words ("Changed what agents may do in a project", "Add a comment", "blocked by policy · Change the status") and every row has "Details" ("Recorded as agent.workspace_policy_changed / About company …"); empty filters say "Nothing recorded matches this filter / Clear filters". Skill library: actions in words ("Create a subtask", "Comment on a task", "Delete a project"); keys remain as each skill's own name and in the "Tools:" line for CLI agents. A new list reads "[QA 047] empty has no tasks yet … Create task" in List and Table (Create task focuses the "Task name" row); the Board says "Drop a task here". Rail: at 768 and at 600 px the shell does not scroll (focus on the picture leaves it at 0), the foot (agents, More, picture) is in view, the items scroll inside (672 in 573 and in 405); the More menu scrolls inside itself at 600. Tree row menu for a row at y 504 in a 600 px window opens upward (230 to 504), every item in view. Security & permissions: still locked, the block is one screen tall and the notice sits at y 374 to 503.
Console on 802: no error on the fresh loads and through the round, but the 500 of defect 4.

## NOT CHECKED

- A setup plan card and a connected agent's "One change" card: none is waiting.
- Light and dark by eye: the pane drew the page at about a quarter size; the colour scan stands in for it.
- Live follow in a tab that is truly in view (see 7, 10), and a list deleted while another person has that list open.
- The bar's "Pause all agents" (not sandbox). "Always do this". A plain member's view. A running timer (the owner's week is still approved).
- A download to disk from Export. An API tokens screen: Settings has none; Connect your AI was only scanned.
- Whether defects 1, 3, 4, 7 and 9 were already in 782.

## LEFT BEHIND

- Custom fields "[QA 047] rollup" and "[QA 047] formula", workspace-wide, on every task (defect 3).
- In the Trash: project "[QA 047] live"; folder "[QA 047] folder"; lists "[QA 047] list renamed" and "[QA 047] empty"; tasks "[QA 047] parent" (QAS-132, with seven empty checklists), "[QA 047] sub 1", "[QA 047] sub 2"; docs "[QA 047] doc title renamed" and "[QA 047] doc fast".
- "[QA 047] place 1" (QAS-131): one "Checklist" added and deleted by me; the delete answered 200 but was not looked at after a reload.
- Gone for good: the note "[QA 047] note edited" and "[QA 047] dashboard".
- Audit log rows of about 13:52 for my policy and limit changes.
- Put back: limits 3 and 10, "With approval" and "Act on single tasks", agents resumed, the workspace pause off, "A person checks before Done" off, the list filter reset, Show Archive off, theme Light (`ah.theme` = light), viewport desktop. My second tab is closed. An older tab of the pane on localhost (a stale "ENOENT … dist/index.html" page) refused a navigation and was gone later; I did not close it.

Defect count this round: checklists that only show after a reload (1), the formula that does not follow subtasks (2), no way to remove a field (3), list search as a pattern with a 500 (4), archived lists with no place (5), the workspace pause that nothing shows (6), the task delete confirm that speaks of the project (7), the black company name in dark (8), dashboards deleted with no confirm (9), the folder page that stays after a delete elsewhere (10), builder wording (11), two dark contrasts (12), request bursts (13), the priority image 404 (14), the Docs confirm (15). Not reproduced: the Docs title and text loss (15 of the list).

# Eleventh sweep, build 806

Task 047 (AP-441), 2026-10-02 about 18:50 to 21:25, owner "Local PM". The build changed twice under the sweep: 803 → 805 at about 19:25 (the page said "Offline — you can keep working", the old web files answered 404, a reload gave 805), then → 806 at about 20:35 after a network drop of some forty minutes. Checked on 803 and kept: item 1 in light at 1280 (every screen of the list), item 2 in light, items 3, 4 and 5. Checked on 805 and kept: item 1 in dark at 1280 for Home, Inbox, the five project views, Project Details, the task panel, Everything, a goal, Planner, Docs, Dashboards, Timesheet, Chat and the fourteen AI pages. Everything else is on 806: dark Settings, the dialogs in dark, 390 px in both themes, items 6 to 13 and the pass over the tenth sweep's defects. Desktop at 1280 x 900 (emulated), 390 x 844 by a fresh load, dark by the app's own switch (`ah.theme` = dark). Each screen was looked at in a screenshot and scanned for text under 3:1, light boxes in dark, form values under 3:1, native-looking buttons and overflow; the two commits were also read (`fb9e9da3b` classes, `5e01f7dd2` colours: every renamed class has the rule of the class it replaced, every token used is defined). From 805 on the pane reported `visibilityState: hidden` and held old frames, so each screenshot was taken after a one-pixel change of the viewport width. Driven with `javascript_tool`. No code changed, nothing committed.

## DEFECTS

1. MEDIUM, dark, "Story point scale" (project toolbar > More > Estimation scale; new with 803's colour change): the chosen value in `select.esc__select` is rgb(0,0,0) on rgb(24,24,28), 1.19:1 (the select got `background: var(--surface)` and no colour). Same at 390. In light the Cancel button is white text on the browser's own grey button (`button.btn_btn.esc__ghost-btn`, rgb(255,255,255) on rgb(239,239,239), 1.15:1, 2 px outset border, Arial); in dark it is that light grey button in a dark card. `.btn_btn` has had no rule since 3 Sept; 803 only turned `color: #fff` into `var(--on-brand)` and kept the comment that says `.btn_btn` makes it navy. Cancel does close the dialog. At 390 the card runs edge to edge (0 to 390).
2. MEDIUM, dark, project toolbar > More > Export (new with 803's class change): `div.export-tasks__card` stays white while its title and hint moved to tokens: "Export" (`span.export-tasks-dropdown-font-size-16`) is rgb(242,241,246) on white, 1.12:1; the hint (`div.export-tasks__hint`) 1.00:1. Only the CSV and XLSX buttons read.
3. MEDIUM, dark, an empty folder's page (may be older): `div.list-view-body.bg-light-gray` is rgb(244,245,247); `h3.empty-state__title` "[QA 047] folder has no lists yet", `p.empty-state__msg` and the "Or say it" line are 1.03:1 to 1.06:1, "Copy / Ask it here" 2.3:1. Only "New list" reads. To see it: dark, New folder in QA Sandbox, open it.
4. MEDIUM, task panel (older: `.ah-detail__main` became a flex column on 1 Oct, `fca1be1d4`). The tab strip "Description / Subtasks / Files / Relations" (`div.ah-detail__tabs`, `overflow-x: auto`, `flex: 0 1 auto`) shrinks to a 1 px line whenever the Description pane is taller than the panel: on any QA Sandbox task (36 custom fields) the four tabs cannot be seen at 1280 x 900 or at 390; on the other three tabs the strip is 14 px and shows. Light on 803, dark on 805, still so on 806.
5. SMALL, task flows (806): Move, Convert to List and Convert to Subtask each show "Task deleted successfully" beside "Task moved sucessfully" / "Converted sucessfully" / "Task converted sucessfully". Misspelt toasts: "sucessfully" (move, merge, convert, duplicate), "Task toal estimate update successfully.". The convert confirm reads "[QA 047] A sub’s task will become subtasks of [QA 047] C."; History calls a list a sprint ("has moved … from ([QA 047] flows) to ([QA 047] target) sprint").
6. SMALL, times do not follow one format (item 11): 12-hour in chat ("2:57 PM"), task History ("02/10/2026, 08:54 PM"), imports and goals; 24-hour in the audit log ("13:52"), the timesheet ("Oct 1, 21:31"), Pipeline ("4 Sep 15:02") and Connect your AI ("02/10/2026, 17:11:56"); "Sept" in the Inbox and "Sep" on Home. An Inbox row shows the day only ("12 Sept"); its tooltip is the raw "2026-09-12T12:19:37.882Z". No "Invalid date" anywhere.
7. SMALL, Show Archive (tenth sweep's 5, partly fixed): an archived list with no task is not listed (the body says "No archived tasks to show"; only the header names it), and an archived list of 2 tasks shows the count 0.
8. SMALL, Settings > Custom Field Manager (new in 806 with the row menu): the name column is 78 px, so names are cut ("[QA 047] ro…", "[QA bench…", four rows that read alike); the full name is only in the title.
9. SMALL, Everything (older, 1 Oct): each status chip is `button.ah-chip.ah-status-ink.lv2__status-chip` with the browser's 2 px outset border (black in light, pale in dark); only `.tv2 button.lv2__status-chip` in the Table view takes it off.
10. SMALL, AI pages at 1280 or narrower, where the AI nav is icons only: on AI Inbox the count on the chosen item (`span.ai-side__count.ah-mono`) is the brand colour on the brand colour (1.00:1), a blank pill; light and dark.
11. SMALL, Settings > Audit log: the search runs only on Enter and nothing on the screen says so; typing alone leaves the rows as they were.
12. SMALL, forms: New task puts "Give the task a name of at least 3 characters." at the foot of the form (y 303; the name box ends at 192), not under the name; the task panel's time form puts its one message under the whole form; in Timesheet > Log time "Enter the hours to log." stays after hours are typed, and letters make the button read "Log abc". A save into an approved week answers 200 with the refusal as text.
13. SMALL, seen once, not reproduced (806): console "ERROR in create task: TypeError: Cannot read properties of undefined (reading 'tasks')" (`918.*.js`) when a subtask was added on a task opened straight from Settings; the subtask was made but the Subtasks tab did not show it until the panel was reopened.
14. Nits: dark Auto-archive, the disabled days box is rgb(84,84,84) on rgb(24,24,28), 2.3:1; the Export dialog's close mark is a fixed rgb(154,154,154); Calendar in dark keeps a pale "OVERDUE" chip (`span.ssc__state.is-overdue`); the date picker in the task panel carries `dp__theme_light` in dark; AI > Quality "Total US$ 0.04" under rows of 0.04 and 0.01; at 1281 px the AI nav opens to words and the Pipeline's five stages become five narrow columns; "Convert to List" lists "[QA 046] folder" but not the new empty folder; the name typed into "Duplicate Task Name" was not used (typed by script, so not proven).

## THE TENTH SWEEP'S DEFECTS ON 806

1. Checklists: FIXED. Add and delete show within 0.3 s. Story points (3), start date (15/10/2026), estimate (02h 30m) and description stayed over a tab switch and a reopen. Removing a tag: could not check (QA Sandbox has no tag and the tag menu offers no way to make one).
2. Formula and rollup: FIXED for the formula (0, then 10 when a subtask is added or converted in, 0 when it is trashed, with no other edit, twice). The rollup stayed 0 throughout (the subtasks held no cost), never "—".
3. Field manager: FIXED. Row menu Choose projects / Archive or Restore / Delete; archive and restore answer "… is archived. Its values are kept." / "… is back on its tasks."; Delete says "5 tasks hold a value for this field. The field and those values are removed for good." with Cancel / Archive instead / Delete. I did NOT press Delete (it is for good): both "[QA 047]" fields are archived. The "30 days" line is gone.
4. List search: FIXED. "[QA 047] parent" finds nothing and says "Nothing matches your filters"; "[QA 047]" and "[QA" match as text; "[QA 047] C" finds the task; every call 200.
5. Archived lists: PARTLY (defect 7). A list with tasks shows as a group with Copy link / Restore / Delete and restores with its counts.
6. Workspace pause: FIXED. The card says "Connected agents are paused", the strip "LIVE Connected agents are paused", the AI sidebar and Project Details say it; left off.
7. Task delete: FIXED. "This task goes to the Trash. You can restore it from there." / "Type delete"; the panel closes, the address is clean.
8. Dark: FIXED. Company name rgb(242,241,246); Notepad and "My Clips" headers dark on lilac (7.4:1); the "All" chip dark on lilac.
9. Dashboards: FIXED. Remove card: "My time was removed from this dashboard. Undo", Undo brings it back. Delete asks "… This cannot be undone." (I pressed Cancel.)
10. Folder deleted elsewhere: FIXED. "This folder is gone / It was deleted, here or by someone else … / Open QA Sandbox" (the first tab was made to report itself visible).
11. Field builder wording: not checked.
12. Dark contrasts: see 8. 13. Tracker: FIXED, one call to `/api/v1/timesheet/tracker` on open. 14. Priority filter image: not checked. 15. Docs delete: FIXED, the app's own dialog, "go to the Trash in Docs. You can restore them from there."

## PASSED

1. Colours and classes. Light, 803, 1280: Home, Inbox (six tabs), QA Sandbox List, Board, Table, Calendar, Gantt, Project Details (three scroll positions), the task panel (four tabs), Everything, Goals and one goal, Planner, Docs and one doc, Dashboards and "Resource Utilization", Timesheet (Mine, Project, Workload, Tracker, Approvals), Chat, AI (fourteen pages), Settings (28 pages scanned, sixteen looked at). Dark, 805 and 806, 1280: the same screens. 390 px, 806, light and dark: 31 screens and the 28 settings pages scanned (no document overflow, nothing under 3:1 but the defects above), Home, the project list, the task panel, General and the scale dialog looked at. The dialogs the class change touched, in both themes: Auto-archive, Recent, Who can see this, Import tasks, Public link, Duplicate: right. Nothing lost its size, weight, border or background.
3. AI sidebar (803, at 1600 px): "Pause all agents" enabled with 2 running; the card ticked turned the button to "Resume connected agents"; pressing it unticked the card and said "Connected agents can work again. An agent made here stays paused until you resume it under AI Agents." On 806 the line reads "Connected agents are paused" when nothing runs.
4. Audit log search (803), with Enter: "comment" 25 rows, "what agents may do" 25, "member" 8, all by the words on screen; "role or details" none, and no such row exists (the request carried `qEvents=member_update`); no match says "Nothing recorded matches that search / Clear search".
5. AI Inbox > Declined (803): 15 rows, none titled "undefined".
6. Task flows (806): Duplicate into another list, Move, Merge, Convert to List, Convert to Subtask, Delete: each answered in about 0.2 s, no endless spinner, tree counts right after each (project 95, 97, 97, 96, 95, 95, 94; back to 92 at the end). A list offers no way back to a task.
7. Empty screens: a new list ("… has no tasks yet … Create task"), a folder ("… has no lists yet … New list"), Docs for a project with none ("No docs in this project yet … New doc").
8. First load (806): Home and QA Sandbox, two reloads each: only "Silence Is Golden" and the service worker note.
9. Forms: New task (empty or spaces refused, no request; a valid name saves), New list ("The name field is required"), New project ("Give the project a name." and "Add a short key." under their boxes), + Dashboard ("Give the dashboard a name."), custom field ("Field Label is required." under the label), Profile ("This field is required." under first name; a valid save says "Profile updated successfully."), Log time (Timesheet: "Pick a task first." and "Enter the hours to log."; task panel: 0 h 0 m "Enter a date and a duration above zero.", 75 minutes "Enter whole hours from 0 to 23 and whole minutes from 0 to 59."). None sent a request.
10. Notification text: the Inbox's rows in all six tabs read as sentences; no tag, no `&lt;`, `&amp;`, "undefined" or "[object". There is no bell in this shell.
13. Chat: the channel opened with its messages; "[QA 047] chat 806" showed under TODAY within a second and the box emptied.

## NOT CHECKED

- Deletes that are for good: the two custom fields and "[QA 047] dash" (their dialogs were read, Cancel pressed). "Pause all agents" was not pressed.
- A valid save for New project (test data stays in QA Sandbox), for a custom field (it would be one more workspace field) and for Log time ("That day is in an approved timesheet period, so time can't be added to it.").
- Item 12: the task panel offers no cloud file option (Files and Attach go to "Upload from computer" and "Record clip" only).
- Item 13: the unread dot (the channel has one member); the Chat list took about 6 s to open, measured in a hidden pane, so not a finding.
- Removing a tag; a rollup over subtasks that hold a value; the field builder wording and the priority filter image of the tenth sweep.
- The import mapping steps (they need a file), the create-project status and task type forms, the alert box and the old description editor that the class change touched. A plain member's view.

## LEFT BEHIND

- Custom fields "[QA 047] rollup" and "[QA 047] formula": archived, not deleted.
- Dashboard "[QA 047] dash" (two cards). Chat message "[QA 047] chat 806" in "[QA 046] channel".
- In the Trash: lists "[QA 047] flows", "[QA 047] target" (with "[QA 047] C", "[QA 047] B" and "[QA 047] C sub") and "[QA 047] A"; folder "[QA 047] folder"; task "[QA 047] A sub". Docs Trash: "[QA 047] doc".
- Audit log rows for the two pause changes, the field archives and restores.
- Put back: workspace pause off, "A person checks before Done" off, Show Archive off, the list search empty, profile name "Local PM", theme Light (`ah.theme` = light), viewport desktop, QA Sandbox at 92 tasks. My second tab is closed.

Defect count this round: four medium (the scale dialog, the Export dialog in dark, the empty folder in dark, the task panel's tab strip), nine small, one line of nits. Of the tenth sweep's fifteen: eleven fixed, one partly (archived lists), three not checked.

## Coordinator check, build 809 (2026-10-02 22:25)

- Group by "Who is working" (#1534): the option is in the List's Group by menu in QA Sandbox; with no connected agent the list shows one group, "No agent 4", with the four tasks and the add row; the unsaved-change bar offers Save, Save for me, Save as new view, Reset; Reset brings back the status groups. No new console error. Not checked: a group for an agent at work (no connected AI on this build), the tab return, Board and Table.

## Coordinator check, build 810 (2026-10-02 22:40)

- Inbox after #1521 (batch 24): opens on "Needs your approval 8"; "Primary 1" shows its one row (a project notice) with Open, Snooze, Clear, Mark done; the counts request answers 200 (about 50 ms the second time). Migration 072 applied at start (two indexes), nothing pending. Not checked: a member who cannot open a task's list, the timesheet, the workload grid, a client view.

## Coordinator check, build 812 (2026-10-02 23:40)

Measured in the page, not judged by eye (the pane's screenshots were too small to read).
- Task panel (#1538): on "[QA 046] parent" at 1280x900 the tab row is 477 by 30 px and names Description, Subtasks 0/1, Files, Relations. FIXED (it was a 1 px line).
- Story point scale (#1541), dark: the chosen value reads 15.75:1, Cancel 15.75:1, Save 7.38:1 on a dark card. Light: Cancel 17.98:1, Save 9.96:1. FIXED (1.19 and 1.15 before).
- Export (#1541), dark: the card is dark (rgb 24,24,28), the hint reads 17.7:1. FIXED.
- Dark was looked at by setting the theme attribute on the page for the check only; the account's theme was not changed.
- Not checked: the empty folder page, the status chips, the AI nav count, the field manager's name column, archived lists, the toasts on Move and Convert, the time format on each screen, the plan card with a locked part, "@" in chat. These wait for a full sweep.

## Coordinator check, build 813 (= 812's screens), 2026-10-03 07:20

An in-page contrast reading (every visible text element against its background; theme switched on the page for the check only): items below 4.5:1 (3:1 for large text) out of those read.
- Home: light 0/144, dark 0/144.
- QA Sandbox list: 1/139 in both (the project's letter avatar "Q", 4.07:1). Task panel: 1/219 (the same avatar).
- Everything: 0/62 in both; the 50 status chips have no border (FIXED, was the browser's outset border).
- Inbox, Primary: 0/27 in both; a row's time reads "12 Sep" and its tooltip "12/09/2026, 5:49 PM" (FIXED, was a raw ISO string).
- AI > Ask: 0/33 in both. The AI nav count did not show (nothing waiting there), so its fix is not seen.
- Not checked: empty folder page, archived lists, toasts on Move/Convert, Custom Field Manager, plan card with a locked part, "@" in chat.

## Coordinator check, build 814 (batch 27: colours 7, legacy classes 3), 2026-10-03 07:45

The same in-page contrast reading as on 813, items below the WCAG line out of those read, light / dark:
- Home 0/144 / 0/144 (813: same). QA Sandbox list 1/140 / 1/140 (813: 1/139; the avatar "Q" at 4.07:1). Task panel 1/219 / 1/219 (same avatar); tab row 30 px. Everything 0/155 / 0/155.
- Screens batch 27 rewrote: Dashboards 0/53, the week's timesheet 0/56, Docs 0/127, Chat 0/56, light and dark.
- By eye, the project list in dark at 1280: rows, chips, group headers and the sidebar read right. A screenshot taken within a second of switching the theme showed white row cells: a transition caught halfway, gone when the theme had settled.
- Not looked at: Settings pages, the create-project form, the call overlay, the clip recorder, the sprint and Scrum screens, 390 px.
