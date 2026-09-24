# UX flows: AlianHub, step by step (task 034, 2026-09-24)

This is a flow-level companion to `ux-comparison-clickup-2026-09-24.md`. That document compared screens; this one counts the steps of twelve everyday flows. It is written against `origin/beta` at `923322c8` (build 422), after task 036 shipped the ⌘K palette, task-detail previous/next and server-side Inbox snooze.

**Method**
- A fresh harness instance (`e2e/support/harness.js`) seeded the owner, admin, member and guest, "E2E Shared Project" and "E2E Owner Only". The frontend was a production build.
- A throwaway headless Playwright script walked each flow as a user would: clicks on visible controls, typed keys, no API shortcuts. It counted clicks and keystrokes and took screenshots at 1280×800 and 390×844 (touch). Typed text counts as keys; a title is noted as "title".
- Where the script could not reach a step, the path was confirmed in the Vue source and is marked *code*.
- Two projects, "UX Launch Plan" (1280) and "UX Mobile Plan" (390), were created through the UI in flow 5 and reused, because the seeded projects have no apps turned on (no priority, no timer).
- Screens were checked in light mode only. SMTP pointed at a closed port, as the harness sets it.
- File references are relative to `frontend/src` unless they start with `Modules/`.

**Reading the tables**
- **Mouse** is the shortest click path from the natural starting screen. **Keys** is the shortest keyboard path.
- **Screens** counts route changes. A full page reload is called out separately.
- **390 px** is whether the flow can be finished on a phone-sized screen.

---

## Summary

| # | Flow | Mouse (1280) | Keyboard | Works at 390 px |
|---|---|---|---|---|
| 1 | First sign-in → next action | 3 clicks + typing, 1 reload; three onboarding layers at once | Tab / Enter | yes (no tour, fewer layers) |
| 2a | Quick task from anywhere (title only) | Home only: 1 click + title + ↵ | none outside Home; palette "New task" is a dead end | yes (Home only) |
| 2b | Task inside a project list | 1 click + title + ↵ per task (the row closes) | none | yes |
| 2c | …with assignee + due date | ≈5 clicks + title (controls at the far right of the row) | none | partial |
| 3 | Change status, assignee, due, priority; close | 1 open + 2 + 2 + 2 + 2 + 1 close = 10 | j/k/Esc only; Esc closes the panel from inside pickers | yes except priority (see 3) |
| 4 | Find a known task | palette: ⌘K + name + ↵ (0 clicks) | same | palette only from the Home drawer; list search hidden behind an icon |
| 5 | Create a project until a task can be added | 3 clicks + name + ↵ | ↵ submits the dialog | yes |
| 6 | Invite a teammate | 6 clicks + email (via palette) | partial | yes |
| 7 | @mention, then reply from the Inbox | author: 1 click + text + ↵; member: 2 clicks + text + ⌘↵ | mostly | yes (send needs a tap) |
| 8 | Switch views, group, filter, save | tab 1 click; group 2; "Me" 1; nothing can be saved | arrow keys on tabs | view switch via "All views" menu |
| 9 | Log time: timer / manual | timer 1–4 clicks (must be assignee); manual 6 clicks | none | yes |
| 10 | Bulk-edit 3 tasks | 3 checkboxes + 2 = 5 clicks | Esc clears only | **no** (bar off-screen) |
| 11 | Two subtasks + two checklist items | 2 clicks + text (↵ between items) | ↵ chains; Esc closes the whole panel | yes |
| 12 | Inbox: clear, snooze, open | 1 + 2 + 1 click, undo on each | j/k/e/s work only after a click, and focus is lost after each action | yes |

**Headline**
- The single most visible defect: in **List view**, which is the default view, the search box, the "Me" toggle and saved filters do nothing. Board applies all three correctly (flows 4 and 8).
- The floating "Getting started" card sits over the bottom-right of every screen at 1280×800. It blocked the task-panel timer (a click was intercepted), and it covers the comment Send button, the inline create-row controls and the end of the bulk bar.
- There is no working "new task from anywhere" outside Home. The palette's "New task" command lands on the project list with nothing open.
- Esc is overloaded. Inside the task panel it closes the whole panel even while a picker or the subtask row is open.

---

## 1. First sign-in → landing

As a fresh member (Max) signing in for the first time.

| Step | Mouse | Keys | Notes |
|---|---|---|---|
| Sign in | click email, type, click password, type, click **Sign in** (3 clicks) | type, Tab, type, ↵ | Login ends with `window.location.reload()` (`views/Authentication/Login/Login.vue:326-339`): one full reload. |
| Landing | — | — | Home "Today & Overdue" (`views/Home/TodayOverdue.vue`). |

| Screens | Forced decisions | Feedback | 390 px |
|---|---|---|---|
| login → Home (reload) | none | none needed | ok; the bottom tab bar is Home · Planner · Chat · AI · More, so **Projects and Inbox are one tap deeper, inside More** |

**What a new member sees at 1280.** Three onboarding surfaces at once:
- the shell tour popover ("Step 1 of 4");
- the "Get going" card (0/5) with a primary **Open a project** button;
- the floating "Getting started" card (2/4) in the bottom-right corner.

The next action is clear: "Open a project" is the one primary button. The layers compete with it, though, and disagree with each other (0/5 against 2/4).

**Friction**
- **F1-a.** "Getting started" shows **Invite your team** and **Create your first project** already ticked for a member who did neither, because those are workspace-level facts. Its two links lead a member to Members and Projects without checking permissions (`components/organisms/Tour/TourComponet.vue:1-24, 76-80`). Its dismissal is kept in `sessionStorage` (`:46, 67-68`), so it returns every session.
- **F1-b.** The My Work empty state says "open E2E Shared Project — sample tasks that teach assigning, priorities…". That project is not a sample project: the copy names `projects[0]` whatever it is (`views/Home/TodayOverdue.vue:176`, `locales/en.js:707`).
- **F1-c.** Screenshots: `f1-landing-member-1280-landing-1280.jpg`, `f1-landing-member-390-landing-390.jpg`.

## 2. Create a task quickly

| Variant | Mouse | Keys | Screens | Forced decisions | Default | Feedback |
|---|---|---|---|---|---|---|
| a. From Home | click "Add a task for today…" (or **+ New → New task**, 2 clicks), title, ↵ | none | 0 | none; minimum 3 characters | Personal List, assignee = me, due today, Medium | toast "Added to your Personal List" |
| a'. From any other screen | palette ⌘K → "New task" → **lands on the project list with nothing open** | typing "new task" + ↵ runs **Ask AI** instead | 1 | — | — | none |
| b. In a project list | "+ Add task to To Do…" (1), title, ↵ | none | 0 | none | assignee = me, first status, Medium, no due date | toast "Task Created Succeessfully" (typo) |
| c. With assignee + due | as b, plus assignee icon → pick (2), due icon → pick (2) | none | 0 | none | as b | as b |

**Friction**
- **F2-a. No global "new task".**
  - The palette command routes to `/project?create=task` (`components/molecules/AdvanceSearch/CommandPalette.vue:231, 367-371`), and nothing reads `create=task`; `views/Projects/ProjectsListing/ProjectsListPage.vue:320` handles only `project`.
  - When a query is typed, "Ask AI" is ranked above commands (`CommandPalette.vue:287-293`), so "new task" + ↵ opens `/ai/ask?q=new+task`.
  - There is no `c` / `n` shortcut.
  - The project header's **+ New** offers only "New list · New folder", so on a project page "New" never means a task.
  - Screenshots: `f2c-palette-newtask-1280-*`.
- **F2-b. Rapid entry breaks after one task.**
  - In List view the create row closes after every ↵ (`views/Projects/ListView/ListGroup.vue:251-252`). The second task needs another click; the script's second title went nowhere. Board and Table keep the row open, so the three views behave differently.
  - On Home the input stays, but focus drops to `<body>` after save (observed), so the second task also needs a click.
- **F2-c. Controls hidden under the card.** The inline assignee / due / priority / Save controls sit at the far right of the create row. At 1280×800 that is under the "Getting started" card (`f2e-create-row-1280.jpg`).
- **F2-d.** The toast string has a typo, "Succeessfully" (`locales/en.js:7642`).

## 3. Open a task, change status / assignee / due / priority, close

In the "UX Launch Plan" list.

| Property | Mouse | Keys | Feedback |
|---|---|---|---|
| Open | click the row name (1) | — (no keyboard row focus in List) | panel slides in; URL gets `?task=` |
| Status | chip → option (2); "Complete" is 1 | — | toast "Status updated successfully" |
| Assignee | "+" → type to filter → pick (2 + name) | ↑↓ ↵ in picker | toast "Assignee added successfully" |
| Due date | field → day (2) | — | toast "Due date updated successfully" |
| Priority | chip → option (2) | — | toast "Priority updated successfully" |
| Close | × or Esc (1) | Esc | returns to the list, focus goes back to the first-opened row |
| Next task (036) | ↓ arrow in header (1) | j / k | counter "n / total" |

| Screens | Forced decisions | Undo | 390 px |
|---|---|---|---|
| 0 (overlay) | none | **none** on any property | partial: status is a header chip (2 taps); the other properties need **Properties** first (+1 tap) and a bottom sheet. Priority opened no picker in our runs (below). |

**Friction**
- **F3-a. Esc closes the whole panel from inside a picker.** With the assignee picker open, Esc closed the task panel (observed at 1280). The panel's Esc handler skips sidebars, modals and SweetAlert, but not an open dropdown (`components/organisms/TaskDetailOverlay/TaskDetailOverlay.vue:143-152`). The user then has to reopen the task.
- **F3-b. No undo on any property change.** Each change shows only a success toast (`components/organisms/TaskDetailRightSide/TaskDetailRightSide.vue:517, 597, 668, 730`).
- **F3-c. Properties depend on project apps.** On a project without the Priority app (both seeded projects), the desktop panel shows **no priority row at all** (`TaskDetailRightSide.vue:138`). The phone header still shows a read-only "Medium" chip (`TaskDetailOverlay/TaskDetailPanel.vue:121`). New users cannot tell why priority is missing.
- **F3-d. Phone priority.** At 390 px, tapping Priority in the Properties sheet opened no picker in three runs. `PriorityComp.vue` opens a `Sidebar` component, which may be stacked under the sheet. This needs a manual check on a device.
- **F3-e. Phone due date.** At 390 px the date picker stayed open after a day was tapped and covered the Sprint and Type rows. At 1280 it closed. `CalenderCompo.vue:7` has `close-on-auto-apply="false"`.
- **F3-f. Title casing.** The panel title is shown in Title Case ("Attach The Vendor Contract") while the list shows the stored sentence case.
- **F3-g. Two checkboxes by the title.** Next to the title sit two checkbox-like icons: "Mark as done" and a green ticked task-type icon. The ticked one reads as "done" on a task that is not done (`f3-detail-1280-open-1280.jpg`).

## 4. Find a known task by name

| Route | Mouse | Keys | Screens | Result |
|---|---|---|---|---|
| Palette | Home sidebar "Search or ask AI" (1), name, ↵ | **⌘K**, name, ↵ (0 clicks) | 1 | Opens the task's project list with the task **expanded full-page** (`useTaskOverlay.js:56`). Results show key, name and project. |
| List search box | click Search, type | — | 0 | **Does not filter List view** (11 rows stayed 11; the server returned the match). |
| Board search box | click Search, type | — | 0 | Works (11 → 1 card). |
| TaskFilter | ≥4 clicks (open, field, value, Show result) | — | 0 | Same List problem; no **assignee** field (`components/molecules/TaskFilter/TaskFilter.vue:159-164`). |

**Friction**
- **F4-a. List view ignores search, "Me" and filters.**
  - `ListGroup.vue:128-150` builds rows only from `projectData/tasks`.
  - Search, "Me" and TaskFilter all write to `projectData/searchedTasks` through `views/Projects/composables/useProjectSearch.js:57-121`. Board (`Kanban/BoardView.vue:115-122`), Table (`TableView/TableViewTable.vue:101`) and Calendar read it; the new List does not.
  - The request succeeds (`POST /api/v1/task/find` returned the one match), so the only failure is the render.
  - Screenshot: `f4-listsearch-1280-filtered-1280.jpg`.
- **F4-b. Phone search is hard to reach.**
  - At 390 px the palette is reachable only from the Home sidebar drawer (top-left toggle).
  - Project pages have only the list-search icon, and that search has the F4-a problem.
  - No tab-bar item opens search.
- **F4-c. Palette opens tasks differently.** The palette opens a task expanded to full page, while a list click opens the side panel. Previous/next is then relative to a list the user never saw.

## 5. Create a project and add its first task

| Step | Mouse | Keys | Notes |
|---|---|---|---|
| Open dialog | Home **+ New → New project** (2) | palette ⌘K → "New project" | focus lands in Name |
| Name → create | type name, ↵ | ↵ submits | 2.9 s to land in the new project's List |
| First task | "+ Add task to To Do…" (1), title, ↵ | — | works at once; the server creates the "List" sprint before replying |

| Screens | Forced decisions | Default | Feedback | 390 px |
|---|---|---|---|---|
| Home → project list (1) | Name only; Key is generated, Source defaults to Other | **the first template ("Implementation Plan…") is pre-selected, with 10 sample tasks** | toast "Project data has been added successfully" | ok |

**Friction**
- **F5-a. A template is picked for you.**
  - Typing a name and pressing ↵ creates a project with 10 example tasks ("An example task. Open it, try the controls, then delete it."), because the first template is pre-selected (`components/organisms/CreateProject/CreateProjectSidebar.vue:248-249`). "Blank" is listed first but is not the default.
  - A user wanting an empty project must notice and click Blank.
  - On the plus side, this is what switches on Priority, Time tracking and other apps; a Blank project lands without them (F3-c).
- **F5-b.** Palette "New project" ignores the typed name (`CommandPalette.vue:371`), and `create=project` stays in the project URL afterwards.
- **F5-c.** Landing on `/project/<id>/p?tab=ProjectListView` works. A bare `/project/<id>` link is a 404 (`router/projects/index.js` has no bare route).

## 6. Invite a teammate

As the owner. SMTP is unreachable in the harness.

| Step | Mouse | Keys |
|---|---|---|
| Reach Members | ⌘K "members" ↵ (0 clicks), or More → Settings → Members | ⌘K route |
| Open invite panel | **+ Invite** (1) | — |
| Email | click (1), type, ↵ makes a chip | ↵ / comma / space |
| Role | select **Member** (1); starts empty | keyboard select |
| Designation | select (2); **required** when the company has designations | keyboard select |
| Send | click **Send** (1); ↵ never sends | — |

| Screens | Forced decisions | Feedback on SMTP failure | 390 px |
|---|---|---|---|
| 1 | role (no default), designation (no default, required) | red toast with the raw transport error: **`connect ECONNREFUSED 127.0.0.1:9`**; the row still appears as "invited · resend" | ok (Members is in the More sheet) |

**Friction**
- **F6-a. The fallback link does not work.**
  - After a send the panel offers "Or share a join link: …#/invitation?companyId=…", and pending rows have "Copy link".
  - Opening that link in a fresh browser shows **"This invitation isn't valid any more"** (`f6-invite-1280-joinlink-1280.jpg`). The link lacks the `token` the invite page requires (`views/Authentication/Invitation/Invitation.vue:138`, `views/Settings/Members/Members.vue:258-261, 361`).
  - So when mail fails, the admin has no working way to bring the person in.
- **F6-b. Raw error text.** The failure toast shows the transport error string (`Members.vue:364`, fed by `Modules/Auth/controller/sendInvitation.js:396-404`), not "Couldn't email the invite — copy the link instead".
- **F6-c. Two required selects with no default** (role and designation), and the Send button is enabled before they are chosen. The error "Pick a designation for the invite." appears only after Send.
- **F6-d. Copy glitch.** The role hint runs into the link hint: "Works on projects and tasks day to day.Send an invite…".
- **F6-e.** No invite entry on the rail or in Home's "+ New". The member-facing "Getting started" card offers "Invite your team" to people who cannot invite (F1-a).

## 7. Comment with @mention; mentioned member sees it and replies

| Actor | Mouse | Keys | Feedback |
|---|---|---|---|
| Author (owner) | open task (1), click comment box (1 at 1280, 2 at 390), type `@Max`, ↵ picks, text, ↵ sends | `@` picker: ↑↓ ↵ | comment appears; no toast |
| Member | rail **Inbox** (badge "1") (1), **Reply here** (1), text, ⌘↵ | `r` opens reply (after a row has focus) | toast "Reply posted."; item marked done |

| Screens | Forced decisions | 390 px |
|---|---|---|
| author 0; member 1 | none | ok; at 390 ↵ does not send (by design, `CommentInput.vue:190`), tap Send |

**Friction**
- **F7-a. Inbox replies are plain text.** A reply from the Inbox has no @ picker and sends `mentionIds: []` (`views/Inbox/Inbox.vue:699-714`). The original author is not mentioned and gets no Inbox item for the reply.
- **F7-b. Send is covered.** At 1280×800 the comment Send button sits under the "Getting started" card (`f7-mention-1280-picker-1280.jpg`).
- **F7-c. Failed sends are silent.** A failed comment send is logged only to the console and the text is cleared (`views/Projects/Comments/Comments.vue:2096-2098`) (*code*).

## 8. Switch views, group, filter, save

| Action | Mouse | Keys | Result |
|---|---|---|---|
| List → Board | tab (1) | ←/→ on the tab list | ok |
| Add Calendar | **Add View** → Calendar (2) | — | toast "View added successfully"; becomes a tab |
| Group by priority | "Status" button → Priority (2) | — | ok; options are **Status, Priority, Due Date** only |
| Filter "Me" | **Me** (1) | — | **List: no effect** (11 → 11); Board: 11 → 3 |
| Filter by status | filter icon → Where → field → value → Show result (≥5) | — | List: no effect (F4-a) |
| Save the view | — | — | grouping, "Me", search and sort are **not saved**; after a reload grouping is back to Status |

| Screens | Forced decisions | 390 px |
|---|---|---|
| 0 | none | view switch through the "All views" dropdown in the header (2 taps); no tab row |

**Friction**
- **F8-a. Filters fail in List.** "Me" and filters do nothing in List view (F4-a).
- **F8-b. Nothing is saved.** Group, "Me" and search reset on reload and on project switch (`useProjectSearch.js` refs; `Projects.vue:732-740`). Only named TaskFilter filters can be saved, and they do not hold grouping.
- **F8-c. Untranslated headings.** The Add View menu shows raw keys **`PROJECTS.MENU_POPULAR`, `PROJECTS.MENU_INTEGRATIONS`, `PROJECTS.MENU_MORE_VIEWS`**. The keys named in `components/molecules/ProjectViews/helper.js:8-10` are missing from `locales/en.js` (`f8-views-1280-add-view-1280.jpg`).
- **F8-d. No assignee grouping.** Grouping by assignee is not offered (`Projects.vue:724-728`) although `ListGroup.vue:139` supports it.
- **F8-e. Tab order changed.** After Calendar was added, the tab order later read Calendar · Board · List. The home view kept its house icon but moved to last.

## 9. Log time

| Variant | Mouse | Keys | Forced decisions | Feedback |
|---|---|---|---|---|
| Timer in the task panel | Start (1). If not assigned: the button is disabled ("Only an assignee can track time…"), so assign yourself first (+3). | none | must be assignee | chip turns into `00:00:08 Pause ✓`; no toast on start |
| Manual entry | rail **Time** → timesheet → **Log time** (2) → Pick a task (1) → task (1) → **+1h** (1) → **Log 1:00** (1) = 6 | ↵ does not submit | task and hours | inline "Logged 1h on …" |

| Screens | 390 px |
|---|---|
| timer 0; manual 1–2 | timer in the panel footer, ok; manual ok (Time is in More) |

**Friction**
- **F9-a. The card blocked the timer.** At 1280×800 the "Getting started" card intercepted the click on the panel's timer button. Playwright reported the card's `<aside class="ah-gs">` intercepting pointer events. The card had to be dismissed first.
- **F9-b. Two start buttons.** The panel shows **Start Tracker** (hands off to the desktop tracker, `TaskDetailRightSide.vue:4-13`) right above the in-browser timer. Both read as "start", and only the hint explains the difference.
- **F9-c. Home doesn't see the panel timer.** A timer started in the task panel does not appear on Home: the panel uses `ah.timer.<uid>`, Home and Time use `ah.timer` (`composable/useTimer.js`, `components/molecules/Home/useTimer.js`, `TaskDetailOverlay/useTaskTimer.js`). Observed: no running chip on Home after starting in the panel.
- **F9-d. No manual entry in the panel.** There is no "Add time manually" in the task panel. The user has to leave the task and pick it again in the Log time form.
- **F9-e. The panel follows you.** After navigating to Home or Time, the open task panel stayed on top of the new page (observed after a route change), covering it until closed.

## 10. Bulk-edit several tasks

| Step | Mouse | Keys |
|---|---|---|
| Select 3 rows | 3 checkbox clicks (**shift-click range does not work**: 2 selected, not 3) | — |
| Status → In Progress | Status ▾ (1) → option (1) | — |

| Screens | Forced decisions | Feedback | Undo | 390 px |
|---|---|---|---|---|
| 0 | archive/delete ask you to type the word | toast "Updated 3 tasks."; selection clears | none | **fails**: the bar is laid out at y=879 in an 844 px viewport, below the bottom tab bar |

**Friction**
- **F10-a. The bulk bar is off-screen on phones.** At 390 px `.lv2-bulk` renders below the viewport, so bulk edit is unreachable there (`views/Projects/ListView/ListBulkBar.vue`).
- **F10-b. Shift-click range doesn't work.** `useTaskSelection.js:90` calls `toggle(id, evt)` without the visible-ID list, so range selection never happens.
- **F10-c. Short action list, no undo.** The List bar has no Priority or Due date actions (the Board's older bar has them), and no undo.

## 11. Subtasks and checklist

| Step | Mouse | Keys | Result |
|---|---|---|---|
| Add 2 subtasks | **Add subtask** (1), title ↵, title ↵ | ↵ chains | both created; toast per subtask |
| Leave the subtask row | Esc → **the whole panel closes** | — | the hint says "Esc cancels" |
| Add 2 checklist items | **Checklist** (1), item ↵, item ↵ | ↵ chains; focus lands in "+ Add an item" | both created |

| Screens | Forced decisions | 390 px |
|---|---|---|
| 0 | none | ok |

**Friction**
- **F11-a. Esc contradicts the hint.** "Enter adds the next subtask; Esc cancels." (`locales/en.js:1599`), but `components/atom/CreateTask/CreateTask.vue` has no Esc handler, so Esc reaches the panel and closes it (observed at both widths).
- **F11-b.** Subtasks nest one level only; checklist items nest about five levels. This is documented in the screen comparison.

## 12. Inbox triage: clear, snooze, open

As the member, with three mentions.

| Action | Mouse | Keys | Feedback |
|---|---|---|---|
| Clear | **Clear** (1) | `e`, but only after a card has focus | bar "Cleared. Undo" |
| Snooze | **Snooze** → "Tomorrow" (2) | `s` → ↓ → ↵ | bar "Snoozed until Fri, Sep 25, 9:00 AM. Undo"; presets show their resolved time |
| Open | **Open task** (1) | ↵ on a focused card | leaves the Inbox for the task page; Back returns to the Inbox tab |

| Screens | Forced decisions | Empty state | 390 px |
|---|---|---|---|
| open = 1 route change | none | "You're all caught up" | ok by mouse |

**Friction**
- **F12-a. The keyboard path is broken at both ends.** On load nothing has focus, and `j` did not move focus into the list (observed). After `e` clears a card, focus falls back to `<body>`, so the next `s` or ↵ does nothing. Keyboard triage therefore needs a mouse click per item (`views/Inbox/Inbox.vue:763-777`).
- **F12-b. Open leaves the Inbox.** Open navigates away instead of opening the task over the Inbox, so triaging several items costs a Back per item (`components/organisms/Header/helper.js:132-272`).
- **F12-c. No undo for bulk actions.** "Clear all" and "Mark all read" have no confirmation and no undo (`Inbox.vue:563-580`) (*code*).
- **F12-d. The hint is incomplete.** The key hint shows "j k e s" only; `r` and ↵ are not listed.

---

## Friction ranked by frequency × cost

Frequency: how often a typical team member hits the flow (D daily, W weekly, R rarely). Cost: extra steps, dead ends or lost work.

| Rank | Friction | Flow | Freq | Cost | Small fix |
|---|---|---|---|---|---|
| 1 | List view ignores search, "Me" and filters (F4-a / F8-a) | 4, 8 | D | high: the filter silently does nothing on the default view | In `ListGroup.vue`, when `searchedTask` is true, build `storeTasks` from `projectData/searchedTasks` filtered by sprint, as `BoardView.vue:115-122` does. Add an e2e check that "Me" narrows List. |
| 2 | "Getting started" card covers the bottom-right controls (F9-a, F7-b, F2-c) | 2, 3, 7, 9, 10 | D | high: blocks clicks on the timer and Send | Hide the card while a task panel, bulk bar or create row is open, or dock it into the Home sidebar. Keep dismissal on the user record, not `sessionStorage`. |
| 3 | Esc closes the whole task panel from inside pickers and the subtask row (F3-a, F11-a) | 3, 11 | D | medium: reopen and lose place | In `TaskDetailOverlay.vue:143-152`, ignore Esc when focus is inside an open dropdown, date picker or create row. Give `CreateTask.vue` its own Esc that closes the row. |
| 4 | No "new task" outside Home; palette "New task" dead-ends; typed "new task" runs Ask AI (F2-a) | 2 | D | high | Make "New task" open a small create dialog with a project picker (default: last-used project, else Personal List). Rank commands above Ask AI when the query matches a command label. Bind `c` to it. |
| 5 | List create row closes after each ↵; Home input loses focus (F2-b) | 2 | D | medium: +1 click per task | Keep the List row open after save, as Board and Table do (`ListGroup.vue:251-252`). Refocus the Home input after save. |
| 6 | Inbox keyboard triage loses focus (F12-a) and Open leaves the Inbox (F12-b) | 12 | D | medium | Focus the first card on load and move focus to the next card after clear or snooze. Open the task as the overlay on top of `/inbox?task=`. |
| 7 | No undo for property and bulk changes (F3-b, F10-c) | 3, 10 | D | medium: mistakes need manual repair | Add "Undo" to the success toast for status, assignee, priority and due date, and to "Updated n tasks.", reusing the Inbox undo bar pattern. |
| 8 | Views don't remember group, "Me" or search, and no assignee grouping (F8-b, F8-d) | 8 | D | medium | Persist `groupBy` and "Me" per user per project (localStorage first). Add "Assignee" to the group menu. |
| 9 | Invite fallback link is invalid, and the SMTP error is raw (F6-a, F6-b) | 6 | R (setup-critical) | high: no way in when mail is down | Append `&token=<linkId>` to the copied link (the row already carries `linkId`). Replace the raw error with "Couldn't email this invite. Copy the join link instead." |
| 10 | Bulk bar off-screen at 390 px, and shift-click range broken (F10-a, F10-b) | 10 | W | high on phones | Lift `.lv2-bulk` above the mobile tab bar (bottom offset = tab-bar height + safe area). Pass the visible IDs through `toggleAndCascade` in `useTaskSelection.js:90`. |
| 11 | Two start buttons and three separate timer stores (F9-b, F9-c) | 9 | D for trackers | medium | Label the desktop hand-off "Open in desktop tracker" and move it into the ⋯ menu. Point Home and Time at the panel's per-user timer key. |
| 12 | Onboarding layers disagree and tick invite/project for members (F1-a, F1-b) | 1 | R (first impression) | medium | Show one checklist per role. Hide workspace-level steps from members. Name the sample project only when it is the sample project. |
| 13 | New project silently uses a 10-task template (F5-a) | 5 | W | low–medium: clean-up work | Pre-select Blank, or label the default "Starter (10 example tasks)" beside the name field. |
| 14 | Raw i18n keys in the Add View menu (F8-c) | 8 | W | low: looks broken | Add `Projects.menu_popular`, `menu_integrations` and `menu_more_views` to `en.js`, then run `npm run i18n:backfill`. |
| 15 | Invite form: two required selects without defaults, and Send enabled early (F6-c) | 6 | R | low | Default the role to Member; make designation optional, or pre-select the first one. |

**Screenshots** (not committed) are in the worktree under `ux-shots/`, named `<flow>-<step>-<width>.jpg`. There are 130+ files at 1280 and 390.
