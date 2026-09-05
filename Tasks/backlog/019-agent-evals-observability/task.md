# 019 — Evals and observability for agent runs

Status: backlog · starts with 016, ongoing · branch per change

## Goal
A prompt or harness change cannot silently degrade the agents, and every run can be explained after the fact from one record.

## Scope (from research [40][56][67][74])
- **Eval set:** 20–50 real tasks from this workspace (brief → plan, qa-review, pr.summary, routing), each with an outcome check on resulting state (rows exist, no collateral changes) and a rubric; graded by code first, model-rubric second. Replayed by `npm run evals` with a fake model for structure and a real model gated behind a flag.
- **Trace per run:** one record linking plan, every tool call, policy decisions, approvals, cost and resulting domain events; OpenTelemetry GenAI attribute names for tokens and cost so it can be exported.
- **Dashboard in /ai:** escalation rate, approve/decline rate, skips by reason, cost per skill, revert count.
- **Regression rule:** a change to any prompt under `Modules/Agents/skills` or `Modules/AIProjectGenerator/prompts` must run the eval set in CI.

## Acceptance
- [ ] Eval suite runs in CI on prompt changes and fails on a seeded regression.
- [ ] `GET /agents/runs/:id` returns the trace; the run page shows it.
- [ ] Dashboard numbers match the audit rows for a seeded week.
