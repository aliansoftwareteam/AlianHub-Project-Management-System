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

## 2026-09-05 — API sweep on beta (owner token)
- `GET /agents/registry`: 18 actions, 18 rated.
- `GET /agents/settings`: undoHours 24, budget 0, provider openai with key, no region; `PUT {undoHours: 999}` → "undoHours must be a whole number between 1 and 168."
- `GET /agents/budget`: month 2026-09, used $0.12, no alerts.
- Throwaway L2 agent (brief.parse, task.get/comment/subtask.create) on a task with a 347-char brief: 8 changes, every one decided `act` with the reason "reversible task-scoped write with no money in it", run `done`, `decisions[]` has 8 entries, `windowEndsAt` = finishedAt + 24 h.
- `POST /runs/:id/revert`: 8 reverted, 0 failed. **Defect found:** `revertedAt` / `revertedBy` / `revert` were not stored because the strict `agentRuns` schema lacked them, so a second revert was accepted. Fixed by declaring the fields (this PR); after the fix a second revert answers 409 "Run was already reverted at …".
- A mixed batch (safe + risky) was not exercised on beta because the seeded agents' skills only emit task-scoped writes; covered by `agent-run-policy` tests.

## 2026-09-05 — UI sweep on beta (owner, Browser pane)
- **Agent settings, L1 default:** the Guide agent created by 015 opens at "L1 · Suggest"; the "What L2 will do without asking" panel lists task.get (read only), task.comment and subtask.create ("reversible, one task, no money") under "Acts without asking" and "Nothing" under "Proposes first".
- **Policy on a real L2 run:** Run now on "Sweep Intake" (L2, actions task.get / task.comment / tasks.search) against GCBA2-3 → run `done`, "6 refused"; Details shows DECISIONS: six `subtask.create` refused ("outside this agent's allowed actions"), one `task.comment` acted ("reversible task-scoped write with no money in it"), "Can be reverted until 06/09/2026 15:01".
- **Revert in the UI:** "Revert this run" → toast "Reverted 1 action(s).", row shows "Reverted 05/09/2026 15:02:44", button gone. (The schema fix in PR #547 is what makes the reverted state stick.)
- **Instance console → Settings → AI:** "AI agents" section with undo window 24 h, monthly budget 0, "This month 2026-09 $0.14 · no cap", "80% alert not reached / 100% alert not reached" chips, provider openai · Region: any · "Key set".

Finding (pre-existing, task 013 area): loading `/settings/instance/settings` directly bounces to My Profile because the shell checks instance access after mounting; navigating from inside the settings shell works. Worth a guard that waits for the access answer.

Open
- Member-role pass — needs a member account.
- 019 evals should start from the `decisions[]` data this produces.
