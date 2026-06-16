# Relation Alerts — Test Cases

**Location:** Notifications bell (after Linked Tasks changes) · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Watcher Notifications

| ID     | Title                                          | Precondition                                                          | Steps                                                                          | Expected Result                                                                              | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------------------------------|--------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|---------------|--------|
| RA_001 | Watcher is notified when a relation is added   | User 2 watches task B; tasks A and B in the same project              | 1. As user 1 link task A to task B ("blocks")  2. As user 2 open the notifications bell | User 2 has a notification on task B saying user 1 linked it, with the relation wording      |               | ⏳     |
| RA_002 | Watcher is notified when a relation is removed | RA_001 done                                                           | 1. As user 1 remove the link  2. As user 2 check notifications                  | A new notification reports the link was removed                                             |               | ⏳     |
| RA_003 | Watchers with "ignore" mode get nothing        | User 2 sets notification mode "ignore" for the task                    | 1. As user 1 add and remove a relation on the watched task  2. As user 2 check notifications | No relation notification is delivered to user 2                                             |               | ⏳     |

---

**Total:** 3 test cases · **All status:** ⏳ Pending
