# Connectors: MCP or own API

Every connector connects over MCP unless it is listed under **Exceptions**. Tools are listed live from each connection's server (task 107); a provider definition under `Modules/Connectors/providers/<id>/index.js` keeps only sign-in, scopes, egress hosts and default caps.

Last checked: 2026-11-18.

## On MCP

| Provider | Server address | Sign-in |
|---|---|---|
| Notion | `https://mcp.notion.com/mcp` | OAuth, registers itself (`mcp.notion.com/register`) |
| GitHub | `https://api.githubcopilot.com/mcp/` | GitHub App OAuth, user tokens refresh |
| Canva | `https://mcp.canva.com/mcp` | OAuth, registers itself (`mcp.canva.com/register`) |
| Dropbox | `https://mcp.dropbox.com/mcp` | Dropbox OAuth (offline access), same token as the REST API |
| HubSpot | `https://mcp.hubspot.com/` | OAuth, registered app |
| Supabase | `https://mcp.supabase.com/mcp` | OAuth, registers itself at `api.supabase.com`, confidential client |
| Upwork | `https://mcp.upwork.com/mcp` | OAuth, registers itself (`upwork.com/register`) |
| Wispr Flow | `https://api.wisprflow.ai/connect/mcp` | OAuth + OpenID on `mcp-auth.wisprflow.com`, registers itself |

## Moving

| Provider | Today | Plan |
|---|---|---|
| Slack | REST OAuth (`slack.com/oauth/v2`), hand-written tools | Official MCP server `https://mcp.slack.com/mcp`. Slack has no self-registration, so sign-in uses a registered app's id and secret. AlianHub's DM and `@channel` guards must survive as argument checks. Decided in task 114; until then the entry stays "moving". |

## Exceptions (stay on their own API)

### Google (Gmail, Calendar, Drive, Meet)
- **Today:** REST OAuth (`accounts.google.com`, `googleapis.com`).
- **Why:** the official servers (`gmailmcp.googleapis.com`, `calendarmcp.googleapis.com`, `drivemcp.googleapis.com`, `/mcp/v1`) are Developer Preview. Access needs enrollment in the Google Workspace Developer Preview Program (Workspace account and Cloud project), and pre-GA features may not be granted to users outside the enrolled domain. Google says features usually stay 3-6 months in preview.
- **Moves when:** Google announces general availability for the three servers.
- **Source:** https://developers.google.com/workspace/preview (Gmail, Calendar, Drive listed under MCP servers, not GA), and https://workspaceupdates.googleblog.com/2026/05/agent-tools-and-security-updates-for-workspace-developers.html. Checked 2026-11-18.

### Outlook / Microsoft 365
- **Today:** REST OAuth through Microsoft Graph (`login.microsoftonline.com/common`, `graph.microsoft.com`), which accepts personal Outlook.com and work accounts.
- **Why:** Microsoft's MCP route is Work IQ, a remote server with 10 generic tools (mail, calendar, files, people, chat, sites) governed in the Microsoft 365 admin center and billed by consumption. The pages checked do not say it works for personal Outlook.com accounts, and its tools are not per-service, so moving would change the connector's tool set and could drop personal accounts. The earlier note that it needs a Microsoft 365 Copilot licence is out of date: Microsoft states usage is independent of that licence.
- **Moves when:** Microsoft documents Work IQ for personal accounts, or AlianHub decides to serve work and school accounts only; then the Graph connector is retired in favour of Work IQ.
- **Sources:** https://learn.microsoft.com/en-us/microsoft-copilot-studio/use-work-iq (GA, updated 2026-11-12) and https://devblogs.microsoft.com/microsoft365dev/?p=25743 (2026-06-02). Checked 2026-11-18.

## Adding a connector

Default to MCP. Use REST only when no official remote server exists, or it is preview-only or gated, and add the app to Exceptions with the source and date.
