# Progress: Connectors — Slack as a personal OAuth provider; retire the workspace bot

## Checklist
- [x] Slack research row
- [x] Contract extensions
- [x] Provider definition
- [x] Tools
- [x] Agent wiring
- [x] Retire bot + notify admins (migration 081, first written as 080)
- [x] Screens (bot form removed; the connect screen is 072's)
- [x] Setup doc
- [x] Tests

## Last step
Done. All acceptance boxes ticked; the last one checked against a real Slack workspace.

## Blockers
None.

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-03
- Branch `feat/074-connectors-slack-personal` cut from `upstream/feat/per-user-connectors` (6c5ae20c1).
- Slack OAuth researched from docs.slack.dev: `user_scope`, PKCE via `code_verifier`, token rotation (12 h access, single-use refresh), `auth.revoke` takes the access token, HTTPS Redirect URL with subdirectory match, no localhost. Section 9 of the research matrix.
- Decisions: token rotation required; public channels and member private channels, no DMs; admins told by in-app notification; pending bot posts expire.
- Contract: optional `auth.scopeParam`, `auth.scopeSeparator`, `auth.tokenAnswer`, `auth.revokeWith`, `answerError`; dead-token errors on a tool call mark the connection broken; a read tool may return named `fields`.
- Provider `providers/slack` with `slack.channels.list`, `slack.channel.read`, `slack.message.post`. PKCE is not sent: a Slack app must opt in, and the confidential client plus signed state already bind the attempt.
- Agents: the old Slack registry group, executor, reader and proposal hooks are gone; the Slack summary seed reads `slack.channel.read` (the person's first member channel by name unless a copy names one) and posts back by channel name.
- Workspace-bot routes and handlers removed; `SlackConnector.vue` and its spec removed; the bot's three test files removed.
- Migration `080-retire-slack-bot`: retires the bot secrets, closes its row, declines waiting bot posts, notifies owners and admins; a second run changes nothing.
- Tests: `connector-slack-tools` (24, fake Slack server), `migration-retire-slack-bot` (4); connector, agent, skill, MCP and migration suites pass, and so do the affected frontend specs. `conventions/style-check` fails on its baseline-format test in this Windows checkout (CRLF), with `scripts/style-baseline.json` unchanged.
- Testing (second commit): the code exchange sent a `code_verifier` to Slack though its consent asked no PKCE challenge, so every real connection would have failed; it now goes only with `pkce: S256`. Disconnect checks a shared grant before refreshing a token to revoke it. `slack.channels.list` got its audit label and the generic callback its public-route reason. New `connector-slack-connection` (12) runs the real lifecycle on Slack's shapes, including refresh-then-revoke; `connector-slack-tools` grew to 31.
- Wider run: 1,024 unit files related to the change and all 30 convention files. The 8 that failed either fail on the base commit too (5) or pass alone (3, timeouts under load). Two baseline files in this checkout were CRLF against `eol=lf` and were checked out again.
- Gap check against task.md (third commit): migration 080 now asks Slack to revoke the bot token first and goes on if it cannot; the leftover `SlackConnector.*` strings were removed; the scope changes made while building are recorded in task.md for Prinsa to confirm, and 079's task notes what 074 already removed.
- Prinsa confirmed the four changes made while building (connect screen is 072's, more of the bot removed, the summary skill's channel choice, the Slack-side revoke).
- 072 merged as #1755. On a throwaway local merge of 074 with it (never pushed):
  - The only git conflict is `tests/connector-slack-post.test.js`. 072's three catalogue tests moved to their own file and pass, with `CONNECTORS=slack` now setting `registryConnectors: true`.
  - A second break git does not flag: 074 drops the `flag` require from `Modules/Connectors/controller.js`, and 072's `appCatalog` calls it. `GET /api/v2/connectors/apps` then answers 500, and no test catches it. Both fixes are in `pr-body.md`.
  - The screen: My connections lists Slack (Messages), and Connect opens Slack's real sign-in page.
  - Real Slack refused a made-up code with `ok:false, invalid_code`, which 074 reads as a refusal (400). A bad state, a denial and a reused state are all refused.
  - Backend connector, agent, skill, MCP, migration and convention suites: 306 files, 9,152 tests pass. Frontend: the same 47 failures as on 074 alone, plus one timeout in `appWithoutWorkspace.spec.js` that passes on a rerun.
- Seen there but not 074's: the frontend dev proxy does not forward `/mcp`, so the Connections page fails locally on `/mcp/manifest`; and the boot log calls `google` unknown in `CONNECTORS`.
- Real Slack check, on the local merge with a test Slack workspace, an app made from a manifest (five user scopes, token rotation on, no PKCE) and a cloudflared tunnel:
  - Connect on My connections opened Slack's consent page with only the five user scopes; after Allow, the connection is `connected` for the team and user, with exactly those scopes, an access expiry, and no token in the row.
  - `slack.channels.list` listed the three channels; `slack.channel.read` read `#new-channel`, tainted.
  - The approved send posted to `#new-channel` and the read showed it; a `<!here>` text was refused.
