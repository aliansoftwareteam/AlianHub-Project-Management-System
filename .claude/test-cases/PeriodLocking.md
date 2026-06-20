# Period Locking After Approval — Test Cases

**Feature:** TIME-03 — lock time entries once their period is approved (tamper-proof, server-side)
**Backend:** `Modules/TimesheetApproval/helpers/lockGuard.js` (`isPeriodLocked`) + `coversDate` rule; enforced in `manualLogTime` (edit) and `deleteManualLogtime`
**Frontend:** Add/Edit Time Log surfaces the server's lock message
**Unit tests:** `coversDate` cases in `tests/timesheet-approval-rules.test.js`
**Depends on:** TIME-01 (approval workflow)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| PL-01 | Approve a period | Entries exist for a week | Submit (TIME-01) then approve it as owner/admin | Approval doc status `approved` | | ⬜ |
| PL-02 | Edit blocked in approved period | PL-01 done | Open an entry in that week → **Edit Time Log** → Update | Save is blocked; toast shows "This timesheet period is approved and locked — the entry can't be edited." | | ⬜ |
| PL-03 | Delete blocked in approved period | PL-01 done | Delete an entry in that week | Server returns `{status:false}` with the lock message; entry remains | | ⬜ |
| PL-04 | Edit/delete allowed when not approved | A week with no approval (or status submitted/rejected) | Edit or delete an entry there | Succeeds normally | | ⬜ |
| PL-05 | Reopen unlocks | An approved period (PL-01) | Reopen it (TIME-01 review → reopen) | Entries in that week become editable/deletable again | | ⬜ |
| PL-06 | Day-granular boundaries | Approved period Mon–Sun | Edit an entry on the Mon (start) and on the Sun (end) | Both are blocked (inclusive of both ends) | | ⬜ |
| PL-07 | Tamper-proof | — | Call `manualLogtime`/`deleteManualLogtime` directly for a locked entry | Blocked server-side regardless of client | | ⬜ |
| PL-08 | Other users unaffected | User A's period approved | User B edits B's own entry in the same week | Allowed (lock is per user) | | ⬜ |

**Total:** 8 cases (UI/API — run on the dev server). `coversDate` covered by 6 automated unit tests.
