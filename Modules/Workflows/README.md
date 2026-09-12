# Workflows

Durable workflow runs and step runs — task 028, sprint 5, step 1.

| Piece | File | Role |
|-------|------|------|
| Flag and tunables | `flag.js` | `WORKFLOW_ENGINE` and the lease, heartbeat, concurrency, attempt and backoff numbers |
| Durable store | `store.js` | the two collections, the compare-and-set claim, the fencing-guarded writes |
| Ready set | `scheduler.js` | which steps may run now, which can never run, and the run's verdict |
| Per-tenant concurrency | `concurrency.js` | the distributed claim count and optimistic admission |
| Retry rules | `retry.js` | deterministic versus transient, and the backoff a transient one waits |
| Action idempotency | `idempotency.js` | one audit row per action key; a replayed step does not repeat its effect |
| Step types | `executors.js` | the interface every step type is registered behind |
| Compatibility wrapper | `automationRule.js` | an existing automation rule as a one-node workflow |
| Engine | `engine.js` | claim, lease, run once, record, decide |

## The flag

`WORKFLOW_ENGINE` is `off` by default, and off is today's behaviour exactly: a
matched rule creates its `automation_runs` row and the queue job calls
`runner.execute`, which books its own retries. No workflow row is written.

On, the same rule creates the same automation run **and** a one-node workflow
run whose single step is of type `automation_rule`. The queue job ticks the
workflow instead, and that node calls the same runner against the same run row —
so the rule's steps, its cursor, its run log and everything the Automations page
shows are unchanged. What moves is the bookkeeping around it: the step is
claimed under a lease, its failure is classified once, and its retry is
scheduled by the engine rather than by the runner.

The node is called with no `enqueue`, so the runner reports `retrying` instead
of booking a retry of its own. A run therefore still gets three attempts in
total, and a deterministic failure still gets one.

## Claims, leases and fencing

A step run is one row, unique on `{ runId, stepId }`. Claiming it is a single
`findOneAndUpdate`:

- **filter** — this step, and either `pending` or `running` with a lease that
  has already expired, and not waiting out a backoff.
- **update** — set `running`, this worker, `leaseExpiresAt = now + WORKFLOW_LEASE_MS`,
  and `$inc` the `fencingToken` and the attempt count.

Two workers that race therefore produce exactly one winner; the loser's filter
no longer matches and it gets `null`. There is no read-then-write window.

The token the claim returns is the fence. Every later write by that worker —
heartbeat, success, failure, deferral, release — is filtered on
`fencingToken: <that token>`. A worker that stalls stops renewing, its lease
lapses, another worker reclaims the step and the token moves on; when the first
worker finally comes back its write matches nothing and raises
`StaleLeaseError` instead of overwriting the new worker's result.

## Per-tenant concurrency

The limit is `WORKFLOW_TENANT_CONCURRENCY` steps running at once **per tenant,
across every worker**, so it cannot be a counter in one process. It is a count
of the rows that are `running` with a live lease in that tenant's own database —
the same rows the lease is written on, so a worker that dies needs no
reconciling: its lease lapses and it stops counting.

Admission is optimistic, because checking before claiming leaves a window in
which every worker sees room. Each worker claims first, then asks how many live
claims were taken before its own, ordered by `(claimedAt, _id)`. That order is
total, so every claimant reaches the same verdict about itself: exactly the ones
past the limit hand their step back, and no two stand down for each other.

## Deterministic versus transient

`retry.classify` asks AICore first: a provider error was already classified at
the vendor boundary, so `retryable` is the answer and its `retryAfterMs` is the
backoff. Otherwise an explicit `error.deterministic` wins, then the error name
(`DeterministicError`, `ValidationError`, `CastError`, `TypeError` and friends
are deterministic; the Mongo network and timeout errors are transient), and
anything unrecognised is transient — which is what the automation runner has
always done.

A deterministic failure fails the step on the spot. A transient one goes back to
`pending` with `nextAttemptAt` set, and the engine books one job for that time.

## Action-level idempotency

Every step execution runs inside `idempotency.once`, keyed `wf:<runId>:<stepId>`
— the run and the step, not the attempt. The key opens one `audit_logs` row,
unique on `meta.idempotencyKey`, and the row's state answers the question:
`applied` means the effect already happened and the executor is not called
again, `pending` or `failed` means a previous attempt did not get that far and
the step runs. A replayed step therefore records `replayed: true` rather than
duplicating its effect.

## What this slice does not do

Step types (approval, fan-out, condition, wait, loop), agent runs as step
executors, the `/api/v2/workflows` API, typed dispatch results and the hourly
run limit as admission control are steps 2 to 5 of the sprint. They register
against `executors.js` and read the same two collections; the engine does not
change for them.

Per the task's out-of-scope: no Temporal. The queue stays behind
`Modules/Automations/engine/queue` and the step types behind `executors.js`, so
the trade-off 2 trigger in the architecture document remains reversible.
