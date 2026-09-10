# ADR 003 — The AI layer: a shared core, and agent skills as data

**Status:** Proposed
**Date:** 2026-09-10
**Extends:** [ADR 002](002-automation-and-agent-engines.md), whose Phase 4 reserves "custom skill authoring"
**Owner decision recorded:** skills are authored by workspace admins in the product (2026-09-10)

---

## Context

An agent in AlianHub is meant to be hired like an employee: it has a role, a scope of projects, an autonomy level, a spend cap and, since task 017, memory that accrues. All of that is per-agent data an owner can set. What an agent can actually *do* is the one thing that is not. A skill is a JavaScript module, and adding one means adding a file, a line in an array, and edits to three frontend files, followed by a deploy.

The intent was always declarative. `Modules/Agents/skills/qaReview.js:1-6` says so: "A skill is a declaration, not code … adding a second skill should mean adding a file here, not editing the engine." That holds for every field except the three that run: `gather`, `verify` and `toChanges` are executable JavaScript that issue Mongo queries and outbound HTTP.

Meanwhile the AI surface has spread. Thirteen files outside the project generator require its LLM client, including the agent engine, Pages, Portfolio, EstimatedTime and the AI feature module. The model client, the pricing table and the prompt partials all live inside a module whose job is generating project plans.

### Constraints that decide the choice

| # | Constraint | Source |
|---|---|---|
| 1 | Multi-tenant and self-hosted, one database per company. A tenant-authored string reaching `eval`, `new Function` or `vm` is remote code execution. | `middlewares/mongoConnector/`, ADR 002 non-negotiables |
| 2 | The action registry is the safety boundary. Forbidden actions are absent, not switched off, so a compromised token has nothing to enable. | `Modules/Agents/registry.js:47` |
| 3 | Skills have no permission narrowing today. `scopes` is declared on all five skills and read nowhere; the comment claiming the toolbelt is filtered to it is false. | `Modules/Agents/skills/qaReview.js:13`, verified by grep |
| 4 | Skill knowledge is triplicated across two frontend files and the backend, with a parity test that exists only to detect the drift. | `Modules/Agents/taskSplit.js:2`, `frontend/src/views/Ai/agentFit.js:110`, `frontend/src/views/Ai/skillInputs.js:6` |
| 5 | No endpoint serves the skill catalogue. The Skill Library screen renders the action registry instead. | `Modules/Agents/routes.js`, `frontend/src/views/Ai/SkillLibrary.vue:76` |
| 6 | An emitted action is validated only when it is performed. A skill can name any action string and nothing objects until execution. | `Modules/Agents/engine/graph.js:124`, `Modules/Agents/actions.js:248` |
| 7 | Spend is priced from a table whose defaults carry Anthropic ids only. An unpriced model books `$0`, which makes the company budget, the agent cap and the run cap inert. | `Modules/AIProjectGenerator/usage.js:28`, `Modules/Agents/runs.js:132` |
| 8 | The provider factory, pricing and prompt partials sit inside the project generator; thirteen files outside it reach across. | `Modules/Agents/engine/orchestrator.js:2` |
| 9 | Two sandboxes already exist with different designs, a JSON AST and a closed text grammar. A third would be a mistake. | `Modules/Automations/engine/expression.js`, `Modules/CustomField/helpers/formula.js` |
| 10 | An automation rule persists a skill slug, so a renamed or removed skill silently breaks saved rules. | `Modules/Automations/engine/actions/runAgent.js:42` |

---

## Options considered

| Option | Safety /6 | Authoring reach /6 | Build cost /6 | Fits existing patterns /6 | Ceiling /6 | Total /30 |
|---|---|---|---|---|---|---|
| A · Keep skills as code, fix the contract | 6 | 1 | 6 | 4 | 2 | **19** |
| B · Skills as data with a closed vocabulary | 6 | 5 | 4 | 6 | 4 | **25** |
| C · Skills as installable packages | 3 | 6 | 2 | 2 | 6 | **19** |
| D · Skills as sandboxed JavaScript | 2 | 6 | 2 | 2 | 6 | **18** |

**A** is the honest baseline and it loses on the only axis that matters here: a workspace still cannot add a skill without us. It stays valuable as the fallback for skills that need an evidence layer, which is why the decision keeps it rather than deleting it.

**D is disqualified, not just outscored.** Constraint 1 is the same rule ADR 002 wrote down for automation conditions, and it applies with more force here because a skill runs with an agent's identity and its allowed actions. A JavaScript sandbox in-process is not a boundary; a real one means a separate runtime, an egress policy, a memory and time budget, and a new operational surface for every self-hoster. The product goal, an agent composed from skills like an employee from competencies, is fully served without it.

**C** is D's distribution problem stacked on D's execution problem, and it presumes a marketplace that ADR 002 already places in Phase 5.

---

## Decision

### 1. Extract a shared AI core

`Modules/AICore/` owns what every AI feature needs and no feature owns:

- `llmProvider/` — the provider factory and the three providers, moved verbatim, with `model` and `provider` added to the `ChatOptions` contract during the move.
- `usage.js` — the pricing table, the `LLM_PRICING` override and `summarize`.
- `instructionGuard.js` — prompt-injection phrase detection, already borrowed by agent memory.
- `askModel` and `parseModelJson` — the single model call with its `degraded` semantics, extracted from the agent orchestrator so the project generator's repair loop can share it.
- `persistence.js` — the LangGraph store and checkpointer factory, which carries no agent vocabulary.

Agents, the project generator, Pages, Portfolio, EstimatedTime and the AI module depend on the core. None depends on another feature module for its model client. `Modules/AI/**` is not the home: it mounts routes, and pointing the core at a route-owning module trades one bad dependency for another.

### 2. A skill becomes a per-company document with a closed vocabulary

One `agent_skills` collection in the company database. Four declarative parts, each with a frozen catalogue behind it:

| Part | What it declares | Frozen catalogue |
|---|---|---|
| `inputs` | What the task must already carry for the skill to be eligible, with the reason shown when it is not | input kinds: `brief`, `public_url`, `pr_link`, `project_task`, `linked_doc` |
| `gather` | What context to read | reader steps: the task, its project, tasks in the project, agent memory, a linked doc. Each is a call into the companyId-first tool layer; a skill never receives a database handle |
| `prompt` | Shared partials, the skill's own instructions, the user-message template, and the JSON shape the model must return | partial names, and the whitelisted-prefix interpolation reader |
| `emit` | How model output maps to registry actions and their parameters | registry action keys, each with the parameter schema the action already publishes |

This is the Automations engine's shape applied to skills, deliberately. A rule is trigger, conditions, steps; a skill is inputs, gather, prompt, emit. Both are validated into a normalised value, both render their authoring UI from a manifest endpoint, and both refuse to execute anything outside their operator table.

### 3. The registry stays hybrid

`getSkill(slug)` resolves a company's data skills first, then the built-in code skills. Code skills remain for work that needs an evidence layer the vocabulary cannot express: `qa-review` measures fourteen page facts in `engine/pageAudit.js` and gates every finding against a fact that actually failed, and `pr.summary` fetches an external pull request. Both keep that guarantee.

The migration is the proof of the vocabulary: `brief.parse`, `digest.ceo` and `project.guide` are re-expressed as seeded data skills. If one of them cannot be, the vocabulary is wrong and we learn it in the first slice rather than the fourth.

### 4. Declared actions become a real narrowing

`scopes` is replaced by the actions a skill's `emit` names. The effective set for a run is the intersection of the skill's emitted actions, the agent's `allowedActions` and the registry. It is validated when the skill is saved, not only when an action is performed, so an authoring mistake is a form error rather than a refused run an hour later. A skill can only ever narrow what its agent may do.

---

## Consequences

**Positive**

- A workspace composes agents from skills it wrote, which is the "agent as employee" model the owner asked for.
- Skill metadata has one home. The three copies of input requirements collapse into the skill record, served by one manifest endpoint, and the parity test that guards the duplication can be deleted.
- `name` and `description`, dead fields today, become the first user-visible skill metadata.
- Every skill gets a risk preview for free, because its rating is the union of its emitted actions' ratings, which the trust layer already computes.
- Extracting the core removes thirteen cross-module reaches and gives per-agent model choice somewhere to live.

**Negative**

- Two skill kinds coexist, code and data, and `getSkill` has to resolve both. This is a real cost paid to keep the QA evidence gate.
- The vocabulary will be too small at first. Every skill an admin cannot express is a feature request against the catalogue, and we should expect the first month to be mostly catalogue additions.
- A data skill is per-company, so a bug in a seeded skill has to be migrated into every company database rather than deployed once.

**Non-negotiables recorded here**

- No `eval`, `new Function` or `vm`, for any part of a skill. Gather steps and emit mappings come from frozen catalogues; prompt interpolation reuses the whitelisted-prefix reader from `Modules/Automations/engine/template.js`, and an unresolvable path renders as empty string, never as the path itself.
- No skill receives a database handle. Every read goes through a `companyId`-first tool function, as `Modules/Automations/engine/tools.js:7` requires of automation actions.
- A skill may only narrow permissions. Effective actions are the intersection with the agent's allowed actions and the registry, checked at save and again at perform.
- Unparseable means inert, never universal. A malformed skill does not run; a malformed input condition does not match everything.
- `version` is on the document from the first write, and any shape change ships its migration in the same task. ADR 002's rules still carry two live shapes and two validators; that is not repeated here.
- Every field a skill document can carry is declared in the strict schema before code writes it. Undeclared fields are dropped silently and tests using the fake database do not catch it.
- A skill is retired, never deleted, because agents and saved automation rules hold its slug.
- The authoring surface ships in the same slice as the runtime. Task 005 shipped an engine that could only be reached by inserting documents into MongoDB by hand, and task 007 is still open because of it.
- Adding a capability stays one file in the catalogue and zero frontend changes.

---

## Roadmap

| Phase | Ships | Dev-wks |
|---|---|---|
| 0 · Core | `Modules/AICore/` with provider, usage, guard, `askModel`, persistence; re-export shims at the old paths; the direct-to-OpenAI bypass in `Modules/ProjectTemplates/controller.js:288` moved onto the factory | 1 |
| 1 · Skill record | `agent_skills` schema and validator, the frozen catalogues, `GET /api/v2/agents/skills` manifest, hybrid `getSkill`, save-time action validation, `brief.parse` re-expressed as data | 2 |
| 2 · Authoring | Skill Library becomes a real library: create, edit, dry-run against a chosen task, risk preview, retire; agent settings picks skills from it; the three duplicated input tables collapse | 2 |
| 3 · Migration and cost | `digest.ceo` and `project.guide` as data; per-agent and per-skill model choice against a priced allowlist; unpriced-model warning in agent settings | 1.5 |
| 4 · Reach | Allow-listed external reads for data skills, which lets `pr.summary` become data | 2 |
| 5 · Deferred | Custom code in a sandboxed runtime, only if the catalogue provably cannot cover real demand | — |

---

## Defects this design assumes are fixed

Found while mapping the layer on 2026-09-10, each verified in the code. They are not part of the decision but they sit under it.

| Defect | Where | Effect |
|---|---|---|
| An unpriced model books `$0` | `Modules/Agents/runs.js:132` with `usage.js:28` | Company budget, agent cap and run cap all become no-ops. Default pricing covers Anthropic ids only |
| The run spend cap is checked after the model call | `Modules/Agents/engine/graph.js:81` | The cap can stop the acting phase but never the spend |
| `skillSlugOf` ignores `enabled: false` | `Modules/Agents/runs.js:274` | A disabled first skill still runs |
| A skill key is stored unvalidated | `Modules/Agents/controller.js:54` | A typo fails at run time as "unknown skill", while `allowedActions` is filtered against the registry on the line below |
| `agent.model` and `agent.schedule` have no readers | `utils/mongo-handler/schema.js:797` | Write-only fields that read as features |
| The private-host pattern differs between the fetcher and the router | `engine/pageAudit.js:22` against `taskInputs.js:7` | Routing calls a link-local URL public and the fetcher then refuses it |
| One LLM call site bypasses the provider factory | `Modules/ProjectTemplates/controller.js:288` | Ignores `LLM_PROVIDER`, so it fails on an Anthropic-only instance |

---

## References

- ADR 002 — Automation Engine and AI Agent Engine, Phase 4
- `Modules/Automations/engine/{expression,template,tools,runner}.js` — the precedent this design copies
- `Modules/CustomField/helpers/formula.js` — the second existing sandbox
- Task 016 contract — the endpoint documentation style this design's contract follows
