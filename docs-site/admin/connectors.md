# Connectors setup

Connectors let each member connect their own accounts (Google, Slack, Outlook, GitHub, Notion, Dropbox and more) so that AlianHub's AI and agents can read from them and propose changes on that member's behalf. Every token belongs to one person and is used only for that person. Every write waits until that person approves it.

This page is for the person who runs the server: which connectors to switch on, which apps to register with each provider, and what the upgrade from the older Google Calendar, cloud-storage and Slack bot paths changes. Members use them from **AI › Customize › Connectors**; see [Connectors](/user-guide/connectors).

Connectors are separate from integrations. An integration, such as the GitHub pull-request sync or Email to Task, runs for the whole workspace on one account; see [Integrations](/user-guide/integrations).

## Switch connectors on

Connectors are off until you name them in `CONNECTORS`, a comma-separated list:

```env
CONNECTORS=google,slack,outlook,dropbox,github,notion
SECRETS_STORE=true
SECRETS_KEY="…at least 32 characters…"
AGENT_TAINT_ROUTING=on
APIURL="https://pm.example.com/"
```

Every connector also needs:

- **`SECRETS_STORE=true` and a usable `SECRETS_KEY`.** Members' tokens are sealed in the per-workspace secrets store and never kept in plain text. See [Security](./security).
- **`AGENT_TAINT_ROUTING` on** (the default). A run that read from a connected app is marked, and makes no web fetch afterwards.
- **`APIURL`** set to the public address. Every provider's redirect address is `<APIURL>/api/v1/connector-oauth/<provider>/callback`.

Without these the connectors stay off, and the server says why in one startup log line. A connector that needs a registered app and has none is still offered to a workspace that sets its own app; the log names it too.

## Apps to register

| Connector | Name in `CONNECTORS` | What to register | Variables |
|---|---|---|---|
| Google (Calendar, Meet, Drive) | `google` | A **Web application** OAuth client in Google Cloud, with the Calendar, Meet, Drive and Picker APIs enabled, plus a Picker API key and the project number | `CONNECTOR_GOOGLE_CLIENT_ID`, `CONNECTOR_GOOGLE_CLIENT_SECRET`, `CONNECTOR_GOOGLE_PICKER_API_KEY`, `CONNECTOR_GOOGLE_APP_ID` |
| Slack | `slack` | A Slack app with the user token scopes `channels:read`, `groups:read`, `channels:history`, `groups:history` and `chat:write`, and **Token Rotation** on | `CONNECTOR_SLACK_CLIENT_ID`, `CONNECTOR_SLACK_CLIENT_SECRET` |
| Outlook (mail and calendar) | `outlook` | A Microsoft Entra app for any organisation and personal accounts, with the delegated Graph permissions `Mail.ReadWrite`, `Calendars.ReadWrite`, `offline_access`, `openid` and `profile`. Never `Mail.Send` | `CONNECTOR_OUTLOOK_CLIENT_ID`, `CONNECTOR_OUTLOOK_CLIENT_SECRET` |
| Dropbox | `dropbox` | A **Scoped access** Dropbox app with `files.metadata.read`, `files.content.read` and `account_info.read`, and your hostnames as Chooser domains | `CONNECTOR_DROPBOX_CLIENT_ID` (the app key), `CONNECTOR_DROPBOX_CLIENT_SECRET` |
| GitHub | `github` | A **GitHub App** (not an OAuth App) with **Expire user authorization tokens** ticked. Without one, members paste a fine-grained personal token | `CONNECTOR_GITHUB_CLIENT_ID`, `CONNECTOR_GITHUB_CLIENT_SECRET` |
| HubSpot | `hubspot` | An **MCP Auth App** in your HubSpot developer account | `CONNECTOR_HUBSPOT_CLIENT_ID`, `CONNECTOR_HUBSPOT_CLIENT_SECRET` |
| Canva | `canva` | Nothing, unless Canva admits only approved clients; then an app from Canva's developer portal | `CONNECTOR_CANVA_CLIENT_ID`, `CONNECTOR_CANVA_CLIENT_SECRET` |
| Notion, Supabase, Upwork, Wispr Flow | `notion`, `supabase`, `upwork`, `wisprflow` | Nothing. AlianHub registers itself with the app once per workspace | |

Register the redirect address with each app, for example `https://pm.example.com/api/v1/connector-oauth/google/callback`. Most providers accept `http://localhost:4000/...` for development. Slack accepts only `https`, so use a tunnel such as `cloudflared` or `ngrok` and set `APIURL` to its address.

Use a separate Google client from the one for **Continue with Google** (`GOOGLE_CLIENT_ID`). Connector tokens must never reach the browser.

Step-by-step guides for each provider, with every screen and scope, are in the repository under [`docs/connectors/`](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/tree/main/docs/connectors).

### Egress hosts

When `AGENT_EGRESS_ALLOWLIST` is on and a workspace has a host list under **Settings › Instance › Egress**, add the hosts of each connector it uses:

| Connector | Hosts |
|---|---|
| Google | `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com`, `meet.googleapis.com` |
| Slack | `slack.com` |
| Outlook | `login.microsoftonline.com`, `graph.microsoft.com` |
| Dropbox | `www.dropbox.com`, `api.dropboxapi.com`, `content.dropboxapi.com`, `mcp.dropbox.com` |
| GitHub | `github.com`, `api.github.com`, `api.githubcopilot.com` |

The hosts of every other app are listed as `egressHosts` in `Modules/Connectors/providers/<name>/index.js`.

## A workspace's own app

An owner or admin can set the company's own app for a connector on the **Workspace** tab of **AI › Customize**, under **Company OAuth apps**. It replaces the server's app for that workspace, and members who connected through the server's app reconnect once. The screen shows the redirect address to register with that app.

## AlianHub Cloud

On an instance hosted by AlianHub Cloud (`HOSTING_MODE=managed`), members connect apps that need a registered app through AlianHub's shared sign-in service. The platform sets `CONNECTOR_SIGNIN_URL` and `CONNECTOR_SIGNIN_PROVIDERS`, so nothing is registered per instance. A workspace's own app still wins.

## Custom apps

`CONNECTORS_CUSTOM` (on by default) lets a workspace add its own MCP servers by their address. Only people whose role has **Add custom apps** in **Security & permissions** can add one; owners and admins always have it, and every other role starts without it.

AlianHub refuses private and local addresses, and every tool of a custom app stays off until someone in the workspace checks it and turns it on. Each member connects their own account to it.

## Tools that change

AlianHub offers an app's tool only once it has been reviewed: a hash of the tool's name, description and input is pinned in the connector catalog. If an app later changes a tool, AlianHub stops using it, tells owners and admins in the Inbox, and lists it under **Tools to review** until one of them approves it again or keeps it off.

Tools that have not been pinned yet stay off. Maintainers pin them with `scripts/connector-tool-shapes.js` against a test account; `CONNECTOR_REVIEW_TOKEN` is only for that script and never belongs on a running server.

## Limits

Owners and admins set daily limits under **Workspace › Limits for connected apps**. These variables cap what they can set:

| Variable | Default | Caps |
|---|---|---|
| `CONNECTOR_QUOTA_MAX_READS` | `5000` | Reads one person may make per day (the default limit is 500) |
| `CONNECTOR_QUOTA_MAX_WRITE_PROPOSALS` | `500` | Writes one person may propose per day (the default limit is 50) |
| `CONNECTOR_QUOTA_MAX_AGENT_READS` | `2000` | Reads one agent may make per day (the default limit is 200) |

A daily sweep, every `CONNECTOR_SWEEP_HOURS` (24 by default), ends the connections of members who no longer have a seat.

## Upgrading from the older paths

Releases with connectors replace three older features. The upgrade migrations run once at boot:

- **Google Calendar connector.** `CONNECTORS=google_calendar` no longer switches anything on; name `google`. Each old Calendar connection moves onto the Google connector with Calendar ticked, keeping its grant, so nobody reconnects. The redirect address did not change.
- **Per-person Google Drive and Dropbox settings.** The **Cloud storage for attachments** settings under **Settings › Integrations**, where each person typed their own app key and secret, are gone. Their stored secrets are deleted and their grants closed. Each person connects Google (with Drive ticked) or Dropbox once under **AI › Customize › Connectors**. Files already attached as links keep opening, and imported copies are ordinary uploads.
- **Slack workspace bot.** The bot behind **Slack messages from agents** is retired: AlianHub revokes its token, declines any message still waiting to be posted through it, and tells owners and admins. Uninstall the old bot app in Slack yourself. Agents now post through each person's own Slack connection, after that person approves.

The GitHub pull-request sync stays an integration. Its page moved from **App connections** to the **GitHub** section of **Integrations**, and old links still lead there. `APP_CONNECTIONS` and `GITHUB_CONNECT_CLIENT_ID` keep their meaning.

## Related

- [Connectors (user guide)](/user-guide/connectors)
- [Integrations](/user-guide/integrations)
- [Environment variables](./env-reference#integrations)
- [Security](./security)
- [Upgrades](./upgrades)
