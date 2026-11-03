# Progress: Connectors — Slack as a personal OAuth provider; retire the workspace bot

## Checklist
- [x] Slack research row
- [x] Contract extensions
- [x] Provider definition
- [x] Tools
- [x] Agent wiring
- [x] Retire bot + notify admins (migration 080)
- [x] Screens (bot form removed; the connect screen is 072's)
- [x] Setup doc
- [x] Tests

## Last step
Built and committed locally on `feat/074-connectors-slack-personal`; not pushed.

## Blockers
None. Connecting Slack from the UI waits on 072's My connections screen; the routes already work.

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
- Not tested end to end: refreshing an expired access token only to revoke it on disconnect (`revokeWith: 'access'`).
