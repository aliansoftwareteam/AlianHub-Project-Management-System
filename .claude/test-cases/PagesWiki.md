# Pages (Project Wiki) — Test Cases

**Location:** Project board toolbar → `...` (More) → Pages · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Pages & Versions

| ID     | Title                              | Precondition              | Steps                                                                     | Expected Result                                                                       | Actual Result | Status |
|--------|------------------------------------|---------------------------|---------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|---------------|--------|
| PW_001 | Create a page                      | Project open on its board | 1. Open `...` → Pages  2. Create a page with title and content  3. Save   | Page appears in the project's page list; reopening shows the saved content           |               | ⏳     |
| PW_002 | Editing creates a new version      | PW_001 done               | 1. Edit the content and save  2. Open the page's version history          | Two versions exist, each with author and timestamp                                   |               | ⏳     |
| PW_003 | Restore an old version             | PW_002 done               | 1. Restore version 1 from the history                                     | Content returns to the original; the restore is recorded as a new version            |               | ⏳     |
| PW_004 | Pages are project-scoped           | Two projects              | 1. Create a page in project 1  2. Open `...` → Pages in project 2         | Project 2's list does not contain project 1's page                                   |               | ⏳     |
| PW_005 | Delete a page                      | A page exists             | 1. Delete the page and confirm                                            | Page disappears from the list; other pages unaffected                                |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
