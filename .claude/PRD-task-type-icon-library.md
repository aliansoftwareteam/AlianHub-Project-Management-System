# PRD — Task Type Icons via Icon Library (Iconify)

**Status:** Draft for review
**Author:** (interview-driven)
**Date:** 2026-07-21
**App version target:** TBD (additive minor)

---

## 1. Summary

Task types today carry an **uploaded image** icon. This update adds the ability to
pick an icon from a curated **Iconify** library (the engine behind
[icones.netlify.app](https://icones.netlify.app/)) when creating or editing a task
type. Custom upload stays as a secondary option. Rendering already flows through
shared components, so the change is mostly: a picker, a 3-way renderer, three new
data fields, and offline-bundled icon sets.

Existing task types are **not migrated in this phase** — they keep their uploaded
icons and render unchanged. Migration is a separate follow-up.

---

## 2. Decisions locked (from interview)

| Decision | Choice |
|---|---|
| Icon engine | **Iconify** (`@iconify/vue`), curated sets **bundled/served locally** (offline, no CDN dependency) |
| Icon sets | **Material Design Icons (mdi)**, **Lucide**, **Tabler** |
| Upload vs library | **Keep both** — library picker is primary; custom upload retained as fallback |
| Data model | **New explicit fields** (`iconType` + `iconValue` + `iconColor`), not overloading `taskImage` |
| Color | **Add a per-task-type color field** to tint monochrome library icons |
| Migration of existing types | **Deferred** to a separate task |
| Icon scope | **Curated subset** (the 3 sets above), not the full 200k catalog |
| Offline delivery | **Option A — lazy-bundle full collections** (~1.3–1.8 MB gzip lazy chunk, ~5 MB in memory); no backend icon endpoints |
| `iconColor` default | **Theme primary color** (`#2F3990`) |
| Per-set enable/disable | **No** — all 3 sets always available |
| AI-generated templates | **Auto-assign** a library icon to each generated task type |

**Why local sets, not the Iconify CDN:** AlianHub is self-hosted and targets teams
with data-residency/air-gapped requirements. Since we bundle the 3 curated sets for
the picker anyway (search needs them), rendering from those same local sets is free
and works offline — so the CDN is unnecessary. (CDN remains a possible optional
fallback only if the full catalog is ever exposed.)

**Footprint:** the 3 sets ≈ 2–5 MB of JSON, lazy-loaded (outside the initial
bundle). Per-icon render is ~1–2 KB. The full `@iconify/json` (~75–120 MB) is never
involved.

---

## 3. Goals / Non-goals

**Goals**
- Pick a task-type icon from mdi/lucide/tabler with in-app search, fully offline.
- Choose a tint color for the icon.
- Keep custom image upload working as a fallback.
- Zero breakage for existing (uploaded-icon) task types.
- Contain the change behind shared components (avoid editing all ~22 call sites).

**Non-goals (this phase)**
- Migrating existing task types / default seeds to library icons.
- Deleting orphaned uploaded icon files from storage.
- Exposing the full Iconify catalog.
- Changing how a *task* references its type (`TaskType`/`TaskTypeKey` unchanged).

---

## 4. Current system (from codebase map)

- **Icon field:** `taskImage` (String) — a storage path (e.g. `setting/task_type/bug.png`)
  or an `http` URL. No color field exists.
- **Stored in 3 places:**
  1. `settings` collection, doc `task_type` → `settings[]` items (`utils/data.js:2406-2437`).
  2. `task_type_templates` collection → `taskTypes[]` (`utils/mongo-handler/schema.js:1278-1290`).
  3. Project embeds `taskTypeCounts[]` and project-template `TemplateTaskType[]`
     (`schema.js:1701,1895,2397,948,1197`; copied at `Modules/createProject/controller.js:314`).
- **A task doc stores only** `TaskType` (string) + `TaskTypeKey` (number)
  (`schema.js:35-42`); the UI resolves the icon from the matching task-type setting.
- **Rendering:** shared components `TaskType.vue` and `TaskTypeSelection.vue` use
  `taskImage.includes('http') ? <img> : <WasabiImage>`. `WasabiIamgeCompp.vue`
  resolves storage paths per `STORAGE_TYPE` (server vs wasabi). **The same
  `.includes('http')` idiom is duplicated inline across ~22 `.vue` files.**
- **Create/edit UIs:** `TaskStatusSidebar.vue` (settings, `type==='task_type'`) and
  `ProjectTaskTypeForm.vue` (project/template) upload as base64 → send `taskImage`.
- **Seeded defaults:** `task`, `bug`, `sub_task`, `design` (4 images under
  `setting/task_type/`). Company-scoped; custom types are **unbounded**.

---

## 5. Proposed solution

### 5.1 Data model (new fields)

Add to each task-type object, in all 3 storage locations:

| Field | Type | Values | Default |
|---|---|---|---|
| `iconType` | String | `'upload'` \| `'library'` | `'upload'` |
| `iconValue` | String | Iconify name when library, e.g. `"mdi:bug"` | `""` |
| `iconColor` | String | hex tint, e.g. `"#2F3990"` | **theme primary** (`#2F3990`) |

- `taskImage` is **retained** and remains the source for `iconType === 'upload'`.
- Existing types have no `iconType` → treated as `'upload'` → render unchanged.
  **No data migration needed to keep the current state working.**

### 5.2 Rendering (single shared component)

Introduce one shared `<TaskTypeIcon :taskType>` that encapsulates the 3-way logic:

```
if (iconType === 'library' && iconValue)  → <Icon :icon="iconValue" :style="{ color: iconColor || 'currentColor' }" />
else if (taskImage?.includes('http'))     → <img :src="taskImage">
else                                       → <WasabiImage :data="{ url: taskImage }">
```

- Put this branch inside the existing `TaskType.vue` / `TaskTypeSelection.vue` first
  (covers kanban, pickers, most lists).
- Progressively replace the ~22 inline `.includes('http')` sites with
  `<TaskTypeIcon>` to remove the duplication (tracked as cleanup, not a blocker).

### 5.3 Icon picker (new component)

`<IconPicker v-model="iconValue" v-model:color="iconColor">`:
- Tabs/filter across the 3 bundled sets; text search over icon names/aliases.
- Grid of results rendered with `<Icon>`; click selects.
- Color swatch/input for `iconColor`.
- Returns the Iconify name (`"mdi:bug"`).

### 5.4 Create/edit UI (keep both)

In `TaskStatusSidebar.vue` and `ProjectTaskTypeForm.vue`, add a **source toggle**:
- **Library** (default) → `<IconPicker>`, sets `iconType='library'`, `iconValue`, `iconColor`.
- **Upload** → existing base64 upload flow, sets `iconType='upload'`, `taskImage`.

### 5.5 Offline Iconify setup — Option A (lazy-bundle full collections)

- Add deps: `@iconify/vue`, `@iconify-json/mdi`, `@iconify-json/lucide`, `@iconify-json/tabler`.
- **Lazy-load** the 3 collections via dynamic import when the picker/renderer first
  mounts, then register with `addCollection(...)` so `<Icon>` resolves fully offline
  (render **and** search) with no CDN and no backend endpoints.
- **Footprint:** ~4.5–5.5 MB raw JSON → **~1.3–1.8 MB gzip** as a separate lazy chunk
  (outside the initial bundle), browser-cached after first load; ~5 MB in memory.
- All 3 sets are always available (no per-set toggle).
- *Rejected alternative (Option B):* a backend endpoint serving only used icons keeps
  the client tiny but adds 2 endpoints + search; not worth it at curated scope. Revisit
  only if the full catalog is ever exposed.

### 5.6 AI-generated templates

`CreateTemplateWithAI.vue` must set each generated task type to `iconType='library'`
with an `iconValue` from the 3 curated sets. Approach: post-process the AI's task-type
names → map to a sensible library icon by keyword (e.g. "bug"→`mdi:bug`,
"design"→`mdi:palette`), falling back to a generic default (e.g. `mdi:checkbox-marked-circle-outline`)
when no match. `iconColor` defaults to the theme primary.

### 5.7 Backend

- `Modules/settings/templates/settingTaskType/controller.js`: add
  `iconType`/`iconValue`/`iconColor` to `allowedKeys` (~line 31) and persist.
- `Modules/settings/templates/taskType/controller.js`: ensure template `taskTypes[]`
  passes the new fields through unchanged.
- `Modules/createProject/controller.js`: ensure `taskTypeCounts` copy carries the
  new fields (~line 314).
- No new file-upload code — library icons are plain strings; the upload branch is
  unchanged.
- Cache keys unchanged (`tasktype:${companyId}`, `taskTypeTemplate:${companyId}`).

### 5.8 State

- `store/Settings/*`: carry `iconType`/`iconValue`/`iconColor` alongside `taskImage`
  in `taskType` / `taskTypeArray` / `projectTaskType`.

---

## 6. Migration (deferred — design note only)

Because `iconType` defaults to `'upload'`, existing types keep working with no
migration. When migration is scheduled (separate task):
- Map the 4 seeded defaults (`task`, `bug`, `sub_task`, `design`) → chosen library
  icons; set `iconType='library'`.
- Leave custom/uploaded types as `'upload'` until an admin re-picks (or provide an
  optional admin re-map screen).
- Optionally clean up orphaned `setting/task_type/*` blobs via the existing delete
  path. **Not in this phase.**

---

## 7. Blast radius

- **Backend:** 3 controllers (settings task-type, templates, createProject) — additive field pass-through.
- **Frontend new:** `IconPicker`, `TaskTypeIcon` (shared renderer), deps + collection registration.
- **Frontend edit:** `TaskStatusSidebar.vue`, `ProjectTaskTypeForm.vue` (source toggle); `TaskType.vue`, `TaskTypeSelection.vue` (library branch); Settings store.
- **Cleanup (progressive):** ~22 files with inline `taskImage.includes('http')` → swap to `<TaskTypeIcon>`.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| A missed inline `.includes('http')` site won't render library icons | Centralize into `<TaskTypeIcon>`; grep-audit all 22 sites |
| Icon-set memory/bundle footprint | Lazy-load collections; optional backend icon-serve fallback |
| New fields not propagated into project/template embeds at creation | Explicitly pass through in `createProject` + template controllers; test create-from-template |
| Unknown/invalid Iconify name stored | Validate against loaded sets at pick time; render a neutral fallback icon if unresolved |
| Monochrome icon invisible in dark mode | `iconColor` default via `currentColor`; verify contrast in both themes |

---

## 9. Resolved decisions (formerly open)

1. **Offline strategy → Option A** (lazy-bundle full collections; see §5.5). ~1.3–1.8 MB gzip lazy chunk, ~5 MB memory, no backend endpoints.
2. **`iconColor` default → theme primary** (`#2F3990`), applied via the icon's color.
3. **Per-set toggle → no.** All 3 sets (mdi, lucide, tabler) always available in the picker.
4. **AI templates → auto-assign** a curated library icon per generated task type (keyword map + generic fallback; see §5.6).

---

## 10. Out of scope (this phase)

- Migrating existing task types / seeds.
- Deleting orphaned uploaded files.
- Full Iconify catalog / CDN rendering.
- Changing task→type reference model.
