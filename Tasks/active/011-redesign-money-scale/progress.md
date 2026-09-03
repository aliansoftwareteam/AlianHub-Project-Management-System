# Progress: Redesign stage 5

## Checklist
- [x] Billing (19a–d) — `views/Billing/*` (hourly, contract, invoices, settings, client view); 53 tests; client view is a field-by-field allow-list, money in integer minor units
- [x] Reports (16a–c, 16e, 11c) — `views/Projects/Reports/*` with `reportsV2.css`, sprint + milestone report pages, PDF export
- [x] Settings finish (15a, 11d, SCIM, 17d) — `views/Settings/Scim/ScimSettings.vue`, `views/Settings/Language/Language.vue`
- [x] Fields, import, i18n/RTL (22a, 22b, 22d) — `plugins/customFieldView/component/organisms/FieldBuilder` restyled with a sandboxed formula engine (fuzzed: 14 attacks all refused); `ar.js` locale + RTL rules in `tokens.css`. **Import** (`components/molecules/ImportCsv/ImportCsvModal.vue`) is functional but still legacy-styled — the one visible gap in this stage
- [x] Dashboards hub + cards (12d, 20a–d) — `views/Dashboards/{DashboardsHub,DashboardView,CardPicker}`
- [x] Whiteboard, mind map (17a, 17b) — `views/Projects/{WhiteboardView,MindMapView}` (`wb-v*`, `mm-v*`)

## Last step
All six landed in the wave-2 integration commit on `feat/redesign-project-views` (PR #525 → `beta`).
This file said "Not started" for a while after the work was done; corrected on a verification pass
that checked each screen exists on disk and is restyled, not from the agent reports.

## Blockers
None.

## Log

### 2026-09-03
- Task created.
