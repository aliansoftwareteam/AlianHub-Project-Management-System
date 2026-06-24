# AHE-3777 — AI Assistant for task creation (fresh / existing projects)

**Sprint:** v14.6.0 - Main
**Status:** PLAN — awaiting approval before implementation
**Goal:** When a PM/Team Leader opens a freshly-created (manually-made) project, let them generate
multiple well-formed tasks autonomously with an AI Assist/Agent — the "Suggest Tasks" idea, but
*much* more capable and accurate. Also available on any project to bulk-add tasks later.

---

## 1. What exists today (two very different AI systems)

### A. Legacy "Suggest Tasks" / "Suggest Subtasks" — weak
- Entry: `SprintsList.vue` ("Suggest Tasks" on a sprint), `SubTasks.vue` ("Suggest Subtasks").
- Flow: `aiHelper.js` → `POST /api/v1/generatePrompt` → `Modules/AI/controller.js` → **OpenAI only** (hardcoded `config.AI_MODEL`/`AI_API_KEY`), prompt from `utils/aiPrompts.json`.
- Output: **titles only** — `[{title}]`, parsed with **`eval()`** (fragile/unsafe).
- Context sent: **only** project/task name + `rawDescription`. No members, no statuses, no requirements.
- Created tasks: title + "To Do" status, **no description, priority, assignee, or sprint structure**.

### B. AIProjectGenerator ("Create with AI") — strong, but only makes NEW projects
- `Modules/AIProjectGenerator/`: modular markdown prompts (`promptBuilder.js` + `prompts/shared/*` + `prompts/project-plan/*`), **multi-provider** (`llmProvider/`: Anthropic / OpenAI / DeepSeek), JSON-mode + schema validation + **repair pass**, plan caching, **SSE progress**.
- UX (`AiProjectCreator.vue` + `aiProjectGenerator.js`): description + requirements → optional brief upload → optional clarifying questions → **plan → review/edit → execute**.
- `orchestrator.js` builds rich tasks: Editor.js `descriptionBlock` (context + "What to do" + "Acceptance criteria"), `Task_Priority`, task type, assignees, task-key reservation, socket emits, activity-log history, and **auto AI time-estimates** per task.

**Key reuse fact:** `createSprint(...)` and `createTasksForSprint({ projectDoc, sprintDoc, tasks, … })`
([orchestrator.js:608, 741](Modules/AIProjectGenerator/orchestrator.js#L741)) are exported and take a
`projectDoc` + `sprintDoc`. They work against **any** project — so we can feed them an *existing*
project and reuse all the task-building richness without touching project creation.

---

## 2. Chosen approach

**Reuse the AIProjectGenerator engine; add a new "tasks into an existing project" mode.**
Do **not** build a new AI stack and do **not** extend the weak legacy `generatePrompt` path.

This directly gives the "better + accurate" the request asks for: multi-provider (Claude), rich
structured tasks, grounding in the project's real context, schema-validated output (no `eval()`),
and a review-before-create step.

### 2.1 Backend (new, thin layer over existing engine)

1. **New prompt set** `Modules/AIProjectGenerator/prompts/project-tasks/` (reuses `shared/*`):
   - `system.md` — "You are adding tasks to an EXISTING project. Do NOT invent the project or its
     statuses/types — they are given. Produce sprints + tasks only."
   - Reuse `task-guidance.md`, `output-format.md`; new trimmed `schema.md` = `{ sprints: [{ sprintName, tasks:[…] }] }` (drop the `project` block).
   - The user message includes the **existing project context**: name, description, its
     `taskStatusData` names, `taskTypeCounts`, team members, and any existing sprint names — plus the
     user's requirements (and optional brief / clarifying answers).
2. **New controller handlers** in `Modules/AIProjectGenerator/controller.js` (mirror the project flow):
   - `POST /api/v1/ai/project/:projectId/tasks/clarify` — optional clarifying questions.
   - `POST /api/v1/ai/project/:projectId/tasks/plan` — async; returns `jobId`, streams the task plan over the existing SSE channel.
   - `POST /api/v1/ai/project/:projectId/tasks/execute` — persists the (possibly edited) plan.
3. **New orchestrator fn** `executeTasksIntoProject({ plan, projectId, companyId, uid, userData, jobId, targetSprintId? })`:
   - Loads the **existing** project doc (its `taskStatusData`, `taskTypeCounts`, `ProjectCode`, `_id`).
   - For each plan sprint: reuse `createSprint(...)` (or, if `targetSprintId` given / project already has a sprint, add into it) → then `createTasksForSprint({ projectDoc, sprintDoc, tasks, … })`.
   - **Skips** `checkProjectPlan` / `buildProjectDoc` / `saveProject` (project already exists).
   - Reuse the existing `rollback` shape (tasks + any newly-created sprints) + SSE `progress`/`complete`/`error`.
4. **Reuse as-is:** `llmProvider/`, `sseEmitter`, `promptBuilder.js`, `buildTaskDoc`, `createSprint`, `createTasksForSprint`, JSON validation + repair, AI time-estimates.

### 2.2 Frontend

1. **Entry points** (primary = fresh project):
   - `ProjectEmptyState.vue` — add a prominent **"✨ Generate tasks with AI"** button (the empty/fresh-project state the request targets).
   - Optionally an "AI Assist" action in the list/sprint header so non-empty projects can bulk-add too (can sit next to / eventually replace the legacy "Suggest Tasks").
2. **Reuse the wizard UX** from `AiProjectCreator.vue` (extract a shared stepper or add a `mode="tasks"`): requirements input → optional clarifying Q&A → **plan preview (sprints + tasks, expandable, with per-task description/priority/type)** → user edits / deselects → **Create**. SSE progress bar during execute. (Preview-before-create matches our standing "preview big batches first" rule.)
3. **Composable**: extend `aiProjectGenerator.js` (or a sibling `aiTaskGenerator.js`) with `planTasks(projectId, …)`, `clarifyTasks(projectId, …)`, `executeTasks(projectId, …)`, reusing `subscribeToProgress`.
4. Live-update the list via the existing socket `insert` events the orchestrator already emits per task (no extra wiring).

---

## 3. Why this beats "Suggest Tasks"

| Dimension | Legacy Suggest Tasks | New AI Assistant |
|---|---|---|
| Provider/model | OpenAI only, hardcoded | Multi-provider, Claude-capable |
| Output | titles only, `eval()` | schema-validated sprints + rich tasks (desc, priority, type, assignee) + repair pass |
| Context/grounding | name + rawDescription | project description + real statuses/types + members + requirements + optional brief + clarifying Q&A |
| Structure | flat into one sprint | proposes sprints + tasks for an empty project |
| Control | pick titles | review/edit full plan before creating |
| Extras | none | auto AI time-estimates, activity history, socket live-update |

---

## 4. Constraints & safety
- **Gating:** reuse `company.planFeature.aiPermission` + the per-user AI limit (`checkGenerateResponseLimit`); permission `task.task_create`. Hide entry points when not allowed.
- **companyId scoping** on every read/write (load project, create sprints/tasks) — non-negotiable.
- **Do not break** the existing "Create with AI" project flow or legacy "Suggest Tasks" — both stay working; we add alongside and reuse shared internals carefully (no behavior change to `executePlan`).
- Verify `npm --prefix frontend run build` clean + `vue-cli-service lint` clean before committing. Backend `node --check`.

---

## 5. Open decisions (need your call)
1. **Sprints vs single bucket:** Should the AI propose *sprints + tasks* (gives a fresh project real structure), or just dump tasks into one default/selected sprint? (Recommend: propose sprints+tasks, like the project generator — but allow "into existing sprint".)
2. **Clarifying questions step:** Include the optional clarifying-Q&A round (more accurate, one extra step) or go straight requirements → plan? (Recommend: include, skippable.)
3. **Legacy "Suggest Tasks":** Keep it as-is for now, or replace it with this new flow once shipped? (Recommend: keep now, revisit after.)
4. **Provider/model:** Which LLM is configured on staging/prod for AIProjectGenerator (Anthropic/OpenAI/DeepSeek)? The new flow inherits it. (Ops/config check.)

---

## 6. Rough work breakdown
- **BE:** new `prompts/project-tasks/*` (~4 small md), ~3 controller handlers + routes, `executeTasksIntoProject` in orchestrator (~120 lines, mostly reusing exports). 
- **FE:** empty-state button + entry point, wizard `mode="tasks"` (reuse `AiProjectCreator`), composable methods.
- **Tests/docs:** test-case doc in `.claude/test-cases/AHE-3777-*.md`; manual test on staging (LLM needs the provider key — likely can't fully test on localhost).
- **One PR** to `staging` (`feat/ai-task-assistant-v14.6.0`).

---

## 7. Files (anticipated)
**New:** `Modules/AIProjectGenerator/prompts/project-tasks/{system,schema,task-guidance-overrides}.md`; FE `aiTaskGenerator` composable (or extend existing); maybe `AiTaskGenerator.vue` (or `AiProjectCreator` mode).
**Edit:** `Modules/AIProjectGenerator/{controller.js,routes.js,orchestrator.js,promptBuilder.js}`; FE `ProjectEmptyState.vue` (+ wherever "Suggest Tasks"/list header lives if we add a secondary entry).
**Reused untouched:** `llmProvider/*`, `sseEmitter.js`, `buildTaskDoc`/`createSprint`/`createTasksForSprint`, `prompts/shared/*`.
