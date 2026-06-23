# Estimate-vs-Actual Variance Report — Test Cases

**Feature:** REP-04 — estimate-vs-actual variance report (per task + rolled up)
**Backend:** `Modules/VarianceReport/{helpers/varianceRules.js,controller.js,routes.js,init.js}`; endpoint `GET /api/v1/reports/variance?projectId=&sprintId=`. No new collection — reuses `tasks.totalEstimatedTime` (estimate, minutes) + summed `timesheets.LogTimeDuration` by `TicketID` (actual, minutes).
**Frontend:** `frontend/src/views/VarianceReport/VarianceReport.vue` (top-nav **Variance Report** → `/:cid/reports/variance`)
**Math:** variance = actual − estimate; over (>0) / under (<0) / on-track / no-estimate; rolled up to project totals.
**Unit-tested:** `tests/variance-rules.test.js` (per-task variance + rollup) — Node suite (35 suites / 397 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| VR-01 | Nav + open | Logged in | Click "Variance Report" | Opens `/:cid/reports/variance`; project picker shown | | ⬜ |
| VR-02 | Per-task variance | A project with estimated + logged tasks | Pick the project | Table lists each task with Estimated, Actual, Variance, % and a status badge | | ⬜ |
| VR-03 | Over highlighting | A task logged > its estimate | View its row | Variance shown +Xh in red; status "Over" | | ⬜ |
| VR-04 | Under highlighting | A task logged < its estimate | View its row | Variance shown −Xh in green; status "Under" | | ⬜ |
| VR-05 | No estimate | A task with logged time but no estimate | View its row | Status "No estimate"; variance = logged | | ⬜ |
| VR-06 | Rollup totals | Same project | Read the totals strip | Total estimated, total actual, total variance (+%), over/under counts — all summed correctly | | ⬜ |
| VR-07 | Units | Minutes underlying | Check formatting | Values render as Xh Ym (estimate + actual both in minutes internally) | | ⬜ |
| VR-08 | Empty project | A project with no tasks | Pick it | "No tasks in this project."; totals zero; no error | | ⬜ |
| VR-09 | Accuracy | Known estimate + logged values | Compare to the task's Estimated field + its time logs | Numbers match (actual = sum of that task's timesheet LogTimeDuration) | | ⬜ |
| VR-10 | Tenant scope | Two companies | View as company A | Only company A's tasks/timesheets (companyId-scoped) | | ⬜ |
| VR-11 | Rules (unit) | — | `npx jest tests/variance-rules.test.js` | All green — over/under/on-track/no-estimate + rollup totals | | ✅ |

**Total:** 11 cases (1 unit-automated, 10 runtime/manual). Done-when met: the report shows estimate vs actual per task and rolled up to the project (sprint id is included per row; a `sprintId` query param also scopes the report).
