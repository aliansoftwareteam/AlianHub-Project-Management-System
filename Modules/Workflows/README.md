# Workflows

Durable workflow runs and step runs — task 028, sprint 5, steps 1 to 3.

| Piece | File | Role |
|-------|------|------|
| Flag and tunables | `flag.js` | `WORKFLOW_ENGINE` and the lease, heartbeat, concurrency, attempt and backoff numbers |
| Durable store | `store.js` | the two collections, the compare-and-set claim, the fencing-guarded writes |
| Ready set | `scheduler.js` | which steps may run now, which can never run, and the run's verdict |
| Per-tenant concurrency | `concurrency.js` | the distributed claim count and optimistic admission |
| Retry rules | `retry.js` | deterministic versus transient, and the backoff a transient one waits |
| Action idempotency | `idempotency.js` | one audit row per action key; a replayed step does not repeat its effect |
| Step types | `executors.js` | the interface every step type is registered behind |
| The step types | `stepTypes/` | approval, tool call, agent run, fan-out and join, condition, wait, timer and loop |
| Approvals | `approvals.js` | the human decision a run waits on: owner, escalation, deadline |
| Schedules | `timeTrigger.js` | a schedule as an entry in the automation trigger catalogue |
| Compatibility wrapper | `automationRule.js` | an existing automation rule as a one-node workflow |
| Agent run step | `agentRun.js` | an agent run as a step, through the existing runner |
| Queue seam | `queue.js` | the one way a run is moved forward: the automation queue |
| API | `controller.js`, `routes.js` | `/api/v2/workflows`: start, read, retry, skip, resume, compensate |
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

## The step types

Every type is one file under `stepTypes/`, registered against `executors.js` and
described in `stepTypes/index.js` — the same idea the automation registry has, so
the builder that comes later draws its forms from `stepTypes.manifest()` and the
API validates a definition with `stepTypes.validateSteps()`.

| Type | Config | Output |
|------|--------|--------|
| `agent_run` | `agentId`, `skill`, `input`, `taskId`, `projectId`, `deadlineMs`, `budgetUsd` | `agentRunId`, `status`, `costUsd`, `findings` |
| `tool_call` | `tool` (an automation registry action), `params` | `tool`, `result` |
| `human_approval` | `ownerUserId`/`ownerRole`, `prompt`, `escalateToUserId`, `escalateAfterMs`, `deadlineMs`, `onDeadline`, `onReject` | `approvalId`, `decision`, `decidedBy`, `decidedAt`, `escalated` |
| `fan_out` | `items` or `itemsFrom`, `type`, `config`, `maxChildren` | `children`, `count` |
| `fan_in` | `from`, `onChildFailure` | `total`, `succeeded`, `failed`, `results` |
| `condition` | `when`, `then`, `else` | `matched`, `taken`, `skipped` |
| `wait` | `forMs` | `waitedMs`, `until` |
| `timer` | `at` or `atFrom` | `waitedMs`, `until` |
| `loop` | `body`, `maxIterations`, `budgetUsd`, `while`, `maxRunsPerHour` | `iterations`, `stoppedBy`, `budgetUsedUsd`, `runLimit` |

A step reads an earlier step's output as `$<stepId>.field`, which the expression
language only recognises when the id begins with `s`; `validateSteps` refuses a
reference that would otherwise read nothing at all.

`agent_run` is the type and its contract; the runner it calls through
`context.runAgent` is `agentRun.js`, below.

## Waiting, without holding a worker

An approval takes days, a timer is a week out and a join waits for its children.
None of that fits inside a claim, so a waiting step throws: the engine hands the
worker back and books the next look exactly as it does for a transient failure.
The one difference is on the row — `store.deferStep` writes `waitReason` and
`waitUntil` instead of an error and gives the attempt back, because waiting is
not failing and a step waiting on a person must not exhaust a retry budget meant
for a step that is broken. `stepTypes.blockedReason(steps)` is what a run view
reads to say what a blocked run is blocked on.

## Approvals

The request is a row of its own in `workflow_approvals`, unique on
`{ runId, stepId }`, so a re-ticked step opens the same request rather than
asking twice. Deciding is a compare-and-set on `pending`: two people answering at
once produce one decision, and the decision wakes the step, so the run resumes on
the next tick instead of at the next poll.

The deadline has two moments. `escalateAfterMs` hands the request to
`escalateToUserId` and keeps waiting, with both owners kept in order on the row.
`deadlineMs` ends it: `onDeadline` is `fail` (the step fails deterministically
and the request is marked expired), or `approve`/`reject`, which record the
decision as the system's. A refusal is an answer, not a fault — the step
succeeds with `decision: 'rejected'` and skips everything downstream of it.

## Bounds

A fan-out and a loop are the two places a workflow can expand without a person
asking it to, so both have a ceiling a definition can ask for less than and never
more: `WORKFLOW_MAX_FAN_OUT` (50) and `WORKFLOW_MAX_LOOP_ITERATIONS` (25). Over
the fan bound the step fails rather than doing part of the work.

A loop stops at whichever bound it reaches first — the iteration cap, the spend
its body reported, its own `while` condition, or the hourly run limit of an agent
its body would start again — and records which in `stoppedBy`. Re-entry re-keys
the idempotency of the body it resets, because idempotency is keyed on the run,
the step and the action, and a loop is the one place where running the same step
again is the point rather than the bug.

## The hourly run limit

`automationRules.limits.maxRunsPerHour` has been written on every v2 rule, with
a default of 500, and read by nothing. It is the loop's admission control:
before a loop re-enters a body that would start an agent run, every agent in
that body has to be inside the hour's allowance, and the first one that is not
stops the loop with `stoppedBy: 'run_limit'` rather than failing it. It has
never meant an ordinary agent run — an agent's own limit is `rateLimitPerDay`,
which `Agents/runs.canStart` enforces — so nothing about starting a run one at a
time changes.

The number is the smallest of the ones that are set: the loop step's own
`maxRunsPerHour`, the rule's stored `limits.maxRunsPerHour` when the run came
from a rule, and `WORKFLOW_MAX_RUNS_PER_HOUR`. Zero or absent is no limit, the
same convention `rateLimitPerDay` uses, and when none of the three is set a loop
is bounded by its iterations and its budget exactly as before.

Counting is per company and per agent over a rolling hour, and it costs one
query per agent per `WORKFLOW_RUN_LIMIT_CACHE_MS`, not one per iteration: the
query reads that agent's run start times in the last hour, the window then rolls
in memory — so the allowance refills as the hour passes without asking again —
and each iteration this process admits appends its own reservation to it. The
reason is written where a person will look for it: `stoppedBy` on the step, the
`blocked` object on the run, and an `agent.action_refused` audit row naming the
agent, the limit and the hour it resets.

## A schedule as a trigger

`schedule.due` is an entry in the automation trigger catalogue, not a second
list, and `Modules/Workflows/timeTrigger.js` holds its vocabulary: every minute,
every hour at a minute, every day at a time, every week on a day at a time, UTC.
It carries `kind: 'time'` because nothing publishes it, and it is offered only
while `WORKFLOW_ENGINE` is on. What turns a due schedule into a run is the
workflow queue, `queue.js`.

## The agent runner behind `agent_run`

`stepTypes/agentRun.js` settled what the step is; `agentRun.js` is the runner it
calls through `context.runAgent`, which every tick supplies. It starts nothing of
its own: it hands the existing runner an `agent_runs` row and lets the run's
identity, its account, its spend cap, the policy and the proposal path apply
exactly as they do for a run a person started from a task.

Two shapes reach it. A run a person started through `POST /api/v2/agents/runs`
already exists, and the step carries its `agentRunId`: with the flag on that
endpoint wraps the run it just created in a one-node workflow and puts it on the
queue instead of executing it on the web request's own event loop, so a
user-started run and a rule-started one travel the same path. A step composed in
a workflow carries an `agentId` and a `taskId` instead and starts the run itself
under the idempotency key `wf:<runId>:<stepId>`, so a retried or replayed step
finds the run its first attempt made rather than billing a second one.

The run is written to the step before it executes, so a step that ends up failing
still says which run it was — the first thing anyone reading a failed step asks.

A run that stops for an approval of its own comes back as a transient failure:
the step waits with it, and once the attempts are spent it fails visibly, which
`resume` then picks up after the decision has settled the run. An approval as a
step in its own right is `human_approval`.

## The API

`/api/v2/workflows`, behind the same flag. Off, every route answers `503` with
the reason — the feature is not refused, it is not running.

| Route | What it does |
|---|---|
| `POST /runs` | starts a run from a `steps` definition, or from the `{ agentId, taskId }` shorthand. An `Idempotency-Key` header (or an `idempotencyKey` field) becomes the run's dedupe key, so a repeated start returns the first run rather than making a second |
| `GET /runs` | the company's runs, newest first |
| `GET /runs/:id` | one run and every step of it |
| `POST /runs/:id/steps/:stepId/retry` | a failed or skipped step back to pending with a fresh attempt budget |
| `POST /runs/:id/steps/:stepId/skip` | a pending or failed step skipped by a person, which lets the steps behind it run |
| `POST /runs/:id/steps/:stepId/resume` | a failed step, or one holding a claim nobody is working, back to pending with the attempts it has already spent |
| `POST /runs/:id/steps/:stepId/compensate` | undoes what the step did, which for an agent-run step is the agents' own run revert: the same inverse, the same undo window, the same audit trail |

Every control bumps the fencing token, because the worker whose attempt it
overrides may still be alive; with a new token that worker's late write matches
nothing, exactly as a lapsed lease's would. A control then reopens the run and
puts it back on the queue, so there is one place a run is moved forward.

Authorisation is the agents' rule, because a workflow step spends the same money
and makes the same changes an agent run does: managing takes an Owner or an
Admin, every request is scoped to the company of its `companyid` header, and a
reader who is neither sees only the runs they started or whose project they can
open. Agents do not drive workflows at all.

A skip a person asked for is the one skip that does not block: `skippedBy` is
what tells the scheduler the difference between "go on without it" and "this
could never run".

## What these slices do not do

Typed dispatch results, deadline and budget shrinking per hop and the depth guard
are step 4. They register against `executors.js` and read the same collections;
the engine does not change for them.

Per the task's out-of-scope: no Temporal. The queue stays behind
`Modules/Automations/engine/queue` and the step types behind `executors.js`, so
the trade-off 2 trigger in the architecture document remains reversible.
