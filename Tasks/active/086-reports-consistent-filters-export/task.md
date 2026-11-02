---
id: 086
title: Time reports — one header, deep filters and export on every tab, workload day panel
status: active
priority: high
depends_on: []
created: 2026-11-02
---

# 086 — Time reports: consistent UI, deep filters, export (PRD)

## 1. Problem

The Time area (`/:cid/timesheet` and its siblings) grew tab by tab, and each tab has its own header, its own filter UI and its own idea of a date range:

- **Tab strip** (`TimesheetTabs.vue`) uses a private `tv-tab` underline style that sits out of line with the toolbar: different alignment, spacing and hit areas from every other AlianHub page, which use `ah-toolbar` + the `ah-tabs`/`ah-tab` segmented control.
- **Mine** and **Approvals** use the private `tv-head` header; **Workload** uses `ah-toolbar` with a project `<select>` in the title slot; **Project** and **Tracker** still render the legacy breadcrumb header, a Bootstrap grid and a "Filter by" dropdown with free-floating chips.
- **Dates**: Mine and Workload step a week at a time, Project has a range picker, Tracker one day, Variance one month, Approvals none. No presets, nothing in the URL, so a filtered view cannot be shared or survive a reload.
- **Filters**: person and project only, and only on some tabs; no sprint/list, status, billable or tags anywhere.
- **Export**: Mine (CSV through the server) and Variance (CSV) only; Project, Workload, Tracker and Approvals cannot be exported.
- **Workload**: a cell shows at most two task chips and a "+N"; there is no way to see the rest or open a task.

## 2. Goal

Every Time report looks and behaves like the rest of AlianHub: one toolbar, one filter bar with date presets and the filters the data supports, the choice kept in the URL, and Export (CSV, Excel, PDF) of exactly what is on screen. Clicking a Workload cell lists that person's scheduled tasks for the day or period and opens any of them in the app's task panel.

## 3. Scope

### 3.1 Shared building blocks (`frontend/src/views/Timesheet/report/`)

1. **`reportRange.js`** (pure, CommonJS so jest tests it): date presets `today, yesterday, this_week, last_week, this_month, last_month, this_quarter, last_quarter, this_year, last_year, last_7, last_30, last_90, custom`; `rangeOf(preset, now, { start, end })` → `{ start, end }` as `YYYY-MM-DD`, ISO weeks (Monday start, as every Time screen already uses); `shiftRange` for the ‹ › stepper (moves by the preset's own period); `granularityOf(range)` (day/week/month buckets).
2. **`reportQuery.js`** (pure): read/write the filter state ⇄ route query (`range`, `from`, `to`, `people`, `projects`, `lists`, `status`, `billable`, `tags`, plus tab-specific keys left untouched). Unknown or malformed values fall back to the tab's default.
3. **`useReportFilters`** composable: reactive filters synced with `router.replace`, so the URL always says what the screen shows; tab links carry the shared keys across tabs.
4. **`reportExport.js`**: `toCsvText(columns, rows)` (pure, tested; quotes, commas, newlines, formula-injection guard via the existing `escapeCSVValue` rules), CSV download, **Excel** through the already-installed `xlsx` (lazy `loadXlsx`), **PDF** through the browser's print dialog on a plain printable table (no PDF library exists in the web app).
5. **Components**
   - `ReportToolbar.vue` — `header.ah-toolbar` with `ah-toolbar__title`, the tab strip, a meta slot (status chip, count), spacer, actions slot and the Export menu.
   - `TimesheetTabs.vue` — restyled as the shared `ah-tabs`/`ah-tab` segmented control (router links, `aria-current`), carrying the shared filter query.
   - `ReportFilterBar.vue` — the controls row (same pattern as Everything's `evr__controls`): the date chip (presets + custom from/to, ‹ › stepper), then `EverythingFilterChip` for each filter the tab declares, and Clear.
   - `ReportExportMenu.vue` — Export button + `ah-pop` menu (CSV / Excel / PDF).
   - `useReportOptions.js` — people, projects, lists (sprints), statuses (by name, across projects, like Everything) and tags (from `project.tagsArray`).

### 3.2 Backend (companyId-scoped, `Modules/TimeSheet`)

6. **`helpers/reportFilters.js`**: `normalizeReportFilters(body)` and `reportTimeClauses(companyId, scope, filters)` — sprint/list, status (name) and tag filters resolve to the matching task ids **inside the session company and the caller's visible projects**; billable becomes a clause on the time row (`billable: false` = non-billable; anything else billable, as the CSV export already reads it). Empty filters add nothing.
7. Accept the optional `filters` object on the routes the tabs call and add the clauses to their match:
   - `GET /api/v1/timesheet/week` (Mine, as `filters` JSON in the query),
   - `POST /api/v1/timesheet/project` (Project),
   - `POST /api/v1/timesheet/workload-grid` (Workload: estimates by task, logged by the same time clauses),
   - `POST /api/v1/timesheet/export-csv` (Mine's payroll CSV).
   No new route; scope rules unchanged (the filters can only narrow what the scope already returns).

### 3.3 Tabs

| Tab | Date | Filters | Export rows |
|---|---|---|---|
| Mine | presets (range ≤ 31 days shows day columns; the week stays the unit for Submit) | person (Everyone permission), project, list, status, billable, tags | task × day grid + payroll entries CSV |
| Project | presets | people, projects, list, status, billable, tags | project rows (logged, estimated, per day) |
| Workload | presets (day columns up to 31 days, then week, then month buckets) | people, projects, list, status, tags; mode estimate/logged | person × bucket hours |
| Tracker | single day (today, yesterday, pick a day) — the screenshot timeline is one day by design | people, projects | the day's slots (time, task, project, person, minutes) |
| Approvals | presets on the period (week, leave dates, proposal date) | people, type (time / leave / AI) | the visible cards |
| Variance | presets (replaces the month stepper) | group by project / person | groups (estimated, actual, variance) |

8. **Workload day panel**: clicking a cell (or a week/month bucket) opens a right-side panel (`ah-slide-right`, same shell as Mine's log panel) listing every scheduled task for that person and period — task name, project, list, planned hours — with logged vs capacity at the top; a row opens the task in the app's task panel (`openTask` from `TaskDetailOverlay/useTaskOverlay`). Esc and the close button close it; drag-and-drop of chips keeps working in day columns.

## 4. Out of scope

- Custom-field filters (the time rows carry no custom-field values; a per-field task lookup is a follow-up).
- `CustomReports` (it is the report *builder* with its own filter model and export) and `MilestoneReport` (milestone billing sheet) — kept as they are; noted as follow-ups.
- `TimeLog/LogTimeSheet.vue` is the log-time form, not a report.
- Server-side PDF; saved report views.
- Changing what a role may see.

## 5. Acceptance criteria

1. All six screens render `ah-toolbar` + the shared tab strip + `ReportFilterBar`; no `tv-head`, legacy breadcrumb or "Filter by" dropdown remains on them.
2. Each date preset yields the documented range (unit tests, including quarter/year boundaries, ISO weeks crossing a year, leap years); Custom accepts from/to and refuses to > from by swapping.
3. Reloading or sharing the URL restores the same filters; switching tabs keeps the date range and people/projects.
4. Sprint/status/tag/billable filters narrow Mine, Project and Workload, and never widen what the caller's scope returns (unit tests on the helper).
5. Export offers CSV, Excel and PDF on every screen and the file holds exactly the rows/columns shown (unit tests for the CSV builder).
6. Workload: clicking a cell opens the panel with all that day's tasks; clicking a task opens the task panel; works for week/month buckets.
7. `npm run i18n:check` and `npm run style:check` pass; touched files' baselines lowered where they shrank.
8. Before/after screenshots of each tab saved in this folder (`screenshots/`).

## 6. Decisions (made autonomously while the owner was away)

- **Tabs are the `ah-tabs` segmented control**, the one Everything, Goals and Planner put in their toolbar, not a new underline style.
- **Filter chips reuse `EverythingFilterChip`** (and its `evr__chip` styles) instead of a new chip component.
- **Status filters by name** across projects (each project has its own status keys), as Everything does.
- **Tracker keeps a single day**: its timeline is per day; presets that span days do not apply there.
- **Mine keeps Submit week-bound**: Submit/Resubmit show only when the range is exactly one ISO week; other ranges are read-only views.
- **PDF = print dialog** of a plain table (no PDF library in the web app; adding one is a bigger decision).
- **No new backend route**: the existing routes take an optional `filters` object; this keeps the API surface and the API doc unchanged except for request fields.
