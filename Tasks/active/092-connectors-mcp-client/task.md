---
id: 092
title: Connectors — MCP client and MCP provider definitions: call apps' MCP servers as the member, reviewed tools only
status: active
priority: high
depends_on: [063, 068]
created: 2026-11-12
---

# 092 — Connectors — MCP client and MCP provider definitions: call apps' MCP servers as the member, reviewed tools only

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
AlianHub calls an app's remote MCP server with the member's own access, offers only tools that were reviewed, and treats everything the server says as outside content.

## Scope
- **MCP provider definitions** (FR-1): a provider folder may set `transport: 'mcp'` with `mcp.url`; `validate.js` checks the address like the auth URLs (HTTPS, host in `egressHosts`), and a product may carry no scopes when the server has none. Built providers (Google, Slack, Dropbox) are unchanged.
- **MCP tools** in the provider's `tools.js`: each maps an AlianHub key to the server's tool name and the shape it was reviewed against, and gets its `run` from one helper, so an MCP provider needs no code. A tool with no reviewed shape is never offered.
- A client on `@modelcontextprotocol/sdk` (already a dependency) over Streamable HTTP. Its requests go through `agentFetch` in the workspace egress context (FR-24, FR-43). HTTPS only; a local (stdio) server is never started.
- Per call: the member's connection from `resolveConnection`, a short-lived session, timeouts
- Listing a server's tools and comparing each with its reviewed shape (a hash of name, description and input schema). A tool that is new or changed is hidden, recorded in `connector_tools`, and owners and admins are told (FR-44).
- Only the description the reviewer accepted goes to a model (FR-45)
- Results text only, capped and tainted (FR-46). Errors, timeouts and rate limits fail one call, with backoff per server (FR-47).
- `callTool` for `mcp` entries, as the contract in 063 defines it
- A fake MCP server for tests: tools that change shape, return too much, time out, or answer 429

## Out of scope
- Signing in, discovery and self-registration (100)
- Which tools each app offers: written in each app's task (075, 094, 095); custom servers (096)

## Acceptance criteria
- [x] A fake server's tool is called as the member, with that member's token only
- [ ] A tool whose description or schema changes is hidden until reviewed, and owners and admins are told *(refused at call time and logged; recording it in `connector_tools` and telling owners and admins is still open)*
- [x] A server's own description never reaches a model unreviewed
- [x] Output over the cap is cut; the run is tainted; a 429 holds that connection only
- [x] A request to a host not on the egress list is refused

## Constraints & notes
- Track: B — tools (using that access safely)
- Depends on: 063 and 068, both built on `feat/per-user-connectors`. A change to the contract is recorded in 063's progress, as its section 8 asks.
- Reuse `readLimits.js`, `taint.js`, `agentFetch.js`, `appConnections/backoff.js`.
