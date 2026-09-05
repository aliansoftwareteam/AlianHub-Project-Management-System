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

## 2026-09-05 — local run on the merged branch (owner, 1280px, fresh `frontend/dist`)

First production build failed: `Parity.fit_no_history` was declared twice in en.js (picker explainer vs. the new reason line). Renamed the explainer to `fit_no_history_note` (commit 3d6e80a4); the duplicate had also hidden the reason line from every other locale, backfilled.

| Screen / flow | Result | Evidence |
|---|---|---|
| /ai hub cards | PASS | month-to-date line ("This month: 18 runs · $0.06"), requirement line per agent ("Needs: a pull-request or branch link on the task"), L4 rung gone, no console errors |
| Run now | PASS | opens "Run QA Reviewer on a task" picker with the requirement stated and the open-task list |
| AI Inbox counts | PASS | Waiting 4 · Done by AI 8 · Declined 2 (were 0/0/0) |
| Routing 8 tasks | PASS | 5 → Daily PM, 3 "needs a person — this task lacks a public URL…"; "3 left for a person" (was 0) |

Note for the next sweep: the Browser pane's synthetic clicks do not land on this app under an emulated 1280px viewport; drive clicks with `javascript_tool` and use screenshots for proof.

## 2026-09-05 — API-sweep follow-ups landed (three parallel agents, merged cd5bad69…)

| # | Defect | What changed | Test |
|---|---|---|---|
| F2 | PAT over MCP attributed as human | `Mcp/server.js` sets `req.mcp`; `actor.js` treats any MCP call as an agent actor named after the token, `viaAccount` from the token/user account or `personal` (an MCP client is the developer's own Claude Code / Cursor, per accounts.js). | `agent-mcp-actor` (8) |
| F3 | `docs.read` returned "" | `pageText()` strips `content.html` first (rawText is a 5000-char excerpt), falls back to rawText, then blocks; cap 40000. | `mcp-docs-read` (5) |
| F5 | Double audit rows per agent action | `actions.js` context carries `auditedByCaller`; the tool layer's `recordAutomationAudit` skips its row for it. Plain rules unchanged. | `agent-audit-single-row` (5) |
| F6 | autonomy > 3 silently clamped | 400 "autonomy must be between 0 and 3" on create and update for any non-integer or out-of-range value. | `agent-autonomy-validation` (5) |
| F7 | pause-all stopped waiting runs | `pauseAll` and single-agent pause stop only running/queued; waiting runs and their proposals stay for the human decision. | `agent-pause-all` (5) |
| 14 | Picker options dropped server-side | `startRun` validates and persists `spendCapUsd` / `notifyMe`; `executeSkill` stops a run at its own cap ("Run spend cap reached ($x of $y)"); `notifyStarter` uses the existing notification pipeline on waiting/terminal writes. Schema fields added to `agentRuns`. | `agent-run-options` (9) |

Gates: `npm test` 1461, `npm run lint` 0 errors.

Not verified in the UI: how an `agent_run` notification renders in the web notification list (sender is the agent id, so its display name is empty). Worth one look during the member sweep.

## Open — next steps
1. Member-role browser sweep: the workspace has only the owner plus four pending invites, so a real member account is needed (owner to create it).
2. Check the `agent_run` notification row renders with a name.
