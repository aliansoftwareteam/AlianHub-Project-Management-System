---
id: 109
title: Connectors — live tool lists and stored tool state per connection
status: backlog
priority: high
depends_on: [108]
created: 2026-11-17
---

# 109 — Connectors — live tool lists and stored tool state per connection

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
A connection to an MCP app offers the tools its server lists right now for that connection, not a static guess.

## Scope
- List a connection's tools live with its own token (`mcpClient.listTools`), with no cache. Apps are listed in parallel with a timeout per app.
- Remove the placeholder `tools.js` of every MCP provider (Notion, GitHub, Canva, Dropbox, HubSpot, Supabase, Upwork, WisprFlow). A provider keeps sign-in, scopes, egress hosts and default caps per kind.
- Store each tool's state per connection (`CONNECTOR_TOOLS` keyed by connection, or on the connection): server tool name, read or write, shape last looked at, changed flag, permission (used by 110).
- Read or write defaults from `annotations.readOnlyHint`; with no hint it is write.
- A tool whose shape differs from the one last looked at is flagged as changed and still works. Its owner gets one notice per change.
- A tool the server stopped listing is marked gone, not deleted, so 111 can show missing ticks.
- An unreachable server gives a clear "could not be reached" result, never "not connected".
- Tool keys stay stable: `<provider>.<server tool name>`.
- `callTool` checks the tool against the live listing and passes changed tools through (the 10-minute shape check goes).

## Out of scope
- The permission control and screen (110). The AI lookup (111). REST providers, which keep their static tools.

## Acceptance criteria
- [ ] After connecting, each MCP app shows its server's real tools; no MCP provider has a `tools.js` placeholder
- [ ] Two members connected to the same app each get the tools their own connection lists
- [ ] `readOnlyHint: true` stores read; no hint stores write
- [ ] A changed tool is flagged, works, and sends one notice
- [ ] A tool removed by the server is marked gone
- [ ] One unreachable server doesn't delay or fail the other apps' listings
- [ ] Tests cover listing, the changed flag, gone tools and an unreachable server
