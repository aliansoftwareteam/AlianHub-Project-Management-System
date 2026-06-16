# What's New (Changelog) — Test Cases

**Location:** Header → click the version badge (e.g. v14.2.0) · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Page Content

| ID     | Title                                          | Precondition                       | Steps                                                              | Expected Result                                                                                              | Actual Result | Status |
|--------|------------------------------------------------|------------------------------------|--------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------|---------------|--------|
| WN_001 | Page opens from the header version badge       | Logged in                          | 1. Click the version badge at the right of the header              | The What's New page opens listing every release, newest first                                               |               | ⏳     |
| WN_002 | Latest and Installed chips are correct         | What's New page open               | 1. Check the chips on the release cards                            | The newest release shows "Latest"; the release matching the running version shows "Installed"               |               | ⏳     |
| WN_003 | Release date shows time in 12-hour format      | What's New page open               | 1. Look at the date on each release card                           | Format like "10 June 2026, 3:59 PM" — date plus 12-hour local time with AM/PM                               |               | ⏳     |
| WN_004 | Grouped sections render with working links     | A release with Features/Bug Fixes  | 1. Read a release card  2. Click a commit or compare link          | Sections are grouped (Features, Bug Fixes, …); links open GitHub in a new tab                               |               | ⏳     |
| WN_005 | View on GitHub link                            | What's New page open               | 1. Click "View on GitHub" in the page header                       | The repository's releases page opens in a new tab                                                           |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
