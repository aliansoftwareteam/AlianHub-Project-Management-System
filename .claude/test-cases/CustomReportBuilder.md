# Custom Report Builder — Test Cases

**Feature:** REP-02 — custom report builder (pick metric + dimension + filters → saved chart/table)
**Backend:** `Modules/CustomReports/{helpers/reportRules.js,controller.js,routes.js,init.js}`, `saved_reports` collection; endpoints `POST /api/v1/reports/custom/run` (preview), `POST/GET /api/v1/reports/custom`, `GET /api/v1/reports/custom/:id/run` (reload), `PUT/DELETE /api/v1/reports/custom/:id`
**Frontend:** `frontend/src/views/CustomReports/CustomReports.vue` (top-nav **Custom Report** → `/:cid/custom-reports`)
**Engine (safety):** dimensions (status/project/sprint), metrics (count/points), filters (project/status/sprint) are **allow-listed**; the config supplies keys + filter values only — never raw field names/operators — so it can't inject Mongo.
**Unit-tested:** `tests/report-rules.test.js` (validateConfig allow-listing, pipeline build) — Node suite (34 suites / 390 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| CR-01 | Nav + open | Logged in | Click top-nav "Custom Report" | Opens `/:cid/custom-reports`; builder + empty/seeded preview render | | ⬜ |
| CR-02 | Live preview | Tasks exist | Change Group by / Measure | Preview updates immediately (POST /run) with real grouped data | | ⬜ |
| CR-03 | Group by status | Tasks with various statuses | Group by = Status, Measure = Task count | Bars/table per statusType with correct counts | | ⬜ |
| CR-04 | Group by project | Tasks across projects | Group by = Project | One row per project with counts | | ⬜ |
| CR-05 | Story points metric | Tasks with points | Measure = Story points | Values = summed points per group | | ⬜ |
| CR-06 | Project filter | — | Pick a project in the filter | Results restricted to that project's tasks | | ⬜ |
| CR-07 | Chart types | Data present | Switch Bar / Pie / Table | Bar = bars, Pie = bars + share %, Table = rows + total | | ⬜ |
| CR-08 | Save | A configured report | Enter a name, Save | Appears under "Saved reports" | | ⬜ |
| CR-09 | Reload saved | A saved report | Click it in the list | Builder + preview restore to the saved config and reload correctly | | ⬜ |
| CR-10 | Delete saved | A saved report | Click Delete | Removed from the list (soft delete) | | ⬜ |
| CR-11 | Injection safe | — | Send `dimension:"$where"` or `filters:{$where:...}` to /run | 400 (bad dimension) or the bad key is dropped; no arbitrary field/operator reaches Mongo | | ⬜ |
| CR-12 | Tenant isolation | Two companies | Build/list as company A | Only company A's tasks + saved reports; company B never visible | | ⬜ |
| CR-13 | Rules (unit) | — | `npx jest tests/report-rules.test.js` | All green — allow-listing, default coercion, filter whitelist, safe pipeline | | ✅ |

**Total:** 13 cases (1 unit-automated, 12 runtime/manual). Done-when met: a user builds, previews and saves a custom report that reloads correctly. Dimensions/metrics are an allow-listed set (status/project/sprint × count/points) — easily extended as more task fields are confirmed.
