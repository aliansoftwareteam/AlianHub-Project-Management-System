# Teams — Test Cases

**Location:** Settings → Teams · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Team Listing

| ID     | Title                                                   | Precondition                                    | Steps                                                             | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------|-------------------------------------------------|-------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_001 | All teams displayed in the list                         | Logged in as Admin, company has teams           | 1. Open Settings → Teams                                          | All teams listed with name, icon (first letter), color, and member avatars |             | ⏳     |
| TM_002 | Empty state shown when no teams exist                   | Company has no teams created                    | 1. Open Settings → Teams                                          | "No data found" image and message displayed                              |               | ⏳     |
| TM_003 | Team icon shows first letter of team name               | At least one team exists                        | 1. Open Settings → Teams  2. Look at team icon                    | Icon displays the first character of the team name with its background color |            | ⏳     |
| TM_004 | Team members shown as avatars on the right              | A team has at least one member assigned         | 1. Open Settings → Teams  2. Look at the right side of a team row | Member profile pictures / initials shown as an avatar stack              |               | ⏳     |

---

## Create Team

| ID     | Title                                                   | Precondition                                    | Steps                                                                                                  | Expected Result                                                          | Actual Result | Status |
|--------|---------------------------------------------------------|-------------------------------------------------|--------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_005 | Create a team with name only                            | Logged in as Admin, team feature in plan        | 1. Click "Create Team"  2. Enter a team name  3. Click "Save"                                         | Team created with default color; appears in the list                     |               | ⏳     |
| TM_006 | Create a team with name and custom color                | Logged in as Admin                              | 1. Click "Create Team"  2. Enter name  3. Select a color from palette  4. Click "Save"                | Team created with the selected background color on the icon              |               | ⏳     |
| TM_007 | Create a team with name, color, and members             | Logged in as Admin, company has members         | 1. Click "Create Team"  2. Enter name  3. Select color  4. Add members  5. Click "Save"               | Team created; assigned members shown as avatars in the team row          |               | ⏳     |
| TM_008 | Cannot create a team without a name                     | Logged in as Admin                              | 1. Click "Create Team"  2. Leave name empty  3. Click "Save"                                          | Validation error shown; team not created                                 |               | ⏳     |
| TM_009 | Cannot create a team with name shorter than 3 characters | Logged in as Admin                             | 1. Click "Create Team"  2. Enter "AB"  3. Click "Save"                                                | Validation error shown; team not created                                 |               | ⏳     |
| TM_010 | Cannot create a team with a duplicate name              | A team named "Marketing" already exists         | 1. Click "Create Team"  2. Enter "Marketing"  3. Click "Save"                                         | Error shown: "Team name already exists"; team not created                |               | ⏳     |
| TM_011 | Team name is capped at 30 characters                    | Logged in as Admin                              | 1. Click "Create Team"  2. Try to type more than 30 characters in the name field                      | Input stops accepting characters after the 30-character limit            |               | ⏳     |
| TM_012 | Newly created team appears in the list immediately      | Logged in as Admin                              | 1. Create a new team  2. Observe the teams list                                                        | New team row appears at the bottom of the list without a page refresh    |               | ⏳     |
| TM_013 | Cancel button closes sidebar without creating a team    | Create Team sidebar is open                     | 1. Enter a team name  2. Click "Cancel"                                                                | Sidebar closes; team is not saved; no new row in the list                |               | ⏳     |

---

## Edit Team Name

| ID     | Title                                                     | Precondition                                  | Steps                                                                              | Expected Result                                                          | Actual Result | Status |
|--------|-----------------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_014 | Click team name to enter inline edit mode                 | At least one team exists, user has edit perm  | 1. Click on a team's name text                                                     | Inline text input appears pre-filled with the current name               |               | ⏳     |
| TM_015 | Save updated name with Enter key                          | A team name input is active                   | 1. Change the team name  2. Press Enter                                            | New name saved; "Updated successfully" toast shown; input closes         |               | ⏳     |
| TM_016 | Blur/focus-out cancels the inline edit                    | A team name input is active                   | 1. Click on team name to open input  2. Click somewhere else (blur)               | Input closes; original name remains unchanged                            |               | ⏳     |
| TM_017 | Cannot save an empty team name                            | A team name input is active                   | 1. Clear the name field  2. Press Enter                                            | Error toast: "Team name is required"; name not updated                   |               | ⏳     |
| TM_018 | Cannot save team name shorter than 3 characters           | A team name input is active                   | 1. Enter "AB"  2. Press Enter                                                      | Error toast: "Minimum 3 character required"; name not updated            |               | ⏳     |
| TM_019 | Cannot save a name already used by another team           | Another team with the target name exists      | 1. Rename a team to match an existing team name  2. Press Enter                    | Error toast: "Team name already exist"; name not updated                 |               | ⏳     |
| TM_020 | Saving unchanged name is a no-op                          | A team name input is active                   | 1. Click a team name  2. Press Enter without changing anything                     | Input closes; no API call made; no change in the list                    |               | ⏳     |

---

## Edit Team Color

| ID     | Title                                                     | Precondition                                  | Steps                                                                              | Expected Result                                                          | Actual Result | Status |
|--------|-----------------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_021 | Click team icon opens color picker popup                  | At least one team exists, user has edit perm  | 1. Click on the colored icon/letter on a team row                                  | Color palette popup appears showing all available color options          |               | ⏳     |
| TM_022 | Selecting a color updates the team icon immediately       | Color picker popup is open                    | 1. Click a color in the popup                                                      | Team icon background changes to the selected color; "Updated successfully" toast shown; popup closes |  | ⏳     |

---

## Manage Team Members

| ID     | Title                                                     | Precondition                                  | Steps                                                                              | Expected Result                                                          | Actual Result | Status |
|--------|-----------------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_023 | Add a member to an existing team                          | Team exists, user has edit perm               | 1. Click the "+" in the Assignee area of a team row  2. Select a member            | Member avatar added to the team row; "Updated successfully" toast shown  |               | ⏳     |
| TM_024 | Remove a member from a team                               | Team has at least one member assigned         | 1. Click the remove icon on a member avatar in the team row                        | Member avatar removed from the team row; "Updated successfully" toast shown |            | ⏳     |
| TM_025 | Member list updates instantly after add/remove            | Team exists with members                      | 1. Add or remove a member  2. Observe the team row immediately                     | Avatar stack reflects the change without a page reload                   |               | ⏳     |

---

## Permission-based Access

| ID     | Title                                                           | Precondition                                               | Steps                                                                | Expected Result                                                          | Actual Result | Status |
|--------|-----------------------------------------------------------------|------------------------------------------------------------|----------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| TM_027 | User without settings_team_list permission sees Access Denied   | Logged in as user without settings.settings_team_list perm | 1. Open Settings → Teams                                             | Access Denied image shown; team list not visible                         |               | ⏳     |
| TM_028 | Read-only user cannot enter inline edit mode for team name      | Logged in as user with read-only (false) team perm         | 1. Open Settings → Teams  2. Click on a team name                    | No inline input appears; team name is not editable                       |               | ⏳     |
| TM_029 | Read-only user cannot open the team color picker                | Logged in as user with read-only (false) team perm         | 1. Open Settings → Teams  2. Click on a team icon                    | Color picker popup does not open                                         |               | ⏳     |
| TM_030 | Read-only user cannot add or remove team members                | Logged in as user with read-only (false) team perm         | 1. Open Settings → Teams  2. Attempt to add or remove a member       | Add member "+" button not shown; remove icon not available on avatars    |               | ⏳     |

---

**Total:** 29 test cases · **All status:** ⏳ Pending
