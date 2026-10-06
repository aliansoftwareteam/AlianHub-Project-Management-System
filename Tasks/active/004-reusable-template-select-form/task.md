---
id: 004
title: Reusable template-selection form component (task types + statuses)
status: active
priority: medium
depends_on: []
created: 2026-08-14
---

# Reusable template-selection form component

## Goal
The three CreateProject step forms — `ProjectTaskTypeForm`, `ProjectStatusForm`,
`TaskStatusForm` — each hand-roll the same left "Templates" column and layout, and
stack their two columns on mobile with no step flow. Extract the shared shell into one
reusable component: left Templates picker + a slotted right list, plus a mobile
two-sub-step flow (pick/create a template → configure its list). The three forms become
thin wrappers that keep owning their data + CRUD and feed the shell via props/slots/events.

## Scope
- **New shell component** `frontend/src/components/molecules/TemplateSelectForm/TemplateSelectForm.vue`:
  - Header title (prop) and the desktop two-column layout, reusing existing class names
    (`taskStatusLeft`, `taskStatusRight`, `templated_name_ul`, `templated_name`,
    `add_template`, `save_template`, `add_new_temp`, `temp_save_value`, …) so the shared
    `style.css` keeps applying with no rewrite.
  - **Left Templates column UI** (owned by shell): count label + "+" icon, list of templates
    with select / inline-rename / delete / "Save Template" (dirty) / "+ New Template" button /
    new-template input / inline error, and the delete `ConfirmationSidebar`.
  - **Mobile (`$clientWidth <= 767`) two-sub-step flow** (NEW):
    1. Template select/create.
    2. On select **or** create → advance to the list sub-step, which shows the active
       template name in its header + a **Back** button returning to sub-step 1.
    - Independent of the wizard's Previous/Next (those keep moving wizard steps as today).
  - **Right column** exposed as a slot so each consumer passes its own list
    (task-type DragDropField, project-status draggables, task-status DragDropFields).
  - **Props** (shape TBD in build): `templates`, `modelValue`/`selected` (active template),
    `title`, `listTitle`, dirty-flag key, error string, edit/delete permission per row.
  - **Emits**: `select(template)`, `create(name)`, `rename({ template, name })`,
    `delete(template)`, `save(template)`, `update:selected`. No API/store calls in the shell.
- **Refactor the three forms into smart wrappers** that keep all store getters, mutations,
  API calls, validation, and toasts, and render `<TemplateSelectForm>` + right-column slot:
  - `frontend/src/components/templates/CreateProject/ProjectTaskTypeForm.vue`
  - `frontend/src/components/templates/CreateProject/ProjectStatusForm.vue`
  - `frontend/src/components/templates/CreateProject/TaskStatusForm.vue`
- Any new i18n keys needed (e.g. Back button, list-step header) added to `en.js` + `hi.js`.

## Out of scope
- Backend, API, or DB changes.
- Any change to the desktop look or behavior — must stay pixel- and behavior-identical.
- Right-column internals (DragDropField, draggable, `TaskStatusSidebar` wiring) — those stay
  inside the wrappers, passed through the slot.
- Changes to the parents (`CreateProjectSidebar`, `ProjectSettingSidebar`, `CreateTemplate`):
  the three forms keep their current public props (`modelValue`, `projectData`, `from`) and
  emits (`disableNext`, `saveTemplate`, `setTemplateData*`, `updateStatus`, `spinnerOn`, …).

## Acceptance criteria
- [ ] One `TemplateSelectForm` shell renders the left Templates column + a slotted right column, and is consumed by all three forms.
- [ ] Desktop: layout, styling, and all template operations (select, rename, delete, save-template, new-template) are unchanged.
- [ ] Mobile: template sub-step shows first; selecting or creating a template advances to the list sub-step; the list sub-step header shows the active template name + a Back button; Back returns to the template sub-step.
- [ ] Mobile: the wizard's Previous/Next continue to move between wizard steps, unaffected by the internal sub-step.
- [ ] Template CRUD (create/edit/delete/save-template) still works in all three contexts: create-project wizard, settings sidebar, create-template.
- [ ] All template API/store logic lives in the wrapper forms; the shell only emits events.
- [ ] Right column is driven by the slot (task types vs project status vs task status).
- [ ] No regression in any of the three forms across their wizard + settings + create-template usages.

## Constraints & notes
- The three forms differ only in: store getter (`settings/taskType` | `projectStaus` | `taskStatus`), mutations (`mutateTaskType`/`setProjectTaskTypeArray`, `mutateProjectStatus`/`setProjectStatus`, `mutateTaskStatus`/`setProjectTaskStatusArray`), API endpoint (`TASK_TYPE_TEMPLATE` | `API_PROJECT_STATUS_TEMPLATE` | `TASK_STATUS_TEMPLATE`), model field key (`taskTypeField` | `projectStatusField` | `taskStatusField`), and the new-template default object shape. The left-column UI is otherwise identical.
- Reserved template name `Custom` is non-editable / non-deletable; validation (required, duplicate name, reserved name) currently lives in the forms — keep it in the wrappers.
- `$clientWidth` (injected, reactive) is the responsive signal; breakpoint is `767`, matching the rest of the module.
- Mobile stepper is NEW; today mobile just stacks the columns (`.mobile-project-taskstatus-section … display:block`).
- Keep the shell dumb — no store/endpoint config props beyond what all three genuinely need (ponytail).

## Resources
- Screenshot of the task-type step (red-bordered target) — provided in the task prompt.
- Source forms: `ProjectTaskTypeForm.vue`, `ProjectStatusForm.vue`, `TaskStatusForm.vue` and their shared `style.css` under `frontend/src/components/templates/CreateProject/`.
