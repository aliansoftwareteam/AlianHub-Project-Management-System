# Timesheet Approval — Test Cases

**Feature:** TIME-01 — Timesheet approval workflow (submit → review → approve / reject / reopen)
**Backend:** `Modules/TimesheetApproval/` (collection `timesheet_approval`, per-company DB)
**Frontend:** `components/molecules/TimesheetApproval/TimesheetApproval.vue`, mounted in the **User Timesheet** toolbar
**Unit tests:** `tests/timesheet-approval-rules.test.js` (30 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| TA-01 | Submit a period | Logged in as a member; on User Timesheet with a week selected and some logged time | Click **Submit timesheet** | Badge changes to **Awaiting approval**; a `timesheet_approval` doc is created with status `submitted`, `totalMinutes`/`entryCount` snapshotted | | ⬜ |
| TA-02 | Submitted period shows status, no button | TA-01 done | Reload / revisit the same week | **Awaiting approval** badge shown; no Submit button | | ⬜ |
| TA-03 | Owner/Admin sees Approvals queue | Logged in as owner (roleType 1) or admin (2) | Look at User Timesheet toolbar | **Approvals** button visible with a count badge of pending submissions | | ⬜ |
| TA-04 | Member does NOT see Approvals | Logged in as member (roleType ≥ 3) | Look at toolbar | No **Approvals** button | | ⬜ |
| TA-05 | Open pending queue | Owner/admin; ≥1 submitted period exists | Click **Approvals** | Panel lists each submission: user name, period, total hours | | ⬜ |
| TA-06 | Approve a submission | TA-05 open | Click **Approve** on a row | Row disappears from queue; that period's status becomes `approved`; submitter sees **Approved** badge | | ⬜ |
| TA-07 | Reject requires a reason | TA-05 open | Click **Reject** → leave reason empty | **Confirm** is disabled until a reason is typed | | ⬜ |
| TA-08 | Reject with reason | TA-05 open | Click **Reject**, type reason, **Confirm** | Row leaves queue; status `rejected`; reason stored | | ⬜ |
| TA-09 | Rejected → resubmit | A period was rejected | As the submitter, open that week | **Rejected** badge + reason shown; **Resubmit** button available; clicking it returns status to `submitted` | | ⬜ |
| TA-10 | Approved period is locked | A period is `approved` | As the submitter, try to submit that week again (API) | Submit is blocked with "already approved and locked" (no button shown in UI) | | ⬜ |
| TA-11 | Reopen an approved/rejected period | Owner/admin; review API | `POST /:id/review` with `action: reopen` on an approved/rejected doc | Status returns to `submitted`; review trail cleared | | ⬜ |
| TA-12 | Member cannot review (server-side) | Member's JWT/token | `POST /api/v2/timesheet-approval/:id/review` | 403-style `{status:false}` "Only an owner or admin can review" | | ⬜ |
| TA-13 | Member can only submit their own | Member's token | `POST /submit` with another user's `userId` | Blocked: "You can only submit your own timesheet" | | ⬜ |
| TA-14 | Totals reflect logged work | Period has N entries totalling M minutes | Submit, inspect doc / queue | `totalMinutes` = M, `entryCount` = N (by `LogStartTime` within the period) | | ⬜ |
| TA-15 | Empty queue message | Owner/admin; no submitted periods | Open **Approvals** | "Nothing to review" shown | | ⬜ |
| TA-16 | Week navigation refreshes status | Submissions exist for some weeks | Change the RangePicker week | Badge/button reflect the newly-selected period's status | | ⬜ |

**Total:** 16 cases (UI/integration — to be run on the dev server). Pure rule engine covered by 30 automated unit tests.
