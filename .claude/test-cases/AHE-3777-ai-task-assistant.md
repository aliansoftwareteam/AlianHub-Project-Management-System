# AHE-3777 — AI Assistant for task creation

**Sprint:** v14.6.0 - Main
**Type:** Feature (frontend + backend, additive)
**Status:** Implemented locally — pending manual test (not committed)

---

## Summary

A PM/Team Leader on a fresh (or any) project can generate **multiple well-formed tasks**
with AI — like "Suggest Tasks" but far more capable: it produces **sprints + richly-described
tasks** (context + "What to do" + "Acceptance criteria", priority, type), with a
**review/edit-before-create** step.

It **reuses the existing AIProjectGenerator engine** (multi-provider LLM, JSON-mode + schema
validation + repair pass, SSE progress, the same task-building internals that "Create with AI"
uses) — adding a new "tasks into an EXISTING project" mode. The existing project-creation flow
and legacy "Suggest Tasks" are unchanged.

## How it works

**Backend** (`Modules/AIProjectGenerator/`, all additive):
- New prompts `prompts/project-tasks/{system,schema}.md` (reuse `role-pm`, `task-guidance`,
  `sprint-guidance`, `member-rule`, `output-format`). Plan shape = `{ sprints: [{ sprintName, tasks[…] }] }` — no project block.
- `schemaValidator.js`: `TasksPlanSchema` / `TasksResponseSchema` / `sanitizeTaskPlanMemberIds`.
- `promptBuilder.js`: `buildTasksSystemPrompt` + `buildTasksUserMessage` (grounds the LLM in the
  existing project's name, description, task **status names**, task **type keys**, sprint names, members).
- `orchestrator.js`: `executeTasksIntoProject()` — loads the existing project, reuses
  `createSprint` + `createTasksForSprint` (task-key reservation, sockets, history, auto AI
  time-estimates); rolls back created tasks/sprints on failure (never the project).
- `controller.js`: `tasksPlan` (async + SSE) + `tasksExecute`. `routes.js`: 2 new routes
  `POST /api/v1/ai/project/:projectId/tasks/plan|execute` (progress on the shared `/api/v1/ai-progress/:jobId` SSE).

**Frontend** (additive):
- `composable/aiTaskGenerator.js` — `generateTasks` / `executeTasks` / `subscribeToProgress`.
- `components/organisms/AiTaskCreator/AiTaskCreator.vue` — self-contained modal (Teleported to
  body): requirements → generate (SSE) → **preview sprints + tasks with per-task checkboxes** →
  Create (SSE progress). Does NOT touch the existing `AiProjectCreator`.
- `SprintsList.vue` — an **"✨ AI Assist"** entry beside "Suggest Tasks" (same AI/permission
  gating) opens the modal for the project.

## Gating / safety
- Shown only when `checkApps('AI', project)` + `task.task_list` + `task.task_create` (same as Suggest Tasks).
- Backend: `isAnyProviderConfigured()` (503 if no LLM key), company-scoped project load, server
  re-validates the plan, sanitizes assignee ids against current members.
- No backend/schema changes to existing collections; no change to `executePlan` / project flow.

---

## Test cases

> Needs an AI provider configured (ANTHROPIC/OPENAI/DEEPSEEK key) — same as "Create with AI".
> On staging that's set; on localhost it returns a graceful "AI provider is not configured" if not.

### TC-1 — Generate into a fresh project
1. Create a project manually, open it (empty task list). In the sprint header, click **✨ AI Assist**.
2. Enter requirements (e.g. "Customer onboarding: signup, email verification, profile setup, dashboard"). Click **Generate tasks**.
3. **Expect:** a preview of sprints, each with several tasks (name + priority).

### TC-2 — Review + create
1. Uncheck a few tasks. Click **Create N tasks**.
2. **Expect:** progress, then a success toast; the new sprints + tasks appear in the list (each task has a full description, priority, type, task key).

### TC-3 — Accuracy / richness
- Open a created task → description has context + "What to do" (ordered) + "Acceptance criteria" (unordered); priority set; AI time-estimate populated shortly after.

### TC-4 — No regression
- "Create with AI" (new project) still works unchanged.
- Legacy "Suggest Tasks" still works unchanged.
- With no AI permission / app disabled, neither "Suggest Tasks" nor "✨ AI Assist" shows.
- Cancel / outside-click closes the modal (except mid-generate/mid-create, by design).

---

## Notes / scope (MVP)
- MVP skips the optional brief-upload + clarifying-questions steps (the project flow has them; can
  be added to tasks mode later). Requirements textarea + review + create is the core.
- Entry point lives in the sprint header (where "Suggest Tasks" is). A project-level empty-state
  banner could be added later.
- LLM provider/model is whatever AIProjectGenerator is configured with (Claude recommended for accuracy).
