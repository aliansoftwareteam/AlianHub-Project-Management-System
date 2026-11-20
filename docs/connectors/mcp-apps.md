# Apps reached through their own MCP servers

Notion, GitHub, Supabase, Upwork, Wispr Flow, Dropbox (AI tools), HubSpot and Canva each run an MCP server. AlianHub calls it as the member, with that member's own token, and offers the tools that server lists for that member's connection. Every write waits in the member's Inbox until they approve it. Google ([google.md](google.md)), Slack ([slack.md](slack.md)) and Outlook are built connectors and have their own pages.

## What an install sets

| App | Name in `CONNECTORS` | Set up | Notes |
|---|---|---|---|
| Notion | `notion` | Nothing | Registers itself once per workspace |
| Supabase | `supabase` | Nothing | Registers itself, as a confidential client; read access only |
| Upwork | `upwork` | Nothing | Registers itself; sign-in runs on www.upwork.com |
| Wispr Flow | `wisprflow` | Nothing | Registers itself; meeting notes and transcripts, not dictation; needs Notetaker on the person's account |
| Canva | `canva` | Nothing, or a Canva developer-portal app | Canva may admit only approved clients; then set `CONNECTOR_CANVA_CLIENT_ID` and `_SECRET` |
| GitHub | `github` | A GitHub App, or members' own tokens | See [github.md](github.md) |
| HubSpot | `hubspot` | An "MCP auth app" | HubSpot → Development → MCP Auth Apps; redirect URL `<APIURL>/api/v1/connector-oauth/hubspot/callback`; set `CONNECTOR_HUBSPOT_CLIENT_ID` and `_SECRET` |
| Dropbox | `dropbox` | The Dropbox app the attachment picker already uses | One connection serves the picker and the AI; see [dropbox.md](dropbox.md) |

On AlianHub Cloud, apps that need a registered app are signed in through the shared sign-in service, so nothing is set per instance.

Every app also needs `SECRETS_STORE` with a usable `SECRETS_KEY`, and `AGENT_TAINT_ROUTING` on. When `AGENT_EGRESS_ALLOWLIST` is on, the app's hosts must be on the workspace's egress list: they are listed in each `Modules/Connectors/providers/<id>/index.js` as `egressHosts`.

## Tools

An app's tools are listed live from its server, through each member's own connection, so two members can see different tools. Nothing is cached: every listing and every call reads the server again. A connection's tools are kept per connection in `connector_connection_tools`:

- **Read or write** comes from the server's `readOnlyHint`; a tool with no hint is a write. The connection's owner can change it.
- **Changed**: a tool whose name, description or input differs from what its owner last looked at is flagged and its owner told once. It keeps working in AI chat; agents skip it until it is looked at again.
- **Gone**: a tool the server stopped listing is marked gone, not deleted, so an agent's tick of it can show as missing.
- A server that does not answer is reported as unreachable, never as not connected. Apps are listed in parallel, each with its own time limit.

The owner lists their connection's tools at `GET /api/v2/connectors/connections/:id/tools`. What a server says about its tools is outside content: shown as the app's own words, never translated, never followed as instructions.

## Permissions

Each tool of a connection has a permission its owner sets on the connection's panel under **AI › Customize › Connectors**: **Always allow**, **Needs approval** or **Off**. Reads start as Always allow and writes as Needs approval. Only the connection's owner changes it (`PUT /api/v2/connectors/connections/:id/tools/:key`), never another member, an owner or admin, or an agent.

- **Off**: every call of the tool is refused.
- **Needs approval**: the tool is not called directly. It is filed as a proposal, and its owner approves it on the Inbox card first.
- **Always allow**: the tool runs. A write runs directly from AI chat and the person's own AI client; an agent run still files every write for approval.

The same panel clears a changed warning (**Looked at**), sets an MCP tool's read or write, and lists tools the app no longer offers. A REST app's tools (Google, Slack, Outlook) take permissions the same way; whether they read or write is fixed by AlianHub.

## Turning an app off for the workspace

Owners and admins turn an app off for everyone on the **Workspace** tab, under **Apps in this workspace**. While it is off, its tools leave AI chat and agents, every call to it is refused, and nobody can connect it. Members' connections and their permissions are kept, so turning it back on restores everything. Each change is in the audit log.
