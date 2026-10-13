# 014 — progress

Branch `fix/ai-hub-sweep`, merged to `beta` as PR #543, merge commit `1fd5d178`, build `14.36.0-beta.20`. A follow-up build fix landed as `3d6e80a4`.

## Checklist

`task.md` states the goal ("every screen and flow under /ai works for **owners and members**, with refusal reasons visible, counts correct, and agent controls honoured on every path including automation-triggered runs") and names the three defect lists as the inputs. The criteria are therefore those lists: `review-static.md` 1–24, `findings-api.md` F1–F7, the router finding from `findings-browser.md`, and the two halves of the goal. Verified against `origin/beta` at `71c9332f` on 2026-09-12. Everything ticked landed in `1fd5d178` (#543).

**Static review — HIGH**

- [x] 1 Rule-triggered runs bypass agent controls — `Modules/Automations/engine/actions/runAgent.js` resolves the named agent (L21), `runs.canStart({ trigger: 'rule' })` (L58), `runs.start` (L70), `runs.executeSkill` (L81); `tests/agent-automation-run.test.js` — `1fd5d178` (#543)
- [x] 2 "Run now" always fails — `views/Ai/RunTaskPicker.vue` and `runNow(agentId, taskId)` — `1fd5d178` (#543)
- [x] 3 Refusal reasons never reach the UI — `reasonOf(error, fallbackKey)` at `views/Ai/useAgents.js:36`, used by every mutation and imported by 10+ views — `1fd5d178` (#543)
- [x] 4 Inbox counts and tabs read fields the API never sends — `Modules/Agents/proposals.js:160` sends `waiting`/`doneByAi`/`declined`; `AiInbox.vue:42,44,206` reads them — `1fd5d178` (#543)
- [x] 5 Approve/decline not atomic — `proposals.setStatus(..., { onlyIf: STATUS.PENDING })` claims the row before any perform (`proposals.js:208,247`); the loser gets 409 (L179); `tests/agent-proposal-atomic.test.js` — `1fd5d178` (#543)
- [x] 6 Teammate person assignment is a no-op — now calls the task assignee endpoint — `1fd5d178` (#543)

**Static review — MEDIUM**

- [x] 7 Stopped runs resurrected, no reaper — terminal writes conditioned on `status: running`; `runs.reapStale` (`runs.js:181`) called at boot from `Modules/Agents/init.js:39`; `tests/agent-run-lifecycle.test.js` — `1fd5d178` (#543)
- [x] 8 Schedule and rate limit stored but never enforced — daily limit enforced in `runs.canStart` ("Daily run limit reached (n of m today)."); the `schedule` field is gone from every `/ai` screen (0 form hits) — `1fd5d178` (#543)
- [x] 9 Approval bypasses `allowedActions` — `proposals.js:218` passes `allowedActions: agent.allowedActions` — `1fd5d178` (#543)
- [x] 10 Skipped runs counted as clean — `runs.STATUS.SKIPPED` (`runs.js:15`), `countsByStatus` (`runs.js:264`) on `GET /agents/runs/summary`, `agentFit.historyFor` excludes it — `1fd5d178` (#543)
- [x] 11 Routing sentence "[object Object]" — `skillKeyOf` + the `Parity.rule_sentence` i18n line — `1fd5d178` (#543)
- [x] 12 Skill Library CLI command omits `?companyId=` — `views/Ai/mcpUrl.js` is the single source — `1fd5d178` (#543)
- [x] 13 Task panel agent strip never fed — `TaskDetailPanel.vue` loads the task's open run and passes it with `onStop` — `1fd5d178` (#543)
- [x] 14 Picker options dropped — `startRun` validates and persists `spendCapUsd` (`controller.js:52,434,451`) and `notifyMe`; the run-level cap is enforced pre-call by `engine/spendGuard.js`; `tests/agent-run-options.test.js` — `1fd5d178` (#543), tightened later by the spend guard
- [x] 15 No way to delete an agent — `app.delete('/api/v2/agents/:id')` at `Modules/Agents/routes.js:68`; `tests/agent-delete.test.js` — `1fd5d178` (#543)

**Static review — LOW**

- [x] 16 Silent failures — toasts carry the API reason on pause / resume / pause-all / stop / save — `1fd5d178` (#543)
- [x] 17 `refusals` shape — stays a number, `$inc`ed per `RefusedError` — `1fd5d178` (#543)
- [x] 18 "Today" vs month-to-date — the card line says month runs and spend — `1fd5d178` (#543)
- [x] 19 L4 rung shown but clamped — `grep -ran "L4" frontend/src/views/Ai/` returns 0; the ladder in `useAgents.js:7-12` stops at L3 — `1fd5d178` (#543)
- [x] 20 "Review in AI inbox" routed to AiHub — now routes to `AiInbox` — `1fd5d178` (#543)
- [x] 21 Token expiry never shown — `expiryOf(token)` in Accounts — `1fd5d178` (#543)
- [x] 22 Hardcoded AGENT chips and English fit reasons — `$t` chips; `agentFit.js` reasons carry `{ code, params }` rendered by `views/Ai/fitText.js` — `1fd5d178` (#543)
- [x] 23 Missing load-error and loading states — `EmptyState` with retry on Inbox, Skill Library, Teammates, Routing, Pipeline, Release — `1fd5d178` (#543)
- [x] 24 Members see Approve on gated proposals — `canDecide` hides the buttons unless owner/admin — `1fd5d178` (#543). The second half of this finding (any member could create, edit, pause and pause-all agents) was left as a product decision here and was later closed as AGT-01 to AGT-11 by PR #620 (build 92) under task 034.

**Live API / MCP sweep**

- [x] F1 Manual runs skip finding memory — `executeSkill` consults finding memory on every trigger — `1fd5d178` (#543)
- [x] F2 PAT over MCP attributed as human — `Modules/Mcp/server.js:49` sets `req.mcp`; `Modules/Agents/actor.js:58` treats any MCP call as an agent actor; `tests/agent-mcp-actor.test.js` — `1fd5d178` (#543)
- [x] F3 `docs.read` returned "" — `pageText()` strips `content.html` first; `tests/mcp-docs-read.test.js` — `1fd5d178` (#543)
- [x] F4 L2 run fails wholesale on one refused action — refused direct actions are recorded and the run continues — `1fd5d178` (#543)
- [x] F5 Double audit rows per agent action — `auditedByCaller` on the actions context; `tests/agent-audit-single-row.test.js` — `1fd5d178` (#543)
- [x] F6 `autonomy > 3` silently clamped — 400 "autonomy must be between 0 and 3" at `controller.js:45`; `tests/agent-autonomy-validation.test.js` — `1fd5d178` (#543)
- [x] F7 pause-all stopped waiting runs — `runs.js:278-288` touches only queued and running; `tests/agent-pause-all.test.js` — `1fd5d178` (#543)

**Browser sweep finding**

- [x] Router assigned agents to tasks lacking the skill's input — `Modules/Agents/taskInputs.js`, `GET /api/v2/agents/routable` (`routes.js:18`), `agentFit.SKILL_INPUTS` (`agentFit.js:110`) with the server mirror in `taskSplit.js:68` pinned by `tests/agent-split-parity.test.js`; `routeTasks` refuses with the reason — `1fd5d178` (#543)

**The goal, both halves**

- [x] Owner pass — `/ai` hub cards, Run now, Inbox counts and routing all verified in the browser on the merged branch (2026-09-05 entry below); task 034 re-opened all 11 `/ai` screens as owner on 2026-09-11 with no console errors
- [ ] **Member pass — outstanding.** The API half is done: task 034's `findings/agents.md` exercised 45 of 50 agent routes as a member and 44 as a guest on 2026-09-11, raising AGT-01 to AGT-11, all fixed by PR #620 (build 92). The **browser** half was never run — 034's own coverage table records "Screens opened (11 total) | 11 | – | – | –", owner only. The stated blocker is gone: `docs/QA-DEMO-TEAM.md` and `npm run demo:seed` / `demo:token` now provide six members, an admin and a guest.
- [ ] **`agent_run` notification row renders with a name — state unknown.** `Modules/Agents/runs.js:340` still sets the notification's sender to `String(run.agentId)`, which will not resolve in the users collection, while the body text at L337 does interpolate `run.agentName`. Whether the row actually paints without a name needs the app open, and nothing records a check. Task 015's `task.md` holds its reminder scope behind this same item, so it is blocking something.

## Last step

Audited 2026-09-12. Every defect from all three review lists is fixed and on `beta`. The task stays in `active/` because the goal's member half is only half met — members were swept at the API level by task 034 (defects fixed in #620) but no `/ai` screen has ever been opened as a member — and because the `agent_run` notification row was never looked at.

## Blockers

None. The member account that blocked the browser sweep exists now (`docs/QA-DEMO-TEAM.md`, `npm run demo:token`).

## Log

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

## 2026-09-12 — record audited

Checklist above rebuilt from `review-static.md`, `findings-api.md` and `findings-browser.md` and checked against `origin/beta` at `71c9332f`.

- All 24 static defects, all seven API defects (F1–F7) and the router finding are fixed and present on `beta`; all twelve named test suites exist.
- The stale "in progress" status line was wrong in both directions: the work merged on 2026-09-05 as PR #543 (build 20), and two items remain — the member-role **browser** sweep of the `/ai` screens, and the unchecked `agent_run` notification row.
- What changed since this file was last written: defect 24's second half (members able to manage agents) was closed as AGT-01 to AGT-11 by PR #620 under task 034, and the member-account blocker recorded here was resolved on 2026-09-11 by the demo team seed (#593). The browser sweep itself was simply never re-run.
- YAML frontmatter added to `task.md` (it had none) and the `Status:` line rewritten to name what remains. Task stays in `active/`.
