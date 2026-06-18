# Velocity Chart — Test Cases

**Location:** Project → `+ View` → Reports → Velocity · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Chart Rendering

| ID      | Title                         | Precondition                                  | Steps                                            | Expected Result                                                                       | Actual Result | Status |
|---------|-------------------------------|-----------------------------------------------|--------------------------------------------------|---------------------------------------------------------------------------------------|---------------|--------|
| VEL_001 | Velocity renders              | Reports view added; project with ≥2 sprints carrying story points | 1. Open Reports → Velocity                       | Per-sprint **committed vs completed** point columns plus a rolling 3-sprint average line |               | ⏳     |
| VEL_002 | Ordering & counts are correct | VEL_001 done                                  | 1. Observe the sprint order and bar values       | Sprints shown oldest → newest; committed/completed match each sprint's points          |               | ⏳     |
| VEL_003 | Empty state handled           | A project with no pointed/closed sprints      | 1. Open Reports → Velocity                       | Renders an empty/zero state — no crash                                                 |               | ⏳     |

---

**Total:** 3 test cases · **All status:** ⏳ Pending
