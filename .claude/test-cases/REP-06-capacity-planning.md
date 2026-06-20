# Test Cases — REP-06 Capacity Planning / Resource Leveling (AHE-3723)

**Endpoint:** `GET /api/v1/reports/capacity?from=&to=&hoursPerDay=` (JWT + companyId scoped)
**Frontend:** Capacity Planning page (`/:cid/reports/capacity`, nav: "Capacity Planning")
**Done-when:** Over-allocated users are flagged against their capacity.

Capacity = working days (Mon–Fri) × hoursPerDay − approved PTO hours (reuses the
SEC-08 `computeAvailableCapacity` engine). Allocation = planned hours from
`estimated_time` (minutes → hours) in the window. Utilization = allocated ÷ capacity.

## Pure-rule unit tests (`tests/capacity-rules.test.js`) — 7/7 passing

| # | Case | Input | Expected |
|---|------|-------|----------|
| 1 | Under-allocated | cap 40h, alloc 20h | available 20h, 50%, status `under` |
| 2 | Full (≥80%) | cap 40h, alloc 36h / 40h | status `full` |
| 3 | Over-allocated | cap 40h, alloc 52h | status `over`, 130%, available 0h |
| 4 | No capacity (all PTO) but allocated | cap 0h, alloc 8h | status `over` |
| 5 | No capacity, nothing allocated | cap 0h, alloc 0h | 0%, status `under` |
| 6 | Summary rollup | 3 rows (under/full/over) | users 3, cap 120h, alloc 108h, 90%, counts 1/1/1 |
| 7 | Empty summary | `[]` | users 0, cap 0, 0% |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Loads for current month | Open Capacity Planning page | Defaults to 1st→last of month, 8h/day; table renders team members |
| M2 | Over-allocation flagged | Member with planned hours > capacity in range | Red `Over` badge, utilization bar red & clamped at 100% width, counted in "Over-allocated" total |
| M3 | PTO reduces capacity | Approve PTO for a member overlapping the range | Their Capacity (h) drops by the PTO working-day hours; PTO (h) column shows it |
| M4 | Pending PTO ignored | Leave PTO in `pending`/`rejected` | Capacity unchanged (only `approved` counts) |
| M5 | Change hours/day | Set 6, Apply | All capacities recompute at 6h/working-day |
| M6 | Custom range | Pick a 1-week window | Capacity = working days in that week × hoursPerDay |
| M7 | companyId isolation | Two companies | Each sees only its own members/PTO/estimates |
| M8 | No members | Company with no active users | Empty-state row, totals all zero, no error |
| M9 | Sort order | — | Rows sorted by utilization % descending (most-loaded first) |

## Guards / non-regression
- `from`/`to` required → 400 with clear message; missing companyId → 400.
- Deleted users excluded (`isDelete != true`); deleted PTO excluded (`deletedStatusKey != 1`).
- Read-only report — no writes, no socket emits, no cache mutation. Cannot affect core flows.
- New isolated module + new route prefix; no existing endpoint touched.
