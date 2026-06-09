# Workload Timesheet — Test Cases

**Module:** `Modules/TimeSheet/controller/workloadTimeSheet.js` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Workload Timesheet

| ID      | Title                                               | Precondition                                      | Steps                                                                           | Expected Result                                                          | Actual Result | Status |
|---------|-----------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| WTS_001 | Workload Timesheet loads for the current date range | Logged in, time logs exist for current period     | 1. Click "Time Sheet" in top nav  2. Select "Workload" view                     | Time logs for the current date range are displayed                       |               | ⏳     |
| WTS_002 | Logs are grouped by user                            | Multiple users have time logs in the period       | 1. Open Workload Timesheet with no user filter                                  | Each user appears as a separate group                                    |               | ⏳     |
| WTS_003 | Logs are grouped by date within each user           | A user has logs on multiple dates                 | 1. Open Workload Timesheet  2. Expand a user group                              | Entries are arranged under their respective dates within the user group  |               | ⏳     |
| WTS_004 | Manual and tracker logs are differentiated per user | A user has both manual and tracker logs           | 1. Open Workload Timesheet  2. Look at a user's log entries                     | Manual and tracker logs have distinct visual indicators                  |               | ⏳     |

---

## Filters

| ID      | Title                                               | Precondition                                      | Steps                                                                           | Expected Result                                                          | Actual Result | Status |
|---------|-----------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| WTS_005 | Filter by date range                                | Time logs exist across multiple weeks             | 1. Set a start date and end date  2. Apply                                      | Only logs within the selected date range are shown                       |               | ⏳     |
| WTS_006 | Filter by a specific user                           | Multiple users have logs                          | 1. Open filter  2. Select a user  3. Apply                                      | Only that user's workload is displayed                                   |               | ⏳     |
| WTS_007 | Filter by a team                                    | At least one team with members exists             | 1. Open filter  2. Select a team  3. Apply                                      | Only workload for that team's members is displayed                       |               | ⏳     |
| WTS_008 | Filter by a project scopes workload to that project | Multiple projects have logs from the same users   | 1. Open filter  2. Select a project  3. Apply                                   | Only time logged against that project is shown per user                  |               | ⏳     |
| WTS_009 | Filter by project and user combined                 | Multiple users have logs on multiple projects     | 1. Open filter  2. Select a project and a user  3. Apply                        | Only that user's logs within the selected project are shown              |               | ⏳     |
| WTS_010 | Filter by team and project combined                 | A team has logs on multiple projects              | 1. Open filter  2. Select a team and a project  3. Apply                        | Only team members' logs within the selected project are shown            |               | ⏳     |
| WTS_011 | Clearing user filter restores all accessible users  | A user filter is active                           | 1. Clear the user filter  2. Apply                                              | Workload for all accessible users is shown again                         |               | ⏳     |
| WTS_012 | Clearing project filter restores cross-project view | A project filter is active                        | 1. Clear the project filter  2. Apply                                           | Logs across all projects are shown again per user                        |               | ⏳     |

---

## Role-based Access

| ID      | Title                                                          | Precondition                                       | Steps                                                                           | Expected Result                                                          | Actual Result | Status |
|---------|----------------------------------------------------------------|----------------------------------------------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| WTS_013 | Admin with no user or team filter sees all users' workload     | Logged in as Admin (roleType 1), no filter applied | 1. Open Workload Timesheet  2. Apply no user or team filter                     | Workload for every company user in the date range is visible             |               | ⏳     |
| WTS_014 | Manager with no user or team filter sees all logs in range     | Logged in as Manager (roleType 2), no filter       | 1. Open Workload Timesheet  2. Apply no user or team filter                     | All users' workload within the date range is displayed                   |               | ⏳     |
| WTS_015 | Member sees only their own workload                            | Logged in as Member (non-admin, no special perm)   | 1. Open Workload Timesheet                                                      | Only the logged-in user's own entries are shown                          |               | ⏳     |
| WTS_016 | Admin filtered by user sees only that user's workload          | Logged in as Admin                                 | 1. Open Workload Timesheet  2. Select a specific user in filter  3. Apply       | Only the selected user's logs are shown despite admin role               |               | ⏳     |
| WTS_017 | Admin filtered by team sees only team members' workload        | Logged in as Admin, at least one team exists       | 1. Open Workload Timesheet  2. Select a team in filter  3. Apply                | Only team members' workload shown; non-team users hidden                 |               | ⏳     |

---

## Totals

| ID      | Title                                               | Precondition                                      | Steps                                                                           | Expected Result                                                          | Actual Result | Status |
|---------|-----------------------------------------------------|---------------------------------------------------|---------------------------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| WTS_018 | Total time per user-date group is correct           | A user has multiple logs on the same date         | 1. Open Workload Timesheet  2. Look at the total for a user-date group          | Total shown equals the sum of all log durations in that group            |               | ⏳     |

---

**Total:** 18 test cases · **All status:** ⏳ Pending
