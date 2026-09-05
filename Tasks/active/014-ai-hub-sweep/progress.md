# 014 — progress

Branch `fix/ai-hub-sweep` (from `origin/beta`, PR target `beta`).

## 2026-09-04 — three review passes
- `findings-browser.md` — owner sweep of every /ai screen.
- `review-static.md` — 24 ranked defects.
- `findings-api.md` — live API/MCP sweep, defects F1–F7.

## 2026-09-05 — fixes landed (commits f9b386a0 backend, 743ddb85 frontend, 374c19a9 merge)

Gates on the merged tree: `npm test` 1415 backend tests, `vitest` 36 frontend unit tests, `npm run i18n:check` clean, eslint 0 errors.

### Backend (Modules/Agents, runAgent.js) — every row has a test in `tests/agent-*.test.js`

| # | Defect | What changed | Test |
|---|---|---|---|
| 1 | Rule-triggered runs bypass agent controls | `runAgent.js` resolves the agent named in `config.agent`, `runs.canStart({trigger:'rule'})`, project scope, `runs.create` → `runs.executeSkill` on behalf of the rule author. Unnamed / unknown / paused / capped / limited / out-of-scope agent → deterministic error on the automation step. Builder schema is now `agent` + `skill`; sentence rules accept `run the <skill> agent as "<name>"`. | `agent-automation-run` (7) |
| 5 | Approve/decline not atomic | `setStatus(..., { onlyIf: 'pending' })` claims the row as `applying` before any perform; the loser gets 409. | `agent-proposal-atomic` (6) |
| 9 | Approval bypasses allowedActions | `proposals.approve` passes the agent's `allowedActions`; deleted agent → 409. | same suite |
| 7 | Stopped runs resurrected; no reaper | Terminal writes conditioned on `status: running`, return `abandoned` (no proposal) when stop/pause-all won. `runs.reapStale` fails stale `running` rows at boot (`init.js`). | `agent-run-lifecycle` (3) |
| 10 | Skipped counted as done | `runs.STATUS.SKIPPED`; `countsByStatus` on `GET /agents/runs/summary`; `agentFit.historyFor` keeps skipped out of clean/failed. | lifecycle (2), `agent-fit` |
| 8 | Rate limit never enforced | `runs.canStart` counts today's runs: "Daily run limit reached (2 of 2 today)." `schedule` still stored but hidden in the UI. | lifecycle (3) |
| router | Router picked Code Reviewer for tasks with no PR | `Modules/Agents/taskInputs.js` → `task.inputs` from `GET /agents/routable`; `agentFit.SKILL_INPUTS` (pr_link / public_url / brief / project_task) makes an agent ineligible when none of its skills has its input; `routeTasks` refuses with the reason. | `agent-fit` (5), `agent-task-inputs` (3) |
| 15 | No way to delete an agent | `DELETE /api/v2/agents/:id` — owner/admin or agent owner, 409 while a run is open, soft delete, audit row, socket emit. | `agent-delete` (5) |
| 17 | `refusals` shape | Stays a number; `executeSkill` `$inc`s it per `RefusedError` and pushes the refused action into `actions`. | lifecycle |
| F1 | Manual runs skip finding memory | `executeSkill` consults finding memory on every trigger. | lifecycle |
| F4 | L2 run fails on one refused action | Refused direct actions are recorded and the run continues. | lifecycle |

### Frontend (frontend/src/views/Ai/**, task panel, Inbox)

| # | Defect | What changed |
|---|---|---|
| 2 | Run now always fails | `RunTaskPicker.vue`; `runNow(agentId, taskId)`. |
| 3 | Refusal reasons never reach the UI | `reasonOf(error, fallbackKey)` in `useAgents.js` reads `error.response.data.statusText`; every mutation goes through it (`useParity.js` too). |
| 4 | Inbox counts and tabs | `counts.waiting/doneByAi/declined`; Done and Declined views filter by proposal status. |
| 6 | Teammate assignment no-op | Calls the task assignee endpoint. |
| 8, 19 | Unenforced schedule field, L4 rung | Both removed from the UI. |
| 11 | Routing sentence "[object Object]" | `skillKeyOf` + `Parity.rule_sentence` through i18n. |
| 12 | MCP command lacks companyId | `mcpUrl.js` is the one source for the MCP URL and CLI command. |
| 13 | Task panel agent strip never fed | `TaskDetailPanel.vue` loads the task's open run and passes it with `onStop`; spec added. |
| 14 | Picker options dropped | `AgentPicker` → `startRun({ spendCapUsd, notifyMe })` (server side still to read them, see follow-ups). |
| 16 | Silent failures | Toasts with the API reason on pause / resume / pause-all / stop / save. |
| 18 | "Today" vs month-to-date | Card line says month runs and spend. |
| 20 | "Review in AI inbox" routed to AiHub | Routes to `AiInbox`. |
| 21 | Token expiry never shown | `expiryOf(token)` in Accounts. |
| 22 | Hardcoded AGENT chips, English fit reasons | `$t` chips; `agentFit.js` reasons carry `{ code, params }` and `fitText.js` renders them. |
| 23 | Missing load-error / loading states | `EmptyState` with retry on Inbox, Skill Library, Teammates, Routing, Pipeline, Release. |
| 24 | Members see Approve on gated proposals | `canDecide` hides the buttons unless owner/admin. |
| — | Skill requirements never stated | `skillInputs.js` + `Ai.req_*` lines in the wizard and pickers. |

## Open — next steps
1. Backend follow-ups from the API sweep: F2 (PAT via MCP attributed as human), F3 (`docs.read` returns empty text), F5 (double audit rows per agent action), F6 (autonomy > 3 should be 400), F7 (pause-all should not stop `waiting_approval` runs).
2. `startRun` should read `spendCapUsd` / `notifyMe` from the body (frontend already sends them, defect 14).
3. Re-run the browser sweep on the merged branch (owner and member), then open the PR against `beta`.
