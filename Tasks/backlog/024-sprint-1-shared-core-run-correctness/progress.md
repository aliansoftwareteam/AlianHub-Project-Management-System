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

## Last step
Not started.
