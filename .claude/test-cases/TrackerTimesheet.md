# Tracker Timesheet — Test Cases

**Module:** `Modules/TimeSheet/controller/trackerTimeSheet.js` · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Tracker Timesheet

| ID      | Title                                                    | Precondition                                         | Steps                                                                        | Expected Result                                                           | Actual Result | Status |
|---------|----------------------------------------------------------|------------------------------------------------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|---------------|--------|
| TTS_001 | Tracker Timesheet loads and shows only tracker-based logs | Logged in, tracker logs exist for current period     | 1. Click "Time Sheet" in top nav  2. Select "Tracker" view                   | Only tracker-based entries are displayed (no manual logs)                 |               | ⏳     |
| TTS_002 | Manual time logs never appear in this view               | User has both manual and tracker logs                | 1. Open Tracker Timesheet                                                    | Manual log entries are completely absent from the view                    |               | ⏳     |
| TTS_003 | Logs are grouped by user                                 | Multiple users have tracker logs in the period       | 1. Open Tracker Timesheet with no user filter                                | Each user appears as a separate group                                     |               | ⏳     |
| TTS_004 | Screenshots visible within each tracker session          | A tracker session has captured screenshots           | 1. Open Tracker Timesheet  2. Expand a user's tracker session                | Screenshots (trackShots) for that session are shown                       |               | ⏳     |

---

## Filters

| ID      | Title                                                    | Precondition                                         | Steps                                                                        | Expected Result                                                           | Actual Result | Status |
|---------|----------------------------------------------------------|------------------------------------------------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|---------------|--------|
| TTS_005 | Filter by date range                                     | Tracker logs exist across multiple days              | 1. Set a start date and end date  2. Apply                                   | Only tracker sessions that overlap the selected date range are shown      |               | ⏳     |
| TTS_006 | Filter by a specific user                                | Multiple users have tracker logs                     | 1. Open filter  2. Select a user  3. Apply                                   | Only that user's tracker sessions are displayed                           |               | ⏳     |
| TTS_007 | Filter by a team                                         | At least one team with members exists                | 1. Open filter  2. Select a team  3. Apply                                   | Only tracker sessions for team members are displayed                      |               | ⏳     |
| TTS_008 | Filter by a project                                      | Tracker logs exist across multiple projects          | 1. Open filter  2. Select a project  3. Apply                                | Only tracker sessions linked to the selected project are shown            |               | ⏳     |
| TTS_009 | Filter by user and project combined                      | Multiple users have tracker logs on multiple projects | 1. Open filter  2. Select a user and a project  3. Apply                    | Only that user's tracker sessions for the selected project are shown      |               | ⏳     |
| TTS_010 | Clearing user filter restores all accessible sessions    | A user filter is active                              | 1. Clear the user filter  2. Apply                                           | Tracker sessions for all accessible users are shown again                 |               | ⏳     |
| TTS_011 | Clearing project filter restores all projects            | A project filter is active                           | 1. Clear the project filter  2. Apply                                        | Tracker sessions across all projects are shown again                      |               | ⏳     |

---

## Everyone Toggle / Access Control

| ID      | Title                                                              | Precondition                                          | Steps                                                                        | Expected Result                                                           | Actual Result | Status |
|---------|--------------------------------------------------------------------|-------------------------------------------------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|---------------|--------|
| TTS_012 | Admin with "Everyone" ON and no user or team filter sees all users | Logged in as Admin, "Everyone" toggle ON              | 1. Open Tracker Timesheet  2. Apply no user or team filter                   | Tracker sessions for every company user in the date range are visible     |               | ⏳     |
| TTS_013 | "Everyone" ON but user filter applied — only selected user shown   | Logged in as Admin, "Everyone" toggle ON              | 1. Open Tracker Timesheet  2. Select a specific user in filter  3. Apply     | Only the selected user's sessions shown despite "Everyone" being ON       |               | ⏳     |
| TTS_014 | "Everyone" ON but team filter applied — only team members shown    | Logged in as Admin, "Everyone" toggle ON              | 1. Open Tracker Timesheet  2. Select a team in filter  3. Apply              | Only team members' sessions shown; non-team users hidden                  |               | ⏳     |
| TTS_015 | Without "Everyone" access user sees only own tracker sessions      | Logged in as Member without admin/everyone permission | 1. Open Tracker Timesheet                                                    | Only the logged-in user's own tracker sessions are displayed              |               | ⏳     |

---

## Screenshots

| ID      | Title                                                    | Precondition                                         | Steps                                                                        | Expected Result                                                           | Actual Result | Status |
|---------|----------------------------------------------------------|------------------------------------------------------|------------------------------------------------------------------------------|---------------------------------------------------------------------------|---------------|--------|
| TTS_016 | Expanding a tracker session shows its screenshots        | A session has at least one captured screenshot       | 1. Open Tracker Timesheet  2. Click to expand a tracker session              | All screenshots captured during that session are visible                  |               | ⏳     |
| TTS_017 | Session with no screenshots shows empty state            | A tracker session was run with screenshots disabled  | 1. Open Tracker Timesheet  2. Expand a session that has no screenshots       | Empty state shown for screenshots; session entry still visible            |               | ⏳     |

---

**Total:** 17 test cases · **All status:** ⏳ Pending
