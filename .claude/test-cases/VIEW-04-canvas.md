# Test Cases — VIEW-04 Canvas / dynamic layouts (AHE-3745)

A first-class **project view** (keyName `CanvasView`): a configurable mini-dashboard
of project insight widgets (Summary, By status, By priority, Overdue, Upcoming),
computed live from the task store. Which widgets show is toggleable + persisted per
user (localStorage). Lightweight, no external lib.

**Registration:** CanvasView.vue · Projects.vue (`getView` + 3 layout conditions) ·
commonFunction `projectComponentsIcons` · ViewsDropdown `images` · en.js `ViewList.CanvasView` +
`ViewList["Canvas View"]` + `ViewListdescription.canvas_view` · utils/data.js seed (keyName `CanvasView`, sortIndex 15).
Existing companies need the catalog DB record added.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | View appears | add catalog record → "+ View" | "Canvas" listed; label resolves |
| M2 | Widgets render | open Canvas | Summary (total + % complete), By status, By priority bars, Overdue count, Upcoming list — all from live tasks |
| M3 | Completion % | mark tasks done | Summary % + Done bar update |
| M4 | Overdue | task past due & open | counted in Overdue (red if > 0) |
| M5 | Upcoming | task due within 7 days & open | listed (date-sorted, top 6) |
| M6 | Toggle widget | click a chip off/on | widget hides/shows; choice persists on reload (localStorage) |
| M7 | Empty | no tasks | friendly empty-state |
| M8 | Live sync | change tasks elsewhere | widgets recompute |

## Guards / non-regression
- Read-only — derives stats from the store; no writes, no schema, no backend, no new collection. Widget on/off stored client-side.
- Reuses the GanttView data harness; deleted tasks excluded; done = status type 'close'.
- Additive: new view + registration only.
