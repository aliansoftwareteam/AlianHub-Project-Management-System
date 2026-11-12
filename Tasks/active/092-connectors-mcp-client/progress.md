# Progress: Connectors — MCP client and MCP provider definitions: call apps' MCP servers as the member, reviewed tools only

## Checklist
- [x] MCP provider definitions: `transport: 'mcp'`, `mcp.url`, products without scopes (`validate.js`)
- [x] MCP tools as data: `mcpTools.js` (`tool`, reviewed `shape`); `tools.js` checks them; an unreviewed tool is never on
- [x] Client over Streamable HTTP through `agentFetch.callMcp` (`mcpClient.js`)
- [x] Shape check at call time; a changed or withdrawn tool is refused and logged
- [x] Runner hands MCP tools `connection.mcp`; 429 holds the connection, 401 marks it broken, a tool's error text stays out
- [x] Contract section 9 (063)
- [x] Fake MCP server and tests
- [ ] Record changed tools in `connector_tools` and tell owners and admins

## Last step
The MCP road works end to end against a fake server, from an agent read, AlianHub's MCP server and an approved write. Open: recording a changed tool and telling owners and admins.

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
