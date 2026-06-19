# Story Points & Estimation Scale — Test Cases

**Location:** Task detail → Story Points · Project → estimation-scale config · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Estimation

| ID     | Title                              | Precondition                              | Steps                                                                  | Expected Result                                                  | Actual Result | Status |
|--------|------------------------------------|-------------------------------------------|------------------------------------------------------------------------|------------------------------------------------------------------|---------------|--------|
| SP_001 | Set story points on a task         | A task open                               | 1. Open a task  2. Set story points via the picker  3. Reload          | The value persists on the task                                   |               | ⏳     |
| SP_002 | Picker reflects the project scale  | Project has an estimation scale set        | 1. Open the story-points picker                                        | Offered values match the project's scale (e.g. Fibonacci)        |               | ⏳     |
| SP_003 | Change the project estimation scale | Admin on the project                      | 1. Open the project's estimation-scale config modal  2. Change scale  3. Save | The picker's available values update to the new scale            |               | ⏳     |
| SP_004 | Story-points rollup in List view   | A sprint with several pointed tasks       | 1. Open the List view for the sprint                                   | A story-points rollup (sum per group/sprint) is shown            |               | ⏳     |
| SP_005 | Points feed the reports            | Pointed + some completed tasks            | 1. Open Reports → Burndown and Velocity                               | Points are reflected in burndown "remaining" and in velocity      |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
