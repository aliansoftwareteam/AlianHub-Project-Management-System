# Progress: Sprint 5 — the workflow engine

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Workflow runs and step runs as the unit of everything, generalised from the automation runner: dependencies, r
- [ ] Step 2: Step types: agent run, tool call, human approval with owner, deadline and escalation, fan-out and fan-in, cond
- [ ] Step 3: Agent runs become step executors; user-started runs go through the queue like rule-started ones already do; th
- [ ] Step 4: Dispatch rides the durable queue with typed results validated at each edge; deadline and budget shrink per hop
- [ ] Step 5: (added) The hourly run limit that is stored and never enforced becomes the loop's admission control, so the sc
- [ ] Interface: Workflow run → lineage (new)
- [ ] Interface: Workflow builder (new)
- [ ] Interface: Workflow run view (new)
- [ ] Interface: AI Inbox → approval steps (extend)
- [ ] Interface: Workflow run → iteration counter (new)
- [ ] Interface: Workflow run → failed step (new)
- [ ] Defects closed: #17
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 5) |
| 2026-09-12 | Started. Step 1 (durable workflow and step runs, dependency scheduling, per-tenant claim counts, heartbeat leases with fencing, deterministic versus transient retries, idempotency keys) is in progress on `feat/sprint-5-workflow-runs`. Steps 2–5 wait for it. |

## Last step
Step 1 in progress.
