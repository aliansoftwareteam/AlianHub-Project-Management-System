# Progress: Connectors — live tool lists and stored tool state per connection

## Checklist
- [x] Live listing per connection with its own token, no cache, parallel with a time limit per app (`Modules/Connectors/connectionTools.js`: `listFor`, `listMine`)
- [x] Placeholder `tools.js` removed from the 8 MCP providers, with their 21 `Connectors.tool.*` labels in every locale
- [x] Tool state per connection in a new collection `connector_connection_tools` (unique on company, connection, tool): read or write, shape, shape last looked at, changed flag, gone flag, permission
- [x] Read or write from `annotations.readOnlyHint`; no hint is write; an owner's choice (`accessByOwner`) is kept over the hint
- [x] Changed tool: flagged, still works in AI chat, owner told once per shape, refused to agents (`tool_changed`)
- [x] Gone tool: marked, not deleted; refused with `tool_missing`; comes back if listed again
- [x] Unreachable server reported as `unreachable`, never `not_connected`; a 401 marks the connection broken
- [x] Keys are `<provider>.<server tool name>`
- [x] `mcpClient.callTool` reads the live listing on every call; the 10-minute listing cache is gone. Live tools pass through changed; reviewed (custom/catalog) tools keep their strict shape check
- [x] Reads in `toolRunner` resolve live tools (`liveTool`); route `GET /api/v2/connectors/connections/:id/tools` for the connection's owner
- [x] Tests: `tests/connector-live-tools.test.js` (15)

## Left for later subtasks
- **110**: writes of live tools (`admitWrite` and `writes.js` still look up only catalog tools), the permission control (stored, not yet enforced), "look at it again" to clear the changed flag, and retiring `toolsOff`, the catalog review flow (`toolReviews.listFor/review`, `/admin/tools` routes, `ConnectorToolReviews.vue`), `mcpTools.js` and `scripts/connector-tool-shapes.js` with its `CONNECTOR_REVIEW_TOKEN` env entry.
- **111**: Ask's GitHub pull request rule still names `github.pull_request.read`, which no longer exists; point it at GitHub's live tool when Ask moves to the one lookup.
- Rule 4: the new route needs `npm run api:doc` in the docs PR after merge.

## Last step

Implementation and tests done 2026-11-18; awaiting review.

## Blockers

None.

## Log

### 2026-11-17
- Task created as a subtask of 107.

### 2026-11-18
- `connector_tools` has a unique index on company, provider and tool, which cannot hold two members' rows for the same tool, so per-connection state went into a new collection instead of an index migration.
- Default permission: read tools Always allow, write tools Needs approval. 110 may change this.
