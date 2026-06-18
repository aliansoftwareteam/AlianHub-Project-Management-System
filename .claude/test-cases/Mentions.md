# @Mentions in Comments — Test Cases

**Location:** Task detail → Comments · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Mention & Notify

| ID      | Title                          | Precondition                          | Steps                                                                            | Expected Result                                                                | Actual Result | Status |
|---------|--------------------------------|---------------------------------------|----------------------------------------------------------------------------------|--------------------------------------------------------------------------------|---------------|--------|
| MNT_001 | Mention a user in a comment    | A task with other project members     | 1. Open a task → Comments  2. Type `@` in the comment box  3. Pick a user from the suggestions  4. Post | Comment posts with the mention; the mentioned user gets a notification (bell + email) |               | ⏳     |
| MNT_002 | Notification links back        | MNT_001 done                          | 1. As the mentioned user, open the notification                                  | It links back to the task / comment                                            |               | ⏳     |
| MNT_003 | Multiple mentions              | Project with ≥2 other members         | 1. Mention two users in one comment  2. Post                                     | Each mentioned user is notified                                                |               | ⏳     |
| MNT_004 | No mention → no mention notice | —                                     | 1. Post a comment with no `@` mention                                            | No mention notification is sent                                                |               | ⏳     |

---

**Total:** 4 test cases · **All status:** ⏳ Pending
