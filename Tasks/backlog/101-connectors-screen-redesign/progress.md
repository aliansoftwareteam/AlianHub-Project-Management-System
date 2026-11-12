# Progress: Connectors — screen redesign: AI → Customize → Connectors, like Claude's

## Checklist
- [x] Customize entry, tabs, route redirects
- [x] Your connectors
- [x] Browse: cards, search, filter, sign-in dialog
- [x] Connector detail panel, per-tool on/off
- [x] Workspace tab (072's admin overview and company apps moved in)
- [x] Remove old connector pages and sections (the parts this task owns; see Decisions)
- [ ] Keyboard, phone width, i18n backfill and checks (built and checked in specs; the browser pass at 375 px is the owner's)

## Last step
Built on `feat/connectors-screen` from `6d4e2eace`; specs and checks pass. Waiting for the owner's browser review.

## Blockers
None.

## Log

### 2026-11-12
- Task created from PRD v2.0 of 056 (decision 26): the Claude-like redesign on top of 072's built screens. Track A.
- Built the screen:
  - `AI › Customize` (`/:cid/ai/customize`, route `AiCustomize`, `?tab=connectors|connect-ai|workspace`) replaces the sidebar's Connections and Connect your AI. `views/Ai/CustomizePage.vue` reads `/integrations/catalog` once, so no tab calls a route this install does not register.
  - Connectors tab (`views/Integrations/ConnectorsTab.vue`): your connectors first (logo or initials, account label, status dot, last used; needing attention first with Reconnect), then Browse (cards with line and category, search, category filter, Connect). An app named in `CONNECTORS` with no way to sign in says why: members are told their admin has to set it up, owners and admins get Set up, which opens the Workspace tab.
  - Sign-in dialog (`ConnectorSignIn.vue`): OAuth, a password field for a personal token (with help on where to make one; emptied whatever the answer, never shown again), or both; Google's product ticks. An app with one product and OAuth only skips the dialog.
  - Detail side panel (`ConnectorDetail.vue`): account, how it signed in, connected and last used, product ticks (re-consent), each tool with read or write and an on/off for the member's own use, owners' and admins' tools to review, Disconnect with an inline confirm. Escape closes, focus is trapped and returned.
  - Workspace tab (`ConnectorsWorkspace.vue`, owners and admins): 072's `AdminConnections` and `CompanyApps`, the tools an app changed with Approve and Keep off (`ConnectorToolReviews.vue`), a `CustomServers.vue` slot for 096, and the limits (`ConnectorQuotas`, with a link at the top that jumps to them).
  - Add custom connector: owners and admins see it, marked "Coming soon" (`aria-disabled`); it emits `add-custom` for 096 to hook.
  - `ConnectYourAi.vue` takes `embedded` and renders inside the tab without its own rail and frame.
- Server (additive):
  - `GET /api/v2/connectors/:provider/tools`: `{ key, label, kind, on }` per catalog tool, `on` from `tools.isOn()`.
  - `PUT /api/v2/connectors/connections/:id/tools`, body `{ toolsOff }`: the connection's owner only, keys checked against the provider's catalog, agents refused, audited `connector.tools_changed`.
  - `toolsOff[]` declared on `connector_connections`; carried by the connection view and by `resolveConnection`; the tool runner refuses a turned-off tool (`tool_turned_off`) at admission, for reads and writes, before the app is called.
  - `GET /api/v2/connectors` also answers `unavailable: [{ provider }]`.
  - Recorded in 063's contract, section 11.
- Routes: `/:cid/connections` (`Connections`) and `/:cid/ai/connect` (`AiConnect`) redirect to Customize with the query kept, so a provider's sign-in that returns to the old address still finishes. `/:cid/app-connections` redirects too, except for a GitHub workspace sign-in coming back to it (until 079). The Inbox's "an app changed a tool" notice opens the Workspace tab; the More menu's Connections entry opens Customize.
- Removed `ConnectionsPage.vue`, `connections.css` (style baseline lowered by 5) and `MyConnections.vue` with their specs; their cases moved to the new specs.
- Tests: Vitest `connectorsScreen.spec.js` (29) and `customizePage.spec.js` (8), plus the updated sidebar, gate, Connect your AI (+1), Integrations hub, phone sweep and Google Calendar specs (20 related spec files, all green). Jest `connector-tools-off.test.js` (13), the lifecycle route list updated; all `connector-*`/`connectors-*` suites pass (25 suites, 569 tests). Conventions project: 26 of 30 suites pass; the four that fail are the known machine-only `plain-words` sort check and three that fail on the MCP apps' tools from `6d4e2eace`, which this task does not touch (`mcp-tool-scopes`, `agent-action-labels`, and `audit-event-labels`' registry check: no scope or AgentActions labels yet for `notion.*`, `github.*` and the rest). `i18n:check` and `style:check` pass.

## Decisions
- The Workspace tab is a third tab of Customize, shown to owners and admins only; a member asking for it gets Connectors.
- Connect your AI shows as a tab when the person's role may connect their own AI, or when a link asks for it (the AI-unavailable hint and the setup checklist still land on it).
- Quotas have no other page now, so they live on the Workspace tab with a link at its top, rather than a link to elsewhere.
- Turning a tool off is not a row of Security & Permissions: it can only narrow what the connection already allows. Owners and admins cannot change another member's list.
- The Integrations hub's Calendar section (the read-only due-date feed) and Slack section (the slash command) are not connectors and stay (FR-38, and 079 keeps the slash command); their connector notes now point to Customize instead of My connections.
- `GoogleConnection.vue` (the old Google Calendar connector) is shown on the Connectors tab while `CONNECTORS` names `google_calendar`, so it keeps working until 077 removes it. `AppConnections.vue` stays for 079.
- No brand colours: Google and GitHub use the shell's own icons, every other app its initials on a brand-tint tile.

## Open
- Usage this week in the detail panel (FR-67) needs a member-facing usage read; not built.
- The person's MCP manifest and the AI chat still list a tool they turned off; it is refused when called.
- The shell rail's App connections tile and the project GitHub card's "Set up" link now lead to Customize; 079 removes them with the GitHub workspace connection.
