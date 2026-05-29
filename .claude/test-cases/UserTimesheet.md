# User Timesheet — Test Cases

**Module:** `Modules/TimeSheet` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View User Timesheet

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_001 | Timesheet loads with current week by default       | Logged in as any user                             | 1. Click "Time Sheet" in the top nav  2. Select "User" view                               | Current week's time logs displayed for the logged-in user              |               | ⏳     |
| TS_002 | Admin sees all users' time logs                    | Logged in as Admin, multiple users have time logs | 1. Open User Timesheet  2. Do not apply any user filter                                   | Time logs for all company users are visible                            |               | ⏳     |
| TS_003 | Regular user sees only their own time logs         | Logged in as a Member (non-admin)                 | 1. Open User Timesheet                                                                    | Only the logged-in user's own entries shown; no other users visible    |               | ⏳     |
| TS_004 | Manager sees their team members' time logs         | Logged in as Manager (roleType 2)                 | 1. Open User Timesheet                                                                    | Time logs for the manager's team members are visible                   |               | ⏳     |
| TS_005 | Time logs grouped by date                          | User has logs on multiple dates                   | 1. Open User Timesheet                                                                    | Entries are grouped under their respective dates                       |               | ⏳     |
| TS_006 | Manual and tracker logs visually differentiated    | User has both manual and tracker logs             | 1. Open User Timesheet  2. Look at the log entries                                        | Manual logs and tracker-based logs have distinct visual indicators     |               | ⏳     |

---

## Filters

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_007 | Filter by date range                               | Time logs exist across multiple weeks             | 1. Open User Timesheet  2. Set start date and end date  3. Apply                          | Only logs within the selected range are shown                          |               | ⏳     |
| TS_008 | Filter by specific user (Admin only)               | Logged in as Admin, multiple users have logs      | 1. Open filter  2. Select a specific user  3. Apply                                       | Only that user's logs are displayed                                    |               | ⏳     |
| TS_009 | Filter by project                                  | Time logs exist across multiple projects          | 1. Open filter  2. Select a project  3. Apply                                             | Only logs linked to the selected project are shown                     |               | ⏳     |
| TS_010 | Filter by team                                     | Teams configured with members                    | 1. Open filter  2. Select a team  3. Apply                                                | Only logs from team members are displayed                              |               | ⏳     |
| TS_011 | Clear filters restores full view                   | At least one filter is active                    | 1. Click "Clear Filters" or reset the filter panel                                        | All logs for the default date range are shown again                    |               | ⏳     |

---

## Manual Time Log — Add

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_012 | Add a manual time log with all fields              | Logged in, at least one task exists               | 1. Click "+ Log Time"  2. Select task  3. Set date, start time, end time  4. Add note  5. Save | Log appears in the timesheet for the selected date                 |               | ⏳     |
| TS_013 | Cannot save manual log without selecting a task    | Logged in                                         | 1. Click "+ Log Time"  2. Leave task empty  3. Try to save                                | Validation error shown; log not created                                |               | ⏳     |
| TS_014 | Cannot save log with end time before start time    | Logged in                                         | 1. Click "+ Log Time"  2. Set end time earlier than start time  3. Try to save            | Validation error shown; log not created                                |               | ⏳     |
| TS_015 | Duration auto-calculated from start and end time   | Logged in                                         | 1. Click "+ Log Time"  2. Enter start time 09:00 and end time 11:30                       | Duration field shows 2h 30m automatically                              |               | ⏳     |
| TS_016 | New manual log appears in timesheet immediately    | Logged in                                         | 1. Add a manual log  2. Look at the timesheet view                                        | Log visible under the correct date without a page refresh              |               | ⏳     |
| TS_017 | Daily total updates after adding a log             | Logged in                                         | 1. Note the current daily total  2. Add a 1h manual log for today                        | Daily total increases by 1h                                            |               | ⏳     |

---

## Manual Time Log — Edit

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_018 | Edit duration of an existing log                   | User has at least one manual time log             | 1. Click edit on a log entry  2. Change start/end time  3. Save                           | Updated duration shown; daily total recalculated                       |               | ⏳     |
| TS_019 | Edit the task linked to a log                      | User has at least one manual time log             | 1. Click edit on a log entry  2. Change the task  3. Save                                 | Log now linked to the new task; updated in timesheet                   |               | ⏳     |
| TS_020 | Edit the date of a log                             | User has at least one manual time log             | 1. Click edit on a log  2. Change date to yesterday  3. Save                              | Log moves to the new date group; old date total decreases              |               | ⏳     |
| TS_021 | Edit note / description of a log                   | User has at least one manual time log             | 1. Click edit on a log  2. Update note  3. Save                                           | Updated note saved and visible on the log entry                        |               | ⏳     |
| TS_022 | Edit triggers a notification                       | Another user is watching the task                 | 1. Edit a time log on a task                                                              | Watcher / relevant user receives "time log edited" notification        |               | ⏳     |

---

## Manual Time Log — Delete

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_023 | Delete a manual time log                           | User has at least one manual time log             | 1. Click delete on a log entry  2. Confirm deletion                                       | Log removed from timesheet; daily total decreases accordingly          |               | ⏳     |
| TS_024 | Deleted log no longer appears in task Time Log tab | Task has a linked time log                        | 1. Delete a time log from the timesheet  2. Open the linked task → Time Log tab           | Deleted entry no longer listed on the task                             |               | ⏳     |
| TS_025 | Delete triggers a notification                     | Another user is watching the task                 | 1. Delete a time log on a task                                                            | Watcher / relevant user receives "time log deleted" notification       |               | ⏳     |

---

## Time Tracker

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_026 | Start the time tracker on a task                   | User has tracker permission (isTrackerUser)       | 1. Open a task  2. Click the tracker Play button                                          | Timer starts and elapsed time ticks in real-time                       |               | ⏳     |
| TS_027 | Only one tracker session can run at a time         | Tracker already running on Task A                 | 1. Open Task B  2. Try to start the tracker                                               | Prompt to stop the existing session before starting a new one          |               | ⏳     |
| TS_028 | Stop tracker saves a time log automatically        | Tracker is running                                | 1. Click the Stop button on the active tracker  2. Confirm                                | Time log entry created with the correct duration; appears in timesheet |               | ⏳     |
| TS_029 | Tracker duration matches actual elapsed time       | Tracker is running                                | 1. Start tracker  2. Wait exactly 5 minutes  3. Stop tracker                             | Saved log shows approximately 5 minutes duration                       |               | ⏳     |
| TS_030 | User without tracker permission cannot start tracker | Logged in as user with isTrackerUser = false    | 1. Open a task  2. Look for the tracker Play button                                       | Tracker button not visible or disabled                                 |               | ⏳     |

---

## Screenshot Capture (Tracker)

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_031 | Screenshot captured during active tracker session  | Tracker running, desktop tracker app installed    | 1. Start tracker on a task  2. Wait for the auto-capture interval                        | Screenshot saved and linked to the active tracker session              |               | ⏳     |
| TS_032 | Screenshot visible in timesheet detail             | Tracker session with screenshots exists           | 1. Open User Timesheet  2. Click a tracker log entry                                     | Screenshots for that session are shown in the detail view              |               | ⏳     |
| TS_033 | Memo / note saved alongside a screenshot           | Tracker session active                            | 1. During tracking, add a memo via the tracker app  2. Stop tracker                      | Memo text saved with the screenshot and visible in timesheet detail    |               | ⏳     |
| TS_034 | Activity strokes recorded during tracker session   | Tracker running                                   | 1. Start tracker  2. Use keyboard/mouse actively for 1 minute                            | Activity data recorded for that minute interval                        |               | ⏳     |

---

## Totals & Summary

| ID     | Title                                              | Precondition                                      | Steps                                                                                     | Expected Result                                                        | Actual Result | Status |
|--------|----------------------------------------------------|---------------------------------------------------|-------------------------------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| TS_035 | Daily total is sum of all logs for that day        | User has multiple logs on the same day            | 1. Open User Timesheet  2. Look at the daily total for a date                             | Total matches the sum of all log durations for that day                |               | ⏳     |
| TS_036 | Weekly total is sum of all daily totals            | User has logs across a full week                  | 1. Open User Timesheet  2. Look at the weekly total                                       | Weekly total equals the sum of all daily totals in the range           |               | ⏳     |
| TS_037 | Total updates immediately after adding a log       | User Timesheet open                               | 1. Add a 2h manual log  2. Look at the daily and weekly totals                            | Both totals increase by 2h without a page refresh                      |               | ⏳     |
| TS_038 | Total updates immediately after deleting a log     | User Timesheet open, at least one log exists      | 1. Delete a 1h log  2. Look at the daily and weekly totals                                | Both totals decrease by 1h without a page refresh                      |               | ⏳     |

---

**Total:** 38 test cases · **All status:** ⏳ Pending

> ℹ️ Notifications & Audit test cases (TS_039–042) will be added in a separate file.
