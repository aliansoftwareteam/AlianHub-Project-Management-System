# Test Cases — VIEW-01 Timeline view (AHE-3742)

A first-class **project view** (keyName `TimelineView`) that plots tasks with a
start + due date as bars on a shared date axis. Read-only, lightweight (no external
library), reads from the same live Vuex task store the List/Gantt views use (so
socket updates flow in automatically).

**Registration (6 spots):** TimelineView.vue · Projects.vue (`getView` + 3 full-width
layout conditions) · commonFunction `projectComponentsIcons` (reuses `comp_timeline_*` icons) ·
ViewsDropdown `images` · en.js `ViewList.TimelineView` + `ViewListdescription.timeline_view` ·
utils/data.js new-company seed (keyName `TimelineView`, sortIndex 12).

> **Catalog note:** added to the new-company seed; for EXISTING companies a `PROJECT_TAB_COMPONENTS`
> record (`{keyName:'TimelineView', name, sortIndex, viewStatus:true}`) must be added + the
> `ProjectTabs:<companyId>` cache cleared (per the maintained-catalog process). keyName is
> `TimelineView` (not `Timeline`, which the catalog hard-filters).

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | View appears | Add the catalog record → open a project → "+ View" | "Timeline" is listed with its icon/preview |
| M2 | Bars render | Open Timeline on a project with dated tasks | Tasks with start+due show as bars positioned on the date axis; month ticks across the top |
| M3 | Status colour | tasks of different statuses | bars coloured: To Do (grey), In Progress (blue), Done (green) |
| M4 | Unscheduled tray | tasks without start/due | listed in the "Unscheduled" side tray, not on the axis |
| M5 | Empty | project with no dated tasks | friendly empty-state message |
| M6 | Live sync | change a task's dates in another view | Timeline reflects it (shared store) |
| M7 | Single-day task | start == due | bar still visible (min width + 1-day axis pad) |
| M8 | Sort | — | rows ordered by start date |

## Guards / non-regression
- **Read-only** — no writes, no drag, no persistence; purely a visualization. Can't affect task data.
- **No external dependency** (unlike Gantt's dhtmlx) — pure CSS/computed; works offline.
- Reuses the proven GanttView data harness (`pickTasks` from the store + `ensureTasksLoaded` via `taskListHelper.groupBy`) so a direct reload into the tab still loads tasks.
- Additive: a new view + registration only; no existing view, route, or schema changed. `deletedStatusKey ∈ [0,2]` (active/archived) tasks shown, deleted excluded — consistent with other views.
