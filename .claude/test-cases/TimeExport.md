# Time Export (CSV / Payroll) — Test Cases

**Feature:** TIME-04 — export tracked time as a payroll CSV
**Backend:** `Modules/TimeSheet/helpers/timesheetCsv.js` (pure builder) + `exportTimesheetCsv` (`POST /api/v1/timesheet/export-csv`)
**Frontend:** `TimesheetExport.vue` — "Export CSV" button in the User Timesheet toolbar
**Unit tests:** `tests/timesheet-csv.test.js` (9 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| TE-01 | Export button present | On User Timesheet with a week selected | Look at toolbar | An **Export CSV** button is shown | | ⬜ |
| TE-02 | Download a CSV | Entries exist in the period | Click **Export CSV** | A `timesheet-<start>_<end>.csv` file downloads | | ⬜ |
| TE-03 | Header row | TE-02 | Open the file | First row = `User,Project,Date,Description,Billable,Hours` | | ⬜ |
| TE-04 | Names resolved | Entries by known users/projects | Inspect rows | User + Project show **names** (not ids) | | ⬜ |
| TE-05 | Column formats | Mixed entries | Inspect a row | Date `YYYY-MM-DD`, Billable `Yes`/`No`, Hours decimal (e.g. `1.50`) | | ⬜ |
| TE-06 | Respects filters | Period + user/project filters applied | Export | Only matching entries are included | | ⬜ |
| TE-07 | CSV escaping | A description containing a comma/quote | Export | That field is quoted correctly; columns stay aligned | | ⬜ |
| TE-08 | Empty period | No entries in the period | Export | Header-only CSV downloads (no rows) | | ⬜ |
| TE-09 | Endpoint (API) | Known entries | `POST /api/v1/timesheet/export-csv` `{userArray,start,end}` (seconds) | `text/csv` attachment with the expected rows | | ⬜ |

**Total:** 9 cases (UI/API — run on the dev server). Pure CSV builder covered by 9 automated unit tests.
