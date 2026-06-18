# Gantt / Timeline View — Test Cases

**Location:** Project → `+ View` → Gantt · **Last updated:** 2026-06-18

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky
>
> **Setup:** run `cd frontend && npm install` once (adds `dhtmlx-gantt`); add the **Gantt** view to the project via `+ View`.

---

## Rendering & Scheduling

| ID      | Title                       | Precondition                              | Steps                                                          | Expected Result                                                            | Actual Result | Status |
|---------|-----------------------------|-------------------------------------------|----------------------------------------------------------------|----------------------------------------------------------------------------|---------------|--------|
| GNT_001 | Add the Gantt view          | dhtmlx-gantt installed; project open      | 1. `+ View` → Gantt → Add                                      | Gantt tab appears and opens                                                |               | ⏳     |
| GNT_002 | Bars render                 | Tasks with both a start and a due date    | 1. Open the Gantt tab                                          | Those tasks render as bars on the timeline                                 |               | ⏳     |
| GNT_003 | Drag to reschedule          | A scheduled task                          | 1. Drag a bar to new dates  2. Reload + open List/Table        | Start/due updated and persisted everywhere                                 |               | ⏳     |
| GNT_004 | Resize duration             | A scheduled task                          | 1. Drag a bar's edge                                           | Due date changes and persists                                              |               | ⏳     |
| GNT_005 | Zoom presets                | Gantt open                                | 1. Switch Day / Week / Month                                   | Timeline scale changes accordingly                                         |               | ⏳     |
| GNT_006 | Unscheduled tray → schedule | A task with no start/due dates            | 1. In the Unscheduled tray click **Schedule** on the task      | Task gets today→+1 day and appears as a bar                                |               | ⏳     |
| GNT_007 | Milestones shown            | Project with milestones                   | 1. Open the Gantt                                              | Milestones render as read-only diamond markers                            |               | ⏳     |

---

## Dependencies, Sync & Permissions

| ID      | Title                          | Precondition                                | Steps                                                       | Expected Result                                                          | Actual Result | Status |
|---------|--------------------------------|---------------------------------------------|-------------------------------------------------------------|--------------------------------------------------------------------------|---------------|--------|
| GNT_008 | Draw + delete a dependency     | Two scheduled tasks                         | 1. Drag from one bar's edge to another  2. Then delete the link | A "blocks" relation is created (visible in the task's Linked Tasks — see TaskRelations) then removed |               | ⏳     |
| GNT_009 | Live sync across sessions      | Same project Gantt open in two browsers     | 1. Drag a bar in window 1                                   | Window 2 updates within a couple of seconds without reload               |               | ⏳     |
| GNT_010 | Read-only without edit rights  | User lacking task-edit permission           | 1. Open the Gantt                                          | Read-only (no drag / no link drawing); "View only" badge shown            |               | ⏳     |

---

## Regression (fixes)

| ID      | Title                                   | Precondition                       | Steps                                                                 | Expected Result                                                  | Actual Result | Status |
|---------|-----------------------------------------|------------------------------------|-----------------------------------------------------------------------|------------------------------------------------------------------|---------------|--------|
| GNT_011 | Reload with Gantt as the active view    | Gantt tab is currently active      | 1. Reload the page (do NOT visit another view first)                  | Bars render — Gantt loads the task store itself (no empty chart) |               | ⏳     |
| GNT_012 | Repeated view switching doesn't crash   | —                                  | 1. Switch List → Table → Gantt and back several times                 | No error; Gantt re-renders cleanly each time (no "tasksStore" crash) |               | ⏳     |

---

**Total:** 12 test cases · **All status:** ⏳ Pending
