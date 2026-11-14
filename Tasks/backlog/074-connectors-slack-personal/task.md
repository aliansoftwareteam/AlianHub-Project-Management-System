---
id: 074
title: Connectors — Slack as a personal OAuth provider; retire the workspace bot
status: backlog
priority: medium
depends_on: [069, 070, 078]
created: 2026-10-28
---

# 074 — Connectors — Slack as a personal OAuth provider; retire the workspace bot

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Slack is used with each person's own Slack user token, and the workspace bot is gone.

## Decisions (2026-11-03, Prinsa)
1. **Token rotation is required.** The Slack app must have token rotation on, so every connection has a 12-hour access token and a single-use refresh token, the same lifecycle as Google. A token response without a refresh token is refused (`no_refresh_token`), as today.
2. **Reach: public channels, and private channels the person is a member of.** No DMs, no group DMs. A read or a post to a DM or group DM is refused.
3. **Admins are told by an in-app notification** (the bell, like `CONNECTOR_BROKEN`) when the migration retires the bot.
4. **Pending bot posts expire.** A proposal still waiting in the Inbox with an old-path `slack.message.post` is closed as `declined` with the reason "The Slack workspace bot was retired. Connect Slack on My connections and ask again.", and nothing is sent.

## Changes made while building (2026-11-03, confirmed by Prinsa the same day)
These go beyond or differ from the scope as first written; each is named in the PR body for the reviewer.
- **The connect screen is 072's.** The first scope said Slack shows on My connections like Google. That screen, for every registry provider, is task 072 (track A), so 074 ships the routes and 072 the screen. Until 072 merges, nobody can connect Slack from the UI; 074 should merge with or after 072.
- **More of the bot is gone than "no caller".** Besides leaving the four `slack*.js` files with no caller, 074 removed the bot's routes and handlers (`/api/v2/connectors/slack/*`), its agent registry group (`registry/connectors.js`), its screen (`SlackConnector.vue`) with its `SlackConnector.*` strings, and the bot's three test files, so the bot cannot be set up again after migration 081. 079 deletes the four files and `SlackPostPreview.vue`.
- **The Slack summary skill picks a channel differently.** With no allow-list, it reads the first channel by name the person is a member of, unless a copy of the skill names one, and posts back to that channel by name.
- **The migration also revokes the bot token at Slack** (`auth.revoke`) before it retires the secrets, and goes on if Slack cannot be reached.

## Scope
- **Research row** — Slack in `056-personal-app-connectors/resources/research-matrix.md`: user scopes, `user_scope` param, PKCE, token rotation and refresh, `auth.revoke`, HTTPS redirect (subdirectory match, no localhost), rate tiers, dead-token errors, distribution.
- **Contract extensions** (`Modules/Connectors/validate.js`, `providerApi.js`, `connection.js`, `toolRunner.js`), each optional so Google is unchanged:
  - `auth.scopeParam` — the consent URL's scope parameter name (`user_scope` for Slack) and `auth.scopeSeparator` (`,`).
  - `auth.tokenAnswer(body)` — where the tokens sit in a token or refresh answer (Slack: `authed_user`).
  - `answerError(body)` — a provider that says "failed" inside a 200 answer (Slack `{ ok: false, error }`), used by the token calls and by tool calls, so a refused call is never kept as data or a delivery.
  - `auth.revokeWith: 'access'` — revoke with the access token (Slack `auth.revoke` takes no refresh token), refreshing it first when expired.
  - `deadGrantErrors` also applied to tool-call errors, so `invalid_auth` / `token_revoked` / `token_expired` mark the connection broken.
- **Provider** `Modules/Connectors/providers/slack/index.js`: one product `messages` with user scopes `channels:read groups:read channels:history groups:history chat:write`; account id `team.id:authed_user.id`, label the team name; egress `slack.com`; rate limit 429.
- **Tools** `Modules/Connectors/providers/slack/tools.js`, keeping today's keys so skills and audit rows keep their names:
  - `slack.channels.list` (read, new) — the channels the person can see (public and their private ones), name and id.
  - `slack.channel.read` (read, redefined) — recent messages of one channel; plain text with Slack markup turned into words (today's `plainText`), capped, tainted by the runner.
  - `slack.message.post` (write, redefined) — a text-only post as the person; a proposal with an approval card; no `<!here>`-style broadcasts, no files or blocks; checked again at send.
  - The old entries for these keys in `Modules/Agents/registry/connectors.js` and `actions.js` give way to the connector tools.
  - Channel type is checked at every call with `conversations.info`; a DM or group DM is refused.
- **Agent wiring**: the `slack.channel` reader and the Slack summary seed use the new tools on the run owner's connection; with no connection they refuse with "Connect Slack on My connections".
- **Retire the bot** — migration `082-retire-slack-bot`: asks Slack to revoke the bot token, retires the bot token and signing secret in the secrets store, closes the workspace `connector: 'slack'` row, expires pending old-path posts (decision 4), tells owners and admins (decision 3), audits `connector.revoke`. Safe to run twice.
- **Screens**: the workspace bot form (`SlackConnector.vue`) is removed and the Integrations › Slack section points to My connections; the bot-retired notice opens the Connections page. The connect, reconnect and disconnect screen for every registry provider, Slack included, is 072's. All strings through i18n, colours from tokens.
- **Setup doc** — `docs/connectors/slack.md`: create the Slack app, add the user scopes, turn on token rotation, Redirect URL `<APIURL>/api/v1/connector-oauth/slack/callback`, `CONNECTOR_SLACK_CLIENT_ID/SECRET`, `CONNECTORS=…,slack`, and a tunnel for local development (HTTPS only).

## Out of scope
- The Slack slash command and the `integration_connections` catalogue (FR-38 — stays).
- Deleting `slackConnection.js`, `slackApi.js`, `slackRead.js`, `slackPost.js` and `SlackPostPreview.vue` (079). 074 leaves them with no caller; their routes are already gone (see the changes above).
- DMs and group DMs; search; reactions; threads beyond the channel's top-level messages.

## Acceptance criteria
- [x] A member connects Slack on My connections with their own Slack account; only the granted user scopes are stored. *(Checked with a real Slack workspace and app on 2026-11-03: Connect, Allow, the five user scopes stored and no token in the row; channels list, channel read and a post worked against real Slack.)*
- [x] Reads are capped by run, quota and tool caps, and tainted; a DM or group DM is refused.
- [x] Posts are proposals approved by the connection's owner in the Inbox; nothing is sent before.
- [x] A dead token (`invalid_auth`, `token_revoked`, `token_expired`, `invalid_refresh_token`) marks the connection broken and tells the person once a day.
- [x] Disconnecting calls `auth.revoke`; the tokens leave the secrets store.
- [x] The migration retires the bot secrets, closes the old row, expires pending bot posts and notifies owners and admins; a second run changes nothing.
- [x] Google's flow and tools behave as before (its tests pass unchanged).
- [x] Tested against a fake Slack server; i18n and style checks pass. The API doc is regenerated in the docs PR after merge (Rule 4), because 074 removes the bot routes.

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 069, 070, 078
- Replaces `slackConnection.js`, `slackApi.js`, `slackRead.js`, `slackPost.js` on the agent path; 079 deletes them.
- Slack's Redirect URL must be HTTPS and the `redirect_uri` must match it or be a subdirectory of it; localhost is not allowed, so local development uses a tunnel (`APIURL` set to the tunnel's https URL).
- Migration 080 was taken by 073 (`081-connectors-google-calendar-to-google`), so the bot retirement is 081.
