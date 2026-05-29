# Time Tracking (Desktop App Download) — Test Cases

**Location:** Settings → Time Tracking · **Last updated:** 2026-05-29

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Page Load

| ID     | Title                                                           | Precondition                               | Steps                                                                | Expected Result                                                              | Actual Result | Status |
|--------|-----------------------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| TT_001 | Time Tracking page loads with available platform options        | Logged in as any user                      | 1. Open Settings → Time Tracking                                     | Page loads with Windows, Mac, and Linux platform cards visible               |               | ⏳     |
| TT_002 | First platform is auto-selected on page load                    | Logged in                                  | 1. Open Settings → Time Tracking  2. Observe the selected platform   | The first platform in the list is highlighted/active by default              |               | ⏳     |
| TT_003 | Each platform card shows OS type and version                    | Platform data loaded from server           | 1. Open Settings → Time Tracking  2. Look at each platform card      | Each card shows the OS name (e.g. "Windows") and its version string          |               | ⏳     |
| TT_004 | Platform card images (Windows, Mac, Linux icons) are displayed  | Platform data loaded from server           | 1. Open Settings → Time Tracking                                     | Correct OS logo / icon shown on each platform card                           |               | ⏳     |

---

## Platform Selection

| ID     | Title                                                           | Precondition                               | Steps                                                                | Expected Result                                                              | Actual Result | Status |
|--------|-----------------------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| TT_005 | Clicking a platform card selects it                             | Page is loaded with multiple platforms     | 1. Click a platform card that is not currently selected              | Clicked card becomes active/highlighted; previously active card deselected   |               | ⏳     |
| TT_006 | Download button title updates to reflect the selected platform  | A platform is selected                     | 1. Click different platform cards one by one                         | Download label/title changes to show the selected platform's installer name  |               | ⏳     |
| TT_007 | Platform description updates when selection changes             | Platform cards have descriptions           | 1. Switch between platform cards                                     | Description text in the download area updates for each selected platform     |               | ⏳     |

---

## Download

| ID     | Title                                                           | Precondition                               | Steps                                                                | Expected Result                                                              | Actual Result | Status |
|--------|-----------------------------------------------------------------|--------------------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------------------|---------------|--------|
| TT_008 | Clicking the download button triggers file download             | A platform is selected with a valid URL    | 1. Select a platform  2. Click the download button                   | Browser initiates a file download for the tracker installer                  |               | ⏳     |
| TT_009 | Each platform has its own distinct download URL                 | All three platforms are loaded             | 1. Inspect the download URL for Windows  2. Do same for Mac, Linux   | Each platform's download URL is unique and points to the correct installer   |               | ⏳     |

---

**Total:** 9 test cases · **All status:** ⏳ Pending
