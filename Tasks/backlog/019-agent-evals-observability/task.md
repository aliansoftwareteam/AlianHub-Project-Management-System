---
id: 019
title: Sprint 9 — evals and routing measurement
status: backlog
priority: medium
depends_on: [026, 027, 030]
created: 2026-09-10
---

# 019 — Sprint 9 — evals and routing measurement

Status: backlog · depends on 026, 027, 030 · sprint 9 · two weeks · branch `feat/agent-evals` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 9. Filed 2026-09-10.

## Goal
A routing or prompt change is a measured business decision, and every run can be explained after the fact from one record.

## Scope
1. A golden set of fifty to two hundred real tasks per task class (brief → plan, qa-review, pr.summary, routing, retrieval), each with an outcome check on the resulting state and a rubric, graded by code first and a model rubric second; injection cases per class; replayed by `npm run evals` with a fake model for structure and a real model behind a flag.
2. Online outcome metrics per model and class from what the trust layer already records: approval rate, decline reasons, revert rate, edit distance, repair rate; cost per approved change as the summary number; a held-out slice; canary comparison per agent revision.
3. Dashboards and the rate alerts from Sprint 3 wired to these metrics; the regression rule that a change to any prompt under `Modules/Agents/skills` or `Modules/AIProjectGenerator/prompts` runs the eval set in CI.
4. (carried) 006's prompt-injection regression test on the run path is the injection slice of the golden set; 006's two-week acceptance trial is the first held-out comparison.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| F Evaluation | AI hub → routing outcomes | new | Approval rate, decline reasons, revert rate, edit distance and cost per approved change, per model and per task class, with the held-out comparison |

## Defects closed
None directly.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] The cheaper-model scenario is answered from data for at least three task classes; the eval suite fails on a seeded regression in CI.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Rewritten 2026-09-10 from the original 019: the eval set grew from 20–50 to 50–200 per class per the architecture document; the trace-per-run and health-dashboard items moved to 026, where the replay record lives.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
