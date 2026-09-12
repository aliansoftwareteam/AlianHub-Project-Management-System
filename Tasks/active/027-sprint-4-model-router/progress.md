# Progress: Sprint 4 — the model router

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Model and provider on the chat options; a provider registry that includes a Google adapter alongside OpenAI, A
- [ ] Step 2: Task classes with a quality floor, latency target and input budget each; a per-tenant policy table; per-agent 
- [ ] Step 3: Health tracking per provider and model with a circuit breaker, half-open probes, failover to the next candidat
- [ ] Step 4: Pre-flight token estimate, reservation against the tenant budget, reconciliation after; the routing decision a
- [ ] Interface: Instance console → providers (new)
- [ ] Interface: Workspace settings → routing policy (new)
- [ ] Interface: Agent and skill settings → model pin (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 4) |
| 2026-09-12 | Started. Step 1 (provider registry with a Google adapter, model and provider on the chat options, per-provider normalisation) is in progress on `feat/sprint-4-provider-registry`. Steps 2–4 wait for it, because they build on the registry. Task 035's follow-ups are closed apart from the owner decisions and items 14, 26 and 48–51. |

## Last step
Step 1 in progress.
