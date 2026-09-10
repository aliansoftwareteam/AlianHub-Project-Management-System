---
id: 027
title: Sprint 4 — the model router
status: backlog
priority: high
depends_on: [024, 026]
created: 2026-09-10
---

# 027 — Sprint 4 — the model router

Status: backlog · depends on 024, 026 · sprint 4 · two weeks · branch `feat/sprint-4-model-router` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 4. Filed 2026-09-10.

## Goal
Any task can run on any configured provider, and the platform survives one being down.

## Scope
1. Model and provider on the chat options; a provider registry that includes a Google adapter alongside OpenAI, Anthropic and DeepSeek; per-provider normalisation of output ceilings, structured-output mode, reasoning-model parameters and error codes.
2. Task classes with a quality floor, latency target and input budget each; a per-tenant policy table; per-agent and per-skill model pins validated against a priced allowlist. (ADR 003 phase 3, cost half)
3. Health tracking per provider and model with a circuit breaker, half-open probes, failover to the next candidate, and per-provider rate-limit budgets as token buckets; retry with backoff on transient provider errors.
4. Pre-flight token estimate, reservation against the tenant budget, reconciliation after; the routing decision and its reasons written to the model-call span and the replay record.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| F Routing | Instance console → providers | new | Each provider and model with health, breaker state, rate-limit budget and whether it is priced; a loud warning when a pinned model has no price |
| F Routing | Workspace settings → routing policy | new | Task class to model preferences with quality floor and latency target, per workspace |
| F Routing | Agent and skill settings → model pin | extend | Pin a model per agent or per skill from the priced allowlist (shared with Sprint 6) |

## Defects closed
None directly.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] With one provider blackholed in a test environment, agent runs continue on the fallback and the breaker state is visible.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Behind a router flag whose default policy reproduces today's single-provider behaviour, so flipping it is a no-op until a policy is set. The Google adapter ships with the same contract tests the other three pass.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
