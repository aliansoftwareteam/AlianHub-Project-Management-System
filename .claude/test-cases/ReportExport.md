# Report CSV / Excel Export — Test Cases

**Feature:** REP-05 — tabular CSV/Excel export for reports (PDF already existed)
**Backend:** `Modules/Export/helpers/exportRules.js` (pure CSV/AoA + filename sanitise), `Modules/Export/table.js` (handlers), routes `POST /api/v1/export/csv` + `POST /api/v1/export/xlsx`. Same "client sends the table it displays" pattern as the existing PDF export — generic, so any report can export. `xlsx` is lazy-loaded.
**Frontend:** shared `frontend/src/composable/exportDownload.js` + Export CSV / Export Excel buttons on **Custom Report** and **Variance Report** pages.
**Unit-tested:** `tests/report-export-rules.test.js` (CSV escaping, header+rows+total, AoA, filename) — Node suite (36 suites / 404 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| EXP-01 | Custom report → CSV | Custom Report has a preview | Click "Export CSV" | A `.csv` downloads with header (dimension, metric) + one row per group | | ⬜ |
| EXP-02 | Custom report → Excel | Same | Click "Export Excel" | An `.xlsx` downloads, opens in Excel with the same rows + total | | ⬜ |
| EXP-03 | Variance → CSV | Variance report loaded for a project | Click "Export CSV" | `.csv` with Task / Estimated / Actual / Variance / % / Status columns + a Total row | | ⬜ |
| EXP-04 | Variance → Excel | Same | Click "Export Excel" | `.xlsx` with the same columns + total row | | ⬜ |
| EXP-05 | Correct columns/values | Known report data | Open the exported file | Columns + values match the on-screen table exactly (client sends what it shows) | | ⬜ |
| EXP-06 | CSV escaping | A label/task name containing a comma or quote | Export CSV | Field is quoted; embedded quotes doubled; opens correctly in Excel | | ⬜ |
| EXP-07 | UTF-8 in Excel | Non-ASCII text (accents, etc.) | Open CSV in Excel | Renders correctly (UTF-8 BOM prepended) | | ⬜ |
| EXP-08 | Filename | — | Export | Downloaded file named `custom-report.csv/.xlsx` or `variance-report.csv/.xlsx` (sanitised) | | ⬜ |
| EXP-09 | Disabled when empty | No preview / no project selected | Look at buttons | Export buttons disabled until there's data | | ⬜ |
| EXP-10 | No new deps break boot | — | App starts; export an Excel | `xlsx` lazy-loads on first XLSX export; CSV needs no lib; app boot unaffected | | ⬜ |
| EXP-11 | Rules (unit) | — | `npx jest tests/report-export-rules.test.js` | All green — escaping, CSV build (CRLF), AoA, filename sanitise | | ✅ |

**Total:** 11 cases (1 unit-automated, 10 runtime/manual). Done-when met: reports export to CSV and Excel with the correct columns. The endpoint is generic (any report can pass its head/rows), demonstrated on Custom Report + Variance.
