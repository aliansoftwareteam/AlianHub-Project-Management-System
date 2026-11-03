feat(connectors): Slack as a personal OAuth provider; retire the workspace bot (074)

Base: `feat/per-user-connectors`

## What this does

Task 074, FR-36 of the 056 PRD. Each member connects their own Slack account with a user token, and agents and MCP clients use only that person's connection. The workspace bot is retired.

- **Provider** `Modules/Connectors/providers/slack`: user scopes `channels:read groups:read channels:history groups:history chat:write`, with token rotation required.
- **Tools**:
  - `slack.channels.list` (new) lists the channels the person can see.
  - `slack.channel.read` reads one channel. It is capped, tainted and counted against the run.
  - `slack.message.post` posts as the person. It is a proposal that only the connection's owner approves in the Inbox.
  - All three work on public channels and the private channels the person is in. A DM or group DM is refused, and the channel's type is checked with Slack at every call.
- **Contract**: new optional keys for Slack's OAuth, so Google is unchanged:
  - `auth.scopeParam` / `scopeSeparator` (Slack's `user_scope`);
  - `auth.tokenAnswer` (Slack nests the token under `authed_user`);
  - `answerError` (Slack refuses with HTTP 200 and `ok: false`);
  - `auth.revokeWith: 'access'` (`auth.revoke` takes the access token).

  A dead token on a tool call marks the connection broken.
- **Migration `081-retire-slack-bot`**: in every workspace that had the bot, it asks Slack to revoke the bot token, retires the bot secrets, closes the bot row, declines Inbox posts still waiting on the bot, and tells owners and admins in the bell. It goes on if Slack cannot be reached, and a second run changes nothing.
- **Screens**: the bot form is gone. Integrations › Slack points to My connections, and the bell notice opens the Connections page.
- **Docs**: the Slack row in the research matrix, `docs/connectors/slack.md` (app setup, token rotation, the tunnel for local development), and env docs for `CONNECTOR_SLACK_CLIENT_ID` / `_SECRET`.

## Merged with `feat/per-user-connectors` (072 #1755, 073 #1761)

This branch already merges the base, so the PR merges cleanly. The merge resolved three things:

- **`tests/connector-slack-post.test.js`**: deleted here (it tested the retired bot) and changed in 072, which added three tests of the catalogue's `registryConnectors` flag. The delete stays, and those tests moved to `tests/connector-catalogue-flags.test.js` with one change: `CONNECTORS=slack` now names a registry provider, so it sets `registryConnectors: true`.
- **A break git does not flag:** 074 dropped the `flag` require from `Modules/Connectors/controller.js` (only the bot used it), while 072's `appCatalog` there calls `flag.named()`. Without the require, `GET /api/v2/connectors/apps` answers 500 and the Company OAuth apps section does not load. The require is back.
- **Migration number:** 073 took 080 (`080-connectors-google-calendar-to-google`), so the bot retirement is now `081-retire-slack-bot`.

On My connections, 072's screen lists Slack from the registry, with the labels "Slack" and "Messages" humanised from the ids.

## Changes beyond the task as first written (confirmed by Prinsa)

- **The connect screen is 072's.** 074 ships the routes and tools; 072 ships the screen.
- **More of the bot is gone than "no caller".** 074 removed:
  - the bot's routes and handlers (`/api/v2/connectors/slack/*`);
  - its agent registry group, executor, reader and proposal hooks;
  - `SlackConnector.vue` and its strings;
  - the bot's three test files.

  The four `slack*.js` files and `SlackPostPreview.vue` stay for 079, whose task now lists what 074 already removed.
- **Slack summary skill:** with no allow-list, it reads the first channel by name the person is a member of, unless a copy of the skill names one, and posts back by channel name.

## Found and fixed while testing

The code exchange always sent a `code_verifier`, even when the consent asked no PKCE challenge. Slack refuses that, so every real Slack connection would have failed. The verifier now goes only with `pkce: S256`. `connector-slack-connection` fails in 9 places without the fix.

## Tests

- New tests:
  - `connector-slack-tools`, 31 tests on a fake Slack server: tools, card edits, send-time checks, 429 hold, run cap, token never stored;
  - `connector-slack-connection`, 12 tests on the real lifecycle with Slack's answer shapes: connect, refresh, dead refresh token, revoke with the access token;
  - `migration-retire-slack-bot`, 8 tests;
  - two frontend specs.
- Connector, Slack, agent, skill, MCP, migration and convention suites: 216 files, 6,244 tests pass. Frontend specs: 147 pass. i18n, style, env-doc and lint are clean.
- A wider run of the 1,024 unit files related to the change: 8 failed. 5 of them fail on the base commit too (`ai-connection`, `api-doc`, `demo-team-seed`, `role-prompts`, `upload-routes-order`). The other 3 failed on timeouts under load and pass when run alone.

## Not done here

- **A connect with a real Slack app.** On a local merge with 072, My connections lists Slack and Connect reaches Slack's real sign-in page, and real Slack's refusal of a bad code is read correctly. Allowing access with a real account still needs a Slack app with token rotation and an https tunnel.
- **`docs/API.md`.** It goes in the docs PR after merge (Rule 4), because this removes the bot routes.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
