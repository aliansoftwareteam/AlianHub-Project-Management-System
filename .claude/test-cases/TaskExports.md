# Task Exports (CSV / XLSX) — Test Cases

**Location:** Project board toolbar → `...` (More) → Export · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Export Flow

| ID     | Title                                   | Precondition                          | Steps                                                                                       | Expected Result                                                                                | Actual Result | Status |
|--------|-----------------------------------------|---------------------------------------|---------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|---------------|--------|
| TE_001 | CSV export downloads                    | Project with a handful of tasks       | 1. Open `...` → Export  2. Click CSV  3. Wait for the "preparing" toast, then the ready toast | A .csv file downloads containing the project's tasks (key, name, status, assignees, dates)    |               | ⏳     |
| TE_002 | XLSX export downloads                   | Project with a handful of tasks       | 1. Open `...` → Export  2. Click XLSX  3. Wait for the toasts                               | A .xlsx file downloads and opens in Excel with the same data                                  |               | ⏳     |
| TE_003 | No duplicate jobs from double-clicks    | Export modal open                     | 1. Click CSV  2. Immediately click either button again                                      | Buttons are disabled while submitting — only one job runs                                     |               | ⏳     |
| TE_004 | Export reflects current data            | TE_001 done                           | 1. Rename a task  2. Run a fresh export                                                     | The new file contains the updated task name                                                   |               | ⏳     |

---

**Total:** 4 test cases · **All status:** ⏳ Pending
