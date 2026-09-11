# Progress: Sprint 1 — shared AI core and run correctness

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Move the provider factory, usage and pricing, the instruction guard, the single model call and the persistence
- [ ] Step 2: Agent runs gain an idempotency key and an in-flight claim: a partial unique index on agent, task and open stat
- [ ] Step 3: Align the job lock with the model timeout per job, and set the server-level timeouts that are missing today.
- [ ] Step 4: Thread loop depth from the originating envelope through agent actions instead of resetting it to zero
- [ ] Step 5: Record spend at the core boundary so every AI feature, not only agent runs, reaches the budget.
- [ ] Step 6: Check the run spend cap before the model call from a token estimate, and reconcile after.
- [ ] Step 7: (added) The run collection's expiry is keyed to terminal status only, so a run waiting on a person is never de
- [ ] Interface: Instance console → AI agents (extend)
- [ ] Defects closed: #12, #13, #14, #15, #16, #18
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 1) |
| 2026-09-11 | Step 5 on `feat/s1-spend-at-core`: `Modules/AICore/spend.js` meters every `chat()` into a new `ai_usage` collection keyed by feature (`Modules/AICore/features.js`); `budget.js` sums the ledger; Instance console card shows spend per feature. Closes defect #18. |
| 2026-09-11 | Step 6 on `fix/s1-precall-spend-cap`: `Modules/AICore/estimate.js` prices a call before it is made; `Modules/Agents/spendGuard.js` reserves it on the run (`reservedUsd`, atomic `$inc`), refuses over the run cap or the company month as `spend_cap_exceeded` with an audit row, reconciles to the real cost after. Reproduced on beta first: the fake provider was called for a run capped under its estimate. Closes defect 15 and 006's "spend cap evaluated after the model call". |

## Last step
Step 5 implemented, awaiting review (PR from `feat/s1-spend-at-core`).
