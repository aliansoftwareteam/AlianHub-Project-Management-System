# 016 — progress

Branch `feat/agent-trust-layer` (from `beta` 1989b987). Three parallel workstreams, merged 2026-09-05.

| Item | What landed | Tests |
|---|---|---|
| Risk ratings | Every registry action carries `{ write, reversible, scope, money }`; `actions.manifest()` exposes them on `GET /agents/registry`; a test fails when an action is added unrated | `agent-actions-rated` (33) |
| Policy-reviewed L2 | `Modules/Agents/policy.js`: never-list → allowedActions → projectIds → param checks → reads act → L0/L1 propose writes → L2/L3 act only on reversible task-scoped non-money writes, else propose; `executeSkill` reviews each change, applies the safe ones, files one proposal for the rest, records `decisions[]` on the run | `agent-policy` (43), `agent-run-policy` (16) |
| Whole-run revert | `POST /agents/runs/:id/revert` walks the run's audit rows newest first through the existing undo path; window = `finishedAt + undoHours`; 409 while open / after window / already reverted; owner, admin or starter; partial failures reported; `windowEndsAt` on the run payload | `agent-revert` (8) |
| Budgets | `Modules/Agents/budget.js`: company monthly budget, `canStart` refuses at 100% (manual and rule-triggered), 80%/100% alerts to owners and admins once per month through the notification pipeline | `agent-budget` (10) |
| Settings | `GET/PUT /agents/settings` (undo hours 1–168, budget ≥ 0, provider name / key present / region — never the key); `LLM_REGION` documented; new agents default to **L1** | `agent-settings` (20) |
| UI | "What L2 will do without asking" panel from ratings (`policyPreview.js`); run detail with decisions and Revert; wizard defaults to L1; instance console "AI agents" section with budget bar and alert chips | vitest 65 |

Gates on the merged branch: `npm test` 1581 (129 suites), lint 0 errors, vitest 65, i18n check clean after backfill (49 new keys).

Notes for review
- L2 now proposes `task.create`, `task.sprint.move`, `page.draft` (project scope) and `chat.post`, `reminder.create` (irreversible) where it used to act. `timelog.*` rated `money: false` — a product call.
- The 80/100 alert stamp is read-then-write; two runs finishing in the same instant could notify twice.
- Stored proposals now keep each change's `rating`.

Open
- Browser sweep as owner and member of: L2 run with a mixed batch, revert, budget alert, settings panel.
- 019 evals should start from the `decisions[]` data this produces.
