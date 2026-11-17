# Progress: Connectors — MCP first: live tool lists per connection, per-tool permissions like Claude's, one tool lookup for AI

## Checklist

- [x] Confirm the PRD and decide the subtask split
- [ ] 108 — exceptions doc, FR-44/FR-45 rewritten
- [ ] 109 — live tool lists and stored tool state per connection
- [ ] 110 — per-tool permissions, workspace switch, tools screen
- [ ] 111 — one tool lookup for Ask and agents, missing ticks
- [ ] 112 — ask which app when several fit
- [ ] 113 — custom servers on the per-connection model
- [ ] 114 — Slack on its MCP server, or an exception

## Last step

Split into subtasks 108–114 (backlog); 108 is next.

## Blockers

None.

## Log

### 2026-11-17
- Task created from a design discussion. All 21 MCP catalog tools are `shape: null` placeholders, so no built-in MCP app offers a tool today.
- Custom MCP servers by address already exist (096): sign-in by self-registration, a registered app, or personal tokens, with per-tool workspace review. This task replaces that review with per-connection permissions.
- Exceptions research: Google's MCP servers are Developer Preview only; Microsoft's Work IQ needs Copilot licensing. Both stay REST for now.
- Changed by the user: AlianHub's MCP server is left out of the one lookup for now. Ask asks which app first when a messaging request, or any request, fits tools from more than one connected app.
- PRD confirmed and split into 108–114.
