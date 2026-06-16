# Auto-Archive — Test Cases

**Location:** Project board toolbar → `...` (More) → Auto-archive · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Settings Modal

| ID     | Title                                  | Precondition                              | Steps                                                                                        | Expected Result                                                                  | Actual Result | Status |
|--------|----------------------------------------|-------------------------------------------|--------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------|---------------|--------|
| AA_001 | Enable auto-archive with a threshold   | Project open; user can edit settings      | 1. Open `...` → Auto-archive  2. Turn the toggle on  3. Set days to 30  4. Save and reopen   | Success toast on save; reopened modal shows toggle on with the saved day value  |               | ⏳     |
| AA_002 | Disable auto-archive                   | AA_001 done                               | 1. Reopen the modal  2. Turn the toggle off  3. Save and reopen                              | Setting persists as off                                                         |               | ⏳     |
| AA_003 | Invalid day threshold is rejected      | Auto-archive modal open                   | 1. Enter 0, a negative number or blank in the days field  2. Try to save                     | Value is rejected or normalized — no nonsensical threshold saved, no crash      |               | ⏳     |
| AA_004 | Setting is per project                 | Two projects; auto-archive on in project 1 | 1. Open `...` → Auto-archive in project 2                                                   | Project 2 shows its own (default/off) state, unaffected by project 1            |               | ⏳     |

---

**Total:** 4 test cases · **All status:** ⏳ Pending
