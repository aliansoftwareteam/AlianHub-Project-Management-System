# QA Test Cases — AI Task Estimation & Project Creation

This document covers manual test cases for all AI features added in
PRs #188, #189, and #190.

How to read this doc:
- **Setup** = what to prepare before running the test.
- **Steps** = exactly what to click or type.

If a test references AI keys, ask a developer to confirm
`ANTHROPIC_API_KEY + ANTHROPIC_MODEL` (or `AI_API_KEY + AI_MODEL`) are
set in the server's `.env` file.

---

# Section A — Auto AI Estimate on Task Create

When a task is created, the AI should silently estimate the time it
would take and fill in the "Estimated" field within a few seconds.

## A1. Single task created from the UI gets an auto estimate

**Setup**
- Log in as a normal user.
- Open any project.
- AI keys are configured in the server.

**Steps**
1. Open a sprint and click "Add task".
2. Type a clear task name (e.g. "Add user profile page with avatar").
3. Add a short description (e.g. "Create a profile page where users
   can see and edit their name, email, and profile picture").
4. Save the task.
5. Wait a few seconds (5–15 sec).
6. Open the task to see the right-side detail panel.

---

## A2. Task with no description still gets a small estimate

**Setup**
- Same as A1.

**Steps**
1. Create a task with just a title (e.g. "Fix bug") and no description.
2. Save the task.
3. Open the task after 5–15 seconds.

---

## A3. AI Project Generator creates tasks with estimates

**Setup**
- AI keys are configured.

**Steps**
1. Click "Create with AI" from the top of the sidebar.
2. Type a clear project description (20+ characters).
3. Click "Generate plan".
4. After the preview appears, click "Create everything".
5. Wait for the project to finish creating.
6. Open the new project.
7. Open any task inside.

---

## A4. Existing estimate is not overwritten on create

**Setup**
- AI keys configured.

**Steps**
1. Use the import-tasks feature OR create a task via an API tool
   that includes a `totalEstimatedTime` value (e.g. 120 minutes).
2. Wait 5–15 seconds after creation.
3. Open the task.

---

## A5. App still works when no AI keys are configured

**Setup**
- Ask a developer to temporarily remove `ANTHROPIC_API_KEY` and
  `AI_API_KEY` from the server's `.env` (or set them blank), then
  restart the server.

**Steps**
1. Create a task normally.
2. Wait 10 seconds.
3. Open the task.

---

# Section B — Manual "Generate Estimate with AI" Button

A new icon button next to the "Estimated" field on the task detail
sidebar lets users re-trigger AI estimation on demand.

## B1. Button appears in the right place

**Setup**
- Log in as a user with full edit permission on the project.
- AI keys are configured.

**Steps**
1. Open any task.
2. Look at the right-side panel where it shows "Estimated".

---

## B2. Hover shows a tooltip

**Steps**
1. Hover the mouse over the AI icon button.
2. Wait about 1 second.

---

## B3. Click generates a new estimate

**Steps**
1. Click the AI icon button.

---

## B4. Spinner is a clean round shape

**Steps**
1. Click the AI icon button.
2. Look at the spinner carefully while it spins.

---

## B5. Rapid clicks do not fire multiple requests

**Steps**
1. Click the AI icon button very fast 5–6 times in a row.
2. Open the browser's Network tab.
3. Filter for "estimatedTime/ai".

---

## B6. Estimate updates everywhere in real-time

**Setup**
- Open the same task in two browser windows (User A and User B).

**Steps**
1. In Window A, click the AI icon button.
2. Watch Window B without touching it.

---

## B7. Read-only user does NOT see the AI button

**Setup**
- Have an admin set your role permission to "read-only" for
  `task_estimated_hours` on the project.
- Or log in as a user with restricted permissions.

**Steps**
1. Open a task.
2. Look at the "Estimated" field.

---

## B8. No-permission user does NOT see the row

**Setup**
- Permission for `task_estimated_hours` set to "no access".

**Steps**
1. Open a task.

---

## B9. Disabling the TimeEstimates app hides everything

**Setup**
- Go to project settings → Apps.
- Turn OFF "TimeEstimates".

**Steps**
1. Open a task.

---

## B10. Error toast on missing AI keys

**Setup**
- Same as A5 — AI keys removed.

**Steps**
1. Open a task.
2. Click the AI icon button (if visible).

---

# Section C — Accuracy of the AI Estimate

These tests check the AI gives sensible numbers and does not
double-count repeated work.

## C1. Repeated wording counts as one job

**Setup**
- AI keys configured. Permission to use AI button.

**Steps**
1. Create a task with this description:
   ```
   Build a user profile page.
   The user should have a profile page.
   Create the profile screen where users can view their info.
   ```
2. Click the AI button.
3. Note the estimate value.
4. Now create another task with this description:
   ```
   Build a user profile page.
   ```
5. Click the AI button on this one too.

---

## C2. Overlapping requirements count as one job

**Setup**
- AI keys configured.

**Steps**
1. Create a task with this description:
   ```
   Add login.
   Implement authentication.
   Set up sign-in flow.
   ```
2. Click the AI button.

---

## C3. Filler content is ignored

**Setup**
- AI keys configured.

**Steps**
1. Create a task with this description:
   ```
   This task is critical for our roadmap.
   We need to add a search bar to the navbar.
   Once done, users will be able to search faster.
   ```
2. Click the AI button.

---

## C4. Multiple distinct items get a fair sum

**Setup**
- AI keys configured.

**Steps**
1. Create a task with this description:
   ```
   Add Stripe webhook handler.
   Acceptance criteria:
   - Handle invoice.paid event
   - Handle refund.created event
   - Handle dispute.created event
   - Log failures
   ```
2. Click the AI button.

---

## C5. Value stays inside safe bounds

**Setup**
- AI keys configured.

**Steps**
1. Create a task with a one-line description "fix typo".
2. Click the AI button.
3. Create another task with a huge description (1000+ words about
   building a full SaaS app).
4. Click the AI button on that one.

---

# Section D — AI Project Generator Step Navigation

After generating a plan, users can go Back to Step 1 and either jump
forward without spending tokens, or regenerate from scratch.

## D1. First-time flow shows single button

**Setup**
- AI keys configured.

**Steps**
1. Click "Create with AI" in the sidebar.
2. The modal opens to Step 1 (Describe).

---

## D2. After generating, the preview shows correctly

**Steps**
1. From D1, type a description (20+ chars).
2. Click "Generate plan".
3. Wait for the loading spinner.

---

## D3. Clicking Back shows two buttons on Step 1

**Steps**
1. From D2, on Step 2 (Review plan), click "← Back".

---

## D4. "Next" goes straight to Step 2 without an AI call

**Setup**
- Open the browser Network tab. Filter for "ai-project" or any
  AI-related path.

**Steps**
1. From D3, click "Next →".

---

## D5. "Re-Generate Plan" creates a fresh plan

**Steps**
1. From D3, click "Re-Generate Plan".

---

## D6. Closing the modal resets to single-button state

**Steps**
1. From D3 (two-button state), click the close (X) icon to close
   the modal.
2. Click "Create with AI" again to reopen.

---

# Section E — AI Project Creation with Plan Limit

The plan limit gate is bypassed for AI-created projects only. Manual
project creation still respects the limit.

## E1. AI project creates successfully even when limit is reached

**Setup**
- Ask a developer to set your company's `planFeature.project` field
  to `0` in MongoDB (so any new project would normally be blocked).

**Steps**
1. Click "Create with AI".
2. Type a description and click "Generate plan".
3. Click "Create everything" on the preview screen.

---

## E2. Manual project creation still respects the limit

**Setup**
- Same as E1 — limit is set to 0.

**Steps**
1. Click "+ New Project" (the manual flow, NOT the AI one).
2. Fill in the form.
3. Click "Create".

---

## E3. Project counter still increments accurately

**Setup**
- Have a developer check the company doc in MongoDB before and after
  the test. Note the value of `projectCount.projectCount`.

**Steps**
1. Note: `projectCount.projectCount = X` (e.g. 5).
2. Create a project via the AI flow.
3. After creation, check the company doc again.

---

# Section F — End-to-End Sanity

## F1. Full flow: AI plan → AI tasks → manual estimate trigger → live update

**Setup**
- AI keys configured. Full edit permissions.

**Steps**
1. Click "Create with AI".
2. Type a description like "Build a small e-commerce checkout flow
   with cart, payment, and order confirmation".
3. Click "Generate plan".
4. Click "Create everything" and wait for completion.
5. Open the new project.
6. Open any task in the first sprint.
7. Look at the "Estimated" field.
8. Click the AI button next to "Estimated".
9. Wait for the spinner to finish.

---

## F2. Existing tasks created before AI was added still work

**Setup**
- Find a task that was created weeks/months ago (before AI features
  were added). It should have an "Estimated" value of "00h 00m" or
  something manually set.

**Steps**
1. Open the old task.
2. Click the AI button.

---

# Section G — Visual / UI Polish

## G1. Button does not overlap or break the layout

**Steps**
1. Open a task with a very long task title.
2. Check the right-side sidebar.

---

## G2. Hover state on the button is visible

**Steps**
1. Hover the mouse over the AI button (not click).

---

## G3. Disabled state during loading is clear

**Steps**
1. Click the AI button.

---

# Section H — Negative / Edge Cases

## H1. Network failure mid-request

**Setup**
- Open browser dev tools → Network tab.
- After clicking the AI button, set network to "offline" mode
  immediately.

**Steps**
1. Click the AI button.
2. Quickly toggle network to offline.
3. Wait 60 seconds.

---

## H2. Slow AI response

**Setup**
- AI keys configured but server is responding slowly (developer can
  simulate this).

**Steps**
1. Click the AI button.
2. Wait up to 60 seconds.

---

## H3. Switching tasks while spinner is running

**Steps**
1. Click the AI button on Task A.
2. While the spinner is still running, click on Task B in the sidebar.

---

# Section I — Multiple Task Selection (List, Kanban, Table Views)

These tests cover selecting many tasks at once and applying bulk
actions. Most tests should be repeated in all three views.

**Important:** Each test marked "[All views]" should be run THREE
times — once in **List View**, once in **Kanban View**, and once in
**Table View**. Note the view name on the bug report if anything fails.

## I1. Single task selection via checkbox [All views]

**Setup**
- Open a project with at least 5 tasks.
- Switch to the view being tested (List / Kanban / Table).

**Steps**
1. Hover over a task row/card.
2. Click the checkbox that appears on the task.

---

## I2. Multiple tasks selection one by one [All views]

**Setup**
- Same project, view being tested.

**Steps**
1. Click the checkbox on Task 1.
2. Click the checkbox on Task 3.
3. Click the checkbox on Task 5.

---

## I3. Select All via header checkbox [List View and Table View]

**Setup**
- Project with several tasks in List or Table view.

**Steps**
1. Look at the top of the task list/table for a header checkbox.
2. Click the header checkbox.

---

## I4. Deselect all via header checkbox [List View and Table View]

**Setup**
- Continue from I3 — all tasks currently selected.

**Steps**
1. Click the header checkbox again.

---

## I5. Bulk action bar appears with selection count

**Setup**
- Any view, at least 3 tasks selected.

**Steps**
1. Select 3 tasks via checkboxes.
2. Look at the top or bottom of the page for a bulk action bar.

---

## I6. Bulk delete works [All views]

**Setup**
- User has delete permission on the project.
- Note down 2 task names you will delete.

**Steps**
1. Select 2 tasks via checkboxes.
2. In the bulk action bar, click the Delete (trash icon) button.
3. Confirm if a confirmation dialog appears.
4. Refresh the page after deletion.

---

## I7. Bulk status change works [All views]

**Setup**
- Select 3 tasks that are NOT currently in "Done" status.

**Steps**
1. Select 3 tasks via checkboxes.
2. In the bulk action bar, click the Status option.
3. Choose "Done" (or any other status).
4. Click apply / confirm.

---

## I8. Bulk priority change works [All views]

**Setup**
- Select 3 tasks with varying priorities.

**Steps**
1. Select 3 tasks via checkboxes.
2. In the bulk action bar, click the Priority option.
3. Choose "HIGH" (or any priority).
4. Click apply / confirm.

---

## I9. Bulk assignee change works [All views]

**Setup**
- Select 3 tasks.

**Steps**
1. Select 3 tasks via checkboxes.
2. In the bulk action bar, click the Assignee option.
3. Choose a user from the dropdown.
4. Click apply / confirm.

---

## I10. Selection clears after a bulk action completes [All views]

**Setup**
- Select 3 tasks.

**Steps**
1. Apply any bulk action (e.g. change priority).
2. Wait for the action to complete.
3. Look at the checkboxes and the bulk action bar.

---

## I11. Switching views clears selection

**Setup**
- Open List View.

**Steps**
1. Select 3 tasks via checkboxes.
2. Switch to Kanban View (or Table View).
3. Look at the selection state.

---

## I12. User without delete permission cannot bulk-delete

**Setup**
- Log in as a user with no delete permission on the project.

**Steps**
1. Select 2 tasks via checkboxes.
2. Look at the bulk action bar.

---

## I13. Empty selection hides the action bar

**Setup**
- No tasks selected.

**Steps**
1. Open any view with tasks.
2. Make sure no checkboxes are ticked.
3. Look for the bulk action bar.

---

## I14. Selected tasks are visually highlighted [All views]

**Setup**
- Any view, 2 tasks selected.

**Steps**
1. Click the checkbox on Task 1.
2. Click the checkbox on Task 2.
3. Compare selected vs unselected tasks visually.

---

## I15. Selection survives scrolling [List View and Table View]

**Setup**
- A project with 30+ tasks (more than fits on screen).

**Steps**
1. Scroll to the top of the list.
2. Select 2 tasks at the top.
3. Scroll down to the bottom of the list.
4. Select 2 more tasks at the bottom.
5. Scroll back up.

---

## I16. Bulk action bar shows the correct selection count

**Setup**
- Any view.

**Steps**
1. Select 1 task — note the count shown on the bulk action bar.
2. Select 2 more tasks — note the new count.
3. Deselect 1 task — note the new count.

---

## I17. Drag and drop still works in Kanban after selection

**Setup**
- Kanban view.

**Steps**
1. Select 1 task via its checkbox.
2. Try to drag that same task to a different column.
3. Try to drag an UNSELECTED task to a different column.

---

# Section J — "Created By" Field is Editable

The "Created By" field on the task detail sidebar should be editable
by users with the right permission, and read-only for everyone else.

## J1. Created By field is visible on the task sidebar

**Setup**
- Open any task.

**Steps**
1. Look at the right-side detail panel.
2. Find the "Created By" row.

---

## J2. Edit-permission user sees a clickable picker

**Setup**
- Log in as a user with EDIT permission on `task.task_assignee`.

**Steps**
1. Open a task.
2. Look at the "Created By" field.
3. Hover over the user avatar/name.

---

## J3. Clicking opens a user picker dropdown

**Setup**
- Edit permission user.

**Steps**
1. Open a task.
2. Click the Created By avatar.

---

## J4. Selecting a new user updates Created By

**Setup**
- A task currently shows "User A" as Created By.
- Edit permission user (User C).

**Steps**
1. Open the task.
2. Click the Created By avatar.
3. Choose User B from the dropdown.
4. Close and reopen the task (or refresh the page).

---

## J5. Updated Created By is reflected in the task list

**Setup**
- A project view where Created By is visible as a column (Table view
  or List view with the column enabled).

**Steps**
1. Note the current Created By for a task in the list.
2. Open the task and change Created By to a different user.
3. Close the task detail.
4. Look at the task in the list.

---

## J6. Updated Created By is reflected in the activity log / history

**Setup**
- Task with history/activity log enabled.

**Steps**
1. Open a task.
2. Change the Created By to a different user.
3. Open the task's Activity Log tab.

---

## J7. Read-only user sees a non-editable display

**Setup**
- Log in as a user WITHOUT edit permission on `task.task_assignee`.

**Steps**
1. Open a task.
2. Look at the Created By field.
3. Click on it.

---

## J8. Selection updates in real-time across browser windows

**Setup**
- Open the same task in two browser windows (User A and User B).
- User A has edit permission.

**Steps**
1. In Window A, click Created By and select a new user.
2. Watch Window B without touching it.

---

## J9. Picker only shows users who have access to the project

**Setup**
- A private project where only a few users have been added.

**Steps**
1. Open a task in that project.
2. Click the Created By avatar.
3. Look at the list of users in the dropdown.

---

## J10. Search inside the picker works

**Setup**
- A project with 10+ users available.

**Steps**
1. Open a task.
2. Click the Created By avatar.
3. Type part of a user's name in the search box.

---

## J11. Created By name appears correctly when long

**Setup**
- A user with a very long name (e.g. "Alexander Bartholomew Sinclair-Bennett").

**Steps**
1. Open a task assigned to that user as Created By.
2. Look at the right-side detail panel.

---

## J12. Picker can be closed without selecting

**Setup**
- Any task with edit permission.

**Steps**
1. Open a task.
2. Click the Created By avatar to open the picker.
3. Press Escape, or click outside the picker.

---

# Quick Reference — What's Where

| Feature | Where to Test |
|---|---|
| Auto AI estimate on task create | Create any task, wait, open it |
| Manual AI button | Task detail sidebar → "Estimated" row |
| AI Project Generator dual buttons | Click "Create with AI" → generate plan → click Back |
| Plan limit bypass | AI project flow with limit set to 0 |
| Permission gate on AI button | Switch to read-only user, open task |
| Real-time updates | Open same task in two browser windows |
| Multi-task selection | Project tasks → tick checkboxes in List / Kanban / Table view |
| Bulk action bar | Select 2+ tasks → bar appears at top/bottom |
| Created By editable | Task detail sidebar → "Created By" row |

---

# When Filing a Bug

Please include:
1. Which Section/Test ID (e.g. "B5 fails")
2. Steps to reproduce
3. What you saw (vs what was expected)
4. Screenshot or screen recording if possible
5. Browser + browser version
6. Whether AI keys are configured (ask dev if unsure)

---

**Document version:** 1.3
**Covers PRs:** #188, #189, #190 + multi-select + Created By editable + Employee Workload Report widget
**Last updated:** 2026-05-26

---

# 2026-05-26 — Employee Workload & Activity Report widget

New dashboard card under "Add Card" → Workload group. Pulls a
filter-driven report of who's doing what right now. Uses two AI
features: per-task Learning/Actual classification (cached on the
task) and a 2-4 sentence plain-English summary banner.

## Section K — Add and remove the card

### K1. Card appears in the "Add Card" picker

**Setup**
- Log in as an Admin user.
- Open the dashboard.

**Steps**
1. Click "Add Card" in the dashboard top-right.
2. Scroll the picker until you see the new card titled
   "Employee Workload & Activity Report".
3. Hover the card — confirm description text appears.
4. Click it.

### K2. Card mounts with default config (zero setup)

**Steps**
1. After K1, the card should appear on the dashboard.
2. Within ~5 seconds the table should populate with employees.
3. The AI summary banner should appear at the top (if an AI key is
   configured on the server).
4. The two charts at the bottom should render.

### K3. Remove the card

**Steps**
1. Click the X (close) icon in the top-right of the card.

---

## Section L — Filter and config (gear icon)

### L1. Open the edit panel

**Steps**
1. Click the gear (settings) icon in the card header.
2. The edit panel slides in from the right.

### L2. Change the date range

**Steps**
1. In the edit panel, set Date Range to "Last 7 Days".
2. Click Save.
3. Observe the card refreshing and showing the new range.

### L3. Filter to specific employees

**Steps**
1. Open the edit panel.
2. Pick 2 employees from the Employees dropdown.
3. Click Save.

### L4. Filter to specific projects

**Steps**
1. Open the edit panel.
2. Pick 1 project from the Projects dropdown.
3. Click Save.

### L5. Filter by task type

**Steps**
1. Open the edit panel.
2. Select task type "learning".
3. Click Save.

### L6. Change activity thresholds

**Steps**
1. Open the edit panel.
2. Set Active Within Minutes to 60 (1 hour).
3. Set Idle After Minutes to 240 (4 hours).
4. Set Overload Capacity Per Day to 300 (5 hours).
5. Click Save.

### L7. Hide the AI summary banner

**Steps**
1. Open the edit panel.
2. Toggle off "Show AI Summary".
3. Click Save.

### L8. Hide the workload chart

**Steps**
1. Open the edit panel.
2. Toggle off "Show Workload Chart".
3. Click Save.

### L9. Hide the task-type chart

**Steps**
1. Open the edit panel.
2. Toggle off "Show Task Type Chart".
3. Click Save.

### L10. Change refresh interval

**Steps**
1. Open the edit panel.
2. Set refresh interval to 30 seconds.
3. Click Save and wait 30 seconds.

### L11. Disable auto-refresh

**Steps**
1. Open the edit panel.
2. Set refresh interval to 0.
3. Click Save.

---

## Section M — Table interactions

### M1. Expand an employee row

**Steps**
1. Click the chevron (›) in the leftmost column of any employee row.
2. The row expands to show their tasks.
3. Click again to collapse.

### M2. Sort by tracked hours

**Steps**
1. Click the "Tracked" column header.
2. Click it again to reverse direction.

### M3. Sort by overdue count

**Steps**
1. Click the "Overdue" column header.
2. Employees with overdue tasks should rise to the top.

### M4. Sort by activity status

**Steps**
1. Click the "Activity" column header.
2. Confirm Active/Idle/Overloaded employees group together.

---

## Section N — Visual flags

### N1. Activity badges show correct colors

**Steps**
1. Look at the Activity column.
2. Confirm green badge = Active, gray badge = Idle, red badge = Overloaded.

### N2. Overdue tasks are visually flagged

**Steps**
1. Expand an employee with overdue tasks (N > 0 in Overdue column).
2. Inside, each overdue task has a red "Xd overdue" tag.

### N3. Missing estimates show as em-dash

**Steps**
1. Find an employee or task with no estimate set.
2. Confirm the Estimated column / task estimate shows "—" (italic gray).

### N4. Overload highlights estimated hours red

**Steps**
1. Find an employee marked "Overloaded".
2. Confirm their Estimated column value is shown in red.

### N5. Online indicator on avatar

**Steps**
1. Have a coworker log into the app.
2. Check that their avatar in the card shows a green dot.

---

## Section O — AI features

### O1. AI summary banner appears

**Setup**
- AI keys configured on the server (`ANTHROPIC_API_KEY +
  ANTHROPIC_MODEL` or `AI_API_KEY + AI_MODEL`).

**Steps**
1. Open the card.
2. Look at the top banner.

### O2. AI summary hidden when no AI key

**Setup**
- Server has no AI keys configured.

**Steps**
1. Open the card.
2. Look for the summary banner.

### O3. Learning / Actual pills on tasks

**Setup**
- AI keys configured.
- Some tasks have been created with descriptions distinct enough to
  be classified (one obviously a tutorial, one obviously a customer
  feature).

**Steps**
1. Expand any employee row in the card.
2. Look at the task pills on the right of each task.

### O4. Unknown pills when no AI key

**Setup**
- No AI keys configured. Tasks have no manual `aiTaskCategoryManual`.

**Steps**
1. Expand any employee row.
2. All task pills should show "Unknown".

### O5. AI summary cache works

**Setup**
- AI keys configured.

**Steps**
1. Open the card and wait for the summary.
2. Close the card and re-add it within 5 minutes.
3. The summary should appear instantly (cached).

---

## Section P — Role-based visibility

### P1. Admin sees all employees

**Setup**
- Log in as a Company Owner / Admin.

**Steps**
1. Open the card with no employee filter applied.

### P2. Manager sees their team only

**Setup**
- Log in as a user with `roleType: 2` (Manager / Project Lead).

**Steps**
1. Open the card with no employee filter applied.

### P3. Regular employee sees themselves only

**Setup**
- Log in as a user with `roleType: 3` or higher.

**Steps**
1. Open the card with no employee filter applied.

### P4. Cross-role API attempt blocked

**Setup**
- Get an auth token for a regular employee.

**Steps**
1. Manually `POST /api/v1/dashboard/employee-workload` with a body
   asking for a different employee's ID.
2. Observe the response.

---

## Section Q — Layout / interaction parity with other cards

### Q1. Drag the card to a different position

**Steps**
1. Click and hold the card header.
2. Drag it to a new position in the grid.
3. Release.

### Q2. Resize the card

**Steps**
1. Hover the bottom-right corner.
2. Drag to resize.

### Q3. Card persists across sessions

**Steps**
1. Add the card, configure it.
2. Log out and log back in.

### Q4. Auto-refresh pauses when tab is hidden

**Steps**
1. Set refresh interval to 10 seconds in the gear panel.
2. Switch to a different browser tab for 30+ seconds.
3. Switch back.

