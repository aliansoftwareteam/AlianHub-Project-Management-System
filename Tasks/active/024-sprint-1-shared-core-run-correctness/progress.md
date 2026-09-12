# Progress: Sprint 1 — shared AI core and run correctness

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: `Modules/AICore/` (provider factory, usage, instruction guard, `modelCall`, persistence) with shims at every old path; ProjectTemplates onto the factory; boundary conventions test — #566 `db21784a`; consumers repointed and the shims deleted in one PR, #575 `255be10d`, because jest mocks tie each test to its consumer
- [x] Step 2: `idempotencyKey`, partial unique indexes, `runs.start` insert-and-catch, reaper `agent.reap-stuck-proposals` every 5 min — #570 `bacb9207`
- [x] Step 3: `Modules/Agents/engine/timeouts.js`; Agenda `lockLifetime` 17 min with `job.touch()` between graph nodes; server, SSE and Mongo timeouts — #569 `0a13449c`
- [x] Step 4: `triggerDepth`/`triggerEventId` on the run; `canStart` refuses `loop_depth_exceeded` at depth 3; actions emit depth + 1 — #568 `8b84214c`
- [x] Step 5: `Modules/AICore/spend.js` meters every `chat()` into `ai_usage` by feature; budget sums the ledger; Instance console per-feature breakdown — #572 `3dc9d97f`
- [x] Step 6: `Modules/AICore/estimate.js` + `spendGuard` reserve/reconcile/release on `reservedUsd`; `spend_cap_exceeded` before the vendor call — #571 `8d618a29`
- [x] Step 7: `expiresAt` set only by `terminalUpdate`; migration `008-agent-run-expiry`; approve refuses `run_missing` — #567 `03675ee7`
- [x] Interface: Instance console → AI agents (extend) — per-feature spend in #572; owner and member sweep still to record
- [x] Defects closed: #12 (#570), #13 (#569), #14 (#568), #15 (#571), #16 (#567), #18 (#572)
- [ ] Exit gate met and gates green — code gates green on `beta` at `3dc9d97f`; migration 008, the in-process sweep, and the owner/member sweeps still to run; consumer repoint and shim deletion still open

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 1) |
| 2026-09-11 | Steps 1–7 merged into `beta` as seven PRs (#566–#572). Four needed a rebase over the run-schema changes (#568, #569, #570, #571, #572 in turn) because every step touched `agent_runs`. Gates on merged beta: backend 155 suites / 1857 tests, conventions 92, frontend vitest 129, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done. Cross-links to tick on 006: budgets pre-call (step 6) and usage accounting (step 5). |
| 2026-09-11 | Deviations: `trigger.depth` stored flat as `triggerDepth` because `trigger` is a string enum; `transcribe.js` and `probes.js` still name a vendor host (allowlisted, not chat calls); the reaper also fails the run waiting on a stuck proposal; the pre-call guard exempts personal and local accounts; migration 008 uses `syncIndexes`, which drops any undeclared index on `agent_runs`. |
| 2026-09-11 | Step 5 on `feat/s1-spend-at-core`: `Modules/AICore/spend.js` meters every `chat()` into a new `ai_usage` collection keyed by feature (`Modules/AICore/features.js`); `budget.js` sums the ledger; Instance console card shows spend per feature. Closes defect #18. |
| 2026-09-11 | Step 6 on `fix/s1-precall-spend-cap`: `Modules/AICore/estimate.js` prices a call before it is made; `Modules/Agents/spendGuard.js` reserves it on the run (`reservedUsd`, atomic `$inc`), refuses over the run cap or the company month as `spend_cap_exceeded` with an audit row, reconciles to the real cost after. Reproduced on beta first: the fake provider was called for a run capped under its estimate. Closes defect 15 and 006's "spend cap evaluated after the model call". |
| 2026-09-12 | `npm run migrate -- status` on the dev database reports nothing to do: every migration through 014 is applied, so the outstanding migration step for sprints 0–2 is done. The AI agents spend card still needs an instance-owner sweep. |

## Last step
All seven steps merged. Remaining: run migration 008 on the dev database; the in-process sweep; the owner and member sweep of the Instance console spend card; then move 024 to `done/`.
