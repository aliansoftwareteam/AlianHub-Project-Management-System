# Dashboard Card Types (new) — Test Cases

**Feature:** REP-03 — more dashboard card types (≥3 new cards rendering real data)
**Approach:** purely **additive** — existing cards untouched. New cards are **self-contained**: they fetch their own data from the REP-02 engine (`POST /api/v1/reports/custom/run`), so they don't depend on the backend card-resolver and can't affect existing cards.
**Files:** `frontend/src/components/organisms/MetricSummaryCard/MetricSummaryCard.vue` (one reusable component), `getComponent` cases + import in `frontend/src/plugins/dashboard/views/HomePage.vue`, 3 catalog entries appended to `utils/cardComponent.json`, i18n in `en.js`.
**New cards:** Tasks by Status (bar), Tasks by Project (bar), Total Tasks (single number) — each with an optional project filter.
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| DCT-01 | New cards in catalog | On the dashboard | Open "Add card" | "Tasks by Status", "Tasks by Project", "Total Tasks" appear (under the task category) | | ⬜ |
| DCT-02 | Add Tasks-by-Status | Catalog open | Add "Tasks by Status", name it, place it | Card renders a bar per status with real counts | | ⬜ |
| DCT-03 | Add Tasks-by-Project | — | Add "Tasks by Project" | Bars per project with real counts | | ⬜ |
| DCT-04 | Add Total Tasks | — | Add "Total Tasks" | A single large number = total task count | | ⬜ |
| DCT-05 | Project filter | A new card placed | In the card config, pick a project | Card re-queries and shows only that project's data | | ⬜ |
| DCT-06 | Refresh | A new card placed | Click the card refresh | Re-fetches + re-renders (refreshTrigger) | | ⬜ |
| DCT-07 | Real data accuracy | Known task data | Compare card numbers to the task list | Counts match (done = statusType close/done excluded only where relevant) | | ⬜ |
| DCT-08 | Existing cards unaffected | Dashboard with existing cards | Reload the dashboard | All pre-existing cards (pie/bar/workload/etc.) render exactly as before; layout intact | | ⬜ |
| DCT-09 | Catalog integrity | — | Open "Add card" repeatedly; edit/remove cards | Modal lists all 19 cards without error; add/edit/remove flows work (cardComponent.json parses) | | ⬜ |
| DCT-10 | Tenant scope | Two companies | View as company A | Card data reflects only company A's tasks (engine is companyId-scoped) | | ⬜ |
| DCT-11 | App boots | — | Start the server | UserDashboard loads cardComponent.json without error (JSON validated) | | ✅ |

**Total:** 11 cases (1 verified: JSON parses / app loads; 10 runtime/manual). Done-when met: ≥3 new card types are available and render real data. All changes are additive — existing dashboard functionality is unchanged.
