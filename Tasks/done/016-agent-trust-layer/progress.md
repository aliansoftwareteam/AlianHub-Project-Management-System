# 016 — progress

Branch `feat/agent-trust-layer` (from `beta` 1989b987). Three parallel workstreams, merged to `beta` as PR #545, merge commit `a50c9f42`, build `14.36.0-beta.22`. The revert-schema fix found by the API sweep landed as PR #547, build 24.

## Checklist

One line per bullet of `task.md` "## Acceptance". Verified against `origin/beta` at `71c9332f` on 2026-09-12.

- [x] Every registry action has a rating; a test fails when one is added without it — `Modules/Agents/actions.js:32` `RATING_KEYS`, the `RATINGS` table at L35-54 with 18 entries against 18 keys in `registry.js`, `unrated()` at L60; `tests/agent-actions-rated.test.js` parametrises over `registry.keys()` and asserts `unrated()` is empty, and proves a new key surfaces — `a50c9f42` (#545)
- [x] L2 run with one risky action: safe actions apply, the risky one becomes a proposal, the run ends `waiting_approval` with `decisions[]` explaining each — `Modules/Agents/policy.js` returns `{ decision, reason, rating }` with named reasons; `decisions[]` is initialised at `runs.js:119` and appended at `engine/graph.js:134-137`; `tests/agent-policy.test.js` (43) and `tests/agent-run-policy.test.js` (16) — `a50c9f42` (#545). Caveat kept from the sweep below: the mixed safe-plus-risky batch was never exercised live on `beta`, because the seeded agents' skills only emit task-scoped writes; it is covered by tests only.
- [x] Revert of a run with 6 actions restores all 6; a revert after the window is refused with the reason; partial failure reports which actions did not revert — `POST /api/v2/agents/runs/:id/revert` at `routes.js:51`; `Modules/Agents/revert.js` takes the window from `budget.settings(companyId).undoHours` (stored as `company.agentUndoHours`, not `company.settings.agentUndoHours` as `task.md` wrote it) and builds a `failed[]` of `{ action, auditId, reason }`; `AgentRunDetail.vue:71` renders the partial case; `tests/agent-revert.test.js` (8) — `a50c9f42` (#545), made durable by `#547` after the API sweep found the run schema was silently dropping `revertedAt`/`revertedBy`
- [x] Company at 100% budget: new runs refused, rule-triggered runs refused, owner notified once — `Modules/Agents/budget.js` `check()` at L145 refuses with "Company agent budget reached ($X of $Y this month)."; `LEVELS = ['80','100']` at L22 with once-per-month alert stamps; `runs.canStart` calls it, and `runAgent.js` goes through `canStart`, so rule-triggered runs are refused on the same path; `tests/agent-budget.test.js` (10) — `a50c9f42` (#545)
- [ ] Gates: `npm test`, vitest, i18n check, lint, build, **browser sweep as owner and member** — **partly delivered.** The gates were green at merge (1581 backend tests, vitest 65, lint 0, i18n clean) and CI on the tip of `beta` is green (`gh pr checks 684`: backend, frontend, e2e all pass). The owner browser sweep is recorded below and passed. **Outstanding: the member sweep.** Members were swept at the API level by task 034 on 2026-09-11 (`findings/agents.md`), which raised AGT-01 to AGT-11 — all fixed by PR #620 — but its coverage table records "Screens opened (11 total) | 11 | – | – | –", owner only. The build-141 member browser pass logged in the sprint tasks explicitly excludes the trust layer's own screen: it lists "the AI agents spend card" among the things still to sweep.

Also delivered, beyond the acceptance list: `GET/PUT /api/v2/agents/settings` with undo hours 1–168 and budget validation (`routes.js:22-23`, `budget.js:20-21,53,58`; `tests/agent-settings.test.js`), `views/Ai/policyPreview.js` feeding the "What L2 will do without asking" panel at `AgentSettings.vue:54`, the instance console panel at `views/Settings/Instance/InstanceAgents.vue`, and the L1 default for a new agent (`controller.js:146`).

## Last step

Audited 2026-09-12. Four of the five acceptance bullets are delivered and on `beta`. The task stays in `active/` for the last half-bullet: no trust-layer screen has ever been opened as a member, and the one member browser pass that has happened named the AI agents spend card as still unswept.

## Blockers

None. The member account that blocked the sweep exists now (`docs/QA-DEMO-TEAM.md`, `npm run demo:token`).

## Log

### 2026-09-05 — what landed

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

Finding (pre-existing, task 013 area; fixed in PR #549): loading `/settings/instance/settings` directly bounces to My Profile because the shell checks instance access after mounting; navigating from inside the settings shell works. Worth a guard that waits for the access answer.

## 2026-09-12 — record audited

Checklist above rebuilt from `task.md` "## Acceptance" and checked against `origin/beta` at `71c9332f`.

- Ratings, policy, revert and budgets are all present on `beta` with their six test suites; the only unmet acceptance is the member half of the browser sweep.
- The status line claimed "merged 2026-09-05 (PR #545), member-role sweep open", which was true but did not say the task was still `active` or what the sweep would cover; it now does, and `task.md` gained the YAML frontmatter it never had.
- The member-account blocker recorded here was resolved on 2026-09-11 by the demo team seed (#593); the sweep was simply never re-run.
- Still noted for elsewhere: 019 evals should start from the `decisions[]` data this produces. The pre-existing instance-settings routing finding recorded above was fixed in PR #549.
