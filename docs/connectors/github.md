# GitHub connector

Each member connects their own GitHub account. Their AI then reads pull requests and issues, and checks, through GitHub's own MCP server (`https://api.githubcopilot.com/mcp/`). Any comment waits in the member's Inbox until they approve it.

## Two ways to connect

| Way | Set up by | When to use |
|---|---|---|
| **Sign in with GitHub** | The instance admin, once: a GitHub App | Most installs. On AlianHub Cloud this is already set up through the shared sign-in service |
| **Paste a personal token** | Each member, at github.com | When no GitHub App is set, or a member prefers it |

With neither a GitHub App nor anything else set, GitHub is still offered and members connect by pasting a token.

## Register a GitHub App (once per install)

A GitHub App, not an OAuth App: an App's user tokens expire and refresh, which the connector module needs. An OAuth App's tokens never refresh, so they are refused.

1. GitHub → Settings → Developer settings → **GitHub Apps** → New GitHub App (under your organisation if members belong to it).
2. **Callback URL:** `<APIURL>/api/v1/connector-oauth/github/callback`, for example `https://hub.example.com/api/v1/connector-oauth/github/callback`.
3. Tick **Expire user authorization tokens**. Untick **Webhook → Active**.
4. Repository permissions:
   - Contents: read-only
   - Issues: read and write
   - Pull requests: read and write
   - Metadata: read-only
   - Commit statuses: read-only
   - Checks: read-only
5. Create the app, then generate a **client secret**.
6. Install the app on the organisations and repositories members should reach. A member's AI still sees only what that member can see.
7. In `.env`:
   ```
   CONNECTORS=…,github
   CONNECTOR_GITHUB_CLIENT_ID=<the app's Client ID>
   CONNECTOR_GITHUB_CLIENT_SECRET=<the client secret>
   ```
   A workspace owner or admin may instead set the company's own app on the Connections page; it wins for that workspace.

## Personal tokens

A member creates a **fine-grained personal access token** at github.com → Settings → Developer settings, with the repositories and the permissions above (read-only is enough unless they want comments), and pastes it on the Connections page. AlianHub checks it with one read of `api.github.com/user`, keeps it in the secrets store, never shows it again and never refreshes it. The member revokes it at GitHub when they want; disconnecting in AlianHub only forgets it.

## Tools

| Tool | Reads or writes |
|---|---|
| `github.pull_request.read` | Reads one pull request |
| `github.pull_request.checks` | Reads its checks and builds |
| `github.pull_requests.search` | Searches pull requests |
| `github.issue.read` | Reads one issue |
| `github.issue.comment` | Comments as the member, after their approval |

Every tool is off until its shape is pinned (see [mcp-apps.md](mcp-apps.md#pinning-tool-shapes)).

## Hosts

`github.com`, `api.github.com` and `api.githubcopilot.com`. Put them on the workspace's egress list when `AGENT_EGRESS_ALLOWLIST` is on.
