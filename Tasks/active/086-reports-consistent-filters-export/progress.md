# 086 — progress

## 2026-11-02

- Worktree reset to `origin/chore/pre-staging` (ca7f83412), branch `feat/reports-overhaul`.
- Read every tab and the shared UI: `ah-toolbar`, `ah-tabs`/`ah-tab`, Everything's `evr__controls` + `EverythingFilterChip`, `openTask` (global task panel), `loadXlsx`.
- PRD written (`task.md`).
- Shared pieces in `frontend/src/views/Timesheet/report/`: `reportRange.js` (presets, stepper, buckets), `reportQuery.js` (filters ⇄ URL), `reportTable.js` (export table), `useReportFilters`, `useReportOptions`, `useReportExport`, `ReportToolbar`, `ReportFilterBar`, `ReportDateChip`, `ReportExportMenu`, `report.css`. `TimesheetTabs` is now the `ah-tabs` segmented control and carries range/people/projects between tabs.
- Backend: `Modules/TimeSheet/helpers/reportFilters.js`; optional `filters` on week, project, workload-grid, export-csv and estimatedTime routes; `pdf.js` prints landscape for wide tables. Week route also takes `projectIds=a,b`.
- Tabs moved onto the shared layout: Mine (range-aware columns: days ≤31, then weeks/months; Submit only for one ISO week), Project (legacy grid kept, header/filters replaced; drill-down keeps the URL query), Workload (+ `WorkloadCellPanel`, `workloadBuckets.js`), Tracker (single day), Approvals (Any time default, people + type), Variance (presets replace the month stepper).
- Shared components touched minimally: `composable/exportDownload.js` (PDF format), `ProjectTimesheetTrComponent.vue` (keeps query on task open/close).
- Tests: `tests/report-range-presets.test.js`, `tests/report-filters-query-export.test.js`, `tests/timesheet-report-filters.test.js`, `tests/workload-cell-buckets.test.js`; 74 timesheet/workload/estimate/export suites pass (1430 tests). Approvals vitest specs updated (router mock gains `useRoute`/`replace`, type tabs found by `data-test`).
- Convention suites: the 5 that fail here (role-playbooks, retired-flags, plain-words, ci-e2e-shards, ai-core-boundary) fail identically on a clean `chore/pre-staging` checkout. global-class-collisions caught the panel class; fixed.
- Browser check on :5410 against the demo DB (read-only): every tab renders, presets/stepper/URL round-trip, Approvals filtered empty state, CSV + PDF export return 200 and the CSV holds exactly the cards on screen. The demo DB has no time logs or plans, so the Workload panel was checked with a sample grid injected into the page (no DB writes) and real TechNova task ids; opening a task shows the task panel and closing it brings the list back.
- Screenshots in `screenshots/` (before-*/after-*). No before-variance: the hidden browser pane timed out on that page.
- i18n: keys added to `en.js` (Reports.*, Time.*), `npm run i18n:backfill` run (English copies, pending files updated), `npm run i18n:check` passes. `npm run style:check` passes; baseline unchanged.
- Frontend vitest, full suite: 48 failures, the same tests that fail on a clean `chore/pre-staging` checkout; none new. Specs that pinned the old Project/Tracker header (legacyScreensOnTokens2, uiSweepThirdPass, darkModeBatchThree) now describe the shared toolbar/filter bar.
- Local servers stopped; temporary `.claude/launch.json` entries reverted.

## Open / follow-ups
- Custom-field filters (needs a task lookup per field).
- `CustomReports` and `MilestoneReport` not moved onto the shared bar.
- Teams as a filter source in the shared bar.
- Mine's under-capacity hint and last-week card only show for a one-week range.

## 2026-11-03 — owner review: filters that follow each other

- People narrow the Projects list to the projects they are on (directly or through a team) or logged/planned time in over the range. With two or more people an **Any / All** switch appears beside People: Any = union, All = projects every one of them shares; kept in the URL as `match=all` and carried between tabs.
- Lists, Status and Tags take their options from the chosen projects, else the people's projects, else all.
- Picked options are listed first and highlighted in every filter dropdown (`EverythingFilterChip` gains an opt-in `highlightPicked`; Everything itself is unchanged).
- New route `POST /api/v1/timesheet/report-facets` (people × range → projects worked in), company-scoped and inside the caller's sheet scope. Run `npm run api:doc` in the docs PR after merge.
- Tests: `tests/report-filter-facets.test.js`, `tests/timesheet-report-facets-route.test.js`. Checked on the demo DB (2 people: Any → 3 projects, All → 1); screenshot `screenshots/after-workload-people-all.jpg`.
- Not yet measured on the large database: the local API could not be started against it from this session (blocked by a permission check).
