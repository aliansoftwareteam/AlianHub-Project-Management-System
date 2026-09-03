# Progress: Automation engine foundation (phase 0)

## Checklist
*Ordered so the riskiest unknown — which events we actually receive — is answered first.*

- [x] Read `Modules/Webhooks/dispatcher.js` end to end; extract the snapshot/diff helper both consumers will share
- [x] Build `event/domainEventBus.js` alone; log envelopes to a collection — **awaiting a week of real traffic to read**
- [x] Add `AUTOMATION_RUNS` / `AUTOMATION_JOBS` to `Config/schemaType.js`; write the run schema + indexes
      *(`AUTOMATION_EVENT_LOG` already added through the full 5-file chain — follow the same path)*
- [x] Rule schema v2 + migration for existing v1 rules
- [x] `QueueAdapter` interface + `agendaDriver.js` (+ an inline driver for tests)
- [x] `engine/expression.js` (AST evaluator) + unit tests before any runner code depends on it
- [x] `engine/registry.js` + `GET /api/v2/automations/registry` with three actions
- [x] Tool layer + the three tier-1 actions
- [x] `engine/matcher.js` (cached rule index)
- [x] `engine/runner.js` (step loop, checkpoint, retry, loop guard)
- [x] Audit integration with `actor.kind:"automation"`
- [x] Restart-mid-run and duplicate-event verification against the local instance

## Last step
Phase 0 engine complete and verified end to end against real MongoDB. Remaining
checklist item is reading a week of the event log.

## Blockers
None.

## Log

### 2026-08-24
- Task created from the AlianHub Engine Blueprint (phase 0) and ADR 002.
- Verified against the working tree: `docs/adr/002-automation-and-agent-engines.md` already
  exists (blueprint step 1 done); `event/` contains only `socketEventEmitter.js`;
  `Modules/Automations` is 317 lines across controller/helpers/routes/init;
  `Config/schemaType.js` has `AUTOMATION_RULES` but no runs/jobs entries.
- Ordering decision: build the event bus and log real envelopes *before* the runner. The
  blueprint's §13 argues we will discover missing events that way, and every later component
  depends on the envelope shape being right.
- Ordering decision: registry endpoint before the runner, so the builder UI in a later task
  renders from a manifest and adding an action needs no frontend work.

### 2026-08-24 (build session 1)
Shipped the first two checklist items.

**New files**
- `utils/entityEvents.js` — `normalizeChangedFields` (moved here from
  `Modules/Webhooks/helpers/webhookRules.js`) plus `createSnapshotStore`, a bounded FIFO
  lifted out of the dispatcher's module-level `taskSnapshots`/`rememberSnapshot`.
- `event/domainEventBus.js` — 219 lines. Subscribes to `task:update` / `task:insert`,
  debounces 2s, classifies, diffs against the previous snapshot, publishes the canonical
  envelope on its own emitter, and optionally records it.
- `tests/domain-event-bus.test.js` — 13 tests over the pure parts.

**Changed**
- `Modules/Webhooks/helpers/webhookRules.js` re-exports `normalizeChangedFields` from the
  shared util, so its public API and all 41 existing tests are untouched.
- `Modules/Webhooks/dispatcher.js` uses `createSnapshotStore`.
- `Modules/Automations/init.js` starts the bus.
- New `AUTOMATION_EVENT_LOG` collection registered through all five files the chain requires:
  `Config/schemaType.js`, `Config/collections.js`, `utils/mongo-handler/schema.js`,
  `utils/mongo-handler/createSchema.js`, `utils/mongo-handler/mongoQueries.js` (two switches).
  Unique on `eventId`, `{type, occurredAt:-1}`, 14-day TTL.
- `.env.example` documents `AUTOMATION_EVENT_LOG` (default `false`).
- Added `ulid` (MIT, zero-dep) for the envelope id.

**Decisions**
- *Separate snapshot store per consumer.* The dispatcher remembers what it last **delivered**;
  the bus remembers what it last **observed**. A task the dispatcher filters out still moved,
  and the engine has to see it — sharing one map would corrupt both diffs. Hence a factory,
  not a shared singleton.
- *`classifyTaskEvent` returns null when nothing changed.* Counter and index bumps fire emits
  carrying no field change; they are noise, not domain events, and letting them through would
  make every rule filter them.
- *Actor defaults to `system`, never a guessed user id.* No write path threads an actor yet.
  A wrong actor on an audit entry is worse than an honest unknown. `actor.kind:"automation"` is
  read verbatim when present — that is what the loop guard will key on.
- *`AUTOMATION_EVENT_LOG` defaults off.* It is a diagnostic with a TTL, not a source of truth.

**Verified**
- 13 new tests pass; the 41 webhook tests still pass after the move.
- Full suite: 645/646. The one failure, `tests/share-rules.test.js`, is **pre-existing** —
  reproduced with this work stashed. `ENTITY_TYPES` in `Modules/PublicShares/helpers/shareRules.js`
  now includes `'page'` but the test still asserts `'page'` is rejected; the test is stale.
- End-to-end against the real `socketEmitter`: two emits from one save collapse into a single
  envelope carrying both changed fields; ULID is 26 chars and sorts; `rawDescription` is
  excluded; an automation-authored emit keeps `actor.kind:"automation"` and `depth:2`; a second
  change diffs `previous.statusType:"close"` → `data.statusType:"open"`.
- Live instance boots with the bus running:
  `[domain-events] listening for task events (recording=true)`.

**Not done / open**
- The bus only *observes*. Nothing matches rules or mutates anything yet — by design.
- Depth and actor arrive from the emit payload, but no write path sets them yet. Until the
  runner exists there is nothing to set them, so the loop guard is currently untested against
  real automation-authored traffic.
- Only `task:*` emits are consumed. Comments, sprints and time logs also emit; whether the
  engine needs them is exactly what reading a week of the event log should answer.

### 2026-08-24 (build session 2 — engine core)
Everything on the checklist except "read a week of real traffic".

**New — `Modules/Automations/engine/`**
- `expression.js` — JSON-AST condition evaluator. Fixed operator table, whitelisted
  field roots, depth cap. No `eval`, no `new Function`, no `vm`, asserted by a test that
  strips comments before checking.
- `template.js` — `{{task.name}}` through the same whitelisted reader; unresolvable paths
  render empty, never as the literal placeholder.
- `tools.js` — the only way an action touches data. `companyId` first, every time.
- `registry.js` — the manifest the builder UI will render itself from.
- `actions/{setStatus,setPriority,addComment}.js` — ~20 lines each.
- `matcher.js` — 60s rule cache keyed by company, indexed by trigger, invalidated on CRUD.
- `runner.js` — step loop, per-step checkpoint, retry policy, run log.
- `queue/{index,agendaDriver}.js` — `QueueAdapter` + Agenda driver + inline driver.
- `index.js` — wires ingest → match → enqueue → execute → record.

**Schema**
- `AUTOMATION_RUNS` registered through all five files. Unique `{ruleId, eventId}`,
  `{startedAt:-1}`, `{status, startedAt:-1}`, 90-day TTL.
- Rule schema extended to v2: `steps`, `scope`, `limits`, `stats`, `version`,
  `reactToAutomation`. `trigger` became `Mixed` so v1's bare string and v2's object both
  validate — narrowing it to Object would have orphaned every rule already saved.

**Decisions**
- *One Agenda instance, on `global`, not per tenant.* Deviates from the blueprint's
  "jobs live in the tenant DB". `mongoConnector` opens a pool of 10 per company, so an
  Agenda per tenant is one poller, one connection and one timer per tenant — 500 companies
  would be 500 pollers before a single rule ran. That is exactly the pool-exhaustion risk
  in the ADR's own risk table. The job row lives in global and carries `companyId`; the
  **run** document — the durable record users actually read — still lives in the tenant DB.
  The trade: a tenant restore does not restore in-flight jobs. It does restore every
  completed run, in-flight jobs live for seconds, and an interrupted run is visible as
  `running` with a cursor, so it can be retried. **This needs an amendment to ADR 002.**
- *Engine off by default* (`AUTOMATION_ENGINE=false`). Until a builder UI exists, the only
  reachable rules are hand-written database rows; a half-configured rule mutating real
  tasks is not a surprise anyone should get from upgrading.
- *`branch` steps deliberately omitted.* A control-flow primitive nobody can author yet is
  just untested code. `condition` can already stop a run early.

**Bugs found and fixed while building**
- `{op:'and', args:null}` matched **everything** — `[].every()` is true, so a malformed
  rule would have fired on every single event. `and`/`or` now require a non-empty array.
  Caught by a test written before the behaviour was checked.
- `addComment` was writing `Comment` / `TaskId` / `UserId`. The real comments schema is
  `message` / `taskId` / `userId` with `project` and `type` required, and `strict:true`
  would have silently dropped the rest. Only surfaced because the e2e ran against a real
  database rather than a mock.
- `GET /api/v2/automations/registry` was **unauthenticated** — `Config/setMiddleware.js`
  protects the `/api/v1/automations` prefix only. Added `/api/v2/automations`; verified it
  now returns 401 without a token.

**Verified end to end against real MongoDB** (seeded project + task + rule, real emit,
then cleaned up): one run created; run succeeded; cursor reached 2; priority actually
changed LOW→HIGH; comment written; template rendered `Closed: E2E task (E2E-1)`; per-step
log recorded; **duplicate eventId dropped by the unique index**; no runaway loop; and a run
resumed at `cursor:1` completed without replaying step 1 (priority stayed LOW) while step 2
did run. Registry endpoint serves the manifest over HTTP; `[automation-queue] agenda
started on global.automation_jobs`.

Tests: 688/689. The single failure is the pre-existing `share-rules` staleness.

**Not done / open**
- Nobody can author a rule yet — no builder UI, and the v1 `createRule` validator still
  only accepts v1 shapes, so v2 rules must be inserted directly. That is the next task.
- Per-rule hourly cap and per-company `PlanFeature` quota are in the PRD but **not built**.
- Schedule / webhook / form / manual triggers are not implemented; event triggers only.
- The event log still has no week of real traffic behind it.

### 2026-08-24 (session 3 — first real-data run, three bugs)
Ran the engine against a real task (T-2 "test" in project TEsth) by moving it to Complete in
the UI. It worked — priority went Medium→High and the comment appeared — but only after three
bugs that every previous test had missed, because they were all seeded or mocked with shapes
inferred from the code rather than read off a real database.

**1. `resolveStatus` read the wrong shape.** Real projects store statuses FLAT
(`{key, name, type, bgColor, textColor}`). I had read `row.convertStatus`, which is the shape
`Tasks/helpers/taskMongo/structural.js` produces while creating a project from a template —
not what is persisted. `set_status` would have failed on every real project. My e2e passed
only because I seeded the shape I had inferred. Now accepts either; regression test covers
both (`tests/automation-tools.test.js`).

**2. Agenda `define()` argument order was wrong.** `@hokify/agenda` is
`define(name, processor, options)` — handler second. I passed `(name, {concurrency}, handler)`,
so every job failed with `definition.fn is not a function` and runs sat in `queued` forever.
Invisible to unit tests, which use the inline driver. Confirmed against
`node_modules/@hokify/agenda/dist/index.d.ts:143` rather than guessed.

**3. Comments were written with a string `taskId`.** The schema types it `Mixed`, so the write
succeeded; but every read path casts (`{ taskId: new mongoose.Types.ObjectId(taskId) }`,
`Modules/Comments/controller.js:229`), and in Mongo a string never equals an ObjectId. The
comment was stored and then invisible in the task's Comments tab forever. Fixed to store an
ObjectId; the one already-written row was repaired in place.

**Verified end to end, in the real UI, by a real user action**
`task.status_changed` → matched → run `success`, cursor 2 → `set_priority` 7ms,
`add_comment` 12ms → task priority HIGH → comment "Auto: test (T-2) reached Complete."
visible in the Comments tab → two audit rows with `actorName: "Escalate completed work"` and
the runId.

Full suite 705/706 (the one failure is the pre-existing `share-rules` staleness).

**New known issue — automation comments show as "Ghost User".**
`userId` is `automation:<ruleId>`, which resolves to no user, so the UI falls back to a
generic avatar and "Ghost User". Functionally fine, cosmetically wrong: it should read as the
rule that wrote it. Needs either a reserved system user or author-rendering that understands
the `automation:` prefix. Not fixed.

**Lesson worth keeping:** every one of these three bugs was a shape mismatch between what the
code path *constructs* and what the database *stores*. Seeded fixtures reproduce the former.
Only real data catches the latter.

