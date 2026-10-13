# 016 — API contract, workstream B (revert, budgets, settings, L1 default)

Agreed before build. Every route sits under the existing `/api/v2/agents` JWT + companyId prefix and answers in the module's `{ status, statusText, data }` shape; error codes below are HTTP status codes on a `{ status: false, statusText, message }` body.

## POST /api/v2/agents/runs/:id/revert

Who: an Owner or Admin, or the person who started the run (`run.startedBy`). Agents cannot revert.

Walks the run's `agent.action` audit rows (`meta.runId === run._id`) newest first and applies each row's undo descriptor through `undo.undoAuditRow` — the same path a proposal undo takes. Failures do not stop the walk.

Response `data`:
```json
{ "reverted": 5, "alreadyUndone": 0, "failed": [{ "action": "task.comment", "auditId": "…", "reason": "not undoable" }], "windowEndsAt": "2026-09-06T10:00:00.000Z" }
```

Refusals:
- 404 — run not found.
- 403 — caller is neither privileged nor the run's starter.
- 409 — the run is still `queued` / `running` / `waiting_approval` ("stop it first"), the run was already reverted, the run made no reversible changes, or the window has closed: `now >= run.finishedAt + undoHours`. The reason names the window end and the setting.

Side effects: the run gains `revertedAt`, `revertedBy` (user id) and `revert: { reverted, failed }`; one `agent.run_reverted` audit row (entity `agent_run`) with the counts; the run event is emitted; every undone action row gets `meta.undoneAt/undoneBy` and its own `agent.action_undone` row, as today.

## GET /api/v2/agents/runs/:id

Unchanged, except a reverted run's payload carries `revertedAt`, `revertedBy` and `revert`.

## GET /api/v2/agents/settings

Any member. Response `data`:
```json
{ "undoHours": 24, "monthlyBudgetUsd": 0, "provider": { "name": "anthropic", "hasKey": true, "region": null } }
```
`provider` is read-only, from the instance environment: `name` is the provider `Modules/AIProjectGenerator/llmProvider` resolves (or `LLM_PROVIDER` when that one is not fully configured, `null` when nothing is set); `hasKey` says whether that provider's key env var is set; `region` is `LLM_REGION` or `null`. The key itself is never returned.

## PUT /api/v2/agents/settings

Owner/Admin only (403 otherwise). Body: any of `undoHours`, `monthlyBudgetUsd`.
- `undoHours` — integer 1–168.
- `monthlyBudgetUsd` — number ≥ 0; 0 means no budget.
Anything else → 400 with the reason, nothing written. Stored on the company row as `agentUndoHours` / `agentMonthlyBudgetUsd`; the `companyData_<companyId>` cache is cleared on write. Responds with the settings shape above.

## GET /api/v2/agents/budget

Any member. Response `data`:
```json
{ "month": "2026-09", "usedUsd": 12.5, "budgetUsd": 50, "percent": 25, "alerts": { "80": null, "100": null } }
```
`usedUsd` is the sum of `spend.usd` over the company's runs started this month (personal/local runs bill 0). `percent` is 0 when there is no budget. `alerts` carry the ISO time the 80% / 100% alert fired this month, or `null`.

## Enforcement and alerts

- `runs.canStart(agent, { companyId })` adds a company budget check after every existing check: at ≥ 100% it returns `{ ok: false, reason: 'Company agent budget reached ($x of $y this month).' }`. Manual starts, mentions and rule-triggered runs (`runAgent.js` calls `canStart`) are all refused with that reason.
- `runs.recordSpend` — after a billed run's spend is written, the first time the month crosses 80% and the first time it crosses 100%, every Owner and Admin gets one in-app notification through `handleNotificationtFun` (type `tasks`, key `task_notification`, changeType `agent_budget`, the tipping run's project and task as context). The alert time is stored on the company row as `agentBudgetAlerts: { month, "80", "100" }`, so it fires once per month per level.

## Agent creation default

`POST /api/v2/agents` without `autonomy` creates the agent at **L1 Suggest** (`autonomy: 1`). An explicit `autonomy` is still validated as an integer 0–3.
