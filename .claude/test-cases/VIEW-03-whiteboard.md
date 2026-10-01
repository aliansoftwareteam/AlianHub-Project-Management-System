# Test Cases — VIEW-03 Whiteboard view (AHE-3744)

A first-class **project view** (keyName `WhiteboardView`) showing tasks as freely
draggable cards on a gridded board. Positions are saved **on the server**, one board
per list (project + sprint), shared by everyone who can open the list (task 046 A3,
`Modules/Whiteboards`). Reads the same live Vuex task store.

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
| M4 | Persistence | move cards, reload the view, open it in another browser | positions restored from the server; indicator shows Saving… then Saved |
| M4a | Two people | both open the list, each moves a different card | both moves are kept; the other person's card moves without a reload |
| M4b | Offline | go offline, move a card, come back | "Offline: changes kept on this device", then saved on reconnect |
| M4c | Board from an earlier build | a browser that holds `wb:<project>:<sprint>` and a list with no server board | the old layout is shown with "Save this board to the workspace"; nothing is uploaded until pressed |
| M4d | History | History → Restore on an earlier state | the board returns to that state as a new revision |
| M5 | Auto-arrange | click "Auto-arrange" | cards snap back to a tidy grid; saved |
| M6 | New task | add a task elsewhere | appears as a new card (default grid slot) |
| M7 | Empty | no tasks | friendly empty-state |
| M8 | Scroll | many cards / dragged far | board scrolls; drag accounts for scroll offset |

## Guards / non-regression
- Does **not** mutate task data — only card positions, stored in the `whiteboards` collection. A card holds a task id and a place, never the task's name.
- A board is read by whoever can open its list and changed under the rule a project's docs and forms use; anyone else gets 404.
- Lightweight: custom pointer-drag (no external lib); global mousemove/up listeners cleaned up on unmount.
- Reuses the GanttView data harness; deleted tasks excluded.
- Additive: new view + registration only.

## Follow-up
Free-form elements (notes, shapes, images), live cursors, and carrying a board when a project is duplicated.
