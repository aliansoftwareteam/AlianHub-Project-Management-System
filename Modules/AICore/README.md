# AICore

The shared AI core: what every AI feature needs and no feature owns (ADR 003, phase 0).

| Piece | File | Role |
|-------|------|------|
| Provider registry | `llmProvider/registry.js` | the one place a provider is known: the OpenAI, Anthropic, DeepSeek and Google adapters, plus `listProviders()` for the routing console |
| Provider factory | `llmProvider/index.js` | `getProvider(selection)` / `isAnyProviderConfigured()` — picks the adapter, wraps it in the spend meter |
| Request normalisation | `llmProvider/normalise.js` | one request out of the same chat options for every vendor: output ceiling, structured-output mode, reasoning-model parameters, and the `AI_MODEL_ROUTER` flag |
| Usage and pricing | `usage.js` | token accounting, cost estimation, the unpriced-model gate |
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
the vendor call.

An adapter declares what differs about its vendor in `capabilities`; `normalise.js`
turns those plus the caller's options into the model id, output ceiling, temperature
and structured-output mode the vendor wants. `tests/ai-provider-contract.test.js`
drives every adapter in the registry through the same requests and failures.
