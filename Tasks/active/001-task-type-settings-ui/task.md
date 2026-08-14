---
id: 001
title: Fix task-type settings UI (overlap, sticky add, sidebar audit)
status: active
priority: medium
depends_on: []
created: 2026-08-14
---

# Fix task-type settings UI (overlap, sticky add, sidebar audit)

## Goal
The task-type section in project create/edit has layout problems: the type icon
overlaps its label, and when the type list is long the "+ Add task type" button is
pushed out of view. Fix the layout so rows render cleanly and the add control is
always reachable, and audit the task-type sidebar for structural fixes.

## Scope
- **P1 — Row overlap (regression):** `TaskTypeIcon`'s root is now `<span class="tticon">`.
  Via Vue scoped styling, a child component's root inherits the parent's scope, so
  `DragDropField`'s broad rule `.taskStatusRight ul li span { display:flex }`
  (`DragDropField.vue`) flips `.tticon` to block-level and wraps the label onto its
  own line. Fix at the source: narrow that selector to `.taskInnerData`, and harden
  `.tticon` to `inline-flex` so no ancestor `span{}` rule can break it again.
- **P2 — Sticky add / scrollable list:** In `ProjectTaskTypeForm.vue` the right column
  is label → list (`DragDropField`) → add button in one scroll; the right list has no
  height bound. Bound the task-type list height with `overflow-y:auto` (mirroring the
  left `.templated_name_ul`, which already scrolls at max-height 140px) so the
  "+ Add task type" button stays visible below it.
- **P3 — Sidebar structure audit (propose, then implement on approval):** audit
  `TaskStatusSidebar.vue` and list concrete structure fixes (see Audit below).

## Out of scope
- Redesigning the task-type feature, data model, or icon picker.
- Restyling colors/spacing beyond what's needed to fix layout.
- Any backend / API change.

## Acceptance criteria
- [ ] In project create/edit, each task-type row shows the icon and label on one line, no overlap (library icons, uploaded images, and default icon).
- [ ] With a long task-type list, the list scrolls within a bounded area and "+ Add task type" stays visible.
- [ ] The `TaskTypeIcon` boundary box still renders correctly everywhere it's used (task list, kanban, dropdowns) — no regression from the overlap fix.
- [ ] Sidebar audit documented and approved; approved sidebar fixes implemented and the options list fits regardless of add-form / icon-picker being open.

## Sidebar audit (P3) — proposed, pending approval
Findings in `TaskStatusSidebar.vue`:
1. **Fragile height calc.** `.sidebar-options` height is an inline
   `calc(100% - 70px|90px)` ternary that hardcodes the search/add-form offset and
   ignores the icon-picker popover. When the icon picker is open the list can overflow
   the panel. **Fix:** make the body a flex column — search / add-form / icon-picker are
   fixed-height children; the options list is `flex:1; min-height:0; overflow-y:auto`.
   Removes all magic numbers.
2. **Icon-picker popover in flow.** `.tasktype__iconpop` sits between the add-form and
   the list; the flex-column fix above resolves the overflow it causes.
3. **Minor:** `mr-10-px` class on the upload button (`TaskStatusSidebar.vue:25`) looks
   like a typo for `mr-10px` (margin not applied). Verify and fix.

## Constraints & notes
- P1's overlap traces to commit `7d00a49` (the boundary-box + tooltip change). Fixing the
  shared `.tticon` protects all ~47 `TaskTypeIcon` call-sites, not just this screen.
- `DragDropField` is shared (task status, project status). Narrowing its `span` selector
  must not break those lists — verify `.taskInnerData` still gets flex.

## Resources
- Screenshot of the broken modal (provided in chat; not committed).
