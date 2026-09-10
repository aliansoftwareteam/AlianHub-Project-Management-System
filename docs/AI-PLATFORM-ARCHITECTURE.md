# The AlianHub AI layer, measured against a platform brief

**Date:** 2026-09-10
**Baseline:** `beta` @ `64f4f507`. Anything only on the open [PR #552](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/pull/552) is labelled as such and never counted as shipped.
**Companion:** [ADR 003](adr/003-ai-layer-and-skills-as-data.md) decides skills-as-data and the shared AI core. This document is wider and assumes it.

---

## How to read this

Two things are being done at once, and keeping them apart is the point.

**Measured.** Every "today" claim below was verified against the code in this repository, with a file and line. Where the answer is "nothing", it says nothing rather than describing an intention.

**Argued.** Every recommendation is made from first principles with its alternatives, including the alternative of replacing something we already have. Nothing is recommended because it is what the repo happens to use.

The honest headline: **the parts of this platform that were designed as a safety boundary are strong, and the parts that were designed as plumbing are missing.** Tenant isolation is structural rather than filtered. The action registry genuinely bounds what an agent can do. The automation engine treats idempotency, checkpointing and retry as first-class. The agent engine, which is the newer half, has none of the three, and the observability layer does not exist at all.

### Scorecard

| Area | Shipped on beta | Verdict | The one thing that matters |
|---|---|---|---|
| **A** Agent lifecycle | Create, update, pause, resume, soft delete with an in-flight guard | **Partial** | No versioning of an agent, its skill or its prompt, so no run is reproducible |
| **B** Multi-agent communication | Nothing. Three callers start a run; agents cannot reach each other | **Absent** | Greenfield. Build on the event bus, not on direct calls |
| **C** Workflow orchestration | Two half-engines. Automations are durable; agent runs are a fire-and-forget function | **Partial** | No DAG, no parallel steps, no dependencies, no resume for agents |
| **E** Memory and knowledge | Regex over task text and page *titles*. Per-task QA dedupe | **Weak** | No embeddings, no vector store, no ingestion, page bodies unreachable |
| **F** Model routing | One provider chosen from an environment variable at process start | **Absent** | No per-call model, no failover, no retry, no circuit breaker |
| **G** Security | Database-per-tenant, an absent-not-disabled action registry, full audit with undo | **Strong, two live holes** | Retrieval and one MCP tool bypass their own scope checks |
| **H** Observability | Rotating text logs with a request id that never leaves the log file | **Absent** | No metrics, no tracing, no error tracker, no run replay record |
| **I** Failure recovery | Automations resume from a cursor. Agent runs are hard-failed on restart | **Split** | An agent crash leaves partial writes and no way to continue |

---

## A. Agent architecture

### Lifecycle today

| Stage | Today | Where |
|---|---|---|
| **Created** | Wizard or `POST /api/v2/agents` from four hard-coded templates. A per-project Guide agent is auto-created when a plan is executed | `Modules/Agents/controller.js`, `frontend/src/views/Ai/agentTemplates.js`, `AIProjectGenerator/executeAgents.js:114` |
| **Registered** | Skills are a frozen array in a source file. The agent's skill key is stored unvalidated against it | `Modules/Agents/skills/index.js:8`, `controller.js:54` |
| **Deployed** | Process restart. There is no other mechanism | — |
| **Versioned** | **Nothing.** Not the agent, not the skill, not the prompt, not the model | — |
| **Executed** | One agent, one skill, one task, one model call, fire and forget | `controller.js:274`, `engine/orchestrator.js:8` |
| **Monitored** | A run row with status, decisions, actions, spend and a one-line outcome | `utils/mongo-handler/schema.js:804` |
| **Updated** | `PUT` mutates the record in place. Running work is unaffected and unrecorded | `controller.js` |
| **Retired** | Soft delete, refused while runs are open, history preserved | `controller.js:164` |

Creation, update and retirement are done well. The retirement path in particular gets the hard part right: it refuses while work is in flight and keeps run and audit history, so the record of what an agent did outlives the agent.

### The gap that matters

**Nothing is versioned, so nothing is reproducible.** An agent's behaviour is the product of its autonomy level, its allowed actions, its skill, that skill's prompt, and the model. All five can change with no record. A run six weeks old cannot be explained, because the thing that produced it no longer exists in the form that produced it.

This is not a nice-to-have for an agent platform. It is the precondition for every other answer in this document: you cannot debug a bad result, evaluate a routing change, or defend an action to a client without knowing exactly what ran.

### Recommendation: immutable revisions, pinned per run

Separate the **agent** (a stable identity, like an employee record) from its **revision** (an immutable snapshot of everything that determines behaviour).

```
agent          { id, name, owner, status: active|paused|retired, currentRevisionId }
agentRevision  { id, agentId, n, createdBy, createdAt,
                 skillRefs: [{ skillId, skillRevisionId }],
                 allowedActions[], projectIds[], autonomy,
                 modelPolicy, limits, promptHash }
```

A run pins `agentRevisionId` at start and never re-reads the mutable record. Editing an agent creates revision `n+1`; in-flight runs finish on `n`. Rollback is a pointer move. The run row already carries the fields that would join to this, and adding it is a schema change plus one write.

**Alternatives considered.** Copying the whole agent document onto every run is simpler and wrong at scale, because a prompt is large and runs are numerous. Event-sourcing the agent gives perfect history at the cost of a rebuild step on every read. Git-backed definitions are attractive for us as authors and hostile to the workspace admins who, per ADR 003, are the intended authors.

**Deployment** then becomes promotion of a revision rather than a process restart, which is what makes canarying a prompt change possible at all.

---

## B. Multi-agent communication

### Today

There is none. Exactly three callers start a run: the API controller, the plan executor, and the automation rule action. No agent can message, delegate to, or hand off to another. The word does not appear in the codebase in this sense.

The relevant existing asset is the domain event bus, which already carries an actor kind of `agent`, enforces a hard depth limit, coalesces bursts, and lets a rule opt out of reacting to machine-authored events. That is most of a communication substrate.

### Recommendation: agents do not call agents

The chain in the brief, media to creative to analytics and back, is a **workflow**, not a conversation. Modelling it as direct calls produces the failure mode every distributed system learns once: a synchronous chain whose latency is the sum of its parts and whose failure surface is their product, with no place to put a retry.

So: **agents never invoke each other. They complete a step and emit a typed result. The workflow engine decides what happens next.** A handoff is an edge in a graph, not a call.

**Message envelope.** One shape for every step dispatch, borrowed from what the automation envelope already proves out and extended for causality:

```
{ tenantId, workflowId, workflowRevisionId, stepId, attempt,
  idempotencyKey,                    // stable across retries of this step
  correlationId,                     // the whole workflow
  causationId,                       // the step that produced this
  actor: { kind, id, onBehalfOf },   // who is accountable
  input, inputRefs[],                // large payloads by reference, never inline
  deadline, budget: { tokens, usd } }
```

Two details that matter. Payloads travel **by reference** into tenant storage, because a campaign brief inlined into every message makes the queue the bottleneck and the run log unreadable. Every message carries a **deadline and a budget**, so a step cannot outlive its usefulness or outspend its worth, and both shrink as they pass down a chain.

**Agent identity.** Already right, and should be extended rather than replaced. Actor kinds distinguish person, automation, agent and system; every agent action carries the agent, the run, and the human it acts on behalf of. Add the revision, and a step-scoped credential rather than an ambient one, per section G.

**Task state.** Owned by the workflow, never by an agent. An agent is a pure function from input to result plus audited side effects. State in the agent is what makes a rerun unsafe.

**Synchronous or asynchronous.** Asynchronous by default. Synchronous only for a sub-second read where the caller cannot proceed, and even then behind a timeout that degrades rather than fails. The single-call design of the current engine is a real asset here: cost and latency are bounded by construction.

**Failure, retry, timeouts, idempotency.** The automation runner already encodes the right answers and the agent path should adopt them rather than invent new ones: a deterministic-versus-transient split so a permanent error is not retried three times, capped attempts with exponential backoff, a persisted cursor, and idempotency by unique key rather than find-then-insert. Section I gives the concrete mechanism.

One live defect to fix first. The agent action context hardcodes loop depth to zero, so an agent write resets the counter the bus uses to break cycles, and the depth limit can never trip through an agent hop. Today the only thing preventing a rule-agent-rule loop is a per-rule flag that defaults off. That flag should not be the only guard.

---

## C. Workflow orchestration

### Today: two half-engines

**The automation engine is durable and correct.** Steps run from a persisted cursor, so a restart resumes rather than replays. Delivery is idempotent through a unique index on rule and event with a duplicate-key catch, which is deliberately not find-then-insert. Retries are capped and backed off, and split between deterministic and transient. Jobs survive restart in a queue on the global database, with the tenant's durable run record in the tenant's own database.

**The agent engine has none of that.** A user-started run is an unawaited call after the HTTP response returns: no queue, no persistence, no concurrency limit, no retry. On restart, every in-flight run is marked failed, after an unknown number of writes have already landed. There is no cursor to resume from and no record of how far it got.

Neither engine can express parallel steps or a dependency between steps. Every loop is sequential by explicit choice, on the sound reasoning that parallel writes against a small per-tenant connection pool turn a working feature into a timeout.

### Recommendation: one workflow engine, agents as step executors

A campaign workflow is a DAG whose nodes are typed steps. A step is an agent run, a tool call, a human approval, or a control node. The engine owns state, scheduling, retries and approvals. Agents own judgement.

```
workflow          { id, tenantId, revisionId, definition }   // versioned like an agent
workflowRun       { id, workflowId, revisionId, status, input, startedAt, deadline, budget }
workflowStepRun   { id, workflowRunId, stepId, attempt, status,
                    idempotencyKey, input, output, error, deterministic,
                    startedAt, finishedAt, durationMs, cost, traceId }
```

The step record is the unit of everything: resume, retry, tracing, cost attribution and the audit trail. The automation runner already writes most of these fields, which is the strongest argument for generalising it rather than starting over.

**Parallel and dependencies.** Steps declare `dependsOn`. The engine runs the ready set, bounded by a per-tenant concurrency limit, which is the missing piece that makes parallelism safe given the connection-pool constraint that motivated the current sequential design. Fan-out and fan-in become ordinary nodes.

**Checkpoints.** Every step boundary is a checkpoint. Within a step, the executor is responsible for its own atomicity, and an agent step's checkpoint granularity is its node. That is a real limitation and should be stated rather than hidden: a step that dies mid-write is replayed whole, which is safe only because every write goes through an idempotent tool layer.

**Human approval.** Already the right shape and should be lifted from a per-run interrupt to a first-class step type with an owner, a deadline and an escalation. Two live defects to fix in passing: nothing expires a run waiting on a person, and the run collection's time-to-live is unconditional on status, so a long-pending approval eventually has its run deleted while its proposal survives, pointing at nothing.

### Why not Temporal

Temporal is the strongest alternative and it would be the right answer at a different point on the curve. It gives durable execution, replay-based recovery, timers, and a mature operational story that would take us a year to approximate.

We should not adopt it here, for reasons that are about this product rather than about Temporal:

- This is a self-hosted, AGPL product that a small team installs with a compose file. Temporal adds a cluster, its own datastore and a version-compatibility discipline to every deployment. The existing architecture deliberately keeps external dependencies at one database plus optional object storage.
- Determinism-constrained workflow code is a real authoring constraint, and per ADR 003 the intended authors are workspace admins composing declarative definitions, not engineers writing workflow code.
- The durable primitives we need are already built and proven in the automation runner. Generalising a working cursor into a DAG is a smaller and better-understood risk than adopting a distributed runtime.

**Keep the seam.** The queue is already behind an adapter interface, written for exactly this reason. The workflow engine should sit behind an equivalent interface so a Temporal backend is a driver rather than a rewrite. The trigger to switch is stated in the trade-offs section.

---

## E. Memory and knowledge

### Today

Retrieval is one file. It takes at most six keyword terms after a stoplist, builds a case-insensitive regular expression, and runs it against task name, key and description, and against page **titles only**. Results are sorted by most recently updated rather than by relevance, capped at a dozen tasks and six pages. Citations are filtered by substring-matching the model's answer, which is a display filter rather than a verification gate.

There are no embeddings anywhere. Three full-text indexes are declared and maintained on every tenant database and nothing queries them.

What exists and is genuinely good: per-task QA finding memory keyed on a measured fact identifier rather than a title, with regression detection when a closed finding returns. On PR #552, a workspace memory store with decisions, constraints, user preferences and run episodes, with provenance and retire-never-delete.

What is unreachable: page bodies, comments, meeting-note transcripts, every uploaded file, project guides, and all financial and performance data. Company-wide pages are structurally unreachable because retrieval is scoped to a project list and they have no project.

### The four tiers

Conflating these is the usual cause of both cost blowups and wrong answers.

| Tier | Lifetime | Scope | Today |
|---|---|---|---|
| **Working state** | One run | Private to the run | Checkpoints, on PR #552 only |
| **Episodic** | Retention window | Project, shared | Run records; episodes on PR #552 |
| **Semantic** | Until retired | Project shared, or per user | Decisions, constraints, preferences, on PR #552 |
| **Retrieval corpus** | Follows the source | Per document, ACL-bearing | **Missing entirely** |

Only the fourth needs embeddings. Treating agent memory as a retrieval problem is the mistake that produces a vector store full of preferences nobody can read back reliably.

### Recommendation

**Ingestion off the event bus.** The bus already emits typed change events per tenant. An indexer subscribes, and for each changed document extracts text, chunks on structure rather than fixed width, embeds, and upserts with a content hash so unchanged chunks are not re-embedded. Deletion tombstones immediately and purges asynchronously. This gives correct freshness without a crawl, and it reuses a mechanism that is already load-bearing.

**Chunk metadata carries the permission, not just the text.** Every chunk stores tenant, source type and identifier, project, visibility, owner, author, timestamps, a content hash and the revision of the embedding model. This is what makes the access-control answer below possible and what makes a re-embedding migration tractable.

**Access control is applied at query time, never only at index time.** Index-time filtering bakes a permission snapshot into the index and goes stale the moment a project is shared or a person leaves. The retrieval call takes the caller's identity, resolves the visible set, and filters the vector query by it. This is exactly the property the current retrieval path claims in its own header comment and does not have.

**Vector store: a pluggable adapter with an honest default.** The choice is genuinely constrained by self-hosting.

| Option | For | Against |
|---|---|---|
| Vector search inside the tenant database | Isolation for free, one datastore, no new operational surface | Requires the managed offering; unavailable on a plain self-hosted server |
| Postgres with a vector extension | Excellent recall and filtering, cheap to run, familiar | A second datastore for a Mongo product |
| Dedicated vector database | Best scale and features | Another service per deployment, and per-tenant isolation must be built |
| Lexical only, with the indexes already declared | Zero new infrastructure, works everywhere | Stops being adequate quickly |

Recommendation: define a retrieval interface with hybrid lexical-plus-vector search, ship the lexical implementation first because it works in every deployment and is a strict improvement on the current regular expression, and ship a vector adapter for hosted deployments. Hybrid search with reciprocal rank fusion outperforms either alone often enough that this is the right destination regardless.

**Deletion and erasure.** Tombstone on delete, cascade on project and user deletion, and a genuine erasure path. Memory today has no time-to-live and no cascade, so orphaned rows persist forever, which is a compliance problem before it is a cost problem.

---

## F. Model routing

### Today

One provider is selected from an environment variable when the process starts. The chat interface has no model parameter, so no caller can request a specific model. The agent record has a model field that nothing reads. There is no retry, no failover, no circuit breaker and no rate-limit handling, and the carefully assigned provider error codes are discarded one frame above where they are set.

Three provider differences a router would have to normalise are already present and undocumented: output-token ceilings differ by an order of magnitude, JSON mode is native on two providers and emulated by appending a sentence to the system prompt on the third, and reasoning models require different parameters.

### Recommendation

A router between the caller and the providers, with four inputs and one decision.

```
route({ taskClass, contextTokens, tenantPolicy, slo }) -> { provider, model, params, budget }
```

**Task class, not caller.** Classify the work: extraction, summarisation, planning, review, code, conversation. A class carries a quality floor and a latency target. This is what lets a cheap model take the classification step in a workflow whose planning step needs a frontier model.

**Health-aware selection with a circuit breaker.** Per provider and model, track error rate, rate-limit responses and latency in a short window. Open the breaker on sustained failure and route to the next candidate. Half-open probes restore it. This is the mechanism that answers the thirty-minute outage scenario.

**Budget as a first-class input.** Estimate tokens before the call, reserve against the tenant's remaining budget, and reconcile after. Today the run cap is checked after the model call, so it can stop the acting phase but never the spend.

**Fix the pricing defect first.** Default pricing covers one vendor's model identifiers. An unpriced model books zero cost, and every downstream control silently stops working: per-agent cap, per-run cap, company budget and both alert thresholds. It fails quietly and looks like healthy zero spend. A router that cannot price its own choices cannot make them.

### Evaluating whether routing improves business performance

This is the part of the brief most often answered with latency dashboards, which measure the wrong thing. Routing is a business change and needs a business measurement.

**Offline, a golden set.** Fifty to two hundred real tasks per class with graded outcomes, replayed on every routing or prompt change. Grade on outcome, not on similarity to a reference answer. This gates a change from reaching production.

**Online, the outcomes the product already records.** This is where AlianHub is unusually well placed, because the trust layer instrumented human judgement as a side effect of being safe:

- **Approval rate** of proposals, per model and task class. A human approving a change is the strongest available quality signal.
- **Decline reasons**, which are already a small closed vocabulary, so a model producing more "too many changes" is visible rather than inferred.
- **Revert rate** within the undo window. A reverted run is a defect that passed review.
- **Edit distance** between what was proposed and what was approved after editing.
- **Refusal and repair rate**, which catches a cheaper model that technically answers but fails the format.

Route by policy, hold out a slice, and compare those five per class. Cost per approved change is the summary metric, and it is the one that says whether a cheaper model was actually cheaper: a model that halves token cost and doubles the revert rate is more expensive, and only outcome data shows it.

---

## G. Security and authorization

### Today: unusually strong foundations, and one structural gap that undoes much of it

**What is genuinely good, and rarer than it should be:**

- **Tenant isolation is structural.** The company identifier *is* the database name, so a cross-tenant read is not a filter that can be forgotten but a connection that was never opened.
- **There is no code-execution primitive in the runtime backend.** No `eval`, no `new Function`, no virtual machine module, no process spawning. Both expression evaluators are closed-vocabulary tree walkers with an own-property check on every hop, so the classic constructor escape fails.
- **The action registry works by absence.** Deleting a project, deleting a task, merging, deploying, billing, removing a member, editing permissions and setting a task to done are absent from it rather than disabled in it. There is no flag to switch on.
- **Refusals are audited as first-class rows**, carrying the attempted action, its parameters and the request path. That is the telemetry that detects a compromised agent token, and most systems do not have it.
- **Undo descriptors are written by the executor that holds the before-state**, not reconstructed later, and an unknown descriptor is reported as not undoable rather than guessed.

**The structural gap: for browser traffic, authorization is still only in the frontend.**

The server-side permission guards each begin by returning early unless the request carries a machine token. The comment says so plainly, and the reason is documented and honest: the backend mirror did not yet match the frontend for per-project overrides, and gating shared routes caused false denials in production.

The consequence is that the permission model is advisory for the majority of traffic. Anyone holding a valid session token and using a command-line HTTP client bypasses role and permission checks entirely, which is precisely the hole the module was written to close. It is closed for machine tokens and open for people.

**The tool boundary has two soft spots.**

First, the never-list is documentation rather than a control. The registry's evaluation function does not consult it; enforcement comes from those actions being absent from the action table. That is sound today and fragile tomorrow, because adding a matching key to the table would make it live despite the never-list entry. It needs a test that fails if the two ever disagree.

Second, performing an action consults the registry and never the permission catalogue. A machine token cannot exceed the registry, but it can exceed the role of the person who minted it. A member whose role denies changing a task's status can still change it through a token, because that path never reaches the middleware where roles are checked.

**Egress is the most directly exploitable finding.** The private-host check is a string prefix match on the hostname, applied only to the first URL. Redirects are followed without revalidation, so a public host that redirects to a cloud metadata endpoint is fetched and its body returned to the model. The check is also blind to internal service names, which matters because the shipped deployment is a compose file where sibling services resolve by name, and to alternate address encodings. The trigger is a task description, which any member can write.

**Audit is thorough but not trustworthy under attack.** There is no hash chain and no signature, rows live in the database the application can write freely, and a scheduled sweep deletes them. An audit write that fails is swallowed, and the action proceeds with no record and no undo descriptor.

**The undo window is advisory.** The setting exists, is validated, and is shown in the console, but the undo path never checks a row's age against it. Every agent action is reversible forever, by any member of the company, including in projects that member cannot see.

**Two scope escapes inside a tenant**, both verified: retrieval ignores page visibility, and the MCP document-read tool ignores both the token's project scope and page visibility while returning up to forty thousand characters.

**Credentials are encrypted inconsistently.** Cloud storage tokens, two-factor secrets and instance settings are encrypted with authenticated encryption. Integration credentials, which include third-party access tokens with write access to code repositories, sit in plaintext and are protected only by redaction when read back through the API. A backup or a database dump exposes them.

### Recommendation

**Authentication.** Human sessions stay as they are. Machine identity should move from a long-lived personal token to a short-lived, workflow-scoped credential minted per step, carrying tenant, workflow, step, agent revision and an expiry. A leaked token then buys minutes and one step's authority rather than a day and the token's full scope.

**Authorization: role-based, with attributes for scope.** Roles decide capability. Attributes, meaning project membership, visibility and ownership, decide reach. This is what already exists in the permission layer; the change is to apply it uniformly to agent reads, which today are enforced structurally at run start rather than checked per read.

**The narrowing chain.** Effective authority is the intersection of the registry, the agent revision's allowed actions, the skill's declared actions per ADR 003, and the step's granted scope. Every layer may narrow and none may widen. Checked when authored and again when performed.

**Credentials.** Provider keys are environment variables today, which is adequate for one operator and inadequate the moment a tenant brings its own key. They belong in a secrets store, referenced by handle, resolved at call time by the router, never logged and never returned by an API. The settings endpoint already reports key presence without the value, which is the right pattern to generalise.

**Egress.** Agents fetch external pages, and the private-host check runs on the initial URL but not on redirects, so a redirect to a link-local address is followed. Outbound needs an allowlist per tenant, revalidation on every hop, and a response size and time cap.

**Audit immutability.** Append-only with a per-tenant hash chain, so tampering is detectable rather than merely discouraged. Audit rows currently have no expiry while the runs that explain them expire after six months, which should be reversed: keep the explanation at least as long as the record.

---

## H. Observability

### Today

There are no metrics, no tracing and no error tracker. Logs are rotating plain text with a request identifier that is generated per request and never leaves the log file: it is not on the run row, not on the audit row, and not sent to the provider.

Worse for the brief's central question, **the prompt, the raw model response and the retrieved context are all discarded.** So is the flag that records whether the model ran at all, which means a QA run that produced findings from the deterministic fallback is indistinguishable in the database from one that used a model.

Token and cost are recorded for agent runs only. Ask, the project generator, meeting notes, page generation, portfolio summaries and three estimators record nothing, and the generator can request a very large output budget per call and leave no trace.

### Recommendation

**Three pillars, one identifier.** Adopt OpenTelemetry and make the trace identifier the join key that appears on the workflow run, every step run, every audit row and every log line.

Span structure, which is what makes the brief's questions answerable by construction:

```
workflow.run
 └── step.run  (agent, tool, approval)
      ├── retrieval          chunk ids, scores, filter
      ├── model.call         provider, model, tokens in/out, cost, latency, cache
      └── tool.call          action key, decision, audit id
```

**Metrics.** Rate, errors and duration per workflow, step, agent and model; token and cost counters with the same dimensions; queue depth and age; approval, decline and revert rates as first-class product metrics because they are the quality signal that section F depends on.

**The run replay record.** One record per model call storing the prompt hash, the resolved prompt or its reference, the retrieved chunk identifiers, the raw response, the model and parameters, and the agent and skill revisions. This is what turns "why did this agent produce this result" from an inference into a lookup. It carries a retention and redaction policy, because the prompt contains tenant content.

**Alerting on rate, not on events.** Error rate per agent and workflow, approval rate falling, cost per tenant against forecast, queue age, and provider breaker state. Today the only alerts are budget thresholds, and nothing tells anyone that an agent has failed its last twenty runs.

**Answering the brief directly:**

| Question | Where the answer comes from |
|---|---|
| Why did this agent produce this result | Replay record: prompt, retrieved chunks, raw response, revisions |
| Which model was used | Model call span and the run's pinned model policy |
| Which tools were called | Tool call spans joined to audit rows by run |
| How long did the workflow take | Workflow span, with per-step durations already recorded |
| Where did it fail | The failed step run, its error, and whether it was deterministic |
| How many tokens | Token counters on model call spans, split input and output |
| How much did it cost | Cost derived at the call from a priced model, aggregated by tenant |
| Which agent or workflow is slow | Metrics by agent, workflow and step, at percentiles |

---

## I. Failure recovery

Fifteen steps, step eleven fails after ten succeed.

**Would you restart the whole workflow?** No, and today for agents you would have to, which is the gap. Steps one to ten have mutated real data. Replaying them means a second comment on someone's task, a duplicate subtask, a second campaign push. The engine resumes at eleven.

**Where is state stored?** In the tenant's own database, as one workflow run plus one record per step run holding input, output, attempt, status and timing. Large payloads are referenced, not inlined. The queue holds only a pointer, so losing a queue entry costs a retry while losing a run record would cost the history.

**How is step eleven retried?** With a stable idempotency key derived from workflow run and step, so every attempt is the same logical operation. Capped attempts with exponential backoff. Deterministic failures, meaning a missing task or an unknown action, fail immediately rather than three times, because retrying a permanent error only multiplies the cost of a broken definition.

**How is duplicate execution prevented?** At three levels. A unique index on workflow run and step so a re-delivery cannot create a second attempt record. Idempotent tool operations keyed on that identifier so a replay is a no-op rather than a second write. A compare-and-set claim on the step so two workers cannot both hold it.

This last one needs saying plainly: **agent runs have none of these today.** There is no unique index, no in-flight check and no claim, so a double-click starts two runs on one task with two model bills. There is also a latent duplicate-execution bug where the job lock expires before the model timeout, so a slow call outlives its lock and the job is re-delivered while the first is still running.

**Recovery from a permanent failure.** The step is marked failed with its error and determinism flag; the workflow moves to a terminal state its definition chose, which is fail, or skip, or route to a compensating step, or wait for a human. Compensation rather than rollback, because steps one to ten had real effects. The undo descriptors already recorded per action are exactly the compensation primitive, and whole-run revert already proves the walk works.

**Root cause.** The step run names what failed and whether it was deterministic. The trace identifier joins it to the model call, the retrieval, the tool calls and the log lines. The replay record shows what the model was actually given. Today you would get a one-line outcome string and a timestamp to eyeball against a text log.

---

## Architecture decisions and trade-offs

**1. Database per tenant, kept.**
*Alternative:* shared collections with a tenant key, which is the industry default and much cheaper per tenant.
*Why:* isolation stops being a filter that can be forgotten and becomes a connection that was never opened. In a product where agents act autonomously, that is worth a lot.
*Trade-off accepted:* cross-tenant analytics require fan-out, per-tenant migrations are a loop, connection pools bound concurrency, and a shared vector index is not available.
*Would change if:* tenant count reaches the thousands, where connection and migration cost dominates, and the answer becomes a hybrid with large tenants isolated.

**2. Generalise the existing durable runner rather than adopt Temporal.**
*Alternative:* Temporal, or a workflow service.
*Why:* the durable primitives are already built and proven here, and a self-hosted product cannot casually require a cluster.
*Trade-off accepted:* we own the scheduler, the timers and the recovery semantics, which is real ongoing cost and a genuine source of subtle bugs.
*Would change if:* workflows exceed roughly a day, need human timers at scale, or the team spends more than about a fifth of its time on orchestration bugs.

**3. The action registry stays a closed allowlist.**
*Alternative:* dynamic tool discovery, which is where the wider ecosystem is heading.
*Why:* forbidden actions being absent rather than disabled means a compromised token has nothing to switch on, and it makes the risk rating and the approval preview possible.
*Trade-off accepted:* every new capability is a code change and a release, which is a real brake on how fast the platform grows.
*Would change if:* third-party tools become a product requirement, at which point registration must carry a signature, a rating and a per-tenant grant.

**4. Declarative skills, not sandboxed code.**
*Alternative:* a JavaScript sandbox, per ADR 003's rejected option.
*Why:* an in-process sandbox is not a boundary, and the closed vocabulary covers the intended use.
*Trade-off accepted:* the vocabulary will be too small at first and every gap is a request against the catalogue.
*Would change if:* a quarter's worth of requests cannot be expressed, at which point a separate runtime with its own egress and resource policy is the honest cost.

**5. Retrieval starts lexical, with a vector adapter behind an interface.**
*Alternative:* adopt a vector database immediately.
*Why:* every deployment must work, including a plain self-hosted server, and hybrid search is the destination anyway.
*Trade-off accepted:* hosted and self-hosted tenants get materially different answer quality until the adapter ships.
*Would change if:* corpora grow past the point where lexical recall is embarrassing, which comes quickly for long documents.

**6. Agents communicate through the workflow engine, never directly.**
*Alternative:* direct agent-to-agent calls, which is what most agent frameworks demonstrate.
*Why:* a synchronous chain has additive latency and multiplicative failure, and nowhere to put a retry or an approval.
*Trade-off accepted:* more moving parts for a two-step flow, and every handoff needs a typed contract.
*Would change if:* a genuine sub-second negotiation loop appears, which a campaign workflow does not have.

**7. Human approval is a workflow step, not a special case.**
*Alternative:* keep it as the per-run interrupt it is today.
*Why:* approvals need owners, deadlines, escalation and reassignment, and a workflow step already has all four.
*Trade-off accepted:* the current interrupt is simpler and works.
*Would change if:* approvals stay single-step and single-owner, in which case the interrupt is enough.

---

## Failure and scale scenarios

**A provider is unavailable for thirty minutes.** The breaker opens after sustained failures and the router selects the next candidate for the affected classes, degrading quality rather than availability. Steps whose class has no alternative are marked transient-failed and retried with backoff past the outage. Nothing is lost because a step is resumable. *Today: every run fails, no failover exists even with a second provider configured and keyed, and the error code that would drive the decision is discarded.*

**A hundred thousand tasks in an hour.** Admission control per tenant at the queue, so one tenant's burst cannot starve another. Workers scale horizontally on the queue; per-tenant concurrency stays bounded by the connection pool. Cheap classification steps run on small models and fan out; expensive steps are the bottleneck by design, and the budget check refuses new work rather than letting spend run. Backpressure surfaces as queue age, which is alertable. *Today: user-started agent runs bypass the queue entirely, so this is unbounded parallelism against a small pool.*

**An agent loops on the same tool.** Four independent limits: per-step tool-call cap, per-workflow depth, an identical-call detector that refuses a repeated action with identical parameters within a step, and the budget. The event bus depth guard already exists and works for rules. *Today: the agent path resets that depth counter to zero on every write, so the guard cannot trip through an agent, and the practical backstop is running out of money.*

**An agent attempts another client's data.** It cannot reach the connection, because the tenant identifier is the database name. The attempt is refused and audited. This is the one scenario the current architecture answers completely, with the caveat that the two verified holes are *within*-tenant scope escapes rather than cross-tenant, and both should still be closed.

**A workflow fails at step eleven.** Covered in section I: resume at eleven, idempotency key, capped backoff, deterministic failures not retried, compensation for the permanent case, and the trace identifier for the root cause.

**A model sixty percent cheaper is slightly worse.** Not a judgement call, a measurement. Run it against the golden set for the affected classes, then online against approval rate, revert rate, edit distance and repair rate on a held-out slice. Adopt per class rather than globally, because the cheap model is usually right for extraction and wrong for planning. Cost per approved change is the deciding number, and a model that halves token cost while doubling reverts is more expensive.

**A critical tool becomes unavailable.** A tool call is a step, so it retries with backoff and fails deterministically when the error says permanent. The workflow definition chooses: wait, route to a human step, or compensate and stop. Breaker state per tool is visible, and the workflow surfaces as blocked rather than silently stalling.

---

## Defects found while measuring

All verified in the code on 2026-09-10, most of them read twice. Grouped by how much trouble they can cause, not by how hard they are to fix.

### Security, exploitable today

| # | Defect | Consequence |
|---|---|---|
| 1 | External fetches follow redirects without revalidating the private-host rule, and that rule is a hostname prefix match | Any member who can write a task description can make the server fetch a cloud metadata endpoint or an internal service and return the body to a model. Internal service names, alternate address encodings and most private address ranges all pass |
| 2 | Server-side permission guards return early for anything that is not a machine token | Role and permission checks are advisory for browser traffic. A valid session plus a command-line client bypasses the permission model |
| 3 | Performing an agent action consults the registry but never the permission catalogue | A machine token can exceed the role of the person who minted it |
| 4 | Retrieval ignores page visibility | Private page titles are returned as sources to anyone who can open the project |
| 5 | The MCP document-read tool ignores project scope and page visibility | A project-scoped token reads any page body in the company |
| 6 | Integration credentials are stored in plaintext | Third-party tokens with repository write access are exposed by any backup or database read. The codebase already encrypts cloud storage tokens correctly |
| 7 | The undo path never checks the undo window, and any member may undo | Every agent action is reversible forever, by anyone in the company, including in projects they cannot see |
| 8 | MCP does not re-check company membership | A removed member keeps access until someone deactivates the token |
| 9 | Auth cookies are not http-only and the content security policy is disabled | Any script injection yields both the session token and the two-day refresh token |
| 10 | The never-list is documentation; the registry's evaluation never consults it | Adding a matching key to the action table would make a forbidden action live despite its never-list entry |

### Correctness and cost

| # | Defect | Consequence |
|---|---|---|
| 11 | Default pricing covers one vendor's model identifiers; an unpriced model books zero | Every spend control silently stops working and looks like healthy zero spend |
| 12 | Agent runs have no idempotency key and no in-flight check | A double-click runs twice, with two model bills and two sets of writes |
| 13 | The job lock expires before the model timeout | A slow call outlives its lock and the job is re-delivered while the first is still running |
| 14 | The agent action context hardcodes loop depth to zero | The event bus depth guard can never trip through an agent hop |
| 15 | The run spend cap is checked after the model call | It can stop the acting phase but never the spend |
| 16 | The run collection's expiry is unconditional on status | A long-pending approval outlives its run, leaving an orphaned proposal |
| 17 | An hourly run limit is stored, defaulted and never enforced | A schema field promising a safety limit that does not exist |
| 18 | Spend is recorded for agent runs only | Every other AI feature is invisible to the budget, including the highest-token path in the product |
| 19 | An audit write that fails is swallowed and the action proceeds | An action can happen with no record and no undo descriptor |
| 20 | Audit rows are not tamper-evident and a sweep deletes them | History can be rewritten undetectably by anything with database access |
| 21 | Two competing uncaught-exception handlers | One mails and rethrows while the other exits, so the mail is unlikely to send |

The first three are the ones to fix this week. Number eleven is the one most likely to be discovered by an invoice.

---

## Development and integration plan

**Assumptions.** Two-week sprints. Two to three engineers on the AI layer, with the owner doing the API and browser sweeps as on every slice since task 014. Everything lands on `beta` behind the existing agents flag, one slice per pull request with the repository's checks green before merge, and one release from `beta` to `main` at the end of the programme, which is the owner's standing decision from 2026-09-05. Sizes follow the same scale as the existing roadmap, where task 016 was three weeks and task 017 two.

**Ordering principles.** Close what is exploitable before building anything. Put the measurement in before the change it is meant to measure. Extract the core before anything that needs a per-call model choice. Make orchestration durable before making it multi-agent. Ship every authoring surface in the same sprint as the runtime it authors, because task 005 shipped an engine nobody could reach and task 007 is still open for it.

### Sprint 0 · Stop the bleeding (one week)

Goal: no exploitable finding survives, and spend accounting is correct everywhere.

1. Merge the two open pull requests, housekeeping first and then task 017, so every later branch starts from the checkpointed engine.
2. Outbound fetches resolve before they validate, check every resolved address against private ranges, revalidate on each redirect, and cap size and time.
3. Retrieval applies the page visibility rule the other read paths already use; the MCP document-read tool applies the token's project scope and visibility; the MCP path re-checks company membership like the REST path does.
4. Performing an agent action evaluates the holder's permission catalogue entry, not only the registry.
5. Pricing fails closed: an unpriced model refuses to start a billed run with a reason that names the missing price, and defaults ship for every configured vendor.
6. A test asserts the never-list and the action table can never overlap. A failed audit write fails the action. The undo path enforces the undo window and the caller's project visibility. Integration secrets are encrypted with the existing cloud-storage idiom, with a migration.

*Integration.* Six small pull requests, each with a test that reproduces the defect first. The only schema change is the secrets migration, run by the migrations runner. No flags.

*Exit gate.* The two data-access findings reproduce on the previous commit and fail to reproduce after; the in-process sweep books a non-zero cost on every configured provider.

### Sprint 1 · The shared core and run correctness (two weeks)

Goal: one AI core, and an agent run that cannot execute twice.

1. Move the provider factory, usage and pricing, the instruction guard, the single model call and the persistence factory into `Modules/AICore/`, leaving re-export shims at every old path so the thirteen consumers and their test mocks keep working. Move the one direct-to-vendor call onto the factory.
2. Agent runs gain an idempotency key and an in-flight claim: a partial unique index on agent, task and open status, checked with a duplicate-key catch rather than find-then-insert, and a reaper for proposals stuck in the applying state.
3. Align the job lock with the model timeout per job, and set the server-level timeouts that are missing today.
4. Thread loop depth from the originating envelope through agent actions instead of resetting it to zero.
5. Record spend at the core boundary so every AI feature, not only agent runs, reaches the budget.
6. Check the run spend cap before the model call from a token estimate, and reconcile after.

*Integration.* The shims make this a pure move; tests move with the code in the same commit. Consumers are repointed one module per pull request after the core lands, then the shims are deleted.

*Exit gate.* Full backend and frontend suites green; a double-submitted run start yields one run; a rule-triggered run under a slow model produces one execution.

### Sprint 2 · Revisions and the skill record (two weeks)

Goal: every run is reproducible, and a skill is data.

1. Agent revisions and skill revisions as immutable documents; a run pins both at start; promote and roll back are pointer moves with an audit row.
2. The skill record, its validator returning field-level errors like the automation rule validator, the frozen catalogues for inputs, readers, prompt partials and emitted actions, the manifest endpoint, and the hybrid resolver that reads a company's data skills first and the built-in code skills second.
3. Save-time validation of emitted actions, and the effective-actions intersection with the agent's allowed actions and the registry.
4. The intake skill re-expressed as a data skill. If it does not fit, the vocabulary is wrong and this sprint is where that is learned.

*Integration.* A seed migration writes the built-in skills as revision one in every company database. Runs created before the change resolve to a synthetic revision zero so nothing old breaks. Every new field is declared in the strict schema before the first write.

*Exit gate.* A run six weeks old can name the exact skill, prompt hash and model that produced it.

### Sprint 3 · Observability foundation (two weeks)

Goal: the eight questions in section H have a lookup, not an inference. This lands before routing because routing cannot be evaluated without it.

1. OpenTelemetry with the trace identifier on the run row, every step row, every audit row and every log line; logs move to structured records.
2. The replay record per model call: prompt hash and reference, retrieved chunk identifiers, raw response, model and parameters, agent and skill revisions, with a retention and redaction policy.
3. A metrics endpoint behind admin auth: rate, errors and duration per workflow, step, agent and model; token and cost counters; approval, decline and revert rates.
4. Provider error codes preserved end to end and grouped, so an error tracker has something to group.
5. Alerts on rates: error rate per agent, approval rate falling, cost against forecast, queue age.

*Integration.* The exporter is off unless an endpoint is configured, so self-hosters see no change; the replay record is written from the core's single model call, which is why sprint 1 comes first.

*Exit gate.* From a run identifier, the prompt, the retrieved context, the raw response and every tool call are reachable in under a minute.

### Sprint 4 · The model router (two weeks)

Goal: any task can run on any configured provider, and the platform survives one being down.

1. Model and provider on the chat options; a provider registry that includes a Google adapter alongside the three that exist; per-provider normalisation of output ceilings, structured-output mode, reasoning-model parameters and error codes.
2. Task classes with a quality floor and latency target each; a per-tenant policy table; per-agent and per-skill model pins validated against a priced allowlist.
3. Health tracking per provider and model with a circuit breaker, half-open probes, failover to the next candidate, and per-provider rate-limit budgets; retry with backoff on transient provider errors.
4. Pre-flight token estimate, reservation against the tenant budget, reconciliation after.

*Integration.* Behind a router flag whose default policy reproduces today's single-provider behaviour, so flipping it is a no-op until a policy is set. The Google adapter ships with the same contract tests the other three pass.

*Exit gate.* With one provider blackholed in a test environment, agent runs continue on the fallback and the breaker state is visible.

### Sprint 5 · The workflow engine (three weeks)

Goal: multi-step, multi-agent work is durable, parallel where safe, and resumable at any step.

1. Workflow runs and step runs as the unit of everything, generalised from the automation runner: dependencies, ready-set scheduling, per-tenant concurrency, a unique index on run and step, a compare-and-set claim, deterministic-versus-transient retries.
2. Step types: agent run, tool call, human approval with owner, deadline and escalation, fan-out and fan-in, condition, and timer. A loop is a bounded re-entry with a maximum iteration count and a budget, which is how a monitoring and optimisation cycle is expressed without an unbounded graph.
3. Agent runs become step executors; user-started runs go through the queue like rule-started ones already do.
4. Dispatch rides the event bus with typed results; deadline and budget shrink per hop; the depth guard applies to agent hops.

*Integration.* An existing automation rule is a one-node workflow, so rules run unchanged. The old direct execution path stays as a thin compatibility wrapper for one release, then goes.

*Exit gate.* A fifteen-step workflow killed at step eleven resumes at eleven with no duplicate writes; an approval step reassigns and escalates on deadline.

### Sprint 6 · Skill authoring and migration (two weeks)

Goal: a workspace admin composes an agent from skills they wrote, in the product.

1. The Skill Library becomes a library: create, edit, dry-run against a chosen task, risk preview from the union of emitted actions, retire. Agent settings pick skills from the manifest; the three duplicated input tables in the frontend are deleted with their parity test.
2. The reporter and project-guide skills re-expressed as data; per-skill model pin exposed in the editor.

*Integration.* The authoring surface ships in the same sprint as the last runtime piece it needs, and the owner sweeps it before merge.

*Exit gate.* An admin creates a new skill, assigns it to an agent, runs it on a task and sees its outcome, with no deploy.

### Sprint 7 · Knowledge and retrieval (three weeks)

Goal: agents and Ask can reach what the workspace actually knows, and only what the caller may see.

1. One retrieval interface with hybrid lexical and vector search; the lexical implementation ships first on the full-text indexes that already exist, with access control applied at query time from the caller's visible set.
2. Ingestion off the event bus: extract, chunk on structure, embed, upsert against a content hash; tombstone on delete; cascade on project and user deletion; embedding model version on every chunk.
3. Sources brought in order of value: page bodies, comments, meeting transcripts, uploaded files through text extraction, project guides, and workspace-level pages that have no project.
4. The vector adapter for hosted deployments behind the interface.
5. The regular-expression path in Ask is retired.

*Integration.* The index is built per tenant by a background migration; retrieval is flagged per tenant; answer quality is compared on a held-out set of real questions before the flag defaults on.

*Exit gate.* A question about a private page is answered for its owner and not for a colleague; a deleted page disappears from answers within a minute.

### Sprint 8 · Security hardening (three weeks)

Goal: authorization is enforced where the data is, and a leaked credential buys minutes.

1. Server-side permission enforcement for browser sessions, after bringing the backend catalogue to parity with the frontend on per-project overrides; staged as report-only for two weeks, logging would-be denials, then enforced.
2. Step-scoped short-lived credentials minted per step; provider keys and integration secrets in a secrets store referenced by handle; per-tenant provider keys.
3. Agent egress through an allow-listing proxy per tenant.
4. Audit as append-only with a per-tenant hash chain; audit retention at least as long as run retention.
5. Http-only session cookies and a content security policy, which is frontend work with the socket and refresh flows adjusted.

*Integration.* Report-only mode is the safety net for the enforcement change, since the last attempt caused false denials in production.

*Exit gate.* The three critical findings from the defect list are closed by design, not by patch; a would-be denial report over two weeks shows no legitimate traffic blocked.

### Sprint 9 · Evals and routing measurement (two weeks)

Goal: a routing or prompt change is a measured business decision. This is task 019.

1. A golden set of fifty to two hundred real tasks per class, graded on outcome, replayed in CI on every prompt or routing change.
2. Online outcome metrics per model and class from what the trust layer already records: approval rate, decline reasons, revert rate, edit distance, repair rate; cost per approved change as the summary number; a held-out slice.
3. Dashboards and the rate alerts from sprint 3 wired to these metrics.

*Exit gate.* The cheaper-model scenario is answered from data for at least three task classes.

### Sprint 10 · External agents (three weeks)

Goal: an outside agent is a teammate with typed activities, not a token with a bearer header. This is task 018.

1. OAuth 2.1 and scopes on the MCP server; more of the data model exposed with the same registry and rating discipline.
2. Inbound external agent sessions as step executors, with typed activities and a human assignee kept on every delegated task.

*Exit gate.* An external coding agent completes a step in a workflow, its actions appear in the audit with the right attribution, and a revoked grant stops it mid-step.

### Dependencies at a glance

| Sprint | Needs | Unblocks |
|---|---|---|
| 0 | Nothing | Everything |
| 1 | 0 | 2, 3, 4 |
| 2 | 1 | 6 |
| 3 | 1 | 4, 9 |
| 4 | 1, 3 | 5, 9 |
| 5 | 1, 4 | 6, 10 |
| 6 | 2, 5 | — |
| 7 | 1 | 9 |
| 8 | 1 | 10 |
| 9 | 3, 4, 7 | — |
| 10 | 5, 8 | — |

Sprints 7 and 8 have no dependency on 5 or 6 and can run on a parallel track if a third engineer is available, which is how 015 and 016 were run.

### What every sprint does the same way

- Branch from `beta`, one slice per pull request, the four checks green, then the owner's API sweep and browser sweep recorded in the task's progress log before merge.
- New behaviour behind a flag whose default reproduces today, so a merge is never a behaviour change on its own.
- Schema fields declared before the first write, and any shape change ships its migration in the same pull request.
- The in-process sweep against the real database and model runs on every merge, extended with the sprint's own checks.
- Each sprint's task folder records deviations from this plan and the reasons, the way tasks 015 to 017 do.

---

## What the interface needs

The architecture above changes what a person can see and do. This maps each area to its surfaces, marked **exists** where task 014 to 017 already shipped it, **extend** where a shipped screen grows, and **new** where nothing exists yet. Every string goes through the locale catalogue, and every new screen gets the owner and member browser sweeps that have gated each slice since task 014.

| Area | Surface | State | What it must show or let a person do | Sprint |
|---|---|---|---|---|
| **A** Lifecycle | Agent settings → revision history | **new** | Numbered revisions with who changed what and when, a diff of autonomy, actions, skills, prompt and model between any two, promote and roll back as one click each, and the revision badge on every run | 2 |
| **A** Lifecycle | Run detail → pinned revision | **extend** | Which agent revision and skill revision produced this run, linked | 2 |
| **B** Communication | Workflow run → lineage | **new** | Who handed off to whom, with the typed result passed at each edge, and the accountable person on each step | 5 |
| **C** Orchestration | Workflow builder | **new** | Compose steps from the manifest the way the automation sentence builder does today: agent, tool, approval, fan-out, condition, timer; declare dependencies; set a per-workflow budget and deadline; save disabled by default and dry-run against a real input | 5 |
| **C** Orchestration | Workflow run view | **new** | The step graph with live status, duration and cost per step; retry, skip, resume and compensate as explicit controls on a failed step; a blocked workflow surfaced with the reason and the step it is waiting on | 5 |
| **C** Approval | AI Inbox → approval steps | **extend** | Approvals that belong to a workflow show the owner, the deadline, the escalation path and a reassign control; the existing decline-reason step stays | 5 |
| **C** Loops | Workflow run → iteration counter | **new** | For a monitoring and optimisation cycle: iterations used of the maximum, budget used of the cap, and a stop control | 5 |
| **E** Knowledge | Instance console → knowledge sources | **new** | Which sources are indexed per workspace, index freshness and size per source, the embedding model in use, a re-index control, and an erasure control per document and per person | 7 |
| **E** Knowledge | Ask → citations | **extend** | Every citation reflects the caller's visibility; a "why this answer" panel lists the retrieved passages with their source and permission, not just the titles | 7 |
| **E** Memory | Project detail → what the agents remember | **exists** | Decisions, constraints, preferences and recent runs, with owner edit and retire, shipped on the open branch | — |
| **F** Routing | Instance console → providers | **new** | Each configured provider and model with health, breaker state, rate-limit budget and whether it is priced; a loud warning when a pinned model has no price on file | 4 |
| **F** Routing | Workspace settings → routing policy | **new** | Task class to model preferences with quality floor and latency target, editable per workspace, with the default shown as "same as today" | 4 |
| **F** Routing | Agent and skill settings → model pin | **extend** | Pin a model per agent or per skill, chosen only from the priced allowlist | 4, 6 |
| **F** Evaluation | AI hub → routing outcomes | **new** | Approval rate, decline reasons, revert rate, edit distance and cost per approved change, per model and per task class, with the held-out comparison | 9 |
| **G** Security | Accounts → tokens | **extend** | Expiry mandatory with a default, scopes never empty, last use, and step-scoped credentials shown as such | 8 |
| **G** Security | Instance console → egress allowlist | **new** | The hosts agents may fetch, per workspace, with the private-range rule stated | 8 |
| **G** Security | Instance console → enforcement | **new** | Permission enforcement in report-only or enforce mode, with the would-be denial log to review before switching | 8 |
| **G** Security | Audit log | **extend** | An integrity indicator per row from the hash chain, and a filter for refusals as the compromised-token signal | 8 |
| **G** Undo | Run detail and audit → undo | **extend** | The undo window shown as a deadline and enforced, with the reason when it has passed, and undo hidden outside the caller's visible projects | 0 |
| **H** Observability | Run detail → trace | **extend** | A timeline of steps, the model call and every tool call with durations, tokens, cost and the decision on each; a link to the replay record | 3 |
| **H** Observability | Run detail → replay | **new** | The prompt sent, the retrieved passages, and the raw response, redacted per policy, shown to owners and admins | 3 |
| **H** Observability | AI hub → health | **new** | Error rate, approval rate and cost per agent and per workflow over time, sortable, so the slow or failing one is found by looking rather than by asking | 3 |
| **H** Cost | Instance console → AI agents | **extend** | Spend from every AI feature, not only agent runs, against the budget, with the alert thresholds already shown | 1 |
| **H** Alerts | Notification settings | **extend** | Owners and admins choose which rate alerts reach them: error rate, approval falling, cost against forecast, queue age | 3 |
| **I** Recovery | Workflow run → failed step | **new** | The error, whether it was deterministic, the attempts and backoff so far, and the single control that applies: retry, skip or compensate | 5 |
| **Skills** | Skill Library | **extend** | Becomes a real library: create, edit, dry-run against a chosen task, the risk preview from emitted actions, retire; today it lists the action registry | 6 |
| **Skills** | Agent settings → skills | **extend** | Pick skills from the manifest instead of toggling a fixed list; effective actions shown as the intersection with the agent's allowed actions | 6 |

Three design constraints that apply across all of it. First, state is encoded in form as well as words: a breaker that is open, a step that is blocked, a model with no price, a token without an expiry each need a visible mark, not a sentence in a tooltip. Second, every destructive or irreversible control names its consequence in the control itself, the way the existing revert button does. Third, the member view and the owner view diverge more with every sprint, and each new surface is designed for both from the start rather than gated afterwards.

---

## Appendix: what PR #552 changes

Not shipped, green, and open. It moves the agent engine onto a checkpointed graph with per-company persistence, which closes several gaps above:

- Run state is checkpointed per node, so a waiting run survives a restart. Resume is per node, not mid-node.
- Human approval becomes a real interrupt with a durable resume, rather than a callback that replays a change list.
- The workspace memory store lands: decisions, constraints, preferences and run episodes, with provenance and retire-never-delete.
- Checkpoint and store indexes are created per tenant, with an expiry on checkpoints.

It does **not** address idempotency for agent runs, the depth-counter reset, model routing, metrics, tracing, the replay record, or either of the two data-access holes.
