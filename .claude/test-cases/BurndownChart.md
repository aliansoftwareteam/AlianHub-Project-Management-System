# Burndown Chart — Test Cases

**Location:** Project board toolbar → `...` (More) → Burndown · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Chart Rendering

| ID     | Title                                        | Precondition                                                   | Steps                                                                            | Expected Result                                                                       | Actual Result | Status |
|--------|----------------------------------------------|----------------------------------------------------------------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------|---------------|--------|
| BD_001 | Chart renders for the current sprint         | Sprint with dated tasks, some completed                        | 1. Open the sprint board  2. Open `...` → Burndown                               | Modal shows the burndown chart with date axis, remaining-work line and ideal line   |               | ⏳     |
| BD_002 | Completing a task lowers the remaining line  | BD_001 done; note today's remaining count                      | 1. Close the modal  2. Mark one open task completed  3. Reopen `...` → Burndown  | Today's remaining count is one lower than before                                    |               | ⏳     |
| BD_003 | Sprint without tasks is handled gracefully   | A sprint with zero tasks                                       | 1. Open that sprint's board  2. Open `...` → Burndown                            | Empty/zero chart or empty-state message — no crash                                  |               | ⏳     |
| BD_004 | Modal closes and reopens cleanly             | Burndown modal open                                            | 1. Close via ✕  2. Reopen  3. Close by clicking the overlay                      | Both close actions work; reopening renders the chart correctly again                |               | ⏳     |

---

**Total:** 4 test cases · **All status:** ⏳ Pending
