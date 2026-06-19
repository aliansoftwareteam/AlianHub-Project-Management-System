# Cumulative Flow Diagram — Test Cases

**Location:** Project → `+ View` → Reports → Cumulative Flow · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Chart Rendering

| ID      | Title                         | Precondition                                | Steps                                       | Expected Result                                                                                  | Actual Result | Status |
|---------|-------------------------------|---------------------------------------------|---------------------------------------------|--------------------------------------------------------------------------------------------------|---------------|--------|
| CFD_001 | CFD renders                   | Reports view added; project with tasks across statuses | 1. Open Reports → Cumulative Flow           | Stacked-area chart of task counts by status band (To do / In progress / On hold / Done) over ~30 days |               | ⏳     |
| CFD_002 | Done band reflects completions | Some tasks completed over recent days       | 1. Observe the "Done" band over time        | The Done band grows on the dates tasks were completed                                            |               | ⏳     |
| CFD_003 | Empty state handled           | A project with no tasks                     | 1. Open Reports → Cumulative Flow           | Renders an empty/zero state — no crash                                                            |               | ⏳     |

---

**Total:** 3 test cases · **All status:** ⏳ Pending
