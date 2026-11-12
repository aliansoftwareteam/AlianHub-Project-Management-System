# Apps reached through their own MCP servers

Notion, GitHub, Supabase, Upwork, Wispr Flow, Dropbox (AI tools), HubSpot and Canva each run an MCP server. AlianHub calls it as the member, with that member's own token, and offers only tools that were reviewed. Every write waits in the member's Inbox until they approve it. Google ([google.md](google.md)), Slack ([slack.md](slack.md)) and Outlook are built connectors and have their own pages.

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

## Pinning tool shapes

AlianHub offers a tool only once it has been reviewed. A tool's shape is a hash of its name, description and input schema, recorded when someone read them and judged the tool safe for what AlianHub says it does. A tool the app later changes is refused and stays off until it is reviewed again. Owners and admins are told, and may approve the changed tool for their workspace.

The catalog ships with `shape: null`, which means off, until a maintainer pins each tool:

1. Connect a **test account** at the app and take its access token.
2. Run:
   ```
   CONNECTOR_REVIEW_TOKEN=<token> node scripts/connector-tool-shapes.js <provider>
   ```
   It prints every tool the server offers now, with its description, input and shape, and marks it as pinned and unchanged, changed since pinned, not reviewed, or not in the catalog.
3. Read each description and input. If the tool does what its AlianHub key says, and nothing that leaves the app unasked, copy the shape into `providers/<provider>/tools.js`. Correct `tool` and `args` where the server's names differ from the catalog's guess.
4. Mark as `kind: 'write'` any tool that changes anything outside AlianHub, whatever the server's own hints say.

The tool names for Upwork, Wispr Flow, Dropbox and Canva are not published; their catalog entries are placeholders until step 3.
