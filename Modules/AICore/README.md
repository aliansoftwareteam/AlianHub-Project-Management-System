# AICore

The shared AI core: what every AI feature needs and no feature owns (ADR 003, phase 0).

| Piece | File | Role |
|-------|------|------|
| Provider factory | `llmProvider/` | `getProvider()` / `isAnyProviderConfigured()` plus the OpenAI, Anthropic and DeepSeek adapters behind one `chat()` interface |
| Usage and pricing | `usage.js` | token accounting, cost estimation, the unpriced-model gate |
| Instruction guard | `instructionGuard.js` | detects prompt-injection phrasing in user-supplied text before it reaches a prompt or memory |
| Model call | `modelCall.js` | `askModel()` — the single "call the model and parse JSON" helper — and `parseModelJson()` |
| Persistence | `persistence.js` | per-company LangGraph checkpointer and store (Mongo, or in-memory under tests) |

## The rule

Every model call goes through `llmProvider.getProvider().chat(...)`. No file outside this
folder requires a vendor SDK or posts to a vendor host directly;
`tests/conventions/ai-core-boundary.test.js` enforces that.

## Old paths

`Modules/AIProjectGenerator/{llmProvider,usage,instructionGuard}` and
`Modules/Agents/engine/persistence` are one-line re-export shims so existing consumers
and their `jest.mock` calls keep working. Consumers are repointed one module per pull
request in the follow-ups to task 024 step 1, after which the shims are deleted.
