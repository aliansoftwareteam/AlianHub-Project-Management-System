# ADR 002 — Automation Engine and AI Agent Engine

**Status:** Proposed
**Date:** 2026-08-24
**Full spec:** https://claude.ai/code/artifact/306d7ace-ffa4-41c1-a7c4-f6332948aef9

---

## Context

AlianHub needs two new capabilities:

1. **Automation Engine** — users configure "when X happens, do Y" without writing code.
2. **AI Agent Engine** — a skill is assigned to an agent (e.g. QA Review); the agent runs
   automatically when a trigger fires and produces a report, follow-up tasks, suggestions
   and bug reports.

Today `Modules/Automations` is a 186-line stub: one action (`set_priority`), triggers stored
but never fired, apply is a manual bulk update. `Modules/Webhooks/dispatcher.js` and
`Modules/AIProjectGenerator` already contain most of the patterns both engines need.

### Constraints that decide the choice

| # | Constraint | Source |
|---|---|---|
| 1 | Ships as one `docker compose up` — only `app` + `mongo` | `docker-compose.yml` |
| 2 | Database per tenant; `mongoConnector.connect(db)` per company, pool 10 | `utils/mongo-handler/` |
| 3 | AGPL-3.0-or-later | `package.json`, `LICENSE` |
| 4 | Sold as multi-tenant SaaS | Chargebee, `SaasAdmin`, `SubscriptionPlan` |
| 5 | Team writes JS — Express, Mongoose, Vue 3 | repo-wide |

---

## Options considered

| Option | New infra | DB-per-tenant | Licence for our SaaS | Build | Score |
|---|---|---|---|---|---|
| **A · Native engine on Mongo + `@hokify/agenda`** | none | native | MIT | ~6 dev-wks | **28/30** |
| B · Temporal | Go cluster + Postgres/Cassandra + ES | no Mongo driver | MIT | ~4 wks + ops | 14/30 |
| C · Embed n8n | n8n service + Postgres | own store | **prohibited** without paid Embed licence | ~2 wks + fee | 9/30 |
| D · BullMQ + Redis | Redis | queue outside tenant DB | MIT | ~6 wks | 22/30 |
| E · Trigger.dev / Windmill | Postgres + Redis + workers | own store | heavy | ~3 wks + ops | 15/30 |

**B is disqualified, not just outscored.** Temporal supports Cassandra, PostgreSQL, MySQL and
SQLite. MongoDB is not supported. Adopting it means every self-host user runs a Temporal
cluster plus a second database.

**C is disqualified.** The n8n Sustainable Use Licence permits "internal business purposes"
only. Its docs name our exact case as prohibited: white-labelling n8n and offering it to
customers for money, or hosting it and charging for access. Legal use requires a separate
paid commercial agreement with n8n.

---

## Decision

**Option A.** Build the automation engine natively on MongoDB, using `@hokify/agenda` (MIT,
maintained fork of Agenda) purely as the durable job queue, behind a `QueueAdapter`
interface so a BullMQ driver can be added later as a scale profile for our cloud.

The AI Agent Engine is **not** a separate system: `run_agent` is one more automation action.
Agent output is written through the same tool layer as every other action, so both engines
share one permission model and one audit trail.

Agent runs are a **deterministic 5-phase pipeline** (gather → ground → analyse → verify →
emit), not a free-roaming agent loop — for predictable cost, tenant safety and
reproducibility. This generalises the existing `AIProjectGenerator/orchestrator.js`.

---

## Consequences

**Positive**
- Zero new services in the self-host install.
- Automation state lives in the tenant DB, so a tenant restore restores in-flight runs.
- No third-party licence in the path of a core feature.
- Reuses `Webhooks/dispatcher.js` event handling and `AIProjectGenerator` LLM plumbing.

**Negative**
- We own the durability logic (checkpoint, retry, idempotency) rather than inheriting it.
- Agenda polls Mongo; ceiling is roughly 50 runs/sec. Mitigated by `QueueAdapter`.
- ~13.5 dev-weeks to the end of phase 3.

**Non-negotiables recorded here**
- No `eval()` / `new Function()` / `vm` for user conditions — conditions compile to a JSON
  AST evaluated by a pure function with a fixed operator table.
- No action touches Mongoose directly; everything goes through a `companyId`-first tool
  function (CLAUDE.md gotcha #1 enforced mechanically).
- Agents may never delete, close a task, change permissions, or read outside the triggering
  entity's project.
- Agent approval mode defaults to `review`, never `auto`.
- Events carry `depth`; hard stop at 3; automation-authored events ignored by default.

---

## Roadmap

| Phase | Ships | Dev-wks |
|---|---|---|
| 0 · Foundation | event bus, schemas, QueueAdapter, tool layer, registry endpoint | 1.5 |
| 1 · Automations GA | matcher, runner, 14 actions, control flow, sentence builder, dry-run, run history | 3.5 |
| 2 · Reach | schedule triggers, external actions, recipe gallery, quotas | 2 |
| 3 · Agent engine + QA agent | orchestrator, skills, toolbelt, verifier, review inbox, budgets | 3.5 |
| 4 · Depth | canvas builder, custom skill authoring, evals, more skills | 3 |
| 5 · Scale | BullMQ driver, agent chains, marketplace | 3 |

---

## References

- Temporal persistence — https://docs.temporal.io/temporal-service/persistence
- n8n Sustainable Use Licence — https://docs.n8n.io/privacy-and-security/sustainable-use-license
- `@hokify/agenda` — https://www.npmjs.com/package/@hokify/agenda
- Vue Flow (canvas builder, MIT) — https://vueflow.dev
