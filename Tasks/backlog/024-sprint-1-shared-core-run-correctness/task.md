---
id: 024
title: Sprint 1 — shared AI core and run correctness
status: backlog
priority: high
depends_on: [023]
created: 2026-09-10
---

# 024 — Sprint 1 — shared AI core and run correctness

Status: backlog · depends on 023 · sprint 1 · two weeks · branch `feat/sprint-1-shared-core-run-correctness` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 1. Filed 2026-09-10.

## Goal
One AI core, and an agent run that cannot execute twice.

## Scope
1. Move the provider factory, usage and pricing, the instruction guard, the single model call and the persistence factory into `Modules/AICore/`, leaving re-export shims at every old path so the thirteen consumers and their test mocks keep working. Move the one direct-to-vendor call (`Modules/ProjectTemplates/controller.js`) onto the factory. (ADR 003 phase 0)
2. Agent runs gain an idempotency key and an in-flight claim: a partial unique index on agent, task and open status, checked with a duplicate-key catch rather than find-then-insert, and a reaper for proposals stuck in the applying state.
3. Align the job lock with the model timeout per job, and set the server-level timeouts that are missing today.
4. Thread loop depth from the originating envelope through agent actions instead of resetting it to zero (`Modules/Agents/actions.js` context).
5. Record spend at the core boundary so every AI feature, not only agent runs, reaches the budget.
6. Check the run spend cap before the model call from a token estimate, and reconcile after.
7. (added) The run collection's expiry is keyed to terminal status only, so a run waiting on a person is never deleted under its proposal.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| H Cost | Instance console → AI agents | extend | Spend from every AI feature, not only agent runs, against the budget, with the alert thresholds already shown |

## Defects closed
#12, #13, #14, #15, #16, #18 from the document's defect table.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] Full backend and frontend suites green; a double-submitted run start yields one run; a rule-triggered run under a slow model produces one execution.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- The shims make this a pure move; tests move with the code in the same commit. Consumers are repointed one module per pull request after the core lands, then the shims are deleted.
- Closes 006's remaining item "spend cap evaluated after the model call".
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
