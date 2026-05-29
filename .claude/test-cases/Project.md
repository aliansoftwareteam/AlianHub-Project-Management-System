# Project Module — Test Cases

**Module:** `Modules/Project` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Create Project

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_001 | Create project with valid name                | Logged in as Admin                       | 1. Click "+ New Project"  2. Enter project name  3. Click Create                                | Project appears in the sidebar and project list              |               | ⏳     |
| PROJ_002 | Create project from a global template         | At least one global template exists      | 1. Click "+ New Project"  2. Select "From Template"  3. Pick a template  4. Click Create        | Project created with template's default tasks and structure  |               | ⏳     |
| PROJ_003 | Create project using AI generator             | AI keys configured                       | 1. Click "Write with AI"  2. Describe the project  3. Generate plan  4. Click "Create everything" | Project and tasks created; appears in sidebar              |               | ⏳     |
| PROJ_004 | Cannot create project without a name          | Logged in as Admin                       | 1. Click "+ New Project"  2. Leave name empty  3. Click Create                                  | Error shown; project is not created                          |               | ⏳     |
| PROJ_005 | Project creation is real-time across sessions | Two browser windows open                 | 1. In Window A create a new project                                                             | Project appears in Window B sidebar without a page refresh   |               | ⏳     |

---

## View & Search Projects

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_006 | Project list loads in sidebar                 | At least one project exists              | 1. Log in  2. Look at the left sidebar                                                          | All projects the user has access to are listed               |               | ⏳     |
| PROJ_007 | Search project by name                        | 3+ projects exist                        | 1. Click the search bar  2. Type a partial project name                                         | Matching projects appear; non-matching are hidden            |               | ⏳     |
| PROJ_008 | Filter shows archived projects only           | At least one archived project exists     | 1. Open project list  2. Click "Show Archive"                                                   | Only archived projects are displayed                         |               | ⏳     |
| PROJ_009 | Project detail page loads correctly           | A project with tasks exists              | 1. Click a project in the sidebar                                                               | Project opens on the default view (List/Board) with tasks    |               | ⏳     |
| PROJ_010 | Filter projects by sprint                     | Project has multiple sprints             | 1. Open project  2. Use sprint filter dropdown  3. Select a sprint                              | Only tasks in the selected sprint are shown                  |               | ⏳     |
| PROJ_011 | Filter projects by folder                     | Project has folders                      | 1. Open project  2. Use folder filter  3. Select a folder                                       | Only tasks in the selected folder are shown                  |               | ⏳     |

---

## Update Project Details

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_012 | Update project name                           | Logged in as Admin or Lead               | 1. Open project  2. Click project name  3. Edit name  4. Save                                  | New name appears in sidebar and header                       |               | ⏳     |
| PROJ_013 | Update project icon / color                   | Logged in as Admin or Lead               | 1. Open project settings  2. Change icon or color  3. Save                                     | New icon/color reflects in sidebar and header                |               | ⏳     |
| PROJ_014 | Change project status                         | Logged in as Admin or Lead               | 1. Open project  2. Click status chip (e.g. "Open")  3. Select "In Development"                | Status updates and is visible on the project list            |               | ⏳     |
| PROJ_015 | Add a Project Lead                            | Logged in as Admin                       | 1. Open project settings  2. Add a user as Lead                                                 | User appears as Lead; gains project-lead permissions         |               | ⏳     |
| PROJ_016 | Remove a Project Lead                         | Project has at least one Lead            | 1. Open project settings  2. Remove the lead  3. Save                                           | User removed from lead; project settings reflect change      |               | ⏳     |
| PROJ_017 | Add a member (Assignee) to project            | Logged in as Admin or Lead               | 1. Open project settings → Members  2. Add a user  3. Save                                     | User added; can access the project                           |               | ⏳     |
| PROJ_018 | Remove a member from project                  | Project has at least 2 members           | 1. Open project settings → Members  2. Remove a member  3. Save                                | Removed member loses project access                          |               | ⏳     |
| PROJ_019 | Set project due date                          | Logged in as Admin or Lead               | 1. Open project settings  2. Set a due date  3. Save                                            | Due date appears on project list and detail view             |               | ⏳     |

---

## Archive & Delete

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_020 | Archive a project                             | Logged in as Admin                       | 1. Open project  2. Click ··· menu  3. Click "Archive"  4. Confirm                             | Project moves out of active list; appears under Archive      |               | ⏳     |
| PROJ_021 | Archived project visible under Show Archive   | At least one archived project exists     | 1. On project list click "Show Archive"                                                         | Archived project is visible; active projects are not shown   |               | ⏳     |
| PROJ_022 | Restore an archived project                   | At least one archived project exists     | 1. Open Archive list  2. Click Restore on a project                                             | Project returns to active project list                       |               | ⏳     |
| PROJ_023 | Delete a project (permanent)                  | Logged in as Admin                       | 1. Open project  2. Click ··· → Delete  3. Confirm deletion                                    | Project and all its tasks are permanently removed            |               | ⏳     |

---

## Project Tags

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_036 | Add a tag to the project                      | Logged in as Admin or Lead               | 1. Project settings → Tags  2. Click "+ Add Tag"  3. Enter name  4. Save                       | Tag appears in the tag list and is available on tasks        |               | ⏳     |
| PROJ_037 | Rename a tag                                  | At least one tag exists                  | 1. Project settings → Tags  2. Click edit on a tag  3. Rename  4. Save                         | Updated name reflects everywhere the tag is used             |               | ⏳     |
| PROJ_038 | Change tag color                              | At least one tag exists                  | 1. Project settings → Tags  2. Click color picker  3. Choose a color  4. Save                  | Tag displays the new color on tasks and tag list             |               | ⏳     |
| PROJ_039 | Delete a tag                                  | At least one tag exists                  | 1. Project settings → Tags  2. Click Delete  3. Confirm                                        | Tag removed from list and detached from all tasks            |               | ⏳     |

---

## Project Checklists

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_040 | Add a checklist to the project                | Logged in as Admin or Lead               | 1. Open project  2. Checklist section → "+ Add Checklist"  3. Enter name  4. Save              | Checklist item appears in the project checklist              |               | ⏳     |
| PROJ_041 | Check a checklist item                        | At least one checklist item exists       | 1. Open project checklist  2. Tick a checkbox                                                   | Item is marked done; progress indicator updates              |               | ⏳     |
| PROJ_042 | Assign a member to a checklist item           | At least one checklist item exists       | 1. Click the assignee icon on a checklist item  2. Select a user                               | User assigned; avatar shown on the checklist item            |               | ⏳     |
| PROJ_043 | Remove assignee from checklist item           | Checklist item has an assignee           | 1. Click the assigned avatar  2. Remove the user                                                | Assignee removed from checklist item                         |               | ⏳     |
| PROJ_044 | Delete a checklist item                       | At least one checklist item exists       | 1. Hover checklist item  2. Click Delete  3. Confirm                                            | Item removed from checklist                                  |               | ⏳     |

---

## Project Views

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_045 | Switch to Board view                          | Project has tasks in multiple statuses   | 1. Open project  2. Click "Board" tab                                                           | Tasks shown as Kanban cards grouped by status                |               | ⏳     |
| PROJ_046 | Switch to List view                           | Project has tasks                        | 1. Open project  2. Click "List" tab                                                            | Tasks shown as a flat list grouped by status                 |               | ⏳     |
| PROJ_047 | Switch to Table view                          | Project has tasks                        | 1. Open project  2. Click "Table" tab                                                           | Tasks shown in a spreadsheet-style table                     |               | ⏳     |
| PROJ_048 | Switch to Calendar view                       | Project has tasks with due dates         | 1. Open project  2. Click "Calendar" tab                                                        | Tasks appear on the calendar on their due dates              |               | ⏳     |
| PROJ_049 | Switch to Workload view                       | Project has tasks with assignees         | 1. Open project  2. Click "Workload" tab                                                        | Workload view renders per-employee assignments               |               | ⏳     |
| PROJ_050 | Switch to Activity view                       | Project has recent activity              | 1. Open project  2. Click "Activity" tab                                                        | Recent project activity log entries shown                    |               | ⏳     |

---

## Saved Filters

| ID       | Title                                         | Precondition                             | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_051 | Create a saved filter for a project           | Logged in, project open                  | 1. Apply filters (assignee, status, priority)  2. Click "Save Filter"  3. Name it  4. Save     | Filter saved; appears in saved filters list                  |               | ⏳     |
| PROJ_052 | Apply a saved filter                          | At least one saved filter exists         | 1. Open saved filters dropdown  2. Click a saved filter                                         | Tasks filtered to match the saved criteria                   |               | ⏳     |
| PROJ_053 | Update a saved filter                         | At least one saved filter exists         | 1. Open saved filter  2. Modify filter criteria  3. Save changes                               | Updated filter applied; new criteria persist                 |               | ⏳     |
| PROJ_054 | Delete a saved filter                         | At least one saved filter exists         | 1. Open saved filters dropdown  2. Delete a filter  3. Confirm                                 | Filter removed from the list                                 |               | ⏳     |

---

## Milestones

> Milestones live in the **Project Details** tab of each project.

| ID       | Title                                         | Precondition                               | Steps                                                                                           | Expected Result                                              | Actual Result | Status |
|----------|-----------------------------------------------|--------------------------------------------|-------------------------------------------------------------------------------------------------|--------------------------------------------------------------|---------------|--------|
| PROJ_055 | Create a milestone                            | Project open, Project Details tab visible  | 1. Open project  2. Click "Project Details" tab  3. Click "+ Add Milestone"  4. Enter name and target date  5. Save | Milestone appears in the milestone list                      |               | ⏳     |
| PROJ_056 | Link a task to a milestone                    | Task and milestone both exist              | 1. Open task detail  2. Click Milestone field  3. Select a milestone                            | Task linked; appears under that milestone in Project Details  |               | ⏳     |
| PROJ_057 | Update milestone status                       | At least one milestone exists              | 1. Open Project Details → Milestones  2. Click status on a milestone  3. Select "Completed"    | Status updated on milestone list                             |               | ⏳     |
| PROJ_058 | Cancel a milestone                            | At least one milestone exists              | 1. Open Project Details → Milestones  2. Click ··· → Cancel  3. Confirm                        | Milestone marked as cancelled                                |               | ⏳     |
| PROJ_059 | Delete a milestone                            | Milestone exists with no linked tasks      | 1. Open Project Details → Milestones  2. Click ··· → Delete  3. Confirm                        | Milestone permanently removed from the list                  |               | ⏳     |

---

**Total:** 47 test cases · **All status:** ⏳ Pending

> ℹ️ Project Templates, Project Settings, and Project Rules are covered in their own dedicated test files.
