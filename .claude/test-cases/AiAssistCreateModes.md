# AI-Assist ("Plan with AI") — create modes

**Sprint:** v14.7.0 — AI-Assist enhancement
**Type:** Feature (frontend + backend)
**Status:** Implemented locally — pending manual test / PR

---

## Summary

The "Plan with AI" button (project toolbar) could only create **sprints + tasks
together**. It now lets the user pick **what** to create, up front:

- **Sprints + tasks** (default) — the original behavior: AI drafts sprints, each
  with detailed tasks, created as new sprints in the project.
- **Tasks only** — AI drafts a flat list of tasks; they're added to **one
  existing sprint** the user chooses (defaults to the sprint currently being
  viewed, else the first). No new sprint is created.
- **Sprints only** — AI drafts sprint names/structure; empty sprints are created
  in the project. No tasks.

A review-before-create preview is shown in every mode (uncheck anything you don't
want). The default is **Sprints + tasks**, so existing behavior is unchanged.

---

## How it works

- **Frontend** (`AiTaskCreator.vue`): a 3-way mode selector at the top of the
  modal. Choosing **Tasks only** reveals a **sprint dropdown** (options + active
  default come from `Projects.vue` via `:sprints` / `:activeSprintId`, derived
  from `projectData.sprintsObj` and `route.params.sprintId`). The label,
  placeholder, generate/create button text, and the preview all adapt to the
  mode. `Tasks only` is disabled when the project has no sprints.
- **Composable** (`aiTaskGenerator.js`): sends `mode` + `targetSprintName` on
  generate and `mode` + `targetSprintId` on execute.
- **Backend** (`Modules/AIProjectGenerator`):
  - `promptBuilder.js` appends a mode-specific **output contract** as the last
    instruction (tasks → `{plan:{tasks:[]}}`, sprints → `{plan:{sprints:[{sprintName}]}}`).
  - `schemaValidator.js` validates with `TasksOnlyPlanSchema` / `SprintsOnlyPlanSchema`
    per mode (LLM output + the client-submitted plan).
  - `controller.js` threads `mode` + `targetSprintId`/`targetSprintName`; tasks
    mode requires a valid `targetSprintId`.
  - `orchestrator.executeTasksIntoProject` branches: tasks → append into the
    chosen existing sprint (resolved from `projectDoc.sprintsObj`, never altering
    it otherwise); sprints → create empty sprints; full → original path. Rollback
    only ever undoes what this run created.

---

## Test steps

Prereq: a paid plan with an AI provider configured, and an existing project.

1. **Sprints + tasks (default, regression)**
   - Open a project → toolbar → **Plan with AI** → confirm **Sprints + tasks**
     is selected by default.
   - Enter requirements → **Generate plan** → preview shows sprints grouped with
     their tasks → **Create N tasks** → sprints + tasks appear in the project.

2. **Tasks only → existing sprint**
   - Open **Plan with AI** → choose **Tasks only** → a **sprint dropdown**
     appears, defaulting to the sprint you're viewing (or the first).
   - Pick a sprint → enter requirements → **Generate tasks** → preview shows a
     **flat task list** under "Adding to: <sprint>" → **Create N tasks**.
   - ✅ The tasks are added to the **chosen existing sprint**; no new sprint is
     created; the sprint's other tasks are untouched.

3. **Sprints only**
   - Open **Plan with AI** → choose **Sprints only** → enter requirements →
     **Generate sprints** → preview shows a **list of sprint names** → **Create N
     sprints**.
   - ✅ Empty sprints are created in the project; no tasks.

4. **No-sprint project** — open Plan with AI on a project with no sprints →
   **Tasks only** is disabled (hint on hover); the other two modes still work.

5. **Review controls** — in each mode, unchecking items reduces the "Create N"
   count; unchecking all disables Create.

6. **Reopen** — close and reopen the modal → it resets to **Sprints + tasks**
   and re-reads the active sprint.

---

## Notes

- Backend default is `full` (unchanged) for any client that doesn't send `mode`.
- Tasks-only and sprints-only reuse the same LLM engine, SSE progress, member-id
  sanitization, per-task background time-estimates, and activity-log entries as
  the original full flow.
