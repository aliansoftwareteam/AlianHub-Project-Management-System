# Comment Reactions — Test Cases

**Location:** Task comments / project Comments tab · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Add & Toggle Reactions

| ID     | Title                                            | Precondition                                   | Steps                                                                                          | Expected Result                                                                      | Actual Result | Status |
|--------|--------------------------------------------------|------------------------------------------------|--------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------|---------------|--------|
| CR_001 | Add an emoji reaction to a comment               | A task with at least one comment               | 1. Hover the comment  2. Click the reaction control  3. Pick an emoji (e.g. 👍)                  | Emoji chip appears under the comment with count 1, highlighted as your own reaction  |               | ⏳     |
| CR_002 | Clicking your own reaction removes it            | CR_001 done                                    | 1. Click the same emoji chip again                                                                | Your reaction is removed; chip disappears or its count decreases by one              |               | ⏳     |
| CR_003 | Counts aggregate across users                    | Two users can see the same comment             | 1. As user 1 react 👍  2. As user 2 (second browser) react 👍 on the same comment                | Chip shows 👍 2; each user sees only their own reaction highlighted                   |               | ⏳     |
| CR_004 | Reactions update live for other viewers          | Two browser windows on the same comment thread | 1. In window 1 add a reaction  2. Watch window 2 without reloading                                | The reaction chip appears in window 2 within a couple of seconds                     |               | ⏳     |
| CR_005 | Picker stays inside the viewport                 | A comment near the bottom/right screen edge    | 1. Open the reaction picker on that comment                                                       | Picker renders fully visible — not clipped behind panels or cut off by the viewport  |               | ⏳     |

---

**Total:** 5 test cases · **All status:** ⏳ Pending
