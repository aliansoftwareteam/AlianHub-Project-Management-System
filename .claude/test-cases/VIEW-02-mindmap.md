# Test Cases — VIEW-02 Mind Map view (AHE-3743)

A first-class **project view** (keyName `MindMapView`) rendering the project →
parent-task → subtask hierarchy as an SVG node tree. Read-only, lightweight (no
external lib), reads the same live Vuex task store as the other views.

**Registration:** MindMapView.vue · Projects.vue (`getView` + 3 full-width layout conditions) ·
commonFunction `projectComponentsIcons` · ViewsDropdown `images` · en.js `ViewList.MindMapView` +
`ViewListdescription.mindmap_view` · utils/data.js seed (keyName `MindMapView`, sortIndex 13).
Existing companies need the `PROJECT_TAB_COMPONENTS` catalog record added (maintained-catalog process).

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | View appears | add catalog record → "+ View" | "Mind Map" listed with icon/preview |
| M2 | Tree renders | open Mind Map | Root = project name; parent tasks branch from it; subtasks branch from their parent; curved connectors |
| M3 | Status colour | mixed statuses | node borders/text reflect To Do / In Progress (blue) / Done (green); root filled navy |
| M4 | Subtask nesting | task with subtasks | subtasks appear as 3rd-level nodes off their parent |
| M5 | Empty | project with no tasks | friendly empty-state |
| M6 | Live sync | add/rename a task elsewhere | mind map reflects it (shared store) |
| M7 | Long names | task name > 24 chars | truncated with ellipsis in the node |
| M8 | Scroll | large project | SVG scrolls within the panel (width/height grow with the tree) |

## Guards / non-regression
- Read-only visualization — no writes, no persistence.
- No external dependency — pure SVG + a bottom-up tidy-tree layout (leaves placed sequentially, parents centered on their children).
- Reuses the GanttView data harness (`pickTasks` + `ensureTasksLoaded`); deleted tasks excluded (`deletedStatusKey ∈ [0,2]`).
- Additive: new view + registration only; nothing existing changed.
