# Project Timesheet — Test Cases

**Module:** `Modules/TimeSheet/controller/projectTimeSheet.js` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Project Timesheet

| ID      | Title                                                   | Precondition                                           | Steps                                                                              | Expected Result                                                             | Actual Result | Status |
|---------|---------------------------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| PTS_001 | Project Timesheet loads for the current date range      | Logged in, time logs exist for current period          | 1. Click "Time Sheet" in top nav  2. Select "Project" view                         | Time logs for the current date range are displayed                          |               | ⏳     |
| PTS_002 | Logs are grouped by project                             | Time logs exist across multiple projects               | 1. Open Project Timesheet with no project filter                                   | Each project appears as a separate group                                    |               | ⏳     |
| PTS_003 | Logs are grouped by date within each project            | A project has logs on multiple dates                   | 1. Open Project Timesheet  2. Expand a project group                               | Entries are arranged under their respective dates within the project group  |               | ⏳     |
| PTS_004 | Manual and tracker logs are visually differentiated     | A project has both manual and tracker logs             | 1. Open Project Timesheet  2. Look at log entries for a project                    | Manual logs and tracker-based logs have distinct indicators                 |               | ⏳     |

---

## Filters

| ID      | Title                                                   | Precondition                                           | Steps                                                                              | Expected Result                                                             | Actual Result | Status |
|---------|---------------------------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| PTS_005 | Filter by date range                                    | Time logs exist across multiple weeks                  | 1. Set a start date and end date  2. Apply                                         | Only logs within the selected date range are shown                          |               | ⏳     |
| PTS_006 | Filter by a specific project                            | User has projectTimesheetPermission, 2+ projects exist | 1. Open filter  2. Select a project  3. Apply                                      | Only logs linked to the selected project are displayed                      |               | ⏳     |
| PTS_007 | Filter by a specific user                               | User has projectTimesheetPermission                    | 1. Open filter  2. Select a user  3. Apply                                         | Only logs created by the selected user are shown                            |               | ⏳     |
| PTS_008 | Filter by project and user combined                     | User has projectTimesheetPermission, multiple users    | 1. Open filter  2. Select a project and a user  3. Apply                           | Only logs for that user within the selected project are shown               |               | ⏳     |
| PTS_009 | Clearing project filter restores all accessible logs    | A project filter is active                             | 1. Clear the project filter  2. Apply                                              | All projects accessible to the user are shown again                         |               | ⏳     |
| PTS_010 | Clearing user filter restores all users' logs           | A user filter is active                                | 1. Clear the user filter  2. Apply                                                 | Logs for all accessible users are restored                                  |               | ⏳     |

---

## Role-based Access

| ID      | Title                                                          | Precondition                                           | Steps                                                                              | Expected Result                                                             | Actual Result | Status |
|---------|----------------------------------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| PTS_011 | User without project timesheet permission sees only own logs   | Logged in as Member without projectTimesheetPermission | 1. Open Project Timesheet                                                          | Only the logged-in user's own logs are shown; no filter by user available   |               | ⏳     |
| PTS_012 | Admin with no project filter sees all company logs             | Logged in as Admin (roleType 1), no filter applied     | 1. Open Project Timesheet  2. Apply no project or user filter                      | Time logs across all projects and all users are displayed                   |               | ⏳     |
| PTS_013 | Manager with no project filter sees all logs in range          | Logged in as Manager (roleType 2), no filter applied   | 1. Open Project Timesheet  2. Apply no project or user filter                      | All time logs within the date range are displayed (not restricted to self)  |               | ⏳     |
| PTS_014 | Admin with project filter sees only selected project's logs    | Logged in as Admin, multiple projects have logs        | 1. Open Project Timesheet  2. Select one project in filter  3. Apply               | Only logs for that project shown; other projects hidden                     |               | ⏳     |

---

## Totals

| ID      | Title                                                   | Precondition                                           | Steps                                                                              | Expected Result                                                             | Actual Result | Status |
|---------|---------------------------------------------------------|--------------------------------------------------------|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|---------------|--------|
| PTS_015 | Total time per project-date group is correct            | A project has multiple logs on the same date           | 1. Open Project Timesheet  2. Look at the total for a project-date group           | Total shown equals the sum of all log durations in that group               |               | ⏳     |

---

**Total:** 15 test cases · **All status:** ⏳ Pending
