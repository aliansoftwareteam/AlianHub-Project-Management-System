# AICore

The shared AI core: what every AI feature needs and no feature owns (ADR 003, phase 0).

| Piece | File | Role |
|-------|------|------|
| Provider registry | `llmProvider/registry.js` | the one place a provider is known: the OpenAI, Anthropic, DeepSeek and Google adapters, plus `listProviders()` for the routing console |
| Provider factory | `llmProvider/index.js` | `getProvider(selection)` / `isAnyProviderConfigured()` — picks the adapter, wraps it in the spend meter |
| Health and the breaker | `llmProvider/health.js` | success and failure rates, latency quantiles and the last error class per provider and model, and the circuit breaker built on them |
| Rate-limit budgets | `llmProvider/rateLimit.js` | a requests-per-minute token bucket per provider, tightened by a vendor's own retry hint |
| Resilient call | `llmProvider/router.js` | retry with backoff, failover to the next configured candidate, and the flag-off path that only observes |
| Request normalisation | `llmProvider/normalise.js` | one request out of the same chat options for every vendor: output ceiling, structured-output mode, reasoning-model parameters, and the `AI_MODEL_ROUTER` flag |
| Usage and pricing | `usage.js` | token accounting, cost estimation, the unpriced-model gate, and `ensurePriced()` / `pricedModels()` — the one pricing check anything that stores a model id uses |
| Task classes | `taskClass.js` | the four shapes of work every feature falls into, each with a quality floor, a latency target and an input budget |
| Model catalogue | `llmProvider/catalogue.js` | the priced allowlist: the pricing table joined to the registry, with the provider and quality tier of a model id |
| Model pins | `modelPin.js` | `validatePin()` — what an agent or skill may pin, refused at save time when the model is unpriced or its provider is not configured |
| Routing policy | `routingPolicy.js` | the per-workspace task class to model preferences, on the company row; `effective()` is what a router reads |
| Pre-call estimate | `estimate.js` | `estimateCall()` — what a call will cost before it is made (chars/4 with a safety factor, plus the max output), for spend gates |
| Features | `features.js` | the closed list of feature tags a model call must carry |
| Spend ledger | `spend.js` | the meter around every `chat()`: refuses an unpriced model before the vendor call, books one `ai_usage` row per call, announces budget levels for non-run features |
| Replay record | `replay.js`, `redact.js` | one `ai_replays` row per call from the same meter: prompt hash (unredacted), redacted and capped prompt and raw response, model, parameters, agent and skill revisions; `AI_REPLAY` (`off`, `agent`, `all`) and `AI_REPLAY_RETENTION_DAYS` set the policy, and a failed write only warns |
| Instruction guard | `instructionGuard.js` | detects prompt-injection phrasing in user-supplied text before it reaches a prompt or memory |
| Model call | `modelCall.js` | `askModel()` — the single "call the model and parse JSON" helper, with an optional `budget.guard` that reserves the estimate before the call and reconciles after — and `parseModelJson()` |
| Persistence | `persistence.js` | per-company LangGraph checkpointer and store (Mongo, or in-memory under tests) |

## The rule

Every model call goes through `llmProvider.getProvider().chat(...)`. No file outside this
folder requires a vendor SDK or posts to a vendor host directly;
`tests/conventions/ai-core-boundary.test.js` enforces that.

Every call names its feature and tenant through the `spend` option:

```js
provider.chat({ ..., spend: { feature: FEATURES.ASK, companyId, userId } });
```

The meter writes the `ai_usage` row that `Modules/Agents/budget.js` sums, so the
tenant budget and its 80% / 100% alerts see every feature. A call without a known
feature tag fails under test and is booked as `unknown` with a warning in production;
a call without a tenant is booked against the global database the same way.
Agent runs pass `runId`: the row is booked once here, and `runs.recordSpend` only
keeps the run's own `spend` fields, the agent's monthly cap and the run-context alert.

## Routing

`AI_MODEL_ROUTER` defaults to `off`, which is today's behaviour exactly: the provider
chosen by `LLM_PROVIDER` (or the first configured one) answers every call, and a
`provider` or `model` named on the chat options is ignored. With the flag `on`,
`getProvider({ provider })` picks that adapter and `chat({ model })` sends that model —
priced by the meter like any other, so a model with no price is still refused before
the vendor call, and `routingPolicy.effective()` hands over the model the workspace
picked for the task class. With the flag off that model is always null, so a saved
policy changes nothing.

A pin is a different thing from the policy: the policy is a workspace preference per
task class, a pin is one agent or one skill saying "always this model". Both are held
to the same allowlist — every model with a price on file, served by a provider this
instance has configured — and both are checked when they are saved, so an unpriced or
unreachable model is a refusal in the settings form, not a failed run later.

An adapter declares what differs about its vendor in `capabilities`; `normalise.js`
turns those plus the caller's options into the model id, output ceiling, temperature
and structured-output mode the vendor wants. `tests/ai-provider-contract.test.js`
drives every adapter in the registry through the same requests and failures.

## Health, breakers and rate limits

Every real call's outcome is written to a health window per provider and model —
success and failure counts, p50 and p95 latency, the last error class — whether
or not the router flag is on. With the flag off that is all that happens: one
adapter, one attempt, and numbers for the instance console.

**Where it lives.** In this process, in a `Map`. A multi-node install therefore
has one window and one breaker per node: each node discovers an outage from its
own failures, spending a few calls to do it, and the console shows the node that
answered the request rather than the cluster. The alternative — a shared store —
puts a write on the hot path of every model call to save those few calls, which
is the wrong trade. A restart starts closed, which fails towards trying a
provider rather than away from one.

**The breaker.** *Closed* is normal. It opens when the health window holds at
least `AI_ROUTER_BREAKER_VOLUME` eligible calls and at least
`AI_ROUTER_BREAKER_THRESHOLD` of them are provider failures — a timeout, a
network error, a 5xx, an overload, an auth, quota or permission refusal, a
missing model. A malformed request, an over-long context and a content filter
are the caller's, not the provider's: they are never counted, because another
provider would refuse them too. A rate-limit answer is a queue rather than an
outage and never opens the breaker on its own; it counts only when nothing at
all got through in the window. *Open* means the candidate is skipped entirely
for `AI_ROUTER_BREAKER_COOLDOWN_MS`. After that it is *half-open*: exactly one
probe is admitted at a time, a successful probe closes the breaker and clears
the window, and a failed one re-opens it for twice as long, up to
`AI_ROUTER_BREAKER_MAX_COOLDOWN_MS`.

**Rate limits.** `AI_ROUTER_RATE_LIMITS="openai:500,anthropic:200"` gives each
provider a requests-per-minute token bucket (`AI_ROUTER_DEFAULT_RPM` covers the
rest; 0, the default, means no bucket and so no change). A call with no token
waits up to `AI_ROUTER_RATE_WAIT_MS` and otherwise takes the next candidate. A
429 drains the bucket for as long as the vendor's retry hint asks, so the next
call does not earn another one.

**Retry and failover.** A retryable provider error is retried on the same
provider up to `AI_ROUTER_MAX_ATTEMPTS`, waiting the vendor's retry hint if it
sent one and otherwise a jittered exponential backoff from
`AI_ROUTER_BACKOFF_MS` to `AI_ROUTER_BACKOFF_MAX_MS`. When the attempts run out,
or the breaker is open, or the bucket is empty, the call moves to the next
configured provider in registry order — dropping any model the caller named,
because a model id belongs to one vendor. When every candidate is skipped
without being called the failure is marked retryable, so a step's own retry
policy applies. All of this is gated on `AI_MODEL_ROUTER=on`.
