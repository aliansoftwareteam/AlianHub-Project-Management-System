# Progress: Reusable template-selection form component

## Checklist
- [x] Build `TemplateSelectForm.vue` shell: desktop two-column layout + left Templates picker UI, reusing existing class names.
- [x] Add the mobile two-sub-step flow (template select → list) with active-template header + Back, gated on `$clientWidth <= 767`.
- [x] Expose the right column as a slot; define props + emits contract.
- [x] Refactor `ProjectTaskTypeForm.vue` to a wrapper on the shell (screenshot target).
- [x] Refactor `ProjectStatusForm.vue` to a wrapper.
- [x] Refactor `TaskStatusForm.vue` to a wrapper.
- [x] No new i18n keys needed — Back is an inline SVG chevron; delete-confirm reuses existing `Templates.delete_template*` keys.
- [ ] Verify desktop unchanged + mobile stepper across wizard, settings sidebar, create-template (build + in-app).

## Last step
All three wrappers + shell written, lint + build clean. Then addressed mobile-layout feedback on the status step: nav wasn't sticky and the card had dead white space below it.

## Follow-up feedback (mobile fill + sticky nav)
- Existing `wizard-tt-fill` (in CreateProjectSidebar) already pins Prev/Next + fills height, but was gated to `activeIndex === 3` (task-type) and its **mobile** rules assumed the old *stacked* columns — which my stepper replaced, so it would even leave the task-type template sub-step with dead space.
- Added a `wizard-step-fill` class on steps 3/4/5 (`!isDisplayTemplate`) and rewrote the **mobile** fill block to suit the stepper: outer flex-column chain pins `.conditional-btn-wrapper` at the bottom; whichever single column is visible (`.taskStatusLeft`/`.taskStatusRight`) fills the remaining height and scrolls; left templates list grows to fill. Desktop `wizard-tt-fill` (step-3 only) left untouched.
- **Fix after 2nd screenshot round** (gaps above header + below list, list clipping, header scrolling away): the culprit was the always-rendered empty `.usetemplatesWrapper` — it *also* carries `.statusTaskWrapper`, so my unscoped `flex:1` stretched it and it split the height 50/50 with the step container (the existing desktop rule already warns about this at line ~1000). Scoped the row-fill rule to `#project-step-container .statusTaskWrapper`, set `.usetemplatesWrapper { flex:none }`, and carried over the rule that lifts the task-type list's 220px cap so it fills+scrolls instead of clipping. Gray step header stays put because the scroll now lives in the column/section below it.

### 2026-08-14 (cont.) — desktop status fill + drag handle
- Task-status drag: made `DragDropField` drag by the icon only for the non-task_type (status) case — `handle` is `.drag-image-wrapper` (was `null` = whole row), with `touch-action:none` for touch drag. Mirrors the task-type grip. Only `TaskStatusForm` consumes the non-task_type path.
- Desktop status fill: the desktop `wizard-tt-fill` was gated to `activeIndex===3` (task-type), so the status steps had dead space below Prev/Next on desktop. Added `wizard-status-fill` (activeIndex 4/5).
  - v1 used the section as a shared scroll — but feedback: (a) templates list showed a gap before "+ New Template" (it was `flex:1 0 auto`, growing), (b) left+right shared one scroll. Reworked to match the task-type step: section `overflow:hidden` (no shared scroll); left `.templated_name_ul` is `flex:0 1 auto` (content-height → no gap, +New right after) with its own overflow when long; right column `.taskStatusRight` has its own `overflow-y:auto` (overrides project-status's 308px cap). Each column now scrolls independently.

### 2026-08-14 (cont.) — project-status drag + mobile status fill
- Project-status uses native `draggable` (not DragDropField), so it hadn't gotten the drag-by-icon change: added `handle=".drag-image-wrapper"` to its active + done draggables and `touch-action:none` on the icon. Its default rows have no drag icon (v-if default) so they stay non-draggable (consistent with checkMove).
- ROOT CAUSE (found on the 2nd project-status report): ProjectStatusForm's OWN scoped CSS caps `.taskStatusRight` at `max-height:300px` on mobile (a leftover `:deep` rule from the pre-fill layout) — that 300px box, not a fill failure, was the empty gap. Task-status has no such cap, which is why it filled and project-status didn't. Fix: `.wizard-step-fill .taskStatusRight { max-height:none !important; overflow:visible !important }` on mobile so the column fills the step and the section scrolls (desktop `wizard-status-fill` already had this override). Reverted the earlier `.tsf-fill-list` flex-grow (it just relocated the emptiness into the list and pushed +Add/Done/Close out of view) — kept the drag-by-icon handle on project-status.
- ~~Mobile status fill: tagged each status form's ACTIVE list with `.tsf-fill-list`~~ (superseded — the grow approach was wrong; see above) (project-status active `.status_ul`; task-status active DragDropField `.ddf__root` via class fallthrough) and added `.wizard-step-fill .tsf-fill-list { flex: 1 0 auto }` so the active list grows to fill the column on mobile (mirrors task-type's single list) instead of clumping at the top with a gap above Prev/Next. Status add button pinned (`flex:none`).

### 2026-08-14 (cont.) — flex-wrap fix
- After the cap fix, a long project-status list wrapped sideways (title beside the list). Cause: `style.css` `@media(max-width:480px){ .statusTaskWrapper{flex-wrap:wrap} }` applies to the fill root/shell (both `.statusTaskWrapper`), so tall flex-column content wraps into a 2nd column. Fix: `flex-wrap: nowrap` on the `wizard-step-fill` flex containers so tall content scrolls in the section instead of wrapping.

### 2026-08-14 (cont.) — switch mobile to list-scroll
- Feedback: only the status LIST should scroll, not the whole section (the section-scroll carried "+ Add Status" and labels off). Switched the mobile fill from section-scroll to list-scroll: section + columns are `overflow:hidden` (fixed), and the active list is the bounded scroll area — task-type via `.taskyou_need_right .status_ul{flex:1;overflow-y:auto}`, status forms via `.tsf-fill-list{flex:1;overflow-y:auto}` (re-added to each active list), templates via `.templated_name_ul{flex:1;overflow-y:auto}`. Labels / sub-header / +Add / +New stay pinned (flex:none / content-height). Removed the transparent `.tsf-list-scroll` wrapper so the list is a direct flex child (no display:contents indirection).

### 2026-08-14 (cont.) — back to section-scroll (match task-status)
- User: list-scroll was wrong; make project-status scroll like task-status. Both status forms should be identical — the only real difference was project-status's scoped `:deep(.taskStatusRight){max-height:300px}` cap. Reverted mobile to section-scroll (section `overflow-y:auto`, columns `overflow:visible`, cap overridden with `max-height:none !important`, `flex-wrap:nowrap`), removed the list-scroll grow/flex rules. `.tsf-fill-list` classes on the forms are now inert no-ops (left in place). Sub-header stays pinned via its existing `position:sticky`.

### 2026-08-14 (cont.) — rebuild ProjectStatusForm on the task-status structure
- User: replace the project-status form with the task-status structure, wire actions to project methods. Decision: keep the default ('Open') inside the active list.
- Rewrote ProjectStatusForm's right column to mirror TaskStatusForm: `DragDropField` for active + done lists (drag-by-icon, color swatch, delete), close status as a fixed row; rightClass now `status_right status_new_right` (same as task-status). Wired DragDropField events to project methods: `@change:DraggableOption`→`updateItem`, `@input:deleteFieldValue`→`deleteProjectStatus`, add/remove via `TaskStatusSidebar`→`updateTaskStatus`/`removeTaskStatus`; template CRUD unchanged (project store/API). Added `markTemplateDirty` helper + `onStatusEdit`.
- Removed project-specific scoped CSS incl. the `:deep(.taskStatusRight){max-height:300px}` cap and the `overflow:unset` root rule — the caps were the divergence from task-status; project-status now inherits task-status behaviour (color input stays display-only/disabled, so no bgColor/backgroundColor issue). Default 'Open' shows in the active DragDropField, non-draggable via checkMove.

### 2026-08-14 (cont.) — pin project-status header (match task-status wrapping)
- Symptom: project-status scrolled its header/title with the list; task-type/task-status keep the header fixed. Cause: task-type/task-status wrap the shell in a separate scroll section (`statusHeader > title + .taskStatusSection.style-scroll > shell`), so the title is OUTSIDE the scroll; project-status made its root both header and scroll container. Fixed by giving project-status the same structure: root `statusHeader`, title fixed, shell inside `<div class="taskStatusSection style-scroll">`. Now identical to task-status.

## Blockers
- Browser MCP (Claude in Chrome) has been disconnected the whole mobile-polish phase, so all mobile-layout fixes are being made blind (reasoning from the DOM/CSS) and verified only by the user's screenshots + `npm run build`. This is causing multiple round-trips. Reconnecting the extension would let these be verified/iterated directly.

### 2026-08-14 (cont.)
- Status step feedback: (1) the `‹ template-name` sub-header scrolled with the list; (2) short status lists leave dead space down to the nav. First pass used `position: sticky` for (1); superseded below.
- New feedback + decision: (a) show "Save Template" in the list sub-step header (users editing the list on step 2 didn't realise they must save it back into the template); (b) the status list should cover full height to the nav.
- First tried moving the scroll into a `.tsf-list-scroll` wrapper (flex:1) inside the right column — but that deeper flex chain didn't bound reliably and the task-list scroll regressed (clipped again).
- Final model = the PROVEN section-scroll: `.wizard-step-fill .taskStatusSection` is the single scroll area (`overflow-y:auto`, bounded by the same flex:1 chain that pins the footer). Lists uncapped + `flex:1 0 auto` (fill short, overflow long into the section scroll). The shell's `.tsf-substep-header` is `position: sticky; top:0` so Back / template name / Save Template pin at the top of that scroll; `.tsf-list-scroll` is just a transparent (`display:contents`) grouping wrapper so the sub-header is a sibling of the slot. Save Template button shows when the active template row is dirty (`isShowSave`) and emits the existing `save`. Kept the shell/wizard split minimal: wizard owns the section scroll + column flex + list fill (global rules reach form/slot elements); shell owns the sub-header + save button (its own elements).

### 2026-08-14 (cont.)
- 3rd/4th screenshot round: on a long list the "+ Add" button was clipped and nothing scrolled. My own `overflow:hidden !important` on the section was the culprit — it clipped everything below the fold instead of scrolling. Sidebar CSS confirms `.sidebar-body` has a definite height (`calc(100% - 47px)`), so the flex chain IS bounded and `.taskStatusSection` is the natural scroll container. Final model: `.taskStatusSection` = the single scroll area (`overflow-y:auto !important`); step header + Prev/Next stay pinned outside it; lists uncapped + `flex:1 0 auto` (grow to fill a short column, never shrink) so short lists fill and long lists overflow into the section scroll. No nested scrollbars.

## Log

### 2026-08-14
- Task created. Confirmed forks with user: refactor all three forms; existing forms stay as smart-wrappers owning CRUD; mobile sub-steps independent of wizard Previous/Next.
- Built `TemplateSelectForm.vue` shell (left picker UI + mobile stepper + `#list` slot; emits select/create/rename/delete/save/left-focus; owns list-based name validation so it stays store-agnostic).
- Refactored all three forms to thin wrappers keeping their store/API/CRUD; public props/emits unchanged so parents need no edits.
- Key findings: `DragDropField` never emits `renameUpdate` (dead handler, dropped); `ProjectStatusForm` referenced an undefined `manageSelectedOption` in a dead `isEditable` branch (kept as-is for fidelity); `inputColor` similarly undefined-but-referenced in task-status (disabled color inputs never fire it).
- CSS: globalized shared `style.css` from the shell (unscoped) so left column + slotted right column match across scope ids; converted the two per-form right-column scroll rules (`taskyou_need_right .status_ul`, `.taskStatusRight` bounds) to global / `:deep()` so they still match the shell-rendered container.
- Minor normalization: project-status "Save Templates" → "Save Template"; task-type/project-status delete-confirm now use i18n keys (were hardcoded English).
