# Slack connector setup

Each member connects their own Slack account. Agents and MCP clients then act with that person's Slack user token, and only on that person's behalf:

- `slack.channels.list` lists the channels the person can see: every public channel, and the private channels they are in.
- `slack.channel.read` reads the recent messages of one of those channels. Each read is capped and marks the run, and the run makes no web fetch after it.
- `slack.message.post` proposes a plain-text message posted as the person. Nothing is sent until that person approves the exact channel and text in the Inbox.

Direct messages and group DMs are never listed, read or posted to. The Slack slash command (`/alianhub`, under Integrations › Slack) is separate and is not changed by any of this.

## 1. Create the Slack app

1. At [api.slack.com/apps](https://api.slack.com/apps), choose **Create New App** › **From scratch**, and pick a development workspace.
2. Under **OAuth & Permissions** › **User Token Scopes**, add `channels:read`, `groups:read`, `channels:history`, `groups:history` and `chat:write`. Add no bot token scopes.
3. On the same page, turn on **Token Rotation**. Slack sends no refresh token without it, and AlianHub refuses a connection that has none. Token rotation cannot be turned off again later.
4. Under **Redirect URLs**, add `<APIURL>/api/v1/connector-oauth/slack/callback`, for example `https://pm.example.com/api/v1/connector-oauth/slack/callback`.
5. To let people from other workspaces connect, open **Manage Distribution** and choose **Activate Public Distribution**. This needs no Slack Marketplace review.
6. Copy the **Client ID** and the **Client Secret** from **Basic Information**.

## 2. Configure AlianHub

```env
CONNECTORS=google,slack
CONNECTOR_SLACK_CLIENT_ID="1234567890.1234567890"
CONNECTOR_SLACK_CLIENT_SECRET="…"
APIURL="https://pm.example.com/"
SECRETS_STORE=on
SECRETS_KEY="…at least 32 characters…"
AGENT_TAINT_ROUTING=on
```

A workspace owner or admin can set the company's own Slack app instead (`PUT /api/v2/connectors/apps/slack`). It then replaces the instance app for that workspace. If `AGENT_EGRESS_ALLOWLIST` is on and the workspace has a host list, add `slack.com` to that list.

## 3. Local development needs a tunnel

Slack accepts only an `https` Redirect URL, and localhost does not work. Run a tunnel to the dev server (port 4000), for example `cloudflared tunnel --url http://localhost:4000` or `ngrok http 4000`. Set `APIURL` to the tunnel's https address, and register that address's callback as the Redirect URL. Slack also accepts any `redirect_uri` below a registered Redirect URL, so registering the tunnel's host once covers the callback path.

## 4. The old workspace bot

Migration `080-retire-slack-bot` runs once in every workspace that had the bot. It:

- retires the bot token and the signing secret in the secrets store;
- closes the bot's connection and its channel allow-list;
- declines every Inbox proposal that was still waiting to post through the bot, so nothing is sent;
- tells each owner and admin in the bell.

A second run changes nothing. After it runs, uninstall the old bot app from Slack yourself.
