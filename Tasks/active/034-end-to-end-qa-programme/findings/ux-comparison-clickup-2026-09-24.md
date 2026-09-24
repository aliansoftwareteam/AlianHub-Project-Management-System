# UX comparison: AlianHub vs ClickUp (task 034, 2026-09-24)

This compares AlianHub's UX with ClickUp's across nine areas and ranks concrete improvements for AlianHub. It is written against `origin/beta` at `65ead5ca` (build 408).

**Method**
- **ClickUp** is described from public sources only: clickup.com product and pricing pages, and the ClickUp Help Center (help.clickup.com, current generation "ClickUp 4.0"). help.clickup.com refused direct fetches (HTTP 403), so Help Center claims come from its search-indexed article text; every one links its article under **Sources**. Screens marked *observed* come from a read-only look at the signed-in app, supplied by the coordinator; no workspace data is reproduced.
- Everything is summarised in our own words. Nothing was signed up for, logged into or accepted.
- **AlianHub** is described from the code, with file references relative to `frontend/src` (FE) and `Modules` (BE). Screen observations come from the three task-034 UI sweeps that ran the harness (`ui-sweep-2026-09-24.md`, `sprint-7-8-sweep-2026-09-24.md`, `ui-sweep-third-pass-2026-09-24.md`). No new server was run for this pass.

**Positioning filter.** AlianHub is self-hosted, open source and about data control. The recommendations therefore leave out:
- per-seat paywalls on basic navigation;
- AI features that only work through a vendor cloud;
- ClickUp's sprawl of feature toggles ("ClickApps").

Where ClickUp gates a feature behind Enterprise (SSO, SCIM, audit logs, data residency), AlianHub already ships it in the open-source build. That is a selling point to keep, not a gap.

---

## Executive summary

AlianHub has already caught up on most of ClickUp's surface:
- a rail shell with Home;
- a My Work card with To Do / Done / Delegated tabs and Today / Overdue / Next / Unscheduled buckets with counts;
- an agenda and a planner;
- a peek-style task panel with expand and a minimise tray;
- an Inbox with keyboard triage;
- a When / If / Then automation builder with sentence compile, backtest, dry run and run history;
- importers for Jira, Trello, Asana, Monday and CSV;
- SSO (OIDC and SAML), SCIM, 2FA and an audit log.

The remaining gaps are mostly depth and polish, not missing modules:
- the command palette does not open with ⌘K on a Mac;
- "Later" in the Inbox is a browser-local list, not a real snooze;
- saved views do not remember their filter, grouping or sort;
- favourites live in four places that do not agree;
- task detail has no previous/next navigation, no task templates, and no threaded or assigned comments;
- AI cannot be pointed at a self-hosted model.

The last point is the one gap that directly undercuts the self-hosted pitch.

### Top 10 recommendations (ranked)

Ranked by impact over effort. Effort: S is under 2 days, M is up to about a week, L is more than a week.

| # | Recommendation | Effort | Impact | Touches |
|---|---|---|---|---|
| 1 | **Make the command palette the front door.** Open it on ⌘K as well as Ctrl+K. Keep navigation and records usable on every plan. Add scope chips (Tasks, Docs, People, Projects), per-row actions (open in new tab, copy link, Ask AI), location and age on each result, and footer hints. Filter results by permission first (TSK-05). | S–M | H | `App.vue:634-648` (checks only `ctrlKey`), `components/molecules/AdvanceSearch/MainComponent.vue`, `components/molecules/Home/HomeSidebar.vue:6` (shows ⌘K), BE `GlobalSearch` |
| 2 | **Real Inbox snooze plus Cleared.** Store "Later until <time>" on the server so it returns on time or on a new update and follows the user across devices. Add a Cleared tab (kept 30 days), "Clear all", an "Other" tab for watched-only updates, and a snooze key. | M | H | `views/Inbox/Inbox.vue:226-270` (Later is `localStorage`), BE `Inbox` |
| 3 | **Task detail flow.** Previous/next arrows and j/k to walk the current view's task order without closing the panel. Copy ID in the header. A quiet action row under the description (Add subtask · Relate / dependency · Checklist · Attach). Empty properties shown as an "Empty" value you click to edit. | S–M | H | `components/organisms/TaskDetailOverlay/{TaskDetailPanel.vue,useTaskOverlay.js}`, `components/organisms/TaskDetailRightSide` |
| 4 | **Saved views that save the view.** Store filter, grouping, sort, columns and "Me" on the view. Offer "Save for everyone", "Save as new view" and "Autosave". Allow a default view per project, and grouping by assignee (the code supports it; the menu doesn't offer it). | M | H | `views/Projects/composables/projectViewBar.js`, `components/molecules/ProjectViews/helper.js`, `components/molecules/TaskFilter/TaskFilter.vue`, `views/Projects/Projects.vue:724-728`, `ListView/ListGroup.vue:135` |
| 5 | **Bring-your-own model endpoint.** An OpenAI-compatible base URL (Ollama, vLLM, LM Studio, a company gateway) for chat as well as embeddings, and a visible "AI off" switch per workspace. ClickUp's AI is a paid, vendor-hosted add-on; AlianHub can offer AI where no data leaves the network. | S–M | H | BE `AICore/llmProvider/openaiProvider.js:8` (chat URL hard-coded; embeddings already read `OPENAI_EMBEDDINGS_URL`), `registry.js`, `catalogue.js`, Settings → AI accounts (`views/Ai/AiAccounts.vue`) |
| 6 | **One favourites model and a persistent tree.** Merge the four favourite mechanisms into one server-stored list shown in the sidebar. Put a star on the breadcrumb. Show the project → folder → sprint tree (with counts) on every project page, not only Home, with "Customize sidebar" that can reorder. Make the sprint crumb in the project header a link. | M | H | `components/organisms/Shell/shellState.js` (`localStorage 'ah.nav'`), `components/molecules/Home/HomeSidebar.vue`, `views/Projects/components/ProjectHeader.vue:4-37`, `components/molecules/SubItem/SubItem.vue:522`, `TaskDetailTitle.vue` |
| 7 | **Task templates.** "Save as template" on a task (description, checklist, subtasks, fields, relative dates). "Apply template" in the add-task row and task menu. An optional default template per project or sprint. | M | H | `components/molecules/TaskDetailAction` (task menu), `views/Projects/ListView/ListGroup.vue:67`, BE `ProjectTemplates` (reuse storage), `views/Settings/Template` |
| 8 | **Threaded and assigned comments.** Replies nest under a comment. A comment can be assigned to someone and resolved, which notifies the assigner. Add an "Assigned comments" card on Home and an Inbox kind for it. | L | H | `views/Projects/Comments/Comments.vue`, `components/organisms/Comment/Comment.vue`, BE `Comments`, `views/Home/TodayOverdue.vue`, `views/Inbox/Inbox.vue` |
| 9 | **Workspace-level migration.** A "Bring your work in" wizard reachable from first run and Settings, not only from a project's ⋯ menu. It maps users and statuses, keeps an import history, and adds a ClickUp source (CSV export or API token). Make the matching workspace export discoverable. | M | H | `components/organisms/ImportDialog/ImportDialog.vue`, `views/Projects/components/ProjectFiltersToolbar.vue:147`, BE `Importers` (`jira/trello/asana/monday/csvRules.js`), BE `Export`, `composable/useOnboardingChecklist.js` |
| 10 | **Keyboard and accessibility basics.** A "?" shortcut sheet and a few global keys (c = new task, / = search, g h / g i = go Home / Inbox). A skip-to-content link. A high-contrast toggle beside the theme switch. Settle the `--ink-3` contrast (UIX-10). Run axe on the e2e smoke routes. | S–M | M | `App.vue`, `components/organisms/Shell/GlobalRail.vue`, `assets/css/tokens.css`, `views/Settings/MySettings`, `e2e/specs/smoke.spec.js` |

**Also worth doing, outside the top 10**
- A Recents card on Home and workspace-wide recents in the palette: S/M.
- Keep the minimised task tray across reloads: S/L.
- One bulk bar for List, Table and Board, and "+ Task" on every view: M/M.
- A List column chooser with "+ Add column" and a density toggle: M/M.
- People, URL, rating and multi-select custom field types: M/M.
- An automation template gallery: S/M.
- Doc comments and version history: L/H. This needs an owner decision, because history was removed on purpose (BE `Pages/controller.js:28`).
- Nested subtasks: L/M.
- PWA offline for reading assigned tasks: L/M.

---

## 1. Navigation and information architecture

**ClickUp**
- **Hierarchy.** Workspace › Space › Folder › List › task, with Docs, Forms and Whiteboards alongside Lists in the sidebar tree ([Sidebar](https://help.clickup.com/hc/en-us/articles/12755292456983-Intro-to-the-Sidebar-in-ClickUp-3-0), [Spaces sidebar](https://help.clickup.com/hc/en-us/articles/32490148963479-What-is-the-Spaces-Sidebar)).
- **Sidebar.**
  - The Home sidebar has default sections plus custom sections that can hold Lists, tasks and channels, and can be reordered ([Home sidebar sections](https://help.clickup.com/hc/en-us/articles/32855333466903-Create-and-reorder-custom-Home-Sidebar-sections)).
  - Favourites cover locations and individual views, and a view can be pinned to the top of the workspace ([Favorites](https://help.clickup.com/hc/en-us/articles/6308862167575-Favorites)).
- **Command bar.**
  - Cmd/Ctrl+K opens it; "/" lists commands; a task can be sent to the tray from it. The desktop app has a system-wide hotkey ([AI Command Bar](https://help.clickup.com/hc/en-us/articles/6533695640343-Intro-to-the-Command-Center), [desktop](https://help.clickup.com/hc/en-us/articles/14952556494359-Desktop-Command-Center)).
  - *Observed:* the prompt offers search, commands and questions together. It has source tabs (all, ClickUp, connected apps), type chips (Tasks, Docs, Agents) with filter and sort, and results that show location and age. Each row has actions (Ask AI, new tab, copy link). The footer hints at "/" and Tab.
- **Keyboard shortcuts.** Off by default and switched on in preferences; Shift+? lists them ([shortcuts](https://help.clickup.com/hc/en-us/articles/6309030550167-Use-keyboard-shortcuts)).
- *Observed layout:*
  - A left rail (Home, Planner, AI, Teams, Docs, Dashboards, Whiteboards, Clips, Timesheets, More).
  - A sidebar tree with folders, lists and sprints and item counts, plus "Customize Sidebar".
  - A breadcrumb with a favourite star.
  - View tabs with "+ View".
  - A bottom tray of pinned tasks.

**AlianHub today**
- **Hierarchy.** Workspace › Project › optional Folder › Sprint (the List equivalent) › Task › Subtask (FE `router/projects/index.js`). Epics and milestones sit beside it.
- **Global rail.** Home, Projects, Inbox, Planner, Chat, AI, Docs, Dash and Time, plus a grouped "More" (FE `components/organisms/Shell/{GlobalRail.vue,navItems.js}`). Below 768 px it becomes a bottom tab bar (`MobileTabBar.vue`).
- **Tree sidebar.** Only on Home (`components/molecules/Home/HomeSidebar.vue`). Its "Customize" option only shows and hides sections.
- **Favourites.** Four separate mechanisms:
  - the Home pin, stored in the browser (`Shell/shellState.js`, `localStorage 'ah.nav'`);
  - the project star, stored on the server;
  - the sprint star (`SubItem.vue:522`);
  - the task star (`TaskDetailTitle.vue`).
  A project starred in its header does not appear in Home Favourites.
- **Breadcrumbs.**
  - The task panel has a clickable Project › Folder › Sprint › Parent (`TaskDetailOverlay/TaskDetailPanel.vue:14-26`).
  - The project header has a `<select>` switcher and a sprint name you cannot click (`views/Projects/components/ProjectHeader.vue:4-37`).
- **Command palette.**
  - `components/molecules/AdvanceSearch/MainComponent.vue` covers recent searches, navigation, records, people, connected apps, Ask AI and commands.
  - It opens only on **Ctrl**+K (`App.vue:635`), although the Home sidebar shows "⌘K" (`HomeSidebar.vue:6`). On a Mac the shortcut does nothing; the button works because it sends a synthetic Ctrl+K.
  - It is gated by a permission and by the plan feature `advanceFilterCtrlK`, and shows an upgrade toast otherwise.
  - A second, older search modal survives in the project ⋯ menu.
- **Recents.** Task-only recents exist (BE `RecentVisits`, `RecentVisitsDropdown.vue`), but only from a project's ⋯ › Find. The palette keeps six recent *search strings* in `localStorage`.
- **Shortcuts.** Hand-written handlers:
  - Ctrl+K for the palette;
  - j/k/e/l/r in the Inbox (`views/Inbox/Inbox.vue:576-585`);
  - Esc for the panel and for bulk selection;
  - Ctrl/⌘+S in docs;
  - arrow keys in the rail;
  - Shift-click range select.
  There is no "?" sheet and no global task keys.
- **Open sweep findings.** U3-36 (the palette runs to the viewport bottom and stays open across route changes), U3-33 (the AI side nav has icons only), UIX-19 (touch targets under 32 px, including the project switcher).

**Gap**
- The palette is AlianHub's biggest navigation lever, but it is broken on Mac and paywalled.
- Favourites don't agree with each other.
- No persistent project tree.
- No workspace-wide recents.
- No shortcut discoverability.

**Recommendations**
- Top-10 #1: palette. S–M/H.
- Top-10 #6: favourites and tree. M/H.
- Top-10 #10: shortcuts. S–M/M.
- Recents card and palette recents from `RecentVisits`, widened to projects, docs and sprints. S/M.
- Retire the legacy `GlobalSearchModal` once the palette covers its filters. S/L.

## 2. Task views: list, board, calendar, gantt

**ClickUp**
- **Bulk edit.** The bulk action toolbar appears when you tick tasks in List. Shift selects a range, up to 1,000 tasks at once, with a "More" overflow of advanced actions. It is on all plans ([bulk toolbar](https://help.clickup.com/hc/en-us/articles/6309768265495-Manage-tasks-with-the-Bulk-Action-Toolbar)).
- **Saving views.** Changing a view shows a save button with three options: save for everyone, autosave, or save as a new view. Filters can be saved and reused. A default view opens first for a location ([save view changes](https://help.clickup.com/hc/en-us/articles/6310370965911-Save-view-changes), [saving filters](https://help.clickup.com/hc/en-us/articles/6311659064983-Saving-view-filters), [Views bar](https://help.clickup.com/hc/en-us/articles/19063083658135-Intro-to-the-Views-Bar)).
- **Me Mode.** Narrows a view to your tasks, optionally counting assigned comments, subtasks and checklist items. A Board can default to it ([same source](https://help.clickup.com/hc/en-us/articles/19063083658135-Intro-to-the-Views-Bar)).
- **Grouping** is in the view header and the Customize panel ([grouping](https://help.clickup.com/hc/en-us/articles/6310202447511-Use-grouping-in-views)).
- **Templates.**
  - Task templates can be saved from a task, applied to new tasks, set as a List default, and pinned in List view ([task templates](https://help.clickup.com/hc/en-us/articles/6309918176535-Use-task-templates), [default template](https://help.clickup.com/hc/en-us/articles/13225295700759-Set-a-default-task-template-for-Lists), [pin templates](https://help.clickup.com/hc/en-us/articles/17924317500951-Pin-Task-templates-in-List-view)).
  - View templates exist too ([view templates](https://help.clickup.com/hc/en-us/articles/6310410797079-View-Templates)).
- *Observed:* List columns end with "+ Add" to add a field as a column.

**AlianHub today**
- **Views** (FE `views/Projects/Projects.vue:1156-1203`): List, Board with WIP limits, Calendar, Gantt (dhtmlx, with critical path, baselines and milestones), Table, Workload (aware of time off), Timeline, Mind map, Canvas, Map, Whiteboard, Dashboard, Docs, Forms, Comments, Activity and Embed. Each project enables its own set.
- **Inline add.** "+ Add task to {group}" in List (`ListView/ListGroup.vue:67`), "+ New task" in Table, a create row on Board, and quick add on Home. The header "+ Task" button shows on Board only (`Projects.vue:1007`).
- **Bulk edit uses two different bars.**
  - List and Table: `ListView/ListBulkBar.vue` (status, assignee, sprint, tags, AI summarise, archive, delete).
  - Board: `molecules/BulkActionBar/BulkActionBar.vue`, which adds priority, due date, move and convert.
- **Grouping** by status, priority or due date only (`Projects.vue:724-728`). Assignee grouping is implemented (`ListGroup.vue:135`) but not offered.
- **Filtering.**
  - `TaskFilter.vue` covers status, due, priority, creator, type and tags, and filters can be saved.
  - A separate "Me" toggle.
  - No filtering or grouping by custom fields.
- **Sorting.** Table only, on two columns.
- **Saved views** keep only name, pin and privacy (`composables/projectViewBar.js`), not filter, grouping or sort.
- **Missing.** No density option, no List column chooser, no task templates (only project templates, BE `ProjectTemplates`).
- **Open sweep findings.** UIX-16/17/18 (dark-mode leftovers and status-chip contrast), PRJ-08 (updating a saved filter always reports failure), TSK-07 (saved filters are not tied to their owner).

**Gap**
- Views exist in breadth; ClickUp has none of Mind map, Map or Canvas.
- Depth is missing: views that remember their setup, task templates, custom-field grouping and filtering, one consistent bulk bar, and column control.

**Recommendations**
- Top-10 #4: saved views. M/H.
- Top-10 #7: task templates. M/H.
- Unify the bulk bars into one component with a "More" overflow, and show "+ Task" on every view. M/M.
- List column chooser with "+ Add column" for custom fields, plus a comfortable/compact density toggle kept per view. M/M.
- Fix PRJ-08 and TSK-07 before building on saved filters. S/M.

## 3. Task detail

**ClickUp**
- **Layout.** A redesigned task view with collapsible sections, more visible relationships and dependencies, and a right sidebar for connections ([intro to tasks](https://help.clickup.com/hc/en-us/articles/10552031987735-Intro-to-tasks), [fields, subtasks, relationships](https://help.clickup.com/hc/en-us/articles/34958820098839-Custom-Fields-subtasks-relationships-and-attachments)).
- **Subtasks and relationships.** Nested subtasks with a configurable depth, up to 1,000 per task. Relationships reach tasks and Docs, including dependencies ([nested subtasks](https://help.clickup.com/hc/en-us/articles/6304431740055-Create-nested-subtasks), [relationships](https://help.clickup.com/hc/en-us/articles/6304528030743-Intro-to-Relationships)).
- **Custom fields.** Include phone and formula; fields can be tied to a task type ([custom fields](https://help.clickup.com/hc/en-us/articles/6303536766231-Intro-to-Custom-Fields), [by task type](https://help.clickup.com/hc/en-us/articles/30976239926167-Intro-to-task-type-Custom-Fields)).
- **Comments.**
  - Threaded replies.
  - Comments, and replies within threads, can be assigned; resolving one notifies the assigner.
  - An icon in every view marks unresolved assigned comments.
  - ([assign comments](https://help.clickup.com/hc/en-us/articles/6311126397591-Assign-comments), [reply to comments](https://help.clickup.com/hc/en-us/articles/6308954445591-Reply-to-task-comments))
- **AI.** AI Fields generate a summary, progress update, translation or action items from a prompt ([AI Fields](https://help.clickup.com/hc/en-us/articles/18450100382871-What-are-AI-Fields)).
- *Observed.*
  - **Header:** task-type selector, copy ID, previous/next arrows, created date, favourite star, and a panel/fullscreen toggle.
  - **AI card** under the title with one-click actions.
  - **Property block:** status with a one-click complete, assignees, a start → due range on one row, priority, points, inline time tracking and tags. Empty values read "Empty" and are edited in place.
  - **Description:** offers "write with AI".
  - **Custom fields** are grouped by where they come from, with inline "+ Create field".
  - **Quiet action list:** Add subtask / Relate or add dependency / Checklist / Attach.
  - **Activity:** a right rail with details, comments and activity; one Activity panel with search and filter; a comment box that also takes an @AI mention.

**AlianHub today**
- **Panel.**
  - A 760 px side panel over any view. Esc closes it; Expand goes to the full `:taskId` route; Minimise docks it to a bottom tray; on phones it is a bottom sheet (FE `components/organisms/TaskDetailOverlay/*`).
  - The tray lives only in memory (`useTaskOverlay.js:10`) and is lost on reload.
  - Home still opens the older `views/TaskDetail`.
- **Tabs.** Description, Subtasks (with count), Files and Relations, plus Activity (Comments / History) (`TaskDetailPanel.vue:398-410`).
- **Properties** (`TaskDetailRightSide`): status, assignees, priority, start and due, estimate with a required reason, points, AI estimate, sprint, type, tags, logged time with a live timer chip (`TaskTimerChip.vue`), watchers and relations.
- **Custom fields** (`plugins/customFieldView/.../FieldBuilder.vue:208-218`): text, long text, number, money, date, dropdown, checkbox, email, phone, formula and rollup. No people, URL, rating, progress or multi-label types.
- **Subtasks.** One level only; the backend refuses deeper nesting (BE `Tasks/helpers/taskMongo/bulk.js:1002`).
- **Checklists.** Items with sub-items, and AI-generated checklists.
- **Relations.** Blocks, blocked by, duplicates and relates, with a warning for open blockers (`components/organisms/LinkedTasks/LinkedTasks.vue:108-134`).
- **Comments** (`organisms/Comment/Comment.vue`): quote-reply, reactions, @mentions, attachments, time-limited edit, and actions to turn a comment into a task or add it to the checklist. No threads, no assign or resolve.
- **AI.** Summary block (`TaskSummaryBlock.vue`), write description, AI checklist, AI estimate, and an agent run strip (`TaskAgentStrip.vue`).
- **Missing.** No previous/next between tasks and no copy-ID button in the header (copy link and key sit in the ⋯ menu).
- **Open findings.** UIX-12 ("Scroll to bottom" link at the top of the phone panel), UIX-18 (chip contrast), TIM-02 (timesheet approval fails for every role).

**Gap**
- AlianHub's AI and agent content in the panel is on par with ClickUp or ahead of it, because agents can act on the task.
- What is missing:
  - moving through tasks without closing the panel;
  - a consistent "Empty → click to edit" property block;
  - a tray that survives a reload;
  - threaded and assigned comments;
  - richer field types;
  - nested subtasks.

**Recommendations**
- Top-10 #3: previous/next, copy ID, quiet actions, empty-value editing. S–M/H.
- Top-10 #8: threaded and assigned comments. L/H.
- Keep the tray in `sessionStorage` or on the user, so docked tasks survive a reload. S/L.
- Add people, URL, rating and multi-select field types. M/M.
- Nested subtasks: L/M. Treat as an owner decision; one level keeps rollups and agent scope simple.
- Move Home onto the overlay panel so there is one task detail. S/M.

## 4. Inbox, notifications, mentions, Home / My Work

**ClickUp**
- **Inbox tabs.**
  - Primary (the types it shows can be customised), Other (updates on tasks you follow), Later, and Cleared (kept 30 days).
  - An optional "All" tab.
  - Snoozing moves a group to Later until its time comes or a new update arrives; Z is the key.
  - ([Inbox](https://help.clickup.com/hc/en-us/articles/12724229385623-Intro-to-Inbox), [snooze](https://help.clickup.com/hc/en-us/articles/15643479240599-Snooze-Inbox-notifications), [Inbox settings and shortcuts](https://help.clickup.com/hc/en-us/articles/16101057400471-Inbox-settings-and-keyboard-shortcuts))
- **Notification settings** per event and channel ([settings](https://help.clickup.com/hc/en-us/articles/6325918957335-Notification-settings)).
- **My Tasks (formerly Home).**
  - A card canvas with "Manage cards".
  - A My Work card bucketed Today / Overdue / Next / Unscheduled.
  - A Reminders card and an AI StandUp card.
  - ([My Tasks](https://help.clickup.com/hc/en-us/articles/18944788880791-My-Tasks-page-formerly-Home), [My Work card](https://help.clickup.com/hc/en-us/articles/18947060934423-Use-the-My-Work-card), [Reminders card](https://help.clickup.com/hc/en-us/articles/18946664478743-Use-the-Reminders-card-in-My-Tasks), [AI StandUp](https://help.clickup.com/hc/en-us/articles/21021454281239-Use-the-AI-StandUp-card-in-My-Tasks))
  - Assigned comments and messages have their own view ([assigned messages and comments](https://help.clickup.com/hc/en-us/articles/34489586379031-View-assigned-messages-and-comments)).
- *Observed.*
  - **Home:** a greeting; a Recents card; an Agenda with calendar connect; My Work (To Do / Done / Delegated with bucket counts); an Assigned comments card (assigned to me or delegated by me, resolved filter, date range); Manage cards.
  - **Inbox:** Filter, Clear all and settings. The empty state offers a next action.

**AlianHub today**
- **Inbox** (FE `views/Inbox/Inbox.vue`, BE `Inbox`):
  - Tabs Primary / Later / Done, with counts.
  - Kind filter: all, mention, approval, reminder, update.
  - Done, "Later", mark all read with a 5-second undo, inline reply to mentions, approve or decline, and j/k/e/l/r triage.
  - **Later is stored in `localStorage` per device** (`Inbox.vue:262-270`). It has no return time and does not sync.
  - No Cleared history, no "Clear all", no Other/watching split.
  - A legacy notification API still backs older dropdowns (BE `notification`).
- **Notification preferences** (`views/Settings/Notifications/Notifications.vue`): a per-event grid across Inbox, Email, Push and Chat; all or assigned-only; snooze durations; quiet hours that respect time off; daily digest; agent activity; AI thresholds. This is already richer than most competitors.
- **Home** (`views/Home/TodayOverdue.vue`, `components/molecules/Home/MyWorkCard.vue`):
  - My Work with To Do / Done / Delegated.
  - Today / Overdue / Next / Unscheduled **with counts** and quick add. This matches ClickUp.
  - Agenda card, Personal List card, timer chip, Planner side panel, "New" menu, setup checklist.
  - "Manage cards" links out to `Dashboards` rather than editing Home in place.
  - No Recents card and no Assigned comments card.
- **Open findings.** UIX-11 (the Planner panel covers Home at 390 px), UIX-20 (Firebase console error), MSG-04 (the author of a reminder assigned to someone else cannot edit or delete it).

**Gap**
- Home is at parity with ClickUp's core My Work.
- The Inbox is close on triage but lacks a durable snooze, a clear or cleared model, and a watching-only tab.
- Home can't be arranged in place.

**Recommendations**
- Top-10 #2: server-side snooze, Cleared, Clear all, Other. M/H.
- Recents card on Home. S/M.
- Assigned comments card, once #8 lands. S/M.
- Let "Manage cards" add, remove and reorder Home cards in place, reusing the Dashboards card picker (`views/Dashboards/CardPicker.vue`). M/M.
- Open the Planner panel closed below 768 px (UIX-11). S/M.

## 5. Docs, chat, whiteboards, forms

**ClickUp**
- **Docs:** nested pages; page history with restore; comments; imports from other tools; collaborative editing ([Docs](https://help.clickup.com/hc/en-us/articles/6328174371351-Intro-to-Docs)).
- **Whiteboards:** real-time canvases with visible cursors; tasks and Docs can be created from them ([Whiteboards](https://help.clickup.com/hc/en-us/articles/6326615000471-Intro-to-Whiteboards)).
- **Chat:** channels and DMs; action items from messages; "SyncUps" (calls) ([Core features](https://help.clickup.com/hc/en-us/articles/6311563319063-Core-ClickUp-features)).
- **Threads** in Chat and Docs ([threads and replies](https://help.clickup.com/hc/en-us/articles/30097219025047-Reply-to-a-thread)).

**AlianHub today**
- **Docs** (`views/Pages/*`, BE `Pages`):
  - EditorJS with callout and task-chip blocks, nested pages, docs linked to tasks, five templates (`pageTemplates.js`).
  - Private or shared, and public links with a password and an expiry (BE `PublicShares`).
  - AI compose, agent review, and presenter mode.
  - No version history (removed on purpose, BE `Pages/controller.js:28`), no live co-editing or presence, no doc comments.
  - Open findings U3-38 (long titles clipped) and PAG-09/10.
- **Chat** (`views/Chat/*`, `components/organisms/MainChat/*`): channels, DMs, audio notes, media, search, pins, make-task-from-message (`MakeTaskSheet.vue`), WebRTC calls with notes (BE `Calls`). No threads. Open finding U3-28 (Create channel grid clipped at 390 px).
- **Whiteboard view** (`views/Projects/WhiteboardView/WhiteboardView.vue`): task cards whose positions are **saved per browser** (`:30-32`). There is no freeform canvas and no shared layout.
- **Forms** (`views/Projects/FormsView/*`): a builder, a public `/form/:token`, one task per submission, conditional rules through automations. Open finding PAG-11 (the responses table can't link to the created task).

**Gap**
- Chat and calls are at parity.
- Docs lack the collaboration trio: comments, history, presence.
- The whiteboard is a local-only layout that looks shared but isn't. That is a trust problem more than a missing feature.

**Recommendations**
- Save whiteboard card positions on the server per project, or label the view "personal layout". S/M.
- Doc comments first (M/H). Then page history, if the owner reverses the removal (M/M). Live presence last (L/M).
- Threads in Chat, sharing the comment-thread model from #8. M/M.
- Do **not** build a freeform whiteboard now (L/L). Mind map and Canvas already cover the brainstorming entry point, and embeds can host an external self-hosted board (Excalidraw) where needed.

## 6. Onboarding and first run

**ClickUp**
- **Signup.** Leads into onboarding modals that create the workspace, with separate team and individual setup guides ([team workspace](https://help.clickup.com/hc/en-us/articles/9563779819031-Set-up-your-team-s-Workspace), [individual](https://help.clickup.com/hc/en-us/articles/9563959684119-Set-up-your-individual-Workspace)).
- **Template Center.**
  - Featured / Workspace / ClickUp tabs.
  - Covers Spaces, Folders, Lists, tasks, Docs, views and checklists.
  - "Use template" lets you choose what to carry over.
  - ([templates](https://help.clickup.com/hc/en-us/articles/6326144923159-Intro-to-templates), [find a template](https://help.clickup.com/hc/en-us/articles/6326080034199-Find-a-template))
- **Sample data.** The nearest thing is a Quick Start List template. The recommended setup order is a guide on the website, not an in-app checklist ([Quick Start](https://clickup.com/templates/quick-start), [team onboarding](https://clickup.com/team-onboarding)).
- **ClickApps** switch features per workspace or Space ([ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps)).
- **Not found.** No public documentation of in-product tours or empty states.
- *Observed:* the Inbox empty state points to a next action ("invite people").

**AlianHub today**
- **Installation.** An installation wizard, then company creation (BE `Setup`).
- **Sample project.** A labelled sample project composed from what the owner says the team does (BE `Setup/demoProject.js`, `utils/sampleTasks`), removable from Home.
- **Setup checklist** on Home for owners, with a member variant (`components/molecules/Home/SetupChecklist.vue`, `composable/useOnboardingChecklist.js`). Steps: invite, sample or project, permissions, apps.
- **Tours** on driver.js (`components/organisms/Tour/{TourComponet.vue,tourSteps.js}`, BE `tours`).
- **Project templates** (BE `ProjectTemplates`, `views/Settings/Template`).
- **Guided AI project creation**, which asks clarifying questions and drafts a plan (task 015, `components/organisms/AiProjectCreator`).
- The sweeps suppressed the tours and the checklist, so the first-run screens were not judged visually in this pass.

**Gap**
- AlianHub is **ahead** here: it has an in-app checklist, a tailored sample project and an AI brief, all things ClickUp leaves to web guides.
- Two gaps remain. Importing is not a checklist step, even though for switchers it is the fastest route to value. And there is no template gallery for tasks, docs or views across the workspace.

**Recommendations**
- Add "Bring your work in" as a checklist step that opens the workspace import wizard (top-10 #9). S/H once #9 exists.
- A single Templates gallery (project, task, doc, automation) with Workspace and Built-in tabs. M/M.
- Give every empty list, inbox and board state one next action, as the Inbox zero state already does ("back to Primary"). S/M.
- Not copied: ClickApps-style feature toggles. Per-project view enablement already covers the useful part without a settings maze.

## 7. Automations and AI in the UI

**ClickUp**
- **Automations.**
  - Opened from a lightning-bolt "Automate" button on a Space, Folder or List.
  - One trigger, up to 15 conditions and 6 actions.
  - Suggested automations and templates, including integration templates.
  - A usage tab against a monthly plan quota.
  - An activity log per run.
  - ([create](https://help.clickup.com/hc/en-us/articles/30241682127127-Create-an-Automation), [conditions](https://help.clickup.com/hc/en-us/articles/6312136485527-Use-Automation-Conditions), [usage](https://help.clickup.com/hc/en-us/articles/10936258508311-Track-your-Workspace-Automations-usage), [activity](https://help.clickup.com/hc/en-us/articles/30953763592087-View-your-Automations-and-Autopilot-Agents-activity))
- **"Automate with AI"** turns a sentence into a draft rule and falls back to the manual builder ([AI automations](https://help.clickup.com/hc/en-us/articles/20690779238423-Build-Automations-with-ClickUp-AI)).
- **Agents.** Autopilot Agents and Super Agents are triggered by an @mention or by assignment, with admin-set tool and data scope ([Super Agents](https://help.clickup.com/hc/en-us/articles/37033397273111-Create-a-Super-Agent), [Autopilot](https://help.clickup.com/hc/en-us/articles/31012020810775-Create-and-configure-Autopilot-Agents)).
- **Other AI.** AI Notetaker for Zoom, Teams and Meet ([Notetaker](https://help.clickup.com/hc/en-us/articles/28928137493015-Use-AI-Notetaker-to-take-notes-and-record-meetings)). Brain answers across the workspace and connected apps ([Brain and Connected Search](https://help.clickup.com/hc/en-us/articles/24640565638935-Brain-AI-and-Connected-Search)).
- **Pricing.**
  - AI is a **paid per-seat add-on** with credits.
  - Automations are capped monthly by plan.
  - ([pricing](https://clickup.com/pricing), [AI limits](https://help.clickup.com/hc/en-us/articles/20686299081879-ClickUp-Brain-AI-feature-availability-and-limits))

**AlianHub today**
- **Automations** (`views/Automations/{AutomationsPage.vue,RunHistoryDrawer.vue}`, BE `Automations`):
  - When / If / Then builder.
  - Plain-sentence compile (`/automations/compile`) with a backtest showing how often a rule would have fired.
  - Dry run against a chosen task, and run history.
  - Scoped to all projects or one.
  - No usage cap. No template gallery.
- **AI.**
  - An AI hub, an agent wizard, skills, an approvals inbox, run traces and replay, health, and agents as teammates (`views/Ai/*`).
  - Task-level AI (summary, estimate, checklist, write).
  - An MCP server for outside agents (BE `Mcp`).
  - Providers are Anthropic, OpenAI, Google and DeepSeek, with the workspace's own keys (BE `AICore/llmProvider/*`, `ProviderKeys`).
  - **The OpenAI chat URL is hard-coded** (`openaiProvider.js:8`), so there is no path to a self-hosted or local model for chat. Embeddings do take `OPENAI_EMBEDDINGS_URL`.
- **Open findings.** `automations.md` lists role and scope defects (AUT-03/04/05/08) to settle before any wider automation UI.

**Gap**
- AlianHub's automation builder is at least as capable as ClickUp's: backtest and dry run are ahead.
- Its agent model, with approvals, traces and scope, is more transparent.
- The main gap is positioning. AI requires a cloud vendor, while a self-hosting buyer expects "our model, our network".
- Minor: no automation templates, and no in-context "Automate" entry on a project.

**Recommendations**
- Top-10 #5: OpenAI-compatible base URL for chat, plus a workspace "AI off" switch. S–M/H.
- An "Automate" button in the project toolbar that opens the builder pre-scoped to that project. S/M.
- A starter gallery of 8–12 rule templates (assign on status, overdue nudge, form → task triage), each opening in the builder with a backtest. S/M.
- Not copied: credit-metered AI and monthly automation caps. The self-hosted instance pays its own model bill directly, and that is the pitch.

## 8. Mobile, responsive and accessibility

**ClickUp**
- **Mobile.** Native iOS and Android apps, with home-screen widgets for quick create and Today ([mobile](https://help.clickup.com/hc/en-us/articles/15145935126679-Intro-to-the-mobile-app), [widgets](https://docs.clickup.com/en/articles/5023319-mobile-home-screen-widgets-for-ios-and-android)).
- **Offline mode** on all plans: create tasks and reminders, and read items already opened ([offline](https://help.clickup.com/hc/en-us/articles/6308895791127-Offline-Mode)).
- **Appearance.** Light, dark or auto, with accent colours ([theme](https://help.clickup.com/hc/en-us/articles/6310791806359-Change-your-Workspace-appearance-and-theme)). A **High Contrast** toggle ([high contrast](https://help.clickup.com/hc/en-us/articles/6310793610391-Use-High-Contrast-Mode)).
- **Accessibility statement.**
  - Targets WCAG 2.2 AA over several years; current conformance is described as partial.
  - Tested with NVDA and VoiceOver.
  - VPAT on request.
  - ([accessibility](https://clickup.com/accessibility))

**AlianHub today**
- **Responsive shell.** The rail becomes a bottom tab bar under 768 px (`Shell/MobileTabBar.vue`, `Shell/style.css:107`), and the task panel becomes a bottom sheet on phones.
- **Sweeps.** Every sweep checks 390 px and 1280 px, light and dark, for page overflow, raw keys, contrast and touch targets. Open: UIX-10 (`--ink-3` at 2.85:1), UIX-18 (chip contrast), UIX-19 (targets under 32 px), U3-28.
- **No native mobile app.** There is a web manifest (`public/manifest.webmanifest`) but no service worker, so no install prompt value and no offline mode. The Electron time tracker (`time-tracker-app/`) is desktop only.
- **Theme.** Dark mode through `data-theme`. No high-contrast mode, no skip link, `prefers-reduced-motion` in only one file, no axe checks in `e2e/specs`.

**Gap**
- The native apps and offline mode are real gaps. They are expensive, and a self-hosted buyer can accept a good PWA instead.
- Accessibility is the cheaper and more important gap. ClickUp publishes a statement and a VPAT; AlianHub has neither, which matters for the enterprise and public-sector buyers that self-hosting attracts.

**Recommendations**
- Top-10 #10: shortcut sheet, skip link, high contrast, axe on smoke routes. S–M/M.
- Publish an accessibility statement in `docs/` stating the WCAG 2.2 AA target and current known gaps, taken straight from the sweep findings. S/M.
- A PWA service worker that caches the shell and the user's assigned tasks read-only, then queues quick-add. L/M.
- Add `prefers-reduced-motion` to the panel and rail transitions in `tokens.css`. S/L.

## 9. Settings, admin and import

**ClickUp**
- **Roles.** Owner, Admin, Member, Limited Member, and several guest types ([roles](https://help.clickup.com/hc/en-us/articles/6310033667223-Intro-to-user-roles)).
- **Custom roles** built on a base role (Enterprise) ([custom roles](https://help.clickup.com/hc/en-us/articles/6309195687959-Manage-Custom-Role-permissions)).
- **Permissions.** Four levels per location, where the most specific wins ([permissions](https://help.clickup.com/hc/en-us/articles/6309221065495-Permissions-in-detail)).
- **Enterprise only:**
  - SAML and OIDC SSO ([SSO](https://help.clickup.com/hc/en-us/articles/6305043992343-Intro-to-single-sign-on-SSO));
  - SCIM ([Okta SCIM](https://help.clickup.com/hc/en-us/articles/6305052795287-Okta-SCIM-ClickUp-configuration-guide));
  - audit logs, 30 days in the UI ([audit logs](https://help.clickup.com/hc/en-us/articles/21929900448535-Workspace-audit-logs));
  - data residency in a choice of three regions ([data hosting](https://help.clickup.com/hc/en-us/articles/15999383444247-Data-hosting)).
- **2FA.** App-based on every plan; enforcing it needs Business ([2FA](https://help.clickup.com/hc/en-us/articles/6327741965591-Activate-and-manage-two-factor-authentication)).
- **Import.**
  - Eleven tool importers plus a spreadsheet importer with column mapping, user mapping and history ([import](https://help.clickup.com/hc/en-us/articles/6311099045783-Intro-to-importing-your-work-into-ClickUp), [data file](https://help.clickup.com/hc/en-us/articles/6310834724247-Import-a-data-file-into-ClickUp)).
  - The workspace CSV export link expires after an hour ([export](https://help.clickup.com/hc/en-us/articles/6310786693015-How-do-I-export-my-Workspace-s-data)).

**AlianHub today**
- **Settings** (`views/Settings/*`): Members, Teams, Security & permissions with simple and advanced rule modes and role lists (`SecurityPermissions.vue`), Sso, Scim, TwoFactorAuth, Audit (`Audit/AuditLog.vue`), Instance, Projects, Template, TimeOff, TimeTracking, Integrations, Notifications, Language, AgentClients and RoutingPolicy.
- **SSO** covers OIDC and SAML with domain discovery and enforcement (BE `SSO/{oidc,saml,discover}.js`). OAuth covers Google, GitHub and GitLab. Everything ships in the open-source build.
- **Import.**
  - Jira, Trello, Asana, Monday and CSV with preview, plus an import list (BE `Importers/routes.js`).
  - The UI is reachable **only from inside a project's ⋯ menu** (`views/Projects/components/ProjectFiltersToolbar.vue:147` → `components/organisms/ImportDialog`), so an import always lands in an existing project.
  - No ClickUp source.
- **Export.** Export and ExportJobs modules exist. How easy they are to find was not assessed in this pass.
- **Open findings.** `instance.md` and `access.md` list role-escalation and settings-scope defects (INS-01/02/06), INS-08 (audit CSV stops at 100 rows) and INS-10 (a member can edit another member's private views). These are prerequisites for any admin UX work.

**Gap**
- Admin features are at parity or ahead of ClickUp, without the Enterprise paywall.
- The gaps are first-run migration and the correctness of the role model.

**Recommendations**
- Top-10 #9: workspace-level migration wizard with a ClickUp source. M/H.
- A "who can see this" explainer in the project share and permissions panels, showing the effective permission and where it comes from, modelled on ClickUp's "most specific wins". M/M. Fix INS-01/02/06 first.
- Show "Self-hosted: your data stays on <instance host>" plainly in Settings → Instance. It costs nothing, and it is AlianHub's answer to ClickUp's Enterprise-only data residency. S/M.

---

## Sources

**ClickUp Help Center (help.clickup.com)**
- Navigation:
  - [Sidebar](https://help.clickup.com/hc/en-us/articles/12755292456983-Intro-to-the-Sidebar-in-ClickUp-3-0)
  - [Spaces sidebar](https://help.clickup.com/hc/en-us/articles/32490148963479-What-is-the-Spaces-Sidebar)
  - [Home sidebar sections](https://help.clickup.com/hc/en-us/articles/32855333466903-Create-and-reorder-custom-Home-Sidebar-sections)
  - [Favorites](https://help.clickup.com/hc/en-us/articles/6308862167575-Favorites)
  - [AI Command Bar](https://help.clickup.com/hc/en-us/articles/6533695640343-Intro-to-the-Command-Center)
  - [Desktop Command Bar](https://help.clickup.com/hc/en-us/articles/14952556494359-Desktop-Command-Center)
  - [Keyboard shortcuts](https://help.clickup.com/hc/en-us/articles/6309030550167-Use-keyboard-shortcuts)
- Views:
  - [Bulk action toolbar](https://help.clickup.com/hc/en-us/articles/6309768265495-Manage-tasks-with-the-Bulk-Action-Toolbar)
  - [Views bar](https://help.clickup.com/hc/en-us/articles/19063083658135-Intro-to-the-Views-Bar)
  - [Save view changes](https://help.clickup.com/hc/en-us/articles/6310370965911-Save-view-changes)
  - [Saving view filters](https://help.clickup.com/hc/en-us/articles/6311659064983-Saving-view-filters)
  - [Grouping](https://help.clickup.com/hc/en-us/articles/6310202447511-Use-grouping-in-views)
  - [Task templates](https://help.clickup.com/hc/en-us/articles/6309918176535-Use-task-templates)
  - [Default task template](https://help.clickup.com/hc/en-us/articles/13225295700759-Set-a-default-task-template-for-Lists)
  - [Pin task templates](https://help.clickup.com/hc/en-us/articles/17924317500951-Pin-Task-templates-in-List-view)
  - [View templates](https://help.clickup.com/hc/en-us/articles/6310410797079-View-Templates)
- Task detail:
  - [Intro to tasks](https://help.clickup.com/hc/en-us/articles/10552031987735-Intro-to-tasks)
  - [Fields, subtasks, relationships](https://help.clickup.com/hc/en-us/articles/34958820098839-Custom-Fields-subtasks-relationships-and-attachments)
  - [Nested subtasks](https://help.clickup.com/hc/en-us/articles/6304431740055-Create-nested-subtasks)
  - [Relationships](https://help.clickup.com/hc/en-us/articles/6304528030743-Intro-to-Relationships)
  - [Custom fields](https://help.clickup.com/hc/en-us/articles/6303536766231-Intro-to-Custom-Fields)
  - [Task-type fields](https://help.clickup.com/hc/en-us/articles/30976239926167-Intro-to-task-type-Custom-Fields)
  - [Assign comments](https://help.clickup.com/hc/en-us/articles/6311126397591-Assign-comments)
  - [Reply to comments](https://help.clickup.com/hc/en-us/articles/6308954445591-Reply-to-task-comments)
  - [Reply to a thread](https://help.clickup.com/hc/en-us/articles/30097219025047-Reply-to-a-thread)
  - [AI Fields](https://help.clickup.com/hc/en-us/articles/18450100382871-What-are-AI-Fields)
- Inbox and Home:
  - [Inbox](https://help.clickup.com/hc/en-us/articles/12724229385623-Intro-to-Inbox)
  - [Snooze](https://help.clickup.com/hc/en-us/articles/15643479240599-Snooze-Inbox-notifications)
  - [Inbox settings and shortcuts](https://help.clickup.com/hc/en-us/articles/16101057400471-Inbox-settings-and-keyboard-shortcuts)
  - [Notification settings](https://help.clickup.com/hc/en-us/articles/6325918957335-Notification-settings)
  - [My Tasks](https://help.clickup.com/hc/en-us/articles/18944788880791-My-Tasks-page-formerly-Home)
  - [My Work card](https://help.clickup.com/hc/en-us/articles/18947060934423-Use-the-My-Work-card)
  - [Reminders card](https://help.clickup.com/hc/en-us/articles/18946664478743-Use-the-Reminders-card-in-My-Tasks)
  - [AI StandUp](https://help.clickup.com/hc/en-us/articles/21021454281239-Use-the-AI-StandUp-card-in-My-Tasks)
  - [Assigned messages and comments](https://help.clickup.com/hc/en-us/articles/34489586379031-View-assigned-messages-and-comments)
- Docs and collaboration:
  - [Docs](https://help.clickup.com/hc/en-us/articles/6328174371351-Intro-to-Docs)
  - [Whiteboards](https://help.clickup.com/hc/en-us/articles/6326615000471-Intro-to-Whiteboards)
  - [Core features](https://help.clickup.com/hc/en-us/articles/6311563319063-Core-ClickUp-features)
- Onboarding:
  - [Team workspace setup](https://help.clickup.com/hc/en-us/articles/9563779819031-Set-up-your-team-s-Workspace)
  - [Individual workspace](https://help.clickup.com/hc/en-us/articles/9563959684119-Set-up-your-individual-Workspace)
  - [Templates](https://help.clickup.com/hc/en-us/articles/6326144923159-Intro-to-templates)
  - [Find a template](https://help.clickup.com/hc/en-us/articles/6326080034199-Find-a-template)
  - [ClickApps](https://help.clickup.com/hc/en-us/articles/6304327753111-Intro-to-ClickApps)
- Automations and AI:
  - [Create an automation](https://help.clickup.com/hc/en-us/articles/30241682127127-Create-an-Automation)
  - [Conditions](https://help.clickup.com/hc/en-us/articles/6312136485527-Use-Automation-Conditions)
  - [Usage](https://help.clickup.com/hc/en-us/articles/10936258508311-Track-your-Workspace-Automations-usage)
  - [Activity](https://help.clickup.com/hc/en-us/articles/30953763592087-View-your-Automations-and-Autopilot-Agents-activity)
  - [AI automations](https://help.clickup.com/hc/en-us/articles/20690779238423-Build-Automations-with-ClickUp-AI)
  - [Super Agents](https://help.clickup.com/hc/en-us/articles/37033397273111-Create-a-Super-Agent)
  - [Autopilot Agents](https://help.clickup.com/hc/en-us/articles/31012020810775-Create-and-configure-Autopilot-Agents)
  - [AI Notetaker](https://help.clickup.com/hc/en-us/articles/28928137493015-Use-AI-Notetaker-to-take-notes-and-record-meetings)
  - [Brain and Connected Search](https://help.clickup.com/hc/en-us/articles/24640565638935-Brain-AI-and-Connected-Search)
  - [AI limits](https://help.clickup.com/hc/en-us/articles/20686299081879-ClickUp-Brain-AI-feature-availability-and-limits)
- Mobile and accessibility:
  - [Mobile app](https://help.clickup.com/hc/en-us/articles/15145935126679-Intro-to-the-mobile-app)
  - [Offline mode](https://help.clickup.com/hc/en-us/articles/6308895791127-Offline-Mode)
  - [Theme](https://help.clickup.com/hc/en-us/articles/6310791806359-Change-your-Workspace-appearance-and-theme)
  - [High contrast](https://help.clickup.com/hc/en-us/articles/6310793610391-Use-High-Contrast-Mode)
- Admin:
  - [Roles](https://help.clickup.com/hc/en-us/articles/6310033667223-Intro-to-user-roles)
  - [Custom roles](https://help.clickup.com/hc/en-us/articles/6309195687959-Manage-Custom-Role-permissions)
  - [Permissions](https://help.clickup.com/hc/en-us/articles/6309221065495-Permissions-in-detail)
  - [SSO](https://help.clickup.com/hc/en-us/articles/6305043992343-Intro-to-single-sign-on-SSO)
  - [Okta SCIM](https://help.clickup.com/hc/en-us/articles/6305052795287-Okta-SCIM-ClickUp-configuration-guide)
  - [2FA](https://help.clickup.com/hc/en-us/articles/6327741965591-Activate-and-manage-two-factor-authentication)
  - [Audit logs](https://help.clickup.com/hc/en-us/articles/21929900448535-Workspace-audit-logs)
  - [Data hosting](https://help.clickup.com/hc/en-us/articles/15999383444247-Data-hosting)
  - [Import](https://help.clickup.com/hc/en-us/articles/6311099045783-Intro-to-importing-your-work-into-ClickUp)
  - [Import a data file](https://help.clickup.com/hc/en-us/articles/6310834724247-Import-a-data-file-into-ClickUp)
  - [Export](https://help.clickup.com/hc/en-us/articles/6310786693015-How-do-I-export-my-Workspace-s-data)

**ClickUp site (clickup.com / docs.clickup.com)**
- [Pricing](https://clickup.com/pricing)
- [Accessibility](https://clickup.com/accessibility)
- [Security](https://clickup.com/security)
- [Quick Start template](https://clickup.com/templates/quick-start)
- [Team onboarding](https://clickup.com/team-onboarding)
- [Mobile widgets](https://docs.clickup.com/en/articles/5023319-mobile-home-screen-widgets-for-ios-and-android)

**AlianHub evidence**
- The code paths cited inline, at `origin/beta` `65ead5ca`.
- The task-034 findings in this folder: `ui-sweep-2026-09-24.md`, `sprint-7-8-sweep-2026-09-24.md`, `ui-sweep-third-pass-2026-09-24.md`, `tasks.md`, `projects.md`, `pages.md`, `messages.md`, `time.md`, `automations.md`, `instance.md`.
