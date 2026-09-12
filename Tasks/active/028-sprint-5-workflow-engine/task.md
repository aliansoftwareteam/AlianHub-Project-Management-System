---
id: 028
title: Sprint 5 — the workflow engine
status: active
priority: high
depends_on: [024, 027]
created: 2026-09-10
---

# 028 — Sprint 5 — the workflow engine

Status: active · depends on 024, 027 · sprint 5 · three weeks · branch `feat/sprint-5-workflow-engine` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 5. Filed 2026-09-10.

## Goal
Multi-step, multi-agent work is durable, parallel where safe, and resumable at any step.

## Scope
1. Workflow runs and step runs as the unit of everything, generalised from the automation runner: dependencies, ready-set scheduling, per-tenant concurrency as a distributed claim count, a unique index on run and step, a heartbeat lease with fencing, deterministic-versus-transient retries, action-level idempotency keys on audit rows.
2. Step types: agent run, tool call, human approval with owner, deadline and escalation, fan-out and fan-in, condition, wait and timer. A loop is a bounded re-entry with an iteration cap and a budget, which is how a monitoring and optimisation cycle is expressed; a time-based trigger joins the trigger catalogue.
3. Agent runs become step executors; user-started runs go through the queue like rule-started ones already do; the workflow API under `/api/v2/workflows` with an idempotency key on run start and per-step retry, skip, resume and compensate.
4. Dispatch rides the durable queue with typed results validated at each edge; deadline and budget shrink per hop; the depth guard applies to agent hops and workflow re-entry.
5. (added) The hourly run limit that is stored and never enforced becomes the loop's admission control, so the schema field finally means something.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| B Communication | Workflow run → lineage | new | Who handed off to whom, the typed result at each edge, the accountable person on each step |
| C Orchestration | Workflow builder | new | Compose steps from the manifest like the automation sentence builder; dependencies, budget, deadline; save disabled by default; dry-run against a real input |
| C Orchestration | Workflow run view | new | The step graph with status, duration and cost per step; retry, skip, resume and compensate on a failed step; a blocked workflow with its reason |
| C Approval | AI Inbox → approval steps | extend | Owner, deadline, escalation path and reassign on workflow approvals |
| C Loops | Workflow run → iteration counter | new | Iterations used of the maximum, budget used of the cap, and a stop control |
| I Recovery | Workflow run → failed step | new | The error, whether deterministic, attempts and backoff, and the one control that applies |

## Defects closed
#17 from the document's defect table.

## Out of scope
- Temporal. The queue and the engine stay behind adapter interfaces; the trigger to switch is in the document's trade-off 2.

## Acceptance
- [ ] A fifteen-step workflow killed at step eleven resumes at eleven with no duplicate writes; an approval step reassigns and escalates on deadline.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- An existing automation rule is a one-node workflow, so rules run unchanged. The old direct execution path stays as a thin compatibility wrapper for one release, then goes.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
