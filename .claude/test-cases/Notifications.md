# Notifications — Test Cases

**Location:** Settings → Notifications · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## View Notification Settings

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_001 | Notification settings page loads with all sections                     | Logged in as any user                  | 1. Open Settings → Notifications                                        | All notification sections shown (Tasks, Projects, etc.) sorted alphabetically |               | ⏳     |
| NOTIF_002 | Each section has rows for individual notification events               | Settings page loaded                   | 1. Observe any section in the notification table                        | Each section contains multiple notification event rows                        |               | ⏳     |
| NOTIF_003 | Three channels shown as columns: Email, Browser, Mobile               | Settings page loaded                   | 1. Look at the column headers                                           | Columns "Email", "Browser", and "Mobile" are visible                          |               | ⏳     |
| NOTIF_004 | Sections are sorted alphabetically by section name                    | Multiple notification sections exist   | 1. Open Settings → Notifications  2. Observe section order              | Sections appear in alphabetical order (e.g. Messages before Tasks)            |               | ⏳     |
| NOTIF_005 | Spinner shown while loading notification settings                      | Logged in                              | 1. Open Settings → Notifications  2. Observe during initial load        | Spinner visible while settings are being fetched                              |               | ⏳     |

---

## Toggle Email Notifications

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_006 | Enable email notification for an event                                 | Email notification is currently OFF    | 1. Toggle the Email toggle for an event to ON                           | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |
| NOTIF_007 | Disable email notification for an event                                | Email notification is currently ON     | 1. Toggle the Email toggle for an event to OFF                          | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |

---

## Toggle Browser Notifications

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_008 | Enable browser notification for an event                               | Browser notification is currently OFF  | 1. Toggle the Browser toggle for an event to ON                         | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |
| NOTIF_009 | Disable browser notification for an event                              | Browser notification is currently ON   | 1. Toggle the Browser toggle for an event to OFF                        | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |

---

## Toggle Mobile Notifications

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_010 | Enable mobile notification for an event                                | Mobile notification is currently OFF   | 1. Toggle the Mobile toggle for an event to ON                          | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |
| NOTIF_011 | Disable mobile notification for an event                               | Mobile notification is currently ON    | 1. Toggle the Mobile toggle for an event to OFF                         | Toast: "Notification Settings Update successfully"; setting saved             |               | ⏳     |

---

## Notification Dropdowns (notifyFor / Duration)

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_012 | Change "Notify For" dropdown value for a supported event               | An event supports the notifyFor option | 1. Open the "Notify For" dropdown for a row  2. Select a new value      | Toast: "Notification Settings Update successfully"; new value saved           |               | ⏳     |
| NOTIF_013 | Change "Duration" dropdown value for a supported event                 | An event supports the duration option  | 1. Open the "Duration" dropdown for a row  2. Select a new value        | Toast: "Notification Settings Update successfully"; new value saved           |               | ⏳     |
| NOTIF_014 | Selecting the same dropdown value shows "Nothing to update"            | A dropdown value is already selected   | 1. Open a dropdown  2. Select the same value that is already selected   | Toast: "Nothing to update"                                                    |               | ⏳     |

---

## Persistence

| ID       | Title                                                                   | Precondition                           | Steps                                                                   | Expected Result                                                               | Actual Result | Status |
|----------|-------------------------------------------------------------------------|----------------------------------------|-------------------------------------------------------------------------|-------------------------------------------------------------------------------|---------------|--------|
| NOTIF_015 | Notification settings persist after page reload                        | At least one toggle was changed        | 1. Change a notification setting  2. Reload the page                   | Changed settings are still reflected correctly after reload                   |               | ⏳     |
| NOTIF_016 | Notification settings are user-specific                                | Two users have different settings      | 1. Log in as User A, check notifications  2. Log in as User B           | Each user sees and controls only their own notification preferences            |               | ⏳     |

---

**Total:** 16 test cases · **All status:** ⏳ Pending
