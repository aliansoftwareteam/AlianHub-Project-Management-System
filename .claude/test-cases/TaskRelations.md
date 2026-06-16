# Task Relations — Test Cases

**Location:** Task detail → Linked Tasks · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Add & Remove Relations

| ID     | Title                                                  | Precondition                                  | Steps                                                                                                                       | Expected Result                                                                              | Actual Result | Status |
|--------|--------------------------------------------------------|-----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TR_001 | Link two tasks with a "blocks" relation                | Two tasks A and B exist in the same project   | 1. Open task A  2. In Linked Tasks click add relation  3. Choose type "blocks"  4. Search task B by name or key and select it | Success toast; task B listed under Linked Tasks on task A with label "blocks"                |               | ⏳     |
| TR_002 | Inverse relation appears on the other task             | TR_001 done (A blocks B)                      | 1. Open task B  2. Check its Linked Tasks section                                                                            | Task A is listed with the inverse label "blocked by"                                         |               | ⏳     |
| TR_003 | Remove a relation from either side                     | A and B are linked                            | 1. Open task A  2. Click the unlink control on the linked row                                                                | Link disappears from both task A and task B; toast confirms removal                          |               | ⏳     |
| TR_004 | Relation search only offers same-project tasks         | Two projects with tasks exist                 | 1. In project 1 open a task and add a relation  2. Search a task name that only exists in project 2                          | No cross-project results — only tasks of the current project are offered                     |               | ⏳     |

---

## History & Live Sync

| ID     | Title                                                  | Precondition                                  | Steps                                                                                                                       | Expected Result                                                                              | Actual Result | Status |
|--------|--------------------------------------------------------|-----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TR_005 | Activity history written on both tasks                 | TR_001 done                                   | 1. Open the activity log of task A  2. Open the activity log of task B                                                       | Both logs contain an entry describing who linked which task and the relation type            |               | ⏳     |
| TR_006 | Linked list updates live in a second window            | Two browser windows both viewing task A       | 1. In window 1 link task A to task B  2. Watch window 2 without reloading                                                    | Window 2 shows the new linked task within a couple of seconds                                |               | ⏳     |

---

**Total:** 6 test cases · **All status:** ⏳ Pending
