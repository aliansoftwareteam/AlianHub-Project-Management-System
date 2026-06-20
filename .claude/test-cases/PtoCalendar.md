# Time-off / PTO — Test Cases

**Feature:** SEC-08 — time-off / PTO; approved entries reduce available capacity
**Backend:** `Modules/Pto/{helpers/ptoRules.js,controller.js,routes.js,init.js}`, `pto_entries` collection, endpoints `POST/GET /api/v1/pto`, `GET /api/v1/pto/capacity`, `PUT /api/v1/pto/:id/status`, `DELETE /api/v1/pto/:id`
**Frontend:** `frontend/src/views/Settings/TimeOff/TimeOff.vue` (Settings → Time Off)
**Capacity:** available hours = working days (Mon–Fri) × hours/day − approved PTO hours in range (feeds REP-06 capacity planning).
**Unit-tested:** `tests/pto-rules.test.js` (validation, working-day count, overlap hours, capacity math) — in the Node suite (32 suites / 369 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| PTO-01 | Request time off | Logged in | Settings → Time Off; pick type, dates, hours/day; Request | Entry created with status **Pending**; appears in the list | | ⬜ |
| PTO-02 | Validation | — | Submit with end before start, or missing dates | Rejected with a clear message; nothing created | | ⬜ |
| PTO-03 | Member sees only own | Member (role 3) with others' PTO present | Open Time Off | Only the member's own entries are listed | | ⬜ |
| PTO-04 | Admin sees team | Owner/admin | Open Time Off | All members' entries listed; Approve/Reject shown on pending | | ⬜ |
| PTO-05 | Approve | Admin; a pending entry | Click Approve | Status → **Approved**; recorded in the audit log (`pto.approved`) | | ⬜ |
| PTO-06 | Reject | Admin; a pending entry | Click Reject | Status → **Rejected**; not counted against capacity | | ⬜ |
| PTO-07 | Approve is admin-only | Member | `PUT /api/v1/pto/:id/status` | `403` Owner/admin only | | ⬜ |
| PTO-08 | Capacity reduced by approved PTO | An approved entry this month | View "My capacity"; or `GET /pto/capacity?from=&to=` | Available = working-hours − approved PTO hours (e.g. 184 − 40 = 144 for a 5-day leave in a 23-weekday month) | | ⬜ |
| PTO-09 | Pending/rejected don't reduce | Pending or rejected entries only | Check capacity | `ptoHours` = 0; available = full capacity | | ⬜ |
| PTO-10 | Weekends excluded | Leave spanning a weekend | Check capacity | Only Mon–Fri days within the leave count | | ⬜ |
| PTO-11 | Delete own | Member; own entry | Delete | Entry soft-removed (deletedStatusKey=1); gone from list | | ⬜ |
| PTO-12 | Delete others blocked | Member; another user's entry id | `DELETE /api/v1/pto/:id` | `403` — can only remove own | | ⬜ |
| PTO-13 | Tenant isolation | Two companies | List/capacity as company A | Only company A's PTO visible (companyId-scoped) | | ⬜ |
| PTO-14 | Capacity never negative | Leave longer than the range | Check capacity | `availableHours` floors at 0 | | ⬜ |
| PTO-15 | Rules (unit) | — | `npx jest tests/pto-rules.test.js` | All green — validation, working-day count, overlap hours, approved-only capacity reduction, non-negative floor | | ✅ |

**Total:** 15 cases (1 unit-automated, 14 runtime/manual). Done-when met: PTO entries reduce a user's available capacity. A visual month-grid calendar is a possible follow-up; the schedule list + capacity readout cover the requirement.
