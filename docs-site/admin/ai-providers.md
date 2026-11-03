# AI providers

AlianHub's own AI features (Ask AlianHub, agents, AI fields, project generation, summaries, talk to text) call a model provider with a key you supply. Separately, people can connect their own AI app (Claude, ChatGPT, Claude Code) to AlianHub, which needs no server key at all. Nothing in the product requires AI: without a key the AI screens simply say AI is not set up.

## Two kinds of AI

| | Built-in AI features | Connect your AI app |
|---|---|---|
| Who pays for the model | this instance, with your provider key | the person's own AI subscription |
| What you configure | **Provider**, key and model | nothing on a new install; the four switches below |
| Guide | this page | [Connect your AI](/ai/) and the [MCP server reference](/ai/mcp-server) |

Both are under **Settings › Instance › Settings › AI**.

## Choose a provider

| Provider (`LLM_PROVIDER`) | Key | Model setting and default |
|---|---|---|
| `openai` | `AI_API_KEY` | `AI_MODEL`, default `gpt-4.1` |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL`, default `claude-sonnet-4-5-20250929` |
| `deepseek` | `DEEPSEEK_API_KEY` | `DEEPSEEK_MODEL`, default `deepseek-v4-flash` |
| `openai_compatible` | `OPENAI_COMPATIBLE_API_KEY` (optional) | `OPENAI_COMPATIBLE_MODEL`, such as `llama3.1:8b` |
| `google` (`.env` only) | `GOOGLE_API_KEY` | `GOOGLE_MODEL`, default `gemini-3-flash` |

1. Create an API key at the provider.
2. Under **AI**, pick the **Provider**, paste the key, and set the model if you want another than the default.
3. Press **Test**: it asks the provider to list models with that key.
4. **Save**. The change applies at once.

When `LLM_PROVIDER` is unset, the first provider that has a key answers, in the order of the table.

### Local and self-hosted models

`openai_compatible` talks to any server that speaks the OpenAI Chat Completions API on your own network, so prompts never leave it:

```bash
LLM_PROVIDER=openai_compatible
OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1     # Ollama
# OPENAI_COMPATIBLE_BASE_URL=http://gpu-host:8000/v1     # vLLM
# OPENAI_COMPATIBLE_BASE_URL=http://gpu-host:1234/v1     # LM Studio
OPENAI_COMPATIBLE_MODEL=llama3.1:8b
OPENAI_COMPATIBLE_EMBEDDINGS_MODEL=nomic-embed-text      # for knowledge search
```

Private and loopback addresses are allowed here. **Test connection** lists the models the server offers. Local models are priced at 0, so no budget stops them. Set `OPENAI_COMPATIBLE_MAX_OUTPUT_TOKENS` (default 8192) to what the model's context fits, and `OPENAI_COMPATIBLE_TIMEOUT_MS` if local inference is slow. Inside Docker, `localhost` is the container itself: use the host's address or the service name.

To reach OpenAI through a proxy or a regional endpoint, set `OPENAI_BASE_URL` instead; `OPENAI_EMBEDDINGS_URL` can point embeddings at an Azure deployment or another server that speaks the same API.

## Cost and limits

Every model call is booked to the workspace that made it, at the model's price.

| Setting | Key | Default | Meaning |
|---|---|---|---|
| Model prices (USD per 1M tokens) | `LLM_PRICING` | built-in list | JSON keyed by model id, such as `{"gpt-4.1":{"input":2,"output":8}}`. Overrides the built-in list. |
| AI field fills per workspace per day | `AI_FIELD_DAILY_LIMIT` | `500` | counted per UTC day; a bulk fill stops at the limit |
| | `AI_FIELD_BULK_MAX` | `200` | most tasks one bulk fill may take |
| Keep replay records of model calls | `AI_REPLAY` | `agent` | `off`, `agent` (agent runs only) or `all`; a redacted record of prompt and answer for review, kept `AI_REPLAY_RETENTION_DAYS` (30) |
| | `WHISPER_MODEL`, `WHISPER_USD_PER_MINUTE` | `whisper-1`, `0.006` | talk-to-text model and its price |

::: warning A model with no price refuses to run
Budgets and caps count cost. A model that has no price on file books zero, so AlianHub refuses to run it rather than spend without limit. If you set a model the built-in list does not know, add it to `LLM_PRICING` (use `{"input":0,"output":0}` for a free or self-hosted model). The **AI providers** tab marks such a model **No price**.
:::

Workspaces have their own AI budget for the month; when it is spent, Ask and agent runs stop until it resets or an owner raises it. With `TENANT_PROVIDER_KEYS=on`, each workspace may also pay with its own provider keys, set by its owners and admins and kept in the secrets store (needs `SECRETS_STORE` and `SECRETS_KEY`; see [Security](./security)).

## The AI providers tab

**Settings › Instance › AI providers** lists each provider and model with its health, circuit-breaker state, call count, latency (p50 and p95), last error, rate limit and price. Health is tracked per server process over the last few minutes.

With `AI_MODEL_ROUTER=on`, a failing or rate-limited provider fails over to the next configured one, and a workspace's **Routing policy** may name a model per kind of task. Tune it with `AI_ROUTER_MAX_ATTEMPTS`, `AI_ROUTER_RATE_LIMITS` (such as `openai:500,anthropic:200` requests per minute), the `AI_ROUTER_BREAKER_*` and `AI_ROUTER_BACKOFF_*` settings. With the router off (the default), the configured provider answers every call and nothing fails over.

Timeouts: `LLM_TIMEOUT_MS` (10 minutes) for every provider, overridable per provider (`OPENAI_TIMEOUT_MS`, `ANTHROPIC_TIMEOUT_MS`, ...).

## Knowledge search

Ask AlianHub can search page bodies, comments and attachments through a knowledge index. It is off until you switch it on:

| Key | Values |
|---|---|
| `KNOWLEDGE_INDEXER` | `off` (default) or `tenant`: index pages, comments, call notes, project guides and attachments for workspaces that turn it on |
| `KNOWLEDGE_RETRIEVAL` | `off` (default), `tenant` (workspaces whose retrieval mode is on or hybrid) or `all` (every workspace not set to off); a workspace in hybrid mode also embeds its chunks with OpenAI |
| `KNOWLEDGE_EMBEDDING_MODEL` | default `text-embedding-3-small` (OpenAI) |
| `KNOWLEDGE_VECTOR_STORE` | `local` (any MongoDB, default) or `atlas` (MongoDB Atlas vector search) |

Restart after changing them. **Settings › Instance › Knowledge** then shows each workspace's index, its backfill and embedding model, and lets you reindex or re-embed it. Changing the embeddings model means re-embedding each workspace there. The `KNOWLEDGE_FILE_*` settings cap how much of each attachment is read. Full descriptions are in [Environment variables](./env-reference#ai).

## Connecting people's own AI apps

On a new install, people can connect Claude, ChatGPT or Claude Code to AlianHub out of the box:

| Switch | Key | Default on a new install |
|---|---|---|
| **Connect an AI app by address** | `MCP_OAUTH` (`both`, `only`, `off`) | `both`; restart to change |
| **AI data tools** | `MCP_TOOLS_DATA` | on |
| **AI management tools** | `MCP_TOOLS_MANAGE` | on |
| **AI everyday work tools** | `MCP_TOOLS_WORK` | on |
| **Hold risky AI writes for approval** (Security group, shown only) | `AGENT_TAINT_ROUTING` | on while any of the four is on |

- Connecting by address needs `APIURL` (or `MCP_OAUTH_ISSUER`) to be an `https` origin. Until it is, `MCP_OAUTH` stays off and the server log says why, and people connect with a personal token instead. `only` refuses personal tokens.
- Every write needs the person's own access, and for an app, the permissions they granted it on the consent screen. The manage permissions also need an owner or admin to approve that app under **Settings › Agent clients**. Dynamic client registration (`MCP_OAUTH_DCR`) stays off.
- An install upgraded from before these defaults keeps all four off: the upgrade records off for each one `.env` does not name. Turn them on here.
- To turn something off, switch it off here or set it to `off` in `.env` and restart, for example `MCP_OAUTH=off` or `MCP_TOOLS_MANAGE=off`. A value in `.env` always wins.

## Turn AI off

- **Everything**: switch **AI features** off (`AI_ENABLED=false`). No prompt, text or audio is sent to any provider, AI screens say AI is turned off, agent runs are refused and background AI work is skipped.
- **Just the built-in features**: leave every provider key empty.
- **Connected AI apps**: set `MCP_OAUTH=off` and the `MCP_TOOLS_*` switches off.
- **The Workspace Guide agent in new workspaces**: switch **Workspace Guide in new workspaces** off (`WORKSPACE_GUIDE_AUTO_CREATE=false`).

## Related

- [Connect your AI](/ai/)
- [AI platform architecture](/ai/architecture)
- [Security](./security)
- [Environment variables](./env-reference#ai)
