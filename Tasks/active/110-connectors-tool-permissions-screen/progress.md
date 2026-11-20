# Progress: Connectors — per-tool permissions, workspace app switch and the tools screen

## Checklist
- [x] PRD written in `task.md` (2026-11-19), with the user's three answers as decisions
- [x] Permission per tool per connection: MCP tools on their `connector_connection_tools` row, REST tools on the connection as `toolPermissions` (`Modules/Connectors/toolPermissions.js`)
- [x] Enforced in `toolRunner.js`: Off → `tool_turned_off`; Needs approval → `needs_approval` on a direct call, admitted by `writes.js` with a card (a generic card for a tool without one); Always allow runs, and a write runs directly except from an agent run
- [x] Live MCP tools resolve in `admitWrite` and `writes.isWrite`
- [x] Owner can change an MCP tool's read/write (`accessByOwner`) and clear a changed warning (`lookedAt`)
- [x] Routes:
  - `GET /connections/:id/tools` for REST and MCP
  - `PUT /connections/:id/tools/:key`: owner only, `agentsRefused('connector.tool_permission_changed')`
  - `PUT /switches/:provider`: owners and admins, `agentsRefused('connector.app_switched')`
  - `GET /connectors` answers `workspaceOff`
- [x] Workspace switch (`appSwitches.js`, collection `connector_switches`):
  - `findUsable` answers `app_off`, so every call, listing and picker refuses it
  - `start`, `setProducts` and `saveToken` refuse it too
  - Audited and a socket event is emitted
- [x] `toolsOff` retired: route, view field and runner check removed. Migration `088-connector-tool-permissions` turns it into Off; an MCP tool takes a carried permission when first listed
- [x] Retired: `toolReviews.js` (its STATE and `noteChanged` moved to `customReview.js` for custom servers), the `/admin/tools` and `/:provider/tools` routes, `ConnectorToolReviews.vue`, `mcpTools.js`, `scripts/connector-tool-shapes.js` and `CONNECTOR_REVIEW_TOKEN`
- [x] Screen:
  - The drawer groups tools Read / Write / No longer offered, with a permission select and, for MCP tools, a read/write select
  - The changed warning has "Looked at"; an app off for the workspace says so
  - The Connectors tab marks switched-off apps; the Workspace tab has **Apps in this workspace** with a toggle per app (`WorkspaceApps.vue`)
- [x] i18n keys in `en.js`, backfilled (32 added, 17 dropped per locale); `i18n:check` and `style:check` pass
- [x] Docs: `docs/connectors/mcp-apps.md`, `docs-site/admin/connectors.md`, env docs, 056 data model row
- [x] Tests:
  - `tests/connector-tool-permissions.test.js` (16, replaces `connector-tools-off`)
  - `tests/connector-live-tools.test.js` (+6)
  - `frontend/tests/unit/connectorsScreen.spec.js` (35)
  - `connector-mcp-review.test.js` removed with the flow it tested

## Left for later
- **111**: Ask and agents pick tools by permission from one lookup. Today an Off tool is refused when called, not left out of the list the model sees.
- Rule 4: the routes changed, so `npm run api:doc` and `npm run version:log` go in the docs PR after merge.
- Not checked in a running app: the instance here has no `CONNECTORS` set.

## Last step

Implementation and tests done 2026-11-19; awaiting review.

## Blockers

None.

## Log

### 2026-11-17
- Task created as a subtask of 107.

### 2026-11-19
- The user answered: retire the catalog review flow here; the workspace switch is a toggle on the admin Connectors screen; follow Rule 2.
- Decision: an agent run's writes always wait for approval, even with Always allow, because taint routing requires it.
