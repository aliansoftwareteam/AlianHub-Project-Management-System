# Progress: Fix task-type settings UI

## Checklist
- [x] P6 — Six-dot drag handle on task-type cards; drag only via handle (mobile body scroll)
- [x] P1 — Harden `.tticon` to inline-flex + narrow `DragDropField` `.taskStatusRight ul li span` selector
- [ ] P1 — Verify boundary box unaffected in task list / kanban / dropdowns (visual check)
- [x] P2 — Bound the right task-type list height so "+ Add task type" stays visible
- [x] P3 — Sidebar audit approved (all three)
- [x] P3 — Implement approved sidebar fixes (flex-column body, icon-picker overflow, mr-10px typo)
- [ ] Visual verification in-app, then commit

## Last step
P1–P5 done + verified live. Real app still had a hidden desktop cap
`.taskStatusSection.style-scroll{max-height:307px}` (style.css:485) that stopped the lists
short with a big empty gap. Added `max-height:none !important` on the settings section to
override it. Verified in a faithful repro served from the app's own dev server (localhost:8080,
JS-measured): right list clientH 456 (fills), scrollH 592 (scrolls), both buttons bottom 678 ≤
sidebar 716 (not clipped). Ready to commit P1–P5 on the current branch.

P6: added `drag_dots.svg` (2x3 grip) as `.drag-handle` at the start of each task-type card
(replacing the hidden absolute 8-dot Swip icon there). Set vuedraggable `:handle=".drag-handle"`
for `from==='task_type'` so only the grip starts a drag — card body drag is a no-op, so mobile
users scroll the list by dragging the body (`touch-action:none` only on the grip). Scoped to
task_type; status/project-status lists keep whole-card drag. Needs real touch-device verification.

## Blockers
None.

## Log

### 2026-08-14
- Task created.
- Investigated `ProjectTaskTypeForm.vue`, `DragDropField.vue`, `TaskStatusSidebar.vue`
  and both stylesheets.
- Root-caused P1 to the boundary-box commit `7d00a49`: `.tticon` (new child root span)
  inherits `DragDropField`'s broad `span { display:flex }` scoped rule.
- Confirmed P2: left Templates list already scrolls (`.templated_name_ul`, max-height
  140px); right task-type list has no height bound.
- P1: hardened `.tticon` to `inline-flex !important` (TaskTypeIcon.vue) and narrowed the
  broad `.taskStatusRight ul li span` selector to `.taskInnerData` (DragDropField.vue).
- P2: bounded `.taskyou_need_right :deep(.status_ul)` to `max-height:220px; overflow-y:auto`
  in ProjectTaskTypeForm.vue.
- P3 approved (all three). Restructured `TaskStatusSidebar` body into a flex column
  (`.tts__body`): search/add-form/icon-picker are natural height, `.sidebar-options` is
  `flex:1; min-height:0` and scrolls. Removed the hardcoded `calc(100% - 70/90px)` inline
  height (which ignored the icon picker). Fixed `mr-10-px` → `mr-10px` (verified the util
  exists in margin.css).
- P4 (follow-up): settings panel left a white gap below the form. `.createProjectWizardSlider`
  is shared with the create-project wizard + template pages and this `<style>` is global, so
  added dedicated `.pss__setting-body` / `.pss__setting-panel` classes in ProjectSettingSidebar
  and made the body a flex column with the panel `flex:1` — fills height only in the settings
  sidebar.
- P5 (/goal: both lists use full available height dynamically): built the flex chain under
  `@media(min-width:768px)` scoped to `.pss__setting-panel` — panel → `.statusHeader` →
  `.taskStatusSection` → `.statusTaskWrapper` → each column → each list. Left `.templated_name_ul`
  and right `.status_ul` are now `flex:1; max-height:none` (overrides the 140px/220px caps in
  the settings context only) with `min-height:0` up the chain so they scroll. Added `.ddf__root`
  class to DragDropField's (previously unclassed) root so the right list's flex parent exists.
  Add button stays pinned below the grown right list. Wizard/template pages and mobile untouched.
- P5 verify/fix: first real-app render overflowed (right list grew past viewport, clipped the
  add button) — the chain wasn't bounding because the section (style-scroll) let content
  overflow. Fix (verified in repro, user-confirmed): `overflow:hidden` on `.taskStatusSection`
  (load-bearing — forces the min-height:0 chain to bound so lists scroll), `flex:none` on
  `.add_template` and `.addStatusBtn` (buttons never clipped/shrunk), plus spacing
  (`.bg-light-gray` margin-bottom 16px, add-button padding-top 12px).




