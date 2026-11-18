---
id: 026
title: Sprint 3 — observability foundation
status: done
priority: high
depends_on: [024]
created: 2026-09-10
---

# 026 — Sprint 3 — observability foundation

Status: done · depends on 024 · sprint 3 · two weeks · branch `feat/sprint-3-observability-foundation` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 3. Filed 2026-09-10.

## Goal
The eight questions in section H of the document have a lookup, not an inference. Lands before routing because routing cannot be evaluated without it.

## Scope
1. OpenTelemetry with the trace identifier on the run row, every step row, every audit row and every log line; logs move to structured records; the exporter is off unless an endpoint is configured.
2. The replay record per model call: prompt hash and reference, retrieved chunk identifiers, raw response, model and parameters, agent and skill revisions, with a retention and redaction policy. (absorbs 019 "trace per run")
3. A metrics endpoint behind admin auth: rate, errors and duration per workflow, step, agent and model; token and cost counters; approval, decline and revert rates. (absorbs 019 "dashboard in /ai", the health half)
4. Provider error codes preserved end to end and grouped, so an error tracker has something to group.
5. Alerts on rates: error rate per agent, approval rate falling, cost against forecast, queue age.
6. (added) The two competing uncaught-exception handlers collapse into one path that reports, flushes and exits.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| H Observability | Run detail → trace | extend | A timeline of steps, the model call and every tool call with durations, tokens, cost and the decision on each; link to the replay record |
| H Observability | Run detail → replay | new | The prompt sent, the retrieved passages and the raw response, redacted per policy, for owners and admins |
| H Observability | AI hub → health | new | Error rate, approval rate and cost per agent and per workflow over time, sortable |
| H Alerts | Notification settings | extend | Owners and admins choose which rate alerts reach them |

## Defects closed
#21 from the document's defect table.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] From a run identifier, the prompt, the retrieved context, the raw response and every tool call are reachable in under a minute.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- The replay record is written from the core's single model call, which is why Sprint 1 comes first.
- Task 019 kept its eval scope and hands its trace and health-dashboard items to this task.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
