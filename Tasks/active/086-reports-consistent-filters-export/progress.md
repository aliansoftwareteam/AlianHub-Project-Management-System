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

## 2026-11-03 — filter row, select all, speed on the large database

- Workload's Estimated | Logged and Variance's By project | By person are segmented controls in the filter row, not the toolbar.
- Every multi-select filter has Select all / Deselect all at the top of its list (over the options in view, so a search narrows it). Opt-in `bulk` prop on `EverythingFilterChip`; not on Mine's single-person picker.
- Speed, measured read-only against the "Alian Software" workspace (264k time logs, 81k plans, 117k tasks), owner scope:

  | Query | Week | Month | Quarter | Year |
  |---|---|---|---|---|
  | Mine: one person's logs | 30 ms | 90 ms | 139 ms | 484 ms |
  | Project: logs by day × project (everyone) | 1401 ms | 1546 ms | 2238 ms | 3556 ms |
  | Project: plans by day × project | 248 ms | 239 ms | 327 ms | 499 ms |
  | Workload: plans, all members | 46 ms | 100 ms | 289 ms | 634 ms |
  | Workload: logs, all members | 95 ms | 195 ms | 855 ms | 2069 ms |
  | People → projects facets (5 people) | 108 ms | 36 ms | 57 ms | 83 ms |
  | Status filter, before (all 75k "Complete" tasks → logs) | 5282 ms | 4588 ms | 3968 ms | 5110 ms |
  | Status filter, after, one person | 150 ms | 320 ms | 591 ms | 514 ms |
  | Status filter, after, everyone (no date index yet) | 1592 ms | 2930 ms | 4016 ms | 8786 ms |

- Cause of the slow company-wide reads: `timesheets` has no index starting with `LogStartTime`, so a date-only match scans every log (explain: COLLSCAN, 264,014 examined for 188 returned). Added `{ LogStartTime: 1 }` to the schema and migration `079-timesheet-date-index` (createIndexes only; not run against the live database from here).
- Task filters now look up only the tasks the report's rows name in the range (plus planned tasks on Workload and the estimate route), not every task in the company.
- Tests: `tests/migration-timesheet-date-index.test.js`, two new cases in `tests/timesheet-report-filters.test.js`; 74 time/report suites pass.

## 2026-11-03 — date index built on the large database (owner approved)

- Built `LogStartTime_1` on `timesheets` in the two workspaces with time logs (Alian Software: 264,020 logs, 2.6 s; one other: 4 logs). Same index migration 079 builds. A week's date read now examines 196 logs instead of 264,014 (IXSCAN, 3 ms on the server).
- Workload's logged minutes are now summed per person per day in the database instead of reading every log row; checked on the real quarter that all 2,568 person-day cells match the old sums exactly.
- Timings after (read-only, from this machine to the database, so they include network time):

  | Query | Week | Month | Quarter | Year |
  |---|---|---|---|---|
  | Project: logs by day × project (everyone) | 79 ms (was 1401) | 248 ms (1546) | 487 ms (2238) | 1623 ms (3556) |
  | Workload: logged minutes, all members (summed in DB) | ~90 ms | ~280 ms | 265 ms (raw rows 1010) | 805 ms (raw rows 2772) |
  | Status filter, everyone | 160 ms (was 5282) | 730 ms (4588) | 1677 ms (3968) | 4558 ms (5110) |
  | Status filter, one person | 117 ms | 270 ms | 269 ms | 419 ms |
  | Mine: one person | 39 ms | 126 ms | 154 ms | 341 ms |

- Still heavy: a whole year for everyone with a status filter (4.6 s; 46k matching logs) and a year of plans for everyone (1.2 s, 16.8k rows). Both are far rarer views; a summed-in-DB read for plans is the next step if needed.

## 2026-11-03 — custom range redesigned

- The From/To native date boxes overflowed the popover and looked out of place. The date popover is now two columns: presets on the left, and the app's own themed date picker (`@vuepic/vue-datepicker`, already styled by `assets/css/datepicker.css`) shown inline on the right, Monday-first, with the current range highlighted. Click a start day and an end day; it applies on the second click. Tracker shows a single-day calendar. On a phone the presets wrap above the calendar.
- Checked on the demo copy (:5412): picking Nov 10 then Nov 20 sets `range=custom&from=2026-11-10&to=2026-11-20`. Screenshot `screenshots/after-date-range-calendar.jpg`.
