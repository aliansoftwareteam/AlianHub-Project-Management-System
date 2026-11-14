# Progress: Connectors in the AI chat — @mention or name an app, read with the asker's own account

## Checklist
- [x] Connectors group in the `@` picker (from `GET /api/v2/connectors`; 087's `/api/v1/ai/ask/mentions` route is not on this branch)
- [x] Name matching adds a removable chip
- [x] Read step: pull request rule, model pick, checks
- [x] Cited sources; taint, caps, usage
- [x] Changes become Inbox proposals
- [x] Unit tests; i18n backfill and checks

## Last step
Built on `feat/connectors-ai-chat` from `02cd81e8f` (the connector module with the MCP transport). Committed, not pushed. Two acceptance boxes wait on task 075: the pull request rule and "comment on that PR" are proved against a stand-in GitHub provider in the tests, and tick once the real GitHub connector exists.

## Blockers
- 075 (GitHub connector): the rule names `github.pull_request.read` with `{ owner, repo, pullNumber }`; 075 must give the tool that input, or the rule's row changes with it. Until then GitHub is not in the connectors list, so no GitHub chip is offered or accepted.
- 087 (grouped `@` picker): this branch extends the old picker; 087 moves the Connectors group into its own picker and its mentions route.

## Decisions
- **One step per question, not per chip.** Rules run first for each connector chip; every chip no rule answered shares one model call (`parseModelJson`, JSON mode), which may return at most three calls (`readLimits.RUN.CALLS`) across the question. A question also takes in at most `readLimits.RUN.CHARS` characters from apps, the same caps a run has.
- **The rule table** is `RULES` in `Modules/AI/askConnectors.js`: a row is `{ tool, calls(question) }`. The pull request row reads a GitHub link, `owner/repo#123` and "PR 482 in owner/repo". A row applies only while its tool is turned on for the chip's provider and each call fits the tool's input; otherwise the chip goes to the model pick.
- **Checks on a picked call:** the tool must be a turned-on tool of a chip's provider (a tool of another connected app, an unreviewed MCP tool or an invented name is refused as `unknown_tool`); the arguments must fit the tool's own input (`Mcp/argsSchema`), so a `connectionId` the model chose is refused too (`bad_input`). The model's own words are never shown: a refusal is a code and a sentence the server writes.
- **A read** goes through `actions.authorizeRead` (registry and the asker's own `ai_connectors` right, as an MCP read) and then `toolRunner.read` with the new caller kind `VIA.CHAT` (`callerId: 'ask'`), so it is audited, counted against the asker's own daily reads (decision 14) and tainted like any connector read. Its text becomes a source of kind `connector`, ref `<provider>:<n>`, cited like any other.
- **No web fetch after a read (FR-59):** the whole Ask stream question runs in one `egressContext`; a successful read calls `noteConnectorRead`, so `agentFetch` refuses any web fetch for the rest of that question. Ask makes no web fetch today; this holds for any added later.
- **A change (FR-60)** is never run. It is taken through `Mcp/tools.planned` (the checks an MCP write meets) and filed with `proposals.create` as an Ask proposal (`source: 'ask'`) whose `connectionOwner` is the asker, so it waits in their Inbox with the connector card, only they can approve it, and it is sent once. Its usage and audit rows name the chat (`proposals.js` maps an Ask proposal to the `chat` caller). The answer is told in a `CONNECTED APPS` block, and the screen lists it under the answer with a link to the Inbox.
- **Refusals in words:** a missing, broken or under-ticked connection is said with `toolRunner`'s own sentences (resolved once per chip before any model call, so a member without the connection costs nothing). The screen words known codes in the asker's language and keeps the server's sentence for the rest.
- **Only a signed-in session reads apps:** a call with an API token gets `session_only` and no read. An answer built on an app read gets no share token, so it is never offered for posting to a chat.
- **Name matching** is in the browser: a connected app's display name as a whole word (any case), or a pull request link or `owner/repo#123` for GitHub, adds an `auto` chip; the chip goes when the name is cut, stays gone once the asker removes it (until the box is reset), and a chip picked from `@` stays. An app not connected adds nothing; under `@` it shows with Connect, which opens the Connections page.

## Shared connector files changed
- `Modules/Connectors/toolRunner.js`: `VIA.CHAT = 'chat'`; exports `connectionOf` (the existing resolver with its refusal sentences).
- `Modules/Agents/proposals.js`: an Ask proposal's connector write is filed with `via: 'chat'` (was `agent`).
- `utils/mongo-handler/schema.js`: the `connectorUsage.actor` comment names `chat`. No enum needed changing: `quotas`, `usage` and `callAudit` take the caller kind as given.
- Not touched: `connection.js`, `apps.js`, `registry.js`, `providerApi.js`, `quotas.js`, `usage.js`, `callAudit.js`, `tools.js`.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decisions 24, 25). Track B.
- Built: `Modules/AI/askConnectors.js` (chips, rule table, model pick and its checks, reads, filed changes, the answer's block); `askStream.js` runs the step after the workspace gather, puts app sources first, adds `connectors` to the answer and drops the share token after an app read; empty answers say `connector_unread` or `connector_waiting`.
- Frontend: `askComposer.js` (`connectorsOf`, `connectorResults`, `namedConnectors`, `withNamedChips`, `connectorNoteKey`), `useAskComposer.js` (loads the connectors list, Connectors items under `@`, Connect, name chips), `AskComposerMenu.vue`, new `AskConnectorNotes.vue`, `AskPage.vue`, `useAskConversation.js`, `askWhy.js`; 20 `Ask.*` strings and four provider names in `en.js`, backfilled (English copies, pending review).
- Tests: `tests/ask-connectors.test.js` (24) with a stand-in GitHub provider in `tests/fixtures/connectors-chat/` beside the fake and notesmcp fixtures; `frontend/tests/unit/askConnectors.spec.js` (12).
- Runs: ask-connectors, connector-*, connectors-*, ask-intent*, ai-ask-*, ai-profile: 38 suites, 809 tests pass. agent-proposal*, inbox-*, mcp-*, agent registry/never/rated: 87 suites, 3294 pass. Conventions: 477 pass, 1 fails (plain-words "baseline is stored sorted", CRLF on this machine). Vitest: askConnectors, askComposer, askConversation, askWhyPanel, aiAskHome, askPlan: 6 files, 79 pass. `i18n:check` and `style:check` pass.
