# Implementation Plan — Task Type Icons via Icon Library

Companion to [PRD-task-type-icon-library.md](./PRD-task-type-icon-library.md). Phases are
ordered by dependency; each is independently shippable behind the "keep both" model
(existing uploaded icons keep working throughout). File refs use the codebase map.

**Guiding constraints**
- `iconType` defaults to `'upload'` → no forced migration, nothing existing breaks.
- One shared `<TaskTypeIcon>` holds the render change → don't edit all ~22 sites up front.
- Offline Option A: lazy-bundle mdi + lucide + tabler; no CDN, no backend icon endpoints.

---

## Phase 0 — Dependencies & offline icon registration

**Goal:** `<Icon icon="mdi:bug">` resolves locally, offline.

1. `frontend/package.json` — add deps:
   - `@iconify/vue`
   - `@iconify-json/mdi`, `@iconify-json/lucide`, `@iconify-json/tabler`
2. New file `frontend/src/utils/iconLibrary.js`:
   - `loadIconSets()` — dynamic-import the 3 `icons.json` and `addCollection(...)` each;
     guard so it runs once; return a shared promise.
   - `CURATED_SETS = ['mdi','lucide','tabler']` (single source of truth for the picker).
   - `searchIcons(query, {limit})` — filter names/aliases across loaded sets, cap results.
   - `DEFAULT_ICON = 'mdi:checkbox-marked-circle-outline'` and a keyword→icon map for AI/fallback.
3. Ensure lazy chunk: import `iconLibrary.js` dynamically from the renderer/picker so the
   ~1.3–1.8 MB collection payload stays out of the initial bundle.

**Verify:** a throwaway view renders `<Icon icon="mdi:bug">` with network throttled to offline.

---

## Phase 1 — Shared renderer `<TaskTypeIcon>`

**Goal:** one component renders all three icon kinds; wiring it makes library icons
appear anywhere the shared task-type components are used (kanban, pickers, most lists).

1. New `frontend/src/components/atom/TaskTypeIcon/TaskTypeIcon.vue`:
   - Prop: the task-type object (`{ iconType, iconValue, iconColor, taskImage }`).
   - Logic:
     ```
     if (iconType === 'library' && iconValue) → <Icon :icon="iconValue" :style="{ color: iconColor || themePrimary }" /> (fallback DEFAULT_ICON on unresolved)
     else if (taskImage?.includes('http'))    → <img :src="taskImage">
     else                                       → <WasabiImage :data="{ url: taskImage }">
     ```
   - On mount, `await loadIconSets()` (only needed for the library branch).
2. Retrofit the two shared renderers to use `<TaskTypeIcon>`:
   - `frontend/src/components/atom/TaskType/TaskType.vue` (lines 7-12, 20-25)
   - `frontend/src/components/atom/TaskTypeSelection/TaskTypeSelection.vue` (lines 7-13, 35-40, 48-54)

**Verify:** manually set a task type's `iconType='library'`/`iconValue` in the store/DB →
icon shows in kanban + pickers; uploaded types still render.

---

## Phase 2 — Icon picker `<IconPicker>`

**Goal:** searchable picker returning an Iconify name + color.

1. New `frontend/src/components/molecules/IconPicker/IconPicker.vue`:
   - `v-model` (iconValue) + `v-model:color` (iconColor).
   - Set filter chips (mdi / lucide / tabler), text search via `searchIcons()`.
   - Results grid rendered with `<Icon>`; **cap/virtualize** (e.g. first 100 matches) —
     15k icons can't all render.
   - Color swatch/input; default = theme primary `#2F3990`.
   - `await loadIconSets()` on open.

**Verify:** open picker offline, search "bug", pick `mdi:bug`, choose a color → emits both.

---

## Phase 3 — Create/edit UI (keep both)

**Goal:** authoring supports Library (default) or Upload.

1. `frontend/src/components/molecules/TaskStatusSidebar/TaskStatusSidebar.vue`
   (upload UI at 24-25, `checkFile` 342-374): add a **Library / Upload** toggle;
   Library → `<IconPicker>`; set `iconType`, `iconValue`, `iconColor`; Upload → existing
   base64 flow sets `iconType='upload'`, `taskImage`.
2. `frontend/src/components/templates/CreateProject/ProjectTaskTypeForm.vue`
   (upload at 71-77, send at 320): same toggle; include the 3 new fields in the payload.
3. Edit-row entry point `frontend/src/components/atom/DragDropField/DragDropField.vue`
   (11-19): open the picker (or upload) on icon click; preview via `<TaskTypeIcon>`.

**Verify:** create a library-icon type and an uploaded type from both UIs; edit each.

---

## Phase 4 — Backend field pass-through + state

**Goal:** persist the 3 new fields in all storage locations (must land before/with Phase 3
so fields aren't stripped).

1. `Modules/settings/templates/settingTaskType/controller.js` — add
   `iconType`, `iconValue`, `iconColor` to `allowedKeys` (~line 31); persist into
   `settings.settings[]` (41-78).
2. `Modules/settings/templates/taskType/controller.js` — confirm `insertTaskTypeTemplate`
   (13-50) / `updateTaskTypeTemplate` (58-103) pass the new fields through `taskTypes[]`
   unchanged (no key stripping).
3. `Modules/createProject/controller.js` — `taskTypeMergedTempArray` (~line 314): carry
   the new fields into the project's `taskTypeCounts[]`.
4. Vuex: `frontend/src/store/Settings/{actions.js,mutations.js}` — include the fields in
   `taskType` / `taskTypeArray` / `projectTaskType` (actions `setTaskType` ~390,
   `setTaskTypeArray` ~685).

**Verify:** round-trip — save from UI, reload, GET `/api/v1/setting/taskType` shows the
fields; create-project-from-template carries them into `taskTypeCounts`.

---

## Phase 5 — AI-generated templates auto-assign

**Goal:** AI-created task types get a curated library icon.

1. `frontend/src/views/Settings/Template/CreateTemplateWithAI.vue` (+ backend AI prompt if
   the type list is generated server-side): post-process each generated task type →
   `iconType='library'`, `iconValue` via keyword map (`bug`→`mdi:bug`,
   `design`→`mdi:palette`, …), fallback `DEFAULT_ICON`; `iconColor` = theme primary.

**Verify:** generate a template via AI → every task type has a resolvable library icon.

---

## Phase 6 — Consolidate inline render sites (cleanup)

**Goal:** remove the duplicated `taskImage.includes('http')` idiom so library icons render
everywhere and there's one code path.

- Replace inline checks with `<TaskTypeIcon>` across the ~22 files, notably:
  `SidebarItems.vue` (30-32, note its `includes('setting')` branch), `SubTaskItem.vue`,
  `TableViewRow.vue`, the filter tables (`TaskFilter/FieldsTable.vue`,
  `TaskFilterAdvance/FieldsTableAdvance.vue`, `AdvanceSearch/MainComponent.vue`,
  `AdvanceFilterTasks.vue`), `ProjectsListingSetting.vue`, `TimeLogTable.vue`,
  `Comments.vue`, `ConfirmationsTemplate.vue`, `ConfirmationsInTask.vue`, and the
  settings/template admin pages.
- Grep-audit `taskImage` to confirm no inline `.includes('http')` remains outside
  `<TaskTypeIcon>`.

**Verify:** search every task-type surface (lists, filters, exports, comments) shows the
correct icon for both kinds.

---

## Migration (separate task — not in this effort)

Deferred per PRD §6. When scheduled: map seeded defaults (`task`/`bug`/`sub_task`/`design`)
→ library icons, set `iconType='library'`; leave custom/uploaded types until re-picked;
optional orphaned-file cleanup. Because everything defaults to `'upload'`, no data change
is required for the app to keep working before migration runs.

---

## Sequencing & dependencies

```
Phase 0 ──► Phase 1 ──► Phase 2 ──► Phase 3
                                     ▲
                     Phase 4 ────────┘   (backend must accept fields for Phase 3 to persist)
Phase 3/4 ──► Phase 5
Phase 1 ──► Phase 6   (needs <TaskTypeIcon> to exist)
```

Ship order: 0 → 1 (render works) → 4 (persistence) → 2 → 3 (authoring) → 5 → 6 (cleanup).

---

## QA matrix

| Case | Expected |
|---|---|
| Existing uploaded type (no `iconType`) | Renders via WasabiImage/img, unchanged |
| New library type | `<Icon>` renders offline, tinted `iconColor` |
| Unknown/invalid `iconValue` | Falls back to `DEFAULT_ICON`, no crash |
| Dark mode | Icon color has adequate contrast |
| Create from template / project | New fields propagate to `taskTypeCounts` |
| AI template | Every type has a resolvable library icon |
| Offline / air-gapped | Picker + render work with no network |
| Exports & filters | Correct icon on every task-type surface |

---

## Risks (from PRD §8)

- Missed inline site → library icon absent: mitigated by centralizing in `<TaskTypeIcon>` + grep audit.
- Picker rendering 15k icons: cap/virtualize results.
- Fields not propagated into embeds: explicit pass-through + create-from-template test.
- Icon-set memory (~5 MB): acceptable; revisit Option B only if full catalog is exposed.

## Rollout

Additive minor version bump. Feature is non-breaking (keep-both). No feature flag needed;
if desired, gate the "Library" toggle default behind a company setting.
