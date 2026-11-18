# Automations and AI features — sweep findings

Area: Automations, AI, AIProjectGenerator, Mcp · finding prefix `AUT` · swept 2026-09-11 against the local server (beta, build 14.36.0-beta.68, company Local360) and a throwaway database on port 27108.

## Coverage

### Routes

44 routes: Automations 15 (9 v2, 6 v1), AI 17, AIProjectGenerator 9, Mcp 3. The MCP token route `POST /api/v2/api-tokens/mcp` belongs to ApiTokens (access area) but was exercised here too.

| Role | Live sweep | Throwaway suite | Not exercised, and why |
|---|---|---|---|
| anonymous | 31 / 44 | 21 / 44 | `updateAiModel` not called live: it rewrites the server `.env`. The suite probes it only where no `.env` exists (CI, a fresh worktree). |
| owner | 9 / 44 (in-app `fetch` from the owner tab) | 36 / 44 | Model-backed generation (plan, clarify, brief, guide, execute into a new project) needs a provider; the suite has none. |
| admin | 33 / 44 | 12 / 44 | v1 create, update, apply and delete not called live: v1 create saves the rule switched on (AUT-05), which the area rules forbid. |
| member | 34 / 44 | 23 / 44 | Same v1 limit. |
| guest | 33 / 44 | 22 / 44 | Same v1 limit. |

Routes no role reached live with a real payload: `POST /api/v1/ai/transcribe` with audio (forwards to api.openai.com, an external host), `POST /api/v1/ai/project/plan|brief|guide|execute` and `tasks/plan` with valid input (model calls beyond the budget), `GET /api/v1/generatePrompt/events/:id` (opened anonymously, no event to observe).

### Screens

4 surfaces: 3 routed screens and 1 embedded surface. All 4 were opened as owner, with no console errors. The only 400 in the tab came from a deliberate probe.

| Screen | Route | Result |
|---|---|---|
| Automations | `/:cid/automations` | Renders list and builder; rule toggles, sentence compile and backtest call the v2 API |
| Ask | `/:cid/ai/ask` | Renders, "8 projects in scope", scope note shown |
| Coding accounts (MCP tokens) | `/:cid/ai/accounts` | Renders modes, policy and token section |
| Create project with AI | modal from Projects › New project | Step 1 renders; cancelled without generating |

### Budget and data used

- **Automation rules:** eight created, all switched off and all in QA Sandbox. One rule was switched on (task created, add a comment), fired once on a `[QA automations]` task, then was switched off and deleted. Zero `[QA automations]` rules remain.
- **MCP tokens:** two tokens created in turn, both scoped to QA Sandbox and both revoked.
  - Priya (member): every read was refused by the known missing member permission rules.
  - Rahul (admin): reads, plus one write, a comment on QAS-12.
- **Real model calls:** about 6–7, over the budget of 5.
  - Planned: Ask on QA Sandbox (1) and task summary on QAS-12 (1).
  - Unplanned (1): the anonymous `ai/description` probe that uncovered AUT-02.
  - Unplanned (about 3–4): while probing private-project scope as a member, two Ask calls and one clarify call reached the model, because members can see a private project they are not assigned to (projects area, below). Clarify can add a repair call.
  - Only QA test strings were sent in the unplanned calls.
- **Left in place (no delete route for projects or tasks):**
  - project `[QA automations] Private scope` (key `QAUJYM`) and its task;
  - task `[QA automations] trigger task` in QA Sandbox;
  - the MCP comment on QAS-12.

### Blocked or out of area

- Member MCP reads are refused with `task.task_list is not granted`: the known member permission rules gap (`fix/member-permission-rules`).
- Out of area, for the projects agent: member `priya.frontend` sees and can Ask about a private project whose only assignee is `rahul.manager` (`GET /api/v1/project`, `scope.visibleProjects`). Guest `kabir.intern` does not.

## Findings

### AUT-01 — `POST /api/v1/updateAiModel` rewrites the server `.env` without a session

- **Severity:** critical
- **Role:** anonymous (and every role)
- **Request:** `POST /api/v1/updateAiModel` with body `{ "key": "JWT_SECRET", "value": "..." }`, no `Authorization`
- **Expected:** 401. Only the instance owner may change instance configuration, and never through a key-value write to `.env`.
- **Actual:** the route is in neither JWT list in `Config/setMiddleware.js`. The handler writes `${key}="${value}"` into `<repo>/.env`, appending the key when it is absent. The value is not escaped, so a newline in `value` adds arbitrary lines. An anonymous caller can replace `JWT_SECRET`, `MONGODB_URL` or the mail and AI keys, which take effect on the next restart. In the throwaway suite the route answers 200 to an anonymous call; it only fails there because no `.env` exists.
- **Reproduction:** not run against the local server, because it would modify instance configuration. Run `tests/integration/automations.int.test.js` › `AUT-01` in a checkout with no `.env`.
- **Suspected file:**
  - `Modules/AI/routes.js:15` registers it with no auth;
  - `Modules/AI/controller.js:388-420` does the write (`envFilePath` at 390, unescaped `replacement` at 399).
- **Fix:** remove the route; the frontend has no caller in `frontend/src/config/env.js`. If it must stay, put it behind the owner-only instance guard with an allow-list of keys and reject values containing newlines or quotes.

### AUT-02 — AI-Assist and "Write with AI" routes run model calls for anonymous callers

- **Severity:** critical
- **Role:** anonymous
- **Request:** `POST /api/v1/ai/description` with `companyid: 6a8ee973d625fca52e519a12` and no `Authorization`
- **Expected:** 401.
- **Actual:** 200 with a real model answer: `{"status":true,"data":{"questions":["What is the task about?", ...]}}`. That spent the company's LLM budget and attributed the spend to whatever `companyid` the caller typed.
  - The same class answers 200 anonymously: `generatePrompt` (runs the model for any valid prompt id), `generatePromptChat`, `deleteUserChat` (deletes the in-memory chat of any `userId` or `uniqueUserId`), `getPrompts`, `findOnePrompts`, `getAiCategory`, `getAiModels`, `findOneAiModel` and `GET /api/v1/generatePrompt/events/:id`.
  - `fix/unauthenticated-v1-routes` only covers `/api/v1/removeCache`.
- **Reproduction:** `curl -X POST localhost:4000/api/v1/ai/description -H 'content-type: application/json' -H 'companyid: <any company>' -d '{}'`
- **Suspected file:**
  - `Modules/AI/routes.js:8-21`: none of `/api/v1/generatePrompt*`, `deleteUserChat`, `getPrompts`, `findOnePrompts`, `getAiCategory`, `getAiModels`, `updateAiModel`, `findOneAiModel` or `/api/v1/ai/description` is listed in `Config/setMiddleware.js`. The `/api/v1/ai/*` entries at 206-215 are exact paths, not a prefix.
- **Fix:** add these paths, or a `/api/v1/ai` prefix plus the legacy names, to `verifyJWTTokenWithCRoute`, and take `userId` and `companyId` from `req.uid` and `req.headers.companyid` instead of the body.
- **Regression:** `AUT-02 refuses anonymous callers on the AI-Assist and description routes`.

### AUT-03 — Automation backtest and v1 preview return task names from private projects to any role

- **Severity:** critical
- **Role:** guest, member
- **Request:** as guest `kabir.intern`, `POST /api/v2/automations/backtest` with `{ rule: { scope: { allProjects: false, projectIds: ["<private project>"] } } }`, and `POST /api/v1/automations/preview` with `{ conditions: { projectId: "<private project>" } }`
- **Expected:** only tasks from projects the caller can open, so 0 matches for a private project the guest is not in.
- **Actual:** both return the private project's tasks.
  - Backtest: `{"matched":1,"sample":[{"id":"6aa3b875a91fde6b0a34a738","key":"QAUJYM-1","name":"[QA automations] zebraquokka private task"}]}`.
  - Preview: `{"count":1,"sample":[{... "priority":"MEDIUM"}]}`.
  - With no scope, backtest searches every task in the company by title (`conditions: { op: "contains", field: "task.TaskName", value: "..." }`), so any word can be probed.
- **Reproduction:** as admin, create a private project with only yourself assigned and add a task. As guest, call either endpoint with that project id or a word from the title.
- **Suspected file:** `Modules/Automations/controller.js:314` (`backtest`) and `:86` (`preview`) build the task match from caller input only.
- **Fix:** intersect with `require('../Agents/scope').visibleProjectIds(companyId, req.uid)`, the same helper Ask uses.
- **Regression:** `AUT-03 keeps private-project tasks out of a guest backtest` and `AUT-03 keeps private-project tasks out of a guest v1 preview`.

### AUT-04 — Any role can create, edit, switch on and delete any automation rule

- **Severity:** high
- **Role:** guest, member
- **Request:** as guest, `POST /api/v2/automations`, `PUT /api/v2/automations/:id`, `PATCH /api/v2/automations/:id/enabled` and `DELETE /api/v2/automations/:id`. As member `priya.frontend`, `PUT` on a rule created by admin `rahul.manager`. As guest, `PATCH .../enabled` on that admin rule.
- **Expected:** rule management limited to owner and admin (or the project lead), and a rule another person created is not editable by a member or guest.
- **Actual:** every call returns `status: true`.
  - "member PUT admin rule" and "guest PATCH admin rule enabled" both succeeded live.
  - A guest can switch on a rule with `allProjects: true`. It then comments on, reprioritises or runs agents against every task in the company under the automation identity.
  - The v1 routes behave the same, and the builder offers a guest "New automation".
  - The known member-rules gap does not explain this: here the calls are allowed, not denied.
- **Reproduction:** see `s2` in the sweep. As guest, create a v2 rule, then rename, switch on and delete a rule created by admin.
- **Suspected file:** `Modules/Automations/controller.js:22-83` and `:179-240`. No `getRoleType` or `isPrivileged` check, and `createdBy` is never compared.
- **Fix:** gate writes with `Config/permissionGuard` (owner and admin, or a dedicated `automation.manage` permission), and hide the builder in `AutomationsPage.vue` for roles without it.
- **Regression:**
  - integration: `AUT-04 refuses a guest creating a rule`, `AUT-04 refuses a member editing a rule someone else created`, `AUT-04 refuses a guest switching a rule on`;
  - Playwright: `AUT-04 does not offer a guest the rule builder`.

### AUT-05 — v1 rules save switched on, and v1 apply bulk-updates priorities with no role or project check

- **Severity:** high
- **Role:** guest
- **Request:** as guest, `POST /api/v1/automations` with `{ conditions: { projectId: "<private project>" }, actions: [{ type: "set_priority", value: "HIGH" }] }`, then `POST /api/v1/automations/:id/apply`
- **Expected:** refused. Failing that, a new rule starts switched off, like v2.
- **Actual:**
  - The rule is saved with `enabled: true`. The engine's matcher loads every `{ enabled: true, deletedStatusKey: 0 }` rule regardless of version.
  - `apply` runs `updateMany` on every parent task that matches, in the whole company when `conditions` is empty. It returns `Applied to 1 task(s).`; afterwards the owner sees the private task at `HIGH`.
  - No history row, socket event or task cache invalidation is written for the changed tasks.
- **Reproduction:** throwaway suite (`AUT-05 refuses a guest bulk-changing priorities in a private project`). Not run live: v1 create switches the rule on.
- **Suspected file:**
  - `Modules/Automations/controller.js:28` (`enabled: true`) and `:105-122` (`applyRule`);
  - `Modules/Automations/engine/matcher.js:38`.
- **Fix:**
  - save v1 rules `enabled: false`;
  - gate `apply` like AUT-04;
  - intersect the match with the caller's visible projects;
  - write through the task update helper so history and sockets fire;
  - or retire the v1 routes, since the frontend only calls v2.
- **Regression:** `AUT-05 saves a new v1 rule switched off` and `AUT-05 refuses a guest bulk-changing priorities in a private project`.

### AUT-06 — AI task summary and task category read any task by id, including private projects

- **Severity:** critical
- **Role:** guest
- **Request:** as guest `kabir.intern`, `POST /api/v1/ai/task-summary` and `POST /api/v1/ai/task-category` with `{ "taskId": "6aa3b875a91fde6b0a34a738" }`, a task in a private project the guest cannot open
- **Expected:** `task not found` (or 403) before anything is read.
- **Actual:**
  - Summary: `{"status":true,"data":{"summary":"","commentCount":0,...}}`, so the lookup succeeded.
  - Category: `{"status":true,"data":{"configured":true,"category":null,"reason":"no-vocabulary"}}`.
  - Once the task has comments, the summary sends the whole thread to the model and returns its summary, with commenter names, to the guest. It is also cached for 6 hours under a key shared across callers.
  - Live on QAS-12, the guest got the summary of a thread they can see; the code path is identical for a private task.
- **Reproduction:** as admin, create a private project and task. As guest, call both routes with the task id.
- **Suspected file:**
  - `Modules/AI/taskSummary.js:158`;
  - `Modules/AI/taskCategory.js:190-196`;
  - `Modules/AI/controller.js` `summarizeTask` and `categoriseTask`, which pass no `req.uid`.
- **Fix:** pass `req.uid` and refuse unless the task's `ProjectID` is in `visibleProjectIds(companyId, uid)`. Keep the cache key per task (it is), but check visibility before reading the cache.
- **Regression:** none in the suite. Both helpers return before the task lookup when no provider is configured, and the throwaway server runs with no AI keys. A unit test with a stubbed provider in `tests/` is the right place; that is outside the files this sweep may edit.

### AUT-07 — AI task generation writes sprints and tasks into a project the caller cannot open

- **Severity:** high
- **Role:** guest
- **Request:** as guest, `POST /api/v1/ai/project/<private project>/tasks/execute` with `{ "mode": "sprints", "plan": { "sprints": [{ "sprintName": "Injected" }] } }`
- **Expected:** 404 `Project not found`, as `clarify`, `brief` and `guide` answer through `projectAccess.resolveProjectId`.
- **Actual:** `{"status":true,"jobId":"..."}`, and a new sprint appears in the private project. `mode: "full"` or `"tasks"` creates tasks the same way. `tasks/plan` has the same gap and sends the project's context to the model.
- **Reproduction:** throwaway suite (`AUT-07 ...`). Live, only the validation step was reached, to avoid writing into a project outside QA Sandbox.
- **Suspected file:**
  - `Modules/AIProjectGenerator/controller.js:911-956` (`tasksPlan`) and `:958-1015` (`tasksExecute`);
  - `Modules/AIProjectGenerator/orchestrator.js:1421` (`loadProjectForTasks`) loads by id only.
- **Fix:** call `resolveProjectId({ companyId, uid, projectId })` in both handlers and return 404 when `hidden`.
- **Regression:** `AUT-07 refuses a guest adding sprints to a private project they cannot open`.

### AUT-08 — MCP `task.get` ignores the token's project scope

- **Severity:** high
- **Role:** admin (any token holder)
- **Request:** MCP token minted with `projectIds: ["6aa3b13ed1b2a9fd26131a1e"]` (QA Sandbox), then `tools/call` `task.get` with the id of a task in another project
- **Expected:** refused, or `task not found`. `tasks.search` and `tasks.next` already filter to the token's projects.
- **Actual:** the full brief of `QD99CA8-1` from another project: title, status, description, comments, linked docs.
- **Reproduction:** mint a scoped token on Coding accounts, then call `task.get` with a task id from a project outside the scope.
- **Suspected file:** `Modules/Mcp/brief.js:75` (`getTask(ctx.companyId, taskId)` with no `ctx.projectIds` check), reached from `Modules/Mcp/tools.js:88`.
- **Fix:** in `buildBrief`, refuse when `ctx.projectIds.length && !ctx.projectIds.includes(String(task.ProjectID))`. `docs.read` already applies `projectScope`.
- **Regression:** `AUT-08 keeps task.get inside the projects a token is scoped to`.

### AUT-09 — v2 update and switch report success for a rule that does not exist

- **Severity:** medium
- **Role:** admin
- **Request:** `PUT /api/v2/automations/0123456789abcdef01234567` and `PATCH /api/v2/automations/0123456789abcdef01234567/enabled`
- **Expected:** `{ status: false, statusText: "Not found." }`, as v1 `updateRule` does.
- **Actual:** `{"status":true,"statusText":"Automation updated.","data":null}` and `{"status":true,"statusText":"Automation on.","data":null}`. The filter also ignores `deletedStatusKey`, so a soft-deleted rule can be edited and switched on while staying hidden from the list.
- **Suspected file:** `Modules/Automations/controller.js:208-213` and `:228-233`.
- **Fix:** add `deletedStatusKey: { $ne: 1 }` to the filter and answer `Not found.` when `updated` is null.
- **Regression:** `AUT-09 reports a missing rule instead of claiming it was updated`.

### AUT-10 — Ask sends `[object Object]` as each task's status to the model and the screen

- **Severity:** low
- **Role:** member
- **Request:** `POST /api/v1/ai/ask` with a question that matches QA Sandbox tasks
- **Expected:** the status name, for example `To Do`.
- **Actual:** every source's `detail` starts `[object Object] · HIGH · ...`, both in the prompt and in the `sources` returned to the Ask screen.
- **Suspected file:** `Modules/AI/ask.js:82`, where `t.status` is the stored `{ text, key, type }` object.
- **Fix:** use `(t.status && t.status.text) || t.statusType`, as `Modules/Mcp/tools.js` `taskRow` does.

### AUT-11 — Automation runs for `task.created` record the placeholder key `--`

- **Severity:** low
- **Role:** admin
- **Request:** `GET /api/v2/automations/:id/runs` after a `task.created` rule fired
- **Expected:** the run's entity carries the new task's key, for example `QAS-13`.
- **Actual:** `{"status":"success","entity":{"kind":"task","id":"6aa3b814a91fde6b0a348bc2","key":"--"}}`. The envelope is built from the create payload (`TaskKey: '--'`) before the key is assigned.
- **Suspected file:** the `task.created` publisher behind `event/domainEventBus` (envelope `data.TaskKey`).
- **Fix:** emit after the key is set, or resolve the key in the runner.

## Checks that passed

- Every Automations, Ask, meeting notes, transcribe, task summary and category, and AI project generator route refuses a caller without a session (401). `companyid` of a company the caller is not in is refused (401).
- v2 rules start switched off. Validation returns field-level errors. The sentence compiler round-trips deterministically with no model. Delete is a soft delete that drops the rule from the list.
- A switched-on `task.created` rule scoped to QA Sandbox fired exactly once, with run status `success`, and stopped once switched off.
- Ask and Ask sources only list projects the caller can open: the guest never saw the private project, and `projectId` of a hidden project yields no sources.
- AI project generator: `clarify` and `brief` answer 404 for a hidden `projectId`. `plan`, `clarify` and `brief` need 20 characters. `execute` and `tasks/execute` re-validate the plan server-side. Tasks mode needs `targetSprintId`. `upload-brief` extracts a text file and rejects `application/x-msdownload`. A body `companyId` of another company is ignored.
- MCP:
  - the manifest is public and secret-free;
  - `POST` and `GET /mcp` without a token, with a web JWT, or with another company answer 401;
  - a revoked token is refused on the next call;
  - a token cannot mint tokens (403);
  - `task.status.set` to Done is refused and audited;
  - unknown tools and methods answer -32601;
  - `tasks.search` stays inside the token's projects;
  - the single write (`task.comment`) is audited and undoable.
- Owner screens (Automations, Ask, Coding accounts, Create project with AI) render without console errors.
