# Tasks Module — Test Cases

**Module:** `Modules/Tasks` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Create Task

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_001 | Create task from sprint with title only        | Project open, sprint visible               | 1. Click "+ Add Task" in a sprint  2. Enter task name  3. Press Enter                             | Task appears in sprint list with auto-generated key (e.g. AHE-100) |               | ⏳     |
| TASK_002 | Create task with title and description         | Project open                               | 1. Click "+ Add Task"  2. Enter title  3. Add description  4. Save                                | Task saved with title and description visible in detail view       |               | ⏳     |
| TASK_003 | Cannot create task without a title             | Project open                               | 1. Click "+ Add Task"  2. Leave title empty  3. Try to save                                       | Error shown; task is not created                                   |               | ⏳     |
| TASK_004 | Task key is auto-generated and unique          | Project has existing tasks                 | 1. Create two tasks in the same project                                                            | Each task gets a unique sequential key (PROJECT_CODE-N)            |               | ⏳     |
| TASK_005 | Task creation triggers real-time update        | Two browser windows open on same project   | 1. Create a task in Window A                                                                       | Task appears in Window B without a page refresh                    |               | ⏳     |
| TASK_006 | AI auto-estimate fires on task create          | AI keys configured                         | 1. Create a task with a clear title and description  2. Wait 5–15 seconds  3. Open the task       | Estimated time field is auto-filled by AI                          |               | ⏳     |

---

## Update Task

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_007 | Update task title                              | Task exists                                | 1. Open task  2. Click title  3. Edit  4. Save                                                    | New title shown in task list and detail header                     |               | ⏳     |
| TASK_008 | Update task description                        | Task exists                                | 1. Open task  2. Click description area  3. Edit  4. Save                                         | Updated description saved and visible                              |               | ⏳     |
| TASK_009 | Change task status                             | Task exists, multiple statuses configured  | 1. Open task  2. Click status chip  3. Select a new status                                        | Status updated; task moves to correct status group in list view    |               | ⏳     |
| TASK_010 | Change task priority                           | Task exists                                | 1. Open task  2. Click priority  3. Select a new priority                                         | Priority icon updated on task row and detail panel                 |               | ⏳     |
| TASK_011 | Set task due date                              | Task exists                                | 1. Open task  2. Click "Due Date"  3. Pick a date                                                 | Due date shown on task row; turns red if past due                  |               | ⏳     |
| TASK_012 | Clear task due date                            | Task has a due date set                    | 1. Open task  2. Click due date  3. Clear / remove it                                             | Due date field shows empty; no red highlight                       |               | ⏳     |
| TASK_013 | Set task start date                            | Task exists                                | 1. Open task  2. Click "Start Date"  3. Pick a date                                               | Start date saved and visible in task detail                        |               | ⏳     |
| TASK_014 | Change task type                               | Task exists, multiple types configured     | 1. Open task  2. Click task type  3. Select a different type                                      | Task type updated; reflected in task list                          |               | ⏳     |

---

## Assign & People

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_015 | Assign a member to a task                      | Task exists, project has multiple members  | 1. Open task  2. Click Assignee  3. Select a user                                                 | User avatar appears on task row and detail panel                   |               | ⏳     |
| TASK_016 | Remove an assignee from a task                 | Task has at least one assignee             | 1. Open task  2. Click Assignee  3. Deselect the user                                             | User removed; task shows unassigned                                |               | ⏳     |
| TASK_017 | Assign multiple members to a task              | Task exists, project has 3+ members        | 1. Open task  2. Click Assignee  3. Select 3 users                                                | All 3 avatars shown on task row                                    |               | ⏳     |
| TASK_018 | Add a watcher / follower to a task             | Task exists                                | 1. Open task  2. Click Watchers  3. Add a user                                                    | User added as watcher; receives notifications for task changes     |               | ⏳     |
| TASK_019 | Remove a watcher from a task                   | Task has a watcher                         | 1. Open task  2. Click Watchers  3. Remove the user                                               | User removed from watcher list                                     |               | ⏳     |
| TASK_020 | Assignee receives notification on assignment   | Task exists, assignee has notifications on | 1. Assign a user to a task                                                                         | Assigned user gets a notification                                  |               | ⏳     |

---

## Task Hierarchy & Structure

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_021 | Create a subtask under a task                  | Parent task exists                         | 1. Open task  2. Click "+ Add Subtask"  3. Enter title  4. Save                                   | Subtask appears nested under the parent task                       |               | ⏳     |
| TASK_022 | Subtask count updates on parent row            | Parent task has subtasks                   | 1. Add a subtask to a task  2. Look at the parent task in list view                               | Subtask counter increments on the parent task row                  |               | ⏳     |
| TASK_023 | Convert task to subtask                        | Two tasks exist in same sprint             | 1. Open a task  2. Click ··· → "Convert to Subtask"  3. Select a parent task                     | Task becomes a subtask; parent task shows it as a child            |               | ⏳     |
| TASK_024 | Convert subtask to parent task                 | Subtask exists                             | 1. Open the subtask  2. Click ··· → "Convert to Task"                                            | Subtask promoted to a standalone task in the sprint                |               | ⏳     |
| TASK_025 | Move task to a different sprint                | Project has 2+ sprints                     | 1. Open task  2. Click ··· → "Move"  3. Select another sprint  4. Confirm                        | Task removed from original sprint; appears in the selected sprint  |               | ⏳     |
| TASK_026 | Move task to a different project               | 2+ projects exist, user has access to both | 1. Open task  2. Click ··· → "Move"  3. Select another project  4. Confirm                       | Task appears in destination project with a new task key            |               | ⏳     |

---

## Estimated Time & AI Estimation

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_027 | Set estimated time manually                    | Task exists, TimeEstimates app ON          | 1. Open task  2. Click Estimated field  3. Enter time (e.g. 2h 30m)  4. Save                     | Estimated time saved and visible in task detail                    |               | ⏳     |
| TASK_028 | Update estimated time                          | Task has an existing estimate              | 1. Open task  2. Click Estimated field  3. Change value  4. Save                                  | New estimate replaces old one                                      |               | ⏳     |
| TASK_029 | Manually trigger AI estimate                   | AI keys configured, task has description   | 1. Open task  2. Click the AI icon next to Estimated field                                        | Spinner appears then estimated time is filled by AI                |               | ⏳     |
| TASK_030 | AI estimate does not overwrite an existing one | Task already has estimated time set        | 1. Create a task with `totalEstimatedTime` already set  2. Wait 15 sec                            | Estimate field unchanged; AI did not overwrite                     |               | ⏳     |
| TASK_031 | AI estimate button hidden for read-only user   | User has read-only permission on task      | 1. Log in as read-only user  2. Open a task                                                       | AI estimate button not visible next to Estimated field             |               | ⏳     |
| TASK_032 | Spinner disabled during AI estimate in-flight  | AI keys configured                         | 1. Click AI estimate button  2. Immediately click again                                           | Second click is ignored; only one request fires                    |               | ⏳     |

---

## Time Logging

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_033 | Log time manually on a task                    | Task exists                                | 1. Open task  2. Click "Time Log" tab  3. Click "+ Log Time"  4. Enter duration and date  5. Save | Time log entry appears; total logged time updates                  |               | ⏳     |
| TASK_034 | Edit a time log entry                          | Task has at least one time log entry       | 1. Open "Time Log" tab  2. Click edit on an entry  3. Change duration  4. Save                   | Updated duration shown; total recalculated                         |               | ⏳     |
| TASK_035 | Delete a time log entry                        | Task has at least one time log entry       | 1. Open "Time Log" tab  2. Click delete on an entry  3. Confirm                                   | Entry removed; total logged time decreases accordingly             |               | ⏳     |
| TASK_036 | Start the time tracker on a task               | Task exists                                | 1. Open task  2. Click the tracker "Play" button                                                  | Timer starts; elapsed time ticking in task header                  |               | ⏳     |
| TASK_037 | Stop the time tracker and save the log         | Tracker is running on a task               | 1. Click the tracker "Stop" button  2. Confirm save                                               | Time log entry created with elapsed duration                       |               | ⏳     |
| TASK_038 | Logged time shown on the Workload Report card  | Workload Report card on dashboard          | 1. Log 1h on a task  2. Open the Workload Report card  3. Find the logged user                   | Logged hours column reflects the new entry                         |               | ⏳     |

---

## Checklists

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_039 | Add a checklist to a task                      | Task exists                                | 1. Open task  2. Scroll to Checklist  3. Click "+ Add Checklist"  4. Enter item name  5. Save     | Checklist item appears under the task                              |               | ⏳     |
| TASK_040 | Check a checklist item                         | Task has at least one checklist item       | 1. Open task → Checklist  2. Tick the checkbox of an item                                        | Item marked done; progress bar / count updates                     |               | ⏳     |
| TASK_041 | Uncheck a checklist item                       | Task has a checked checklist item          | 1. Open task → Checklist  2. Untick the checkbox                                                  | Item reverts to unchecked; progress bar decreases                  |               | ⏳     |
| TASK_042 | Rename a checklist item                        | Task has at least one checklist item       | 1. Click the item name  2. Edit  3. Save                                                          | Updated name saved and visible                                     |               | ⏳     |
| TASK_043 | Delete a checklist item                        | Task has at least one checklist item       | 1. Hover item  2. Click delete icon  3. Confirm                                                   | Item removed from checklist                                        |               | ⏳     |
| TASK_044 | AI-generate checklists from task description   | AI keys configured, task has description   | 1. Open task  2. Click "Suggest Checklists"                                                       | AI returns relevant checklist items based on description           |               | ⏳     |
| TASK_045 | Assign a member to a checklist item            | Task has a checklist item                  | 1. Click the assignee icon on checklist item  2. Select a user                                    | User avatar shown on checklist item                                |               | ⏳     |

---

## Attachments

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_046 | Attach a file to a task                        | Task exists                                | 1. Open task  2. Click "+ Attachment"  3. Select a file  4. Upload                                | File appears in attachments section; attachment count updates      |               | ⏳     |
| TASK_047 | Remove an attachment from a task               | Task has at least one attachment           | 1. Open task → Attachments  2. Click delete on a file  3. Confirm                                 | File removed; attachment count decreases                           |               | ⏳     |
| TASK_048 | Attachments are copied when duplicating task   | Task has attachments, duplicate option on  | 1. Open task  2. Click ··· → Duplicate  3. Enable "Copy Attachments"  4. Duplicate               | Duplicate task contains the same attachments                       |               | ⏳     |

---

## Comments

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_049 | Add a comment to a task                        | Task exists                                | 1. Open task  2. Click "Comments" tab  3. Type a comment  4. Submit                               | Comment appears in the thread with author name and timestamp       |               | ⏳     |
| TASK_050 | Edit a comment                                 | Task has at least one comment (own)        | 1. Hover the comment  2. Click Edit  3. Change text  4. Save                                      | Updated comment text saved; "(edited)" indicator shown             |               | ⏳     |
| TASK_051 | Delete a comment                               | Task has at least one comment (own)        | 1. Hover the comment  2. Click Delete  3. Confirm                                                  | Comment removed from thread                                        |               | ⏳     |
| TASK_052 | Unread comment count shown on task row         | Task has an unread comment for current user | 1. Another user adds a comment  2. Open the task list                                             | Comment bubble icon shows an unread count badge on the task row    |               | ⏳     |
| TASK_053 | Commenter receives real-time message           | Two users have the task open               | 1. User A adds a comment  2. Watch User B's screen                                                | User B sees the comment appear without a page refresh              |               | ⏳     |

---

## Tags & Labels

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_054 | Add a tag to a task                            | Project has tags configured                | 1. Open task  2. Click "+ Tag"  3. Select a tag                                                   | Tag chip appears on task row and detail panel                      |               | ⏳     |
| TASK_055 | Remove a tag from a task                       | Task has at least one tag                  | 1. Open task  2. Click the tag chip  3. Remove it                                                 | Tag removed from task; no longer shown on task row                 |               | ⏳     |

---

## Custom Fields

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_056 | Fill a custom field value on task              | Project has at least one custom field      | 1. Open task  2. Scroll to Custom Fields  3. Click "+ Custom Field"  4. Enter value  5. Save      | Custom field value saved and visible in task detail                |               | ⏳     |
| TASK_057 | Update custom field value                      | Task has a custom field value set          | 1. Open task  2. Click the custom field  3. Change value  4. Save                                 | Updated value persists after page refresh                          |               | ⏳     |

---

## Duplicate, Archive & Delete

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_058 | Duplicate a task with all options enabled      | Task has assignees, checklist, attachments | 1. Open task  2. Click ··· → Duplicate  3. Enable all copy options  4. Confirm                   | New task created with same title + all data; unique key assigned   |               | ⏳     |
| TASK_059 | Duplicate task — exclude comments              | Task has comments                          | 1. Duplicate task with "Copy Comments" disabled                                                    | New task has no comments copied                                    |               | ⏳     |
| TASK_060 | Archive a task                                 | Task exists                                | 1. Open task  2. Click ··· → Archive  3. Confirm                                                  | Task removed from active list; visible under Archive filter        |               | ⏳     |
| TASK_061 | Restore an archived task                       | At least one archived task exists          | 1. Show archived tasks  2. Click Restore on a task                                                 | Task returns to the active sprint list                             |               | ⏳     |
| TASK_062 | Delete a task (soft delete)                    | Task exists                                | 1. Open task  2. Click ··· → Delete  3. Confirm                                                   | Task removed from list; can be restored if needed                  |               | ⏳     |
| TASK_063 | Mark task as favourite                         | Task exists                                | 1. Hover task  2. Click star / favourite icon                                                      | Task added to Favourites; star icon highlighted                    |               | ⏳     |
| TASK_064 | Unmark task as favourite                       | Task is marked as favourite                | 1. Click the highlighted star icon on the task                                                     | Task removed from Favourites; star icon deactivated                |               | ⏳     |

---

## Bulk Operations

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_065 | Select multiple tasks via checkboxes           | Project has 3+ tasks in list view          | 1. Hover a task  2. Tick the checkbox  3. Tick 2 more tasks                                       | Bulk action bar appears at the bottom showing selection count      |               | ⏳     |
| TASK_066 | Bulk change status                             | 3+ tasks selected                          | 1. Select tasks  2. Click "Status" in bulk bar  3. Choose a status                                | All selected tasks updated to the new status                       |               | ⏳     |
| TASK_067 | Bulk change priority                           | 3+ tasks selected                          | 1. Select tasks  2. Click "Priority" in bulk bar  3. Choose a priority                            | All selected tasks updated to the new priority                     |               | ⏳     |
| TASK_068 | Bulk add assignee                              | 3+ tasks selected                          | 1. Select tasks  2. Click "Assignee" in bulk bar  3. Add a user                                   | User added as assignee to all selected tasks                       |               | ⏳     |
| TASK_069 | Bulk set due date                              | 3+ tasks selected                          | 1. Select tasks  2. Click "Due Date" in bulk bar  3. Pick a date                                  | Due date applied to all selected tasks                             |               | ⏳     |
| TASK_070 | Bulk delete tasks                              | 3+ tasks selected                          | 1. Select tasks  2. Click "Delete" in bulk bar  3. Confirm                                        | All selected tasks removed from list                               |               | ⏳     |
| TASK_071 | Bulk archive tasks                             | 3+ tasks selected                          | 1. Select tasks  2. Click "Archive" in bulk bar  3. Confirm                                       | All selected tasks moved to archive                                |               | ⏳     |
| TASK_072 | Bulk move tasks to another sprint              | 3+ tasks selected, project has 2+ sprints  | 1. Select tasks  2. Click "Move" in bulk bar  3. Select target sprint  4. Confirm                 | All selected tasks moved to the target sprint                      |               | ⏳     |
| TASK_073 | Bulk action bar hides when selection cleared   | 3+ tasks selected                          | 1. Deselect all tasks (click checkboxes or press Escape)                                           | Bulk action bar disappears                                         |               | ⏳     |

---

## Activity & History

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_074 | Activity log records a status change           | Task exists                                | 1. Change task status  2. Open task → "Activity Log" tab                                          | Log entry shows who changed the status, from what to what          |               | ⏳     |
| TASK_075 | Activity log records an assignee change        | Task exists                                | 1. Change task assignee  2. Open task → "Activity Log" tab                                        | Log entry shows who added/removed the assignee                     |               | ⏳     |
| TASK_076 | Activity log records a due date change         | Task exists                                | 1. Set / change due date  2. Open task → "Activity Log" tab                                       | Log entry shows old and new due date                               |               | ⏳     |

---

## Real-time Updates

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_077 | Status change reflects in other browser window | Two browser windows open on same project   | 1. In Window A change a task's status                                                              | Window B shows the new status without a page refresh               |               | ⏳     |
| TASK_078 | Bulk update completion emits socket event      | Two browser windows open on same project   | 1. In Window A bulk-update 5 tasks' priority                                                       | Window B shows updated priorities without a page refresh           |               | ⏳     |

---

## Filtering, Grouping & Sorting

| ID       | Title                                          | Precondition                               | Steps                                                                                              | Expected Result                                                    | Actual Result | Status |
|----------|------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|--------|
| TASK_079 | Filter tasks by assignee                       | Project has tasks with different assignees | 1. Open filter panel  2. Select "Assignee"  3. Pick a user                                        | Only tasks assigned to that user are shown                         |               | ⏳     |
| TASK_080 | Filter tasks by priority                       | Project has tasks with different priorities | 1. Open filter panel  2. Select "Priority"  3. Pick "High"                                       | Only high-priority tasks shown                                     |               | ⏳     |
| TASK_081 | Filter tasks by status                         | Project has tasks with different statuses  | 1. Open filter panel  2. Select "Status"  3. Pick "In Progress"                                   | Only "In Progress" tasks shown                                     |               | ⏳     |
| TASK_082 | Filter tasks by due date range                 | Project has tasks with due dates           | 1. Open filter  2. Set "Due Date" range (e.g. this week)                                          | Only tasks due in the selected range shown                         |               | ⏳     |
| TASK_083 | Group tasks by priority                        | Project has tasks with different priorities | 1. Open Group By  2. Select "Priority"                                                            | Tasks reorganised into Priority groups (High, Medium, Low)         |               | ⏳     |
| TASK_084 | Sort tasks by due date                         | Project has tasks with different due dates | 1. Open Sort  2. Select "Due Date" ascending                                                       | Tasks ordered nearest due date first                               |               | ⏳     |
| TASK_085 | Sort tasks by created date                     | Project has multiple tasks                 | 1. Open Sort  2. Select "Created Date" descending                                                  | Newest tasks appear at the top                                     |               | ⏳     |

---

**Total:** 85 test cases · **All status:** ⏳ Pending
