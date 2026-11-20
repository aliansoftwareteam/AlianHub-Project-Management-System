---
id: 110
title: Connectors — per-tool permissions, workspace app switch and the tools screen
status: active
priority: high
depends_on: [109]
created: 2026-11-17
---

# 110 — Connectors — per-tool permissions, workspace app switch and the tools screen

Sub task of 107 (`Tasks/backlog/107-connectors-mcp-first-live-tools/task.md`). Its decisions apply here.

## Goal
The connection's owner sees every tool of their connection and decides how each may be used, as in Claude's Connectors settings. Owners and admins can turn an app off for everyone.

## Decisions (2026-11-19, with the user)
1. The retirement of the catalog review flow happens here, not in a later task: `toolReviews.js`, the `/admin/tools` routes, `ConnectorToolReviews.vue`, `mcpTools.js`, `scripts/connector-tool-shapes.js` and the `CONNECTOR_REVIEW_TOKEN` env entry go. Custom servers keep their own review (113), so `customReview.js` takes over the two things it used from `toolReviews.js`.
2. The workspace switch lives on the admin Connectors screen: AI › Customize › Workspace, as an on/off toggle per app.
3. Rule 2 is followed: this file is the PRD and `progress.md` tracks the work.

## Scope
- **Permission per tool per connection**: Always allow, Needs approval, Off. Default: reads Always allow, writes Needs approval.
  - Tools of an MCP app keep theirs on their `connector_connection_tools` row (109).
  - Tools of a REST app (Google, Slack, Outlook) keep theirs on the connection as `toolPermissions: [{ key, permission }]`; a tool with no entry has the default.
  - Only the connection's owner changes it. Another member gets 404, an API token 403, an agent is refused by `agentsRefused`.
- **What each permission does**, enforced in `toolRunner.js`, the one place every call passes:
  - Off: every call is refused (`tool_turned_off`); the tool is shown as off.
  - Needs approval: a direct call is refused with `needs_approval`, so it is filed as a proposal; `writes.js` admits it and shows the approval card. This holds for reads too (a generic card when the tool has none of its own).
  - Always allow: a direct call runs. A write with Always allow runs directly from AI chat and the person's own MCP client. An agent run still files every write for approval, because taint routing (`AGENT_TAINT_ROUTING`) requires it.
- **Writes of MCP apps' live tools**: `admitWrite` and `writes.js` resolve them like reads do.
- **Read or write**: the owner can change an MCP app tool between read and write (`accessByOwner`). A REST tool's kind is fixed by its code.
- **Looked at**: the owner clears a changed warning; the current shape is recorded as looked at, and agents use the tool again.
- **`toolsOff` retired**: its route and field go. Migration `088-connector-tool-permissions` turns every stored `toolsOff` key into an Off permission (MCP keys on their row, REST keys on the connection) and removes the field.
- **Workspace switch**: owners and admins turn a catalog app off for the workspace (`connector_switches`). While it is off:
  - its tools leave every listing (the connection's tools answer `app_off`, Ask leaves the app out);
  - every call to it is refused (`app_off`), and no one can start a new connection to it;
  - connections are kept, so turning it back on restores everything.
  - The change is audited (`connector.app_switched`) and a socket event is emitted.
- **Routes**:
  - `GET /api/v2/connectors/connections/:id/tools`: the connection's tools for the owner, REST or MCP.
  - `PUT /api/v2/connectors/connections/:id/tools/:key` with `{ permission?, access?, lookedAt? }`: owner only.
  - `PUT /api/v2/connectors/switches/:provider` with `{ on }`: owners and admins.
  - `GET /api/v2/connectors` also answers `workspaceOff: [provider]`.
  - Removed: `PUT /connections/:id/tools` (`toolsOff`), `GET /:provider/tools`, and `GET` and `PUT /admin/tools/...`.
- **Connectors screen** (task 101 layout):
  - The connection drawer lists its tools grouped Read and Write, with a permission control on each row.
  - An MCP tool also has a read/write control.
  - A changed tool shows a warning with "Looked at"; gone tools are listed apart, under "No longer offered".
  - An app that is off for the workspace says so.
  - The Workspace tab gets an "Apps in this workspace" card with a toggle per app.
- Strings go through i18n and colours come from tokens.

## Out of scope
- How AI picks tools by permission, and listing live tools to Ask and agents (111).
- Custom servers (113): their per-tool review stays as it is.
- AlianHub's own MCP server tool list (`Modules/Mcp`).

## Acceptance criteria
- [ ] Off removes a tool from AI chat and agents; Needs approval goes to the approval card; Always allow runs it
- [ ] Only the connection's owner can change its permissions; another member and an agent are refused
- [ ] Clearing a changed warning records the current shape as looked at
- [ ] An app turned off for the workspace offers no tools and refuses calls
- [ ] Existing `toolsOff` settings carry over as Off
- [ ] The catalog review flow, `mcpTools.js`, `scripts/connector-tool-shapes.js` and `CONNECTOR_REVIEW_TOKEN` are gone
- [ ] `i18n:check` and `style:check` pass
