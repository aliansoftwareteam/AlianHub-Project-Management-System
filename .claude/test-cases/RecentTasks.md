# Recent Tasks — Test Cases

**Location:** Project board toolbar → `...` (More) → Recent · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Recent List

| ID     | Title                                      | Precondition                              | Steps                                                                                   | Expected Result                                                                          | Actual Result | Status |
|--------|--------------------------------------------|-------------------------------------------|---------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| RT_001 | Visited tasks appear most-recent first     | Logged in; project with several tasks     | 1. Open three different tasks one after another  2. Open `...` → Recent                  | Modal lists the visited tasks newest first with task key, name and status chip          |               | ⏳     |
| RT_002 | Clicking an entry opens that task          | RT_001 done                               | 1. Click one of the listed tasks                                                         | Modal closes and the app navigates to that task's detail view                           |               | ⏳     |
| RT_003 | List is personal to the logged-in user     | Two users in the same company             | 1. As user 1 visit a task  2. As user 2 open `...` → Recent                              | User 2 does not see user 1's visit — only their own history                             |               | ⏳     |
| RT_004 | Empty state for a fresh user               | A user who has not opened any task yet    | 1. Open `...` → Recent                                                                   | A "no recent tasks" message is shown instead of an empty area                           |               | ⏳     |
| RT_005 | Modal closes via ✕ and overlay click       | Recent modal open                         | 1. Click the ✕ icon  2. Reopen and click the dark overlay outside the card               | Both actions close the modal without navigating                                         |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
