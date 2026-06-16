# Epics — Test Cases

**Location:** Project board toolbar → `...` (More) → Epics · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Epic Management

| ID     | Title                                    | Precondition                          | Steps                                                            | Expected Result                                                                | Actual Result | Status |
|--------|------------------------------------------|---------------------------------------|------------------------------------------------------------------------|----------------------------------------------------------------------------------------|---------------|--------|
| EP_001 | Create an epic                           | Project open on its board             | 1. Open `...` → Epics  2. Create an epic with a name             | Epic appears in the panel list with zero progress; success toast               |               | ⏳     |
| EP_002 | Rename an epic                           | EP_001 done                           | 1. Edit the epic name  2. Save                                   | List shows the new name                                                        |               | ⏳     |
| EP_003 | Delete an epic keeps its tasks           | An epic with assigned tasks           | 1. Delete the epic and confirm                                   | Epic disappears; its former tasks remain intact, just without an epic          |               | ⏳     |

---

## Task Assignment & Progress

| ID     | Title                                    | Precondition                          | Steps                                                            | Expected Result                                                                | Actual Result | Status |
|--------|------------------------------------------|---------------------------------------|------------------------------------------------------------------------|----------------------------------------------------------------------------------------|---------------|--------|
| EP_004 | Assign tasks to an epic                  | EP_001 done; project has open tasks   | 1. Assign two tasks to the epic                                  | Epic shows 2 total tasks; the tasks carry the epic reference                   |               | ⏳     |
| EP_005 | Completing a task updates progress       | EP_004 done                           | 1. Mark one assigned task completed  2. Reopen the Epics panel   | Epic shows 1 of 2 done                                                         |               | ⏳     |
| EP_006 | Moving a task between epics fixes counts | Two epics; a task assigned to epic 1  | 1. Reassign the task to epic 2                                   | Epic 1 total decreases by one and epic 2 increases by one                      |               | ⏳     |

---

**Total:** 6 test cases · **All status:** ⏳ Pending
