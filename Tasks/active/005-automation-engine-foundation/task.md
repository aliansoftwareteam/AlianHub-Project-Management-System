---
id: 005
title: Automation engine foundation (phase 0)
status: active
priority: high
depends_on: []
created: 2026-08-24
---

# Automation engine foundation (phase 0)

## Goal
`Modules/Automations` is a 317-line stub: one action (`set_priority`), triggers stored on the
rule but never fired, and "apply" is a manual bulk update. Build the foundation an event-driven
automation engine needs — canonical event envelope, durable queue, checkpointed runner, tool
layer, and the registry endpoint that drives the UI — so that a rule can fire from a real task
change and survive a container restart mid-run. Phase 0 of ADR 002; no user-facing feature
ships from this task.

## Scope
- **`event/domainEventBus.js`** — subscribes to the existing `socketEmitter` namespaced events
  exactly as `Modules/Webhooks/dispatcher.js` does (`task:update`, `task:insert`), so no
  existing write path is touched. Normalises to one envelope:
  `{ id (ULID), companyId, type, occurredAt, actor{userId,kind}, depth, scope, entity, data, previous, changedFields }`.
- **Shared snapshot/diff helper** — lift the `taskSnapshots` + `normalizeChangedFields` logic
  out of `Webhooks/dispatcher.js` into a helper both the dispatcher and the event bus use, so
  `previous` and `changedFields` have exactly one implementation.
- **New `SCHEMA_TYPE` entries** in `Config/schemaType.js`: `AUTOMATION_RUNS` (tenant),
  `AUTOMATION_JOBS` (tenant, Agenda-managed). `AUTOMATION_RULES` already exists — extend it.
- **Rule schema v2** — `trigger{type,event,cron,tz}`, `scope`, `conditions` as a JSON AST,
  `steps[]`, `limits`, `stats`. Migrating existing v1 rules is in scope.
- **Run schema** — one doc per execution with embedded per-step input/output/duration/error,
  a unique compound index on `{ruleId, eventId}`, `{startedAt:-1}`, and a 90-day TTL.
- **`engine/queue/`** — `QueueAdapter` interface + `agendaDriver.js` using `@hokify/agenda`
  (MIT). A `bullDriver.js` is *not* written here; the interface just has to make it possible.
- **`engine/matcher.js`** — rule cache keyed by `companyId` with 60s TTL, invalidated on rule
  CRUD, indexed in memory by `trigger.type`. Copy the `hookCache` pattern.
- **`engine/runner.js`** — walks `steps[]`, checkpoints `{cursor, output}` to the run doc after
  every step, resumes at the cursor after a restart. Transient failures retry 3x (30s/2m/10m);
  deterministic failures fail immediately.
- **`engine/expression.js`** — pure evaluator over the condition AST with a fixed operator
  table. **No `eval`, no `new Function`, no `vm`.**
- **`engine/template.js`** — `{{task.name}}` resolved through a path whitelist, not a generic
  property walk.
- **Tool layer** — every mutation goes through a function taking `companyId` as its first
  argument, like `MongoDbCrudOpration`. Actions never touch Mongoose directly.
- **Loop guard** — automation-authored events carry `actor.kind:"automation"` and `depth+1`;
  rules ignore them unless opted in; `depth > 3` hard-stops with a visible error on the rule.
- **`GET /api/v2/automations/registry`** — manifest of triggers, conditions and actions
  (fields, types, labels, icons), returning at least three real actions.
- **Three tier-1 actions** as the proof the layering works: `set_status`, `set_priority`
  (port the existing one), `add_comment`.
- Audit entries for every mutation with `actor.kind:"automation"`, linked to the run.

## Out of scope
- The remaining eleven tier-1 actions, and all of tier 2/3/4 (task 007+).
- The Vue sentence builder and canvas UI — this task ships no frontend.
- Schedule, webhook, form and manual triggers; phase 0 is event triggers only.
- Recipe gallery, templates, plan quotas, admin usage view (phase 2).
- Everything in the agent engine — see task 006.
- The BullMQ driver.

## Acceptance criteria
- [ ] A hardcoded rule fires from a real task status change in a running local instance.
- [ ] Killing the container mid-run and restarting resumes at the checkpointed step instead of replaying completed steps.
- [ ] Delivering the same `eventId` twice creates exactly one run — the duplicate insert fails on the unique index and is dropped.
- [ ] A rule whose action re-triggers itself stops at `depth > 3` and surfaces a visible error on the rule rather than looping.
- [ ] `GET /api/v2/automations/registry` returns manifests for `set_status`, `set_priority` and `add_comment`, each with field types and labels.
- [ ] No `eval`, `new Function`, or `vm` appears anywhere in `Modules/Automations/engine/`.
- [ ] Every action mutation is written through the tool layer with `companyId` as the first argument; no action requires Mongoose directly.
- [ ] Existing v1 rules still load and apply after the schema change.
- [ ] `tests/automation-rules.test.js` still passes, extended to cover the AST evaluator.

## Constraints & notes
- **Decided in [ADR 002](../../../docs/adr/002-automation-and-agent-engines.md):** native engine
  on MongoDB + `@hokify/agenda` behind a `QueueAdapter`. Temporal has no MongoDB driver; n8n's
  Sustainable Use Licence prohibits our SaaS model. Do not revisit without amending the ADR.
- **One container.** `docker-compose.yml` ships `app` + `mongo` only. Nothing added here may
  require a new service — that is what rules out Redis in phase 0.
- **Database per tenant.** `mongoConnector.connect(db)` opens a pool of 10 *per company*. Every
  engine collection lives inside the tenant DB, and any "scan all tenants" loop is
  O(companies) connections — batch with a concurrency cap.
- **`CLAUDE.md` Rule 1** — comments only for non-obvious *why*. The engine files are the wrong
  place for narration.
- `Modules/Webhooks/dispatcher.js` is the reference implementation for cache, debounce,
  snapshot diffing and retry. Read it before writing the event bus.
- `Modules/AIProjectGenerator` is the reference for provider factory, SSE progress and usage
  accounting — needed by task 006, not this one.

## Resources
- `resources/blueprint.md` — the AlianHub Engine Blueprint (§00-§05 cover this task).
  Source: https://claude.ai/code/artifact/306d7ace-ffa4-41c1-a7c4-f6332948aef9
