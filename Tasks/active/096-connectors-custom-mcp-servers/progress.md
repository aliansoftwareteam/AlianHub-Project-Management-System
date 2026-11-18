# Progress: Connectors — custom MCP servers: added by address with a right, every tool reviewed

## Checklist
- [x] "Add custom apps" right
- [x] Add flow: address, sign-in metadata, sign-in step
- [x] Address checks and egress
- [x] Tool review list
- [x] Workspace tab: edit, remove (on the Connections page until 101's screen mounts the components)
- [ ] `CONNECTORS_CUSTOM` and the hosted plan feature (the switch is built; the plan feature waits for `Modules/Entitlements`)
- [x] i18n backfill and checks

## Last step
Built on `feat/connectors-custom-servers` (from `6d4e2eace`), not pushed. Waits for the owner's review.

## Blockers
- The hosted plan feature: `Modules/Entitlements` is not on this branch, so custom apps are not gated by plan yet.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decision 23). Track A.

### 2026-11-12 — built
- Right: `ai_custom_apps` ("Add custom apps") in `Config/aiRights.js`, the catalogue in `utils/data.js` and its repair list; owners and admins hold it, members and guests start without it. Migration `086-ai-custom-apps-right` adds the row to existing workspaces without granting it.
- Data: `connector_servers` declared in every schema file with a unique (`companyId`, `url`) index; `connector_tools` gains `label`, `description` and `inputSchema` for a custom server's reviewed tools.
- A custom server is the provider `custom_<row id>`, built from its row (`Modules/Connectors/customServers.js`). `connection.definitionFor(companyId, provider)` gives the lifecycle its definition; catalog providers behave as before. `apps.resolveApp` answers its own app: the client it registered for the workspace, or the client id and secret its adder entered (secret by handle).
- Routes under `/api/v2/connectors/servers` (`customController.js`): list (any member, with their own connection), add (the right), change name or app, remove, list tools for review and review one (an owner or admin, or the adder while they hold the right). Write routes are `agentsRefused` and rate-limited; every change is audited.
- Address checks: https only, a host name rather than a number, no private, loopback or link-local address for the server or any host its sign-in names. The server's hosts go on the workspace egress list while one is in use, and come off with the server.
- Review: the reviewer's own connection lists the tools; the server's own text is shown as outside content; a tool is turned on only against the version the reviewer saw. A changed tool is turned off and owners and admins are told.
- Generic tools `custom.tools.list`, `custom.tool.read`, `custom.tool.write` (`customTools.js`), registered once in the agent registry and AlianHub's MCP server; a call binds to the reviewed tool and runs through `toolRunner` (own connection, caps, quotas, taint, audit, write proposals approved by the connection's owner and sent once).
- Switch `CONNECTORS_CUSTOM` (on unless `off`, and only while the connector module is on), described in `scripts/env-doc.meta.json`.
- UI: `AddCustomConnector.vue`, `CustomServerTools.vue` and the `CustomServers.vue` card, mounted on the Connections page. Strings under `Connectors.custom.*`, tokens only.
- Tests: `tests/connector-custom-servers.test.js` (45), `frontend/tests/unit/customServers.spec.js` (7); the route list in `tests/connector-lifecycle.test.js` extended on purpose.
- Contract section 12 in `Tasks/active/063-connectors-provider-definition/resources/contract.md`.

### 2026-11-12 — merged into `feat/connectors-mcp-transport`
- The Connections page is gone (101), so the custom apps card sits at the foot of AI › Customize › Connectors, where members connect. The page header's "Add custom connector" shows for whoever holds "Add custom apps" (the servers list answers `mayAdd`) and opens the same add dialog; the card hides its own Add button there, and hides itself for a member while there is no custom app.
- Custom providers are left off the catalog rows (`connectorRows`), since the card lists them.
- An agent must have `custom.*` ticked like any other connector tool (098); a person's turned-off tools (101) apply to catalog tools only.
- Migration renumbered to `086-ai-custom-apps-right`, after 098's `085-agent-connector-ticks`.
