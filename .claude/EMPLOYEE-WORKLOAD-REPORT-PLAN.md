# Employee Workload & Activity Report Widget — As Built

A dashboard card that shows, per employee, how much time they
**planned**, **logged**, and were **estimated** for — within a chosen
time period and filter set. It works exactly like every other
dashboard card: pure filter-driven, all configuration lives in
`utils/cardComponent.json`, the backend reads the saved config and
returns the matching data. **Nothing is hardcoded.**

> This document describes the **shipped** implementation. (For the
> original superset proposal — AI summary banner, activity badges,
> charts — see the document history at the bottom; those pieces were
> intentionally dropped during iteration.)

---

## What the card shows

A single sortable table, one row per employee, plus a totals footer.

| Column | Meaning | Source |
|---|---|---|
| **Employee** | Avatar + name. Online dot if active. | `users` |
| **Project** | Count of distinct projects the employee has activity in for this filter ("3 projects"). | derived |
| **Logged Hours** | Time the employee actually logged in the period. Colour-coded when over budget. | `timesheets.LogTimeDuration` |
| **Planned Hours** | Time the employee planned for themselves in the period. `—` when none. | `estimated_time.EstimatedTime` |
| **Estimate Hours** | The task's shared estimate (`totalEstimatedTime`). `—` when none. | `tasks.totalEstimatedTime` |

Each employee row expands to list that employee's tasks, aligned to
the same columns: task key + name (click opens the task), project,
and the same logged / planned / estimate trio per task.

### Key domain rule — what the time period actually filters

The period filter does **NOT** pivot on a task's created or due date.
It mirrors the production timesheet model:

- **Planned Hours** come from `estimated_time` rows whose **`Date`**
  falls in the period — each employee plans per-day hours.
- **Logged Hours** come from `timesheets` rows whose **`LogStartTime`**
  falls in the period.
- The union of task ids touched by either of those drives which tasks
  appear.
- **Due date is used only** to flag a task as overdue.

### Multi-assignee handling

A task can have several assignees. Planned and logged hours are
**per-employee** (keyed on `userId|taskId`), while the **Estimate**
(`totalEstimatedTime`) is the task's single shared value shown to each
assignee. So two people on the same task each see their own
planned/logged numbers but the same estimate.

### Over-budget highlighting (+ legend)

The Logged Hours cell is colour-coded so a manager can spot trouble at
a glance. A small legend sits in the chips row:

- 🔴 **Red — Over estimate**: logged exceeded the task's estimate
  (`ewr-over-estimate`, `#EF4444`). Over-estimate task rows are also
  tinted with a red left-accent.
- 🟠 **Amber — Over planned**: logged exceeded the employee's own plan
  (`ewr-over-planned`, `#F59E0B`).

### Other UI behaviours

- **Totals footer** sums Logged / Planned / Estimate across the
  visible rows.
- **Sorting** is client-side — click the Employee / Logged / Planned /
  Estimate headers to sort asc/desc.
- **Hide empty users** toggle: when on, employees with no activity in
  the current filter are removed; when off they're shown but
  de-emphasised.
- **Task name click** opens the existing **TaskDetail** sidebar
  (same pattern as `QueueListComponent`).
- **Normal arrow cursor** across the card; only genuinely interactive
  elements (sort headers, chevron, clickable rows, task links) use a
  pointer.
- **Auto-refresh** every 60s, paused while the browser tab is hidden,
  and an immediate refresh when the tab regains focus. Also re-fetches
  whenever the card config changes.

---

## Card configuration options (7 fields)

All defined as standard field entries in
`utils/cardComponent.json` → entry `key: "EmployeeWorkloadReportCard"`
(`cardType: "workload"`). The edit panel auto-renders inputs from the
shared `CardFieldComponent.vue` using its convention `label` values —
**no custom modal**.

| # | Field `label` | `name` | Type | Default | Controls |
|---|---|---|---|---|---|
| 1 | `card_name` | `fieldName` | text | "Employee Workload & Activity Report" | Card title (required, 3–100 chars) |
| 2 | `location` | `projectId` | dropdown (multi) | `[]` (all) | Project filter |
| 3 | `show_assignees` | `AssigneeUserId` | dropdown (multi) | `[]` (all visible) | Employee **and team** filter |
| 4 | `status` | `statusArray` | dropdown (multi) | `[]` (all) | Task-status filter |
| 5 | `timerange` | `timerange` | dropdown | `3` (this_week) | Time period — see options below |
| 6 | `include_subtasks` | `isParentTask` | radio/toggle | `true` | Include subtasks |
| 7 | `hide_empty_users` | `hideEmptyEmployees` | radio/toggle | `false` | Hide employees with no activity |

**`timerange` options:** `1` today · `2` yesterday · `3` this_week ·
`4` last_week · `5` this_month · `6` last_month · `7` last_30_days.
The widget resolves the chosen id to a `dateFrom`/`dateTo` window
before calling the backend.

> The `add_filter` advanced-filter field was **removed** from this
> card, and the filter section is suppressed for it in
> `CardFieldComponent.vue`.

---

## Team-based assignee filtering

The "Show Assignees" picker can select **teams**, stored as
`tId_<teamId>`. Two safeguards make this work:

1. **Frontend resolution** — `fetchReport()` runs the selection
   through `teamIdToUserId(selection, teams)` (from
   `@/composable/commonFunction`), expanding each `tId_*` into that
   team's member user-ids before posting `employeeIds`.
2. **Empty teams hidden** — `CardFieldComponent.vue`'s `teams`
   computed filters out teams whose `assigneeUsersArray` is empty, so
   a memberless team never appears as an option.
3. **Backend guard** — the controller keeps only valid Mongo
   ObjectId strings (`mongoose.Types.ObjectId.isValid`) before casting,
   so an unresolved `tId_*` string can never crash the query.

---

## Role-based data access (enforced server-side)

Visibility is computed in the endpoint from `callerRoleType` /
`callerUserId` that the widget sends, regardless of the filter:

| `callerRoleType` | Sees |
|---|---|
| `1` Admin / Owner | All active company employees |
| `2` Manager / Lead | Employees on projects they lead (`LeadUserId`) + self |
| else | Only themselves |

The user's `employeeIds` filter is intersected with this visible set —
a lower-role user cannot pull a higher-role user's data via a direct
API call.

---

## How it works (data flow)

```
cardComponent.json  →  per-user card config  →  widget reads config
        (defaults)        (userDashboard)            (cardData prop)
                                                          │
                              resolveDateRange(timerange) │ teamIdToUserId()
                                                          ▼
                       POST /api/v1/dashboard/employee-workload
                                                          │
            estimated_time.Date (planned)  +  timesheets.LogStartTime (logged)
                       union task ids → fetch tasks (project/status/subtask filters)
                                                          ▼
                       per-employee rows + per-task rows + totals
                                                          ▼
                                  widget renders the table
```

---

## Backend endpoint

`POST /api/v1/dashboard/employee-workload`
→ `Modules/UserDashboard/controller.js` → `getEmployeeWorkloadReport`
(route in `Modules/UserDashboard/routes.js`).

**Inputs** (accepts both convention names and early-draft names):
- `AssigneeUserId[]` / `employeeIds[]` (sanitised to valid ObjectIds)
- `projectId[]` / `projectIds[]`
- `dateFrom`, `dateTo`
- `statusArray[]` / `statusKey[]` / `statusKeys[]`
- `isParentTask` (include subtasks)
- `taskType` (`all` / `learning` / `actual` / `unknown`)
- `callerUserId`, `callerRoleType`

**Pipeline:**
1. Resolve role-based visible employee set.
2. Apply the `employeeIds` filter (intersected with visibility).
3. Fetch candidate employees from `users` (active, in company).
4. `plannedByUserTask` — sum `estimated_time.EstimatedTime` by
   `userId|taskId` where `Date` is in range.
5. `loggedByUserTask` — sum `timesheets.LogTimeDuration` by
   `Loggeduser|TicketID` where `LogStartTime` is in range.
6. Union the task ids; fetch those tasks honouring project / status /
   subtask filters → `taskMap`.
7. Build per-employee rows: `loggedMinutes`, `plannedMinutes`,
   `commonEstimateMinutes` (= `task.totalEstimatedTime`),
   `projectCount`, `overdueCount`, and a `tasks[]` array (each task
   carries `sprintId`, `loggedMinutes`, `plannedMinutes`,
   `commonEstimateMinutes`, `aiTaskCategory`, `overdue`).

**Hard filters (security):** `tasks.deletedStatusKey === 0`,
`projects.deletedStatusKey === 0`, `users.isActive === true` and
`AssignCompany` includes companyId, plus role visibility.

> The returned `aiTaskCategory` (Learning / Actual / Unknown) is still
> produced by `Modules/EstimatedTime/aiTaskCategory.js` and included in
> the payload, but the current UI does **not** render category pills.
> `Modules/EstimatedTime/aiWorkloadSummary.js` exists but is **unused**
> (the summary banner was dropped).

---

## Production schema reference

### `users`
`_id`, `Employee_Name`, `Employee_FName`, `Employee_LName`,
`Employee_profileImage`, `isActive`, `isOnline`, `AssignCompany[]`

### `projects`
`_id`, `ProjectName`, `AssigneeUserId[]`, `LeadUserId[]`,
`deletedStatusKey`, `sprintsObj`, …

### `tasks`
`_id`, `TaskName`, `TaskKey`, `AssigneeUserId[]`, `status`,
`statusKey`, `DueDate`, `ProjectID`, `sprintArray`,
`totalEstimatedTime`, `subTasks`, `deletedStatusKey`,
`aiTaskCategory`, `aiTaskCategoryManual`.

### `timesheets`
`_id`, `Loggeduser`, `ProjectId`, `TicketID` (joins to task `_id`),
`LogStartTime` (unix sec), `LogEndTime` (unix sec),
`LogTimeDuration` (minutes), `logAddType` (1=manual, 2=tracker).

### `estimated_time`
`UserId`, `TaskId`, `ProjectId`, `EstimatedTime` (minutes), `Date`.
Per-user-per-task planned time.

---

## Files

**New:**
- `frontend/src/components/organisms/EmployeeWorkloadReportCard/EmployeeWorkloadReportCard.vue`
- `frontend/src/components/organisms/EmployeeWorkloadReportCard/style.css`
- `Modules/EstimatedTime/aiTaskCategory.js` (classifier — output returned, not surfaced)
- `Modules/EstimatedTime/aiWorkloadSummary.js` (present but unused)

**Modified:**
- `Modules/UserDashboard/controller.js` — `getEmployeeWorkloadReport`
- `Modules/UserDashboard/routes.js` — route registration
- `utils/cardComponent.json` — card catalog entry (7 fields)
- `frontend/src/plugins/dashboard/views/HomePage.vue` — `getComponent()` case
- `frontend/src/composable/commonFunction.js` — default grid size case
- `frontend/src/components/molecules/CardFieldComponent/CardFieldComponent.vue` — suppress advanced filter for this card; hide empty teams from `show_assignees`
- `frontend/src/locales/en.js` — dashboardCard i18n keys

**Not touched:** Tasks, Sprints, Projects modules, existing chart
components, existing widgets, existing AI estimator.

---

## Operational notes

- The card catalog is cached in `myCache` for 24h — **restart the
  backend** after editing `cardComponent.json`.
- A card instance saved with old config persists — **remove and re-add**
  the card to pick up field changes.
- Default grid size (`commonFunction.js`): minW 6, maxW 12, minH 10,
  maxH 22.
- Auto-refresh interval: `AUTO_REFRESH_SECONDS = 300` in the widget.

---

**Document version:** 3.0 (as-built)
**Updated:** 2026-05-27

**v3.0 — rewritten to match shipped implementation:**
- Final columns: Employee · Project · Logged · Planned · Estimate
- Period pivots on `estimated_time.Date` + `timesheets.LogStartTime`
  (not created/due date); multi-assignee aware
- Config trimmed to **7 fields**; advanced filter removed
- Added over-budget red/amber highlighting + legend, totals footer,
  client-side column sorting, hide-empty-users toggle, task-name →
  TaskDetail sidebar, normal arrow cursor
- Added team→user resolution, empty-team hiding, ObjectId guard
- Dropped from scope: AI summary banner, workload bar chart,
  Learning/Actual pie chart, activity (active/idle/overloaded) badges
  & thresholds, sort/advanced-filter config fields
- `aiTaskCategory` still returned (not surfaced); `aiWorkloadSummary`
  now unused
