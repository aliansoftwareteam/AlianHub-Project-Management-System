# AI platform architecture

How the AI parts of AlianHub fit together: the shared model core, the agents, the MCP server, automations and workflows, and the safety boundary they all share. It is condensed from `docs/AI-PLATFORM-ARCHITECTURE.md` (a measured review dated 2026-09-10) and the two decision records `docs/adr/002-automation-and-agent-engines.md` and `docs/adr/003-ai-layer-and-skills-as-data.md`. Read those for the full argument, the alternatives scored, and the roadmap.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| AI core | `Modules/AICore/` | The one place a model is called. Provider registry and factory (`llmProvider/`), pricing and spend metering (`usage.js`, `spend.js`), budget reservation, routing policy and model pins, the instruction guard, `askModel()` and the LangGraph persistence factory. Its rules are in `Modules/AICore/README.md` |
| Agents | `Modules/Agents/` | The action registry, the executors, project policy (`ask()`), proposals, the audit log and undo, standing approvals, budgets, skills, the daily look and triage, role playbooks |
| MCP server | `Modules/Mcp/` | The `/mcp` endpoint, its tools, scopes, visibility filter, instructions and prompts. See [MCP server reference](./mcp-server) |
| OAuth server | `Modules/OAuthServer/` | Consent, client approval, grants and tokens for apps that connect by address |
| Automations | `Modules/Automations/` | Rules (trigger, conditions, steps), the matcher and the runner, and the job queue |
| Workflows | `Modules/Workflows/` | Durable runs and step runs under a lease, behind `WORKFLOW_ENGINE` (off by default). See `Modules/Workflows/README.md` |
| Knowledge | `Modules/Knowledge/` | Ingestion, retrieval and agent memory |
| Domain events | `event/domainEventBus.js` | Normalises every mutation's socket event into one envelope the automation engine reads |

Every model call goes through `llmProvider.getProvider().chat(...)`; no file outside `Modules/AICore/` requires a vendor SDK, and `tests/conventions/ai-core-boundary.test.js` enforces it. Each call names its feature and tenant, so one `ai_usage` row per call feeds the workspace budget and its alerts.

## One road for every change

An AI agent is either a person's own app over MCP or an agent AlianHub runs. Both act as a person, and both take the same road:

```
tool call (POST /mcp)            in-product agent run
        │                                 │
        ▼                                 │
authenticate: token, workspace, seat      │
scope or grant for the tool               │
        │                                 │
        ▼                                 ▼
registry entry ── an action not in the registry does not exist
target visible to the person (Modules/Mcp/visibility.js)
        │
        ▼
ask()  (Modules/Agents/projectPolicy.js)
   ├── act      → perform(): permissions, executor, audit row with undo
   ├── propose  → proposal in the AI Inbox; a signed-in person approves
   └── refuse   → RefusedError, written to the audit log
```

`ask()` only holds an agent back; it never grants what the registry, the person's permissions or the never-list refuse. `perform()` asks again before it runs, so a caller that skipped a step still meets it. The step-by-step version, with every file, is in [Agent actions and MCP tools](/developer/agent-actions).

## What makes it safe

- **Tenant isolation is structural.** Each company has its own MongoDB database, named by its id, so a cross-tenant read is a connection that was never opened rather than a filter someone forgot. See [Multi-tenancy and data access](/developer/multi-tenancy).
- **The registry works by absence.** The never-list in `Modules/Agents/registry.js` is `project.delete`, `task.delete`, `billing.*`, `deploy.production`, `git.merge`, `member.remove`, `permissions.edit` and `status.set("Done")`. None of them is in the action table, so a stolen token has nothing to switch on. `indexActions()` throws if a key matching the never-list is added.
- **An agent never does more than its person.** Every action names the permission that governs the same change for a person, and `perform()` checks it for the person behind the agent.
- **A decision needs a signed-in person.** No MCP tool approves, declines or undoes; `Modules/Agents/personDecides.js` refuses any token or agent.
- **No tenant code runs in the process.** Automation conditions and skills are closed vocabularies evaluated by pure functions; there is no `eval`, `new Function` or `vm`.
- **Content is data.** Task, doc, comment and chat text reaches the model as content, never instruction. A run that read outside content is marked tainted, and with `AGENT_TAINT_ROUTING` on (the default while the MCP tools are on) an outside app's write that reaches past one task waits for a person.
- **Refusals are audited** as rows of their own, and every applied change carries the undo its executor wrote.
- **Budgets refuse before the model is called** (`Modules/Agents/spendGuard.js`), and an unpriced model is refused before the vendor call.

## Decisions

### Automations and agents share one engine (ADR 002)

The automation engine is built natively on MongoDB, with `@hokify/agenda` (MIT) as the durable job queue behind a `QueueAdapter` seam. Temporal was ruled out because it has no MongoDB persistence; embedding n8n was ruled out by its licence.

- The agent engine is not a separate system: running an agent is one more automation step, so both share one permission model and one audit trail.
- There is one Agenda instance per install, on the `global` database (`global.automation_jobs`, `Modules/Automations/engine/queue/agendaDriver.js`); each job carries its `companyId`. Rules and run records stay in the tenant database. One poller per tenant would exhaust connection pools at a few hundred companies.
- The same queue carries workflow runs and the recurring jobs of the Agents and Knowledge modules. `AUTOMATION_QUEUE_DRIVER` picks `agenda` (default) or `inline` (tests); `AUTOMATION_CONCURRENCY` defaults to 5; `AUTOMATION_ENGINE=false` turns the engine off.
- Recorded limits: no action touches Mongoose directly; agents never delete, close a task on their own authority, or change permissions; events carry a `depth` with a hard stop at 3, and changes made by automations are ignored by rules by default.

### A shared AI core, and skills as data (ADR 003)

- `Modules/AICore/` owns the provider factory, pricing, the instruction guard, `askModel` and persistence. No feature depends on another feature for its model client.
- A skill is a per-company document (`agent_skills`) with four declarative parts, each backed by a frozen catalogue: `inputs` (what a task must carry), `gather` (reader steps through companyId-first tools, never a database handle), `prompt` (partials and a whitelisted interpolation reader) and `emit` (how model output maps to registry actions).
- The registry is hybrid: a company's data skills first, then the built-in code skills. `qa-review` stays code because its findings are gated against measured page facts.
- A skill can only narrow. Its effective actions are the intersection of the actions it emits, the agent's allowed actions and the registry, checked when it is saved and again when an action is performed.
- A skill is retired, never deleted, because agents and saved rules hold its slug.

### Trade-offs the review records

| Decision | Rejected alternative | Cost accepted |
|---|---|---|
| Database per tenant | Shared collections with a tenant key | Cross-tenant analytics fan out; migrations loop per tenant; pools bound concurrency |
| Generalise the durable runner | Temporal, or LangGraph as the workflow engine | We own scheduling, timers and recovery |
| Closed action registry | Dynamic tool discovery | Every new capability is a code change and a release |
| Declarative skills | Sandboxed JavaScript | The vocabulary starts small |
| Lexical retrieval first, vector adapter behind an interface | A vector database from day one | Answer quality differs by deployment until the adapter ships |
| Agents talk through the workflow engine | Direct agent-to-agent calls | More moving parts for a two-step flow |
| Immutable agent revisions pinned per run | Copying the agent onto each run | Every edit writes a revision |
| In-process model router | An external LLM gateway | We own breakers, quirks and the price table |
| OpenTelemetry as the observability substrate | A vendor tracer or SDK | Collector and backend are optional deployment pieces |

## Good to know

- The review in `docs/AI-PLATFORM-ARCHITECTURE.md` is a measurement against a platform brief at one point in time. Treat its "today" findings as dated, and check the code before relying on one.
- Several parts are behind flags that are off by default, among them `WORKFLOW_ENGINE`, `AI_MODEL_ROUTER`, `MCP_TOOLS_V2`, `EXTERNAL_AGENT_SESSIONS` and `CONNECTORS`. See [Environment variables](/admin/env-reference).

## Related

- [MCP server reference](./mcp-server)
- [Agent actions and MCP tools](/developer/agent-actions)
- [Architecture](/developer/architecture)
- [AI providers](/admin/ai-providers)
