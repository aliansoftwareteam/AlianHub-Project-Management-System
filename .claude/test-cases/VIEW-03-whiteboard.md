# Test Cases — VIEW-03 Whiteboard view (AHE-3744)

A first-class **project view** (keyName `WhiteboardView`) showing tasks as freely
draggable cards on a gridded board. Positions persist **per user** via localStorage
(keyed by project+sprint) as the v1; shared/server-persisted positions are a noted
follow-up. Reads the same live Vuex task store.

**Registration:** WhiteboardView.vue · Projects.vue (`getView` + 3 full-width layout conditions) ·
commonFunction `projectComponentsIcons` (reuses `comp_board_*`) · ViewsDropdown `images` ·
en.js `ViewList.WhiteboardView` + `ViewList["Whiteboard View"]` (catalog name) + `ViewListdescription.whiteboard_view` ·
utils/data.js seed (keyName `WhiteboardView`, sortIndex 14). Existing companies need the catalog DB record added.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | View appears | add catalog record → "+ View" | "Whiteboard" listed; label resolves (not raw key) |
| M2 | Cards render | open Whiteboard | each task is a card on the board, auto-laid in a grid; status colour on the left edge |
| M3 | Drag | drag a card | it follows the cursor; drops where released |
| M4 | Persistence | move cards, reload the view | positions restored (localStorage, same browser/user) |
| M5 | Auto-arrange | click "Auto-arrange" | cards snap back to a tidy grid; saved |
| M6 | New task | add a task elsewhere | appears as a new card (default grid slot) |
| M7 | Empty | no tasks | friendly empty-state |
| M8 | Scroll | many cards / dragged far | board scrolls; drag accounts for scroll offset |

## Guards / non-regression
- Does **not** mutate task data — only card positions, stored client-side (localStorage). No backend, no schema, no new collection.
- Lightweight: custom pointer-drag (no external lib); global mousemove/up listeners cleaned up on unmount.
- Reuses the GanttView data harness; deleted tasks excluded.
- Additive: new view + registration only.

## Follow-up
Shared/server-persisted positions (a per-project board layout) so arrangements are the same for everyone — deferred to keep this view lightweight + backend-free.
