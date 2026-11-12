# Progress: Connectors — MCP client and MCP provider definitions: call apps' MCP servers as the member, reviewed tools only

## Checklist
- [x] MCP provider definitions: `transport: 'mcp'`, `mcp.url`, products without scopes (`validate.js`)
- [x] MCP tools as data: `mcpTools.js` (`tool`, reviewed `shape`); `tools.js` checks them; an unreviewed tool is never on
- [x] Client over Streamable HTTP through `agentFetch.callMcp` (`mcpClient.js`)
- [x] Shape check at call time; a changed or withdrawn tool is refused and logged
- [x] Runner hands MCP tools `connection.mcp`; 429 holds the connection, 401 marks it broken, a tool's error text stays out
- [x] Contract section 9 (063)
- [x] Fake MCP server and tests
- [x] Record changed tools in `connector_tools` and tell owners and admins; owner/admin re-approval

## Last step
Done on `feat/connectors-mcp-transport`. Catalog shapes for real apps are pinned with `scripts/connector-tool-shapes.js` and a test account (094, 095, 075).

## Blockers
None.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decisions 18, 20). Track B.
- Built on `feat/connectors-mcp-transport`, cut from `feat/per-user-connectors`:
  - `Modules/Connectors/validate.js`: `transport` (`api` or `mcp`); for `mcp`, an https `mcp.url` whose host is in `egressHosts`, and products that may list no scopes.
  - `Modules/Connectors/mcpTools.js`: `mcpTool({ tool, shape, args, ...definition })` gives an MCP tool its `run`, so an MCP provider is data only.
  - `Modules/Connectors/tools.js`: an MCP tool must name its server tool and a sha256 shape or `null`; a tool whose product has no scopes names none; `isOn` is false for an unreviewed tool, so the agent registry, AlianHub's MCP server and `anyOn` leave it out.
  - `Modules/Agents/engine/agentFetch.js`: `callMcp`, sharing `callApi`'s workspace and declared-host guard; passes only the protocol's own headers and sets the token itself.
  - `Modules/Connectors/mcpClient.js`: the SDK's `Client` and `StreamableHTTPClientTransport` with a `fetch` over `agentFetch.callMcp`. GET (the server stream) is answered 405 locally, so one request is one answer. Each call is one session: initialize, list tools when the cached listing (ten minutes per provider) is stale or lacks the tool, compare shapes, call, end the session. `textOf` keeps text parts and names the rest.
  - `Modules/Connectors/toolRunner.js`: `connection.mcp` for MCP tools (only the tool it was defined with); 429 → `provider_busy` and `markBackoff`, 401 → `broken` (`mcp_unauthorized`), other statuses → `provider_refused`; a result with `isError` is refused without its text; the scope check skips a tool with no scope. The broken path is shared with `accepted()`.
- Contract section 9 records the additions; 063's progress notes the change.
- Tests:
  - `tests/connector-mcp.test.js`: 27 tests against `tests/fixtures/fakeMcpServer.js` (JSON and event-stream answers) and the `notesmcp` fixture provider. They cover validation, tool checks, unreviewed tools offered nowhere, reads from MCP, the cached listing, changed and withdrawn tools, 429/401/500/`isError`, an approved write, and the egress guard. All pass.
  - The 92 connector, connectors, migration and MCP suites (3,418 tests) pass unchanged.
  - Conventions: 29 of 30 files pass. `plain-words` fails only its "baseline stored sorted" check, because this checkout wrote `scripts/plain-words-baseline.json` with CRLF while git stores it as LF (`eol=lf`); the file is untouched by this change.
- A plain-Node run of `mcpClient` against the fake server left no open handles; one call took about 30 ms.

- Finished the open box:
  - `Modules/Connectors/toolReviews.js`: a call that finds a tool changed records it in `connector_tools` (state `changed`, off) and tells owners and admins once, through the Inbox notice `connector_tool_changed`. An owner or admin can approve the tool as the app describes it now, or keep it off: `GET /api/v2/connectors/admin/tools/:provider` and `PUT /api/v2/connectors/admin/tools/:provider/:tool`. An approved shape is what later calls go out with (`approvedShape`); read or write stays what the catalog says. A tool the catalog never reviewed stays off whatever is stored.
  - Inbox: the notice renders from `Inbox.connector_tool_changed` and opens Connections. Audit words for `connector.tool_reviewed`, `connector.app_registered` and `connector.app_registration_dropped` are in `eventWords.js` and `en.js`; the i18n backfill has run.
  - `scripts/connector-tool-shapes.js`: for catalog maintainers. It lists an MCP app's live tools with their shapes and descriptions next to what `tools.js` pins, using a test token in `CONNECTOR_REVIEW_TOKEN` (documented in env-doc). Pinning a shape after reading the description is the review.
  - Tests: `tests/connector-mcp-review.test.js`, 5 tests: refused, recorded and told once; listed for an owner, refused for a member; approved and called again; kept off with no second notice; an unknown tool refused. With `connector-mcp.test.js`, 32 pass. The audit-label, i18n, env-doc and lifecycle tests pass.
