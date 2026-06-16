# Public Sharing + Intake — Test Cases

**Location:** Project board toolbar → `...` (More) → Public link · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Public Link

| ID     | Title                                  | Precondition                        | Steps                                                                                       | Expected Result                                                                                   | Actual Result | Status |
|--------|----------------------------------------|-------------------------------------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|---------------|--------|
| PS_001 | Create a public link for a sprint      | Project with a sprint and tasks     | 1. Open `...` → Public link  2. Pick a sprint  3. Click Create public link                  | A `/share/<token>` URL appears with Copy Link button and "Link enabled" ticked                    |               | ⏳     |
| PS_002 | Public page opens without login        | PS_001 done                         | 1. Copy the link  2. Open it in an incognito window                                         | Read-only board renders (tasks grouped by status) — no login redirect, no edit controls           |               | ⏳     |
| PS_003 | Disabling the link blocks the page     | PS_002 done                         | 1. Untick "Link enabled"  2. Reload the public page in incognito  3. Re-enable and reload   | Disabled: page no longer shows the board; re-enabled: same URL works again                        |               | ⏳     |

---

## Intake Requests

| ID     | Title                                  | Precondition                        | Steps                                                                                       | Expected Result                                                                                   | Actual Result | Status |
|--------|----------------------------------------|-------------------------------------|---------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------|---------------|--------|
| PS_004 | Visitor can submit a request           | Link enabled                        | 1. Tick "Accept public requests"  2. Reload the public page  3. Fill and submit the intake form | Thank-you page confirms the submission and links back to the board                                |               | ⏳     |
| PS_005 | Review submissions in the inbox        | PS_004 done                         | 1. In the app reopen `...` → Public link for that sprint  2. Accept one request, reject another | Submissions show title/description/submitter; handled items leave the pending inbox               |               | ⏳     |
| PS_006 | Empty title is rejected on the form    | Intake form visible on public page  | 1. Submit the form with an empty title                                                      | Submission rejected with a readable message; no junk entry appears in the inbox                   |               | ⏳     |

---

**Total:** 6 test cases · **All status:** ⏳ Pending
