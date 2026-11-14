# Progress: Connectors — remove the old Slack bot and GitHub sync paths

## Checklist
- [x] Remove Slack bot code
- [ ] Remove GitHub sync + flag *(waits: see Blockers)*
- [x] Checks (Slack half)

## Last step
The Slack half is done on branch `refactor/connectors-remove-old-paths`, after the 077 commit; not pushed. The GitHub half has not started, on purpose.

## Blockers
**The GitHub half waits for 075's tools to be switched on.** The task 049 GitHub sync (`Modules/Integrations/appConnections`, the `APP_CONNECTIONS` flag, `AppConnections.vue` and its route, and the `pull_request.get` registry action) is the only working pull-request path today. Its replacement, GitHub through its own MCP server (075), ships with every tool off (`shape: null`) until the tool shapes are pinned against a real GitHub account (`docs/connectors/mcp-apps.md`, "Pinning tool shapes"). Removing the sync before then would leave no way to read or link a pull request. The 049 retirement migration and its admin notice wait with it. Nothing of the GitHub sync was touched.

## What was removed (Slack half)
- `Modules/Agents/connectors/slackConnection.js`, `slackApi.js`, `slackRead.js` and `slackPost.js`. Before deleting, every `require`, route, string and test was searched: they were only required by one another, plus the `slackApi.js` entry in `tests/conventions/agent-egress-callers.test.js`, which went with it. 074 had already removed their routes, registry group, screen and tests.
- The `slackOn` helper in `Modules/Agents/connectors/flag.js`; `connectors-flag.test.js` now reads `flag.status('slack').on`, the same value.
- `SlackPostPreview` from the pending queue (`frontend/src/views/Inbox/ApprovalQueue.vue`): migration 082 declined every bot post that was still waiting, so the queue never holds one again.
- The five `/api/v2/connectors/slack/*` bot route descriptions left in `scripts/api-doc.meta.json`, which `npm run api:doc:check` reported as described but no longer registered.
- `Ai.slack_post_note` and `Ai.slack_post_outside` (pending-tense strings), from en.js and, by the backfill, every locale and pending file.

## What was kept, and why
- **`frontend/src/views/Ai/SlackPostPreview.vue` stays, as a minimal read-only fallback.** The AI Inbox lists decided proposals on its Done and Declined tabs, and a proposal filed through the workspace bot (before 074) stores the bot's params (`channelId`, `channelName`, `text`), its delivery results and no connector card. Without this view those history rows would show a label only, with no channel, text or delivery result. It now shows just that (no approval note, no "leaves the workspace" chip) and only for a `slack.message.post` change without a card. A post on a person's own connection carries a card and shows on `ConnectorWriteCard` alone. Before this change such a post showed twice in the AI Inbox and the queue, once as an empty bot preview (`#` with no channel) and once as its card. Audit rows never rendered through this view.
- `Modules/Agents/connectors/readLimits.js` stays: the Slack provider's tools and `toolRunner` read it.
- The Slack slash command and the rest of the `integration_connections` catalogue (FR-38), and migration 082 with its `CONNECTOR_SLACK_BOT_RETIRED` notice.

## Tests
- Adapted: `frontend/tests/unit/aiInboxSlackPost.spec.js` (5: a post on the person's own connection shows once on its card and not as a bot preview; a declined bot post still shows its channel and text; each bot delivery shows its own result; the failure and success toasts on approving); `frontend/tests/unit/inboxApprovalQueue.spec.js` (a Slack post shows once, on its card); `connectors-flag.test.js`; `conventions/agent-egress-callers.test.js` (the `slackApi.js` entry went with the file); `conventions/audit-event-labels.test.js` (its list of dotted strings that are not audit keys named four Slack API methods and the `slack.channel` reader, which only the deleted files held).
- Runs on the final tree (after the 077 commit), with the scratch jest config outside the repo:
  - the same 360 connector, Slack, Google, cloud, picker, agent, MCP, migration, storage, integration, secret, member, SCIM, inbox and approval unit files as 077: 10,669 of 10,670 pass; the one failure, `agent-rest-route-actions`, fails the same way on `6d4e2eace`.
  - conventions: 26 of 30 files, 472 of 476 tests pass. The 4 failures are the known CRLF `plain-words` baseline test and `mcp-tool-scopes`, `agent-action-labels` and `audit-event-labels` ("the words on screen"), which fail the same way on `6d4e2eace`.
  - frontend: 20 vitest specs on the AI Inbox, approval queue and connection views, 160 tests pass.
  - `npm run i18n:check` and `npm run style:check` pass (no baseline changed). `npm run api:doc:check` now reports only the stale `docs/API.md` and `docs/api/openapi.json`, regenerated in the docs PR (Rule 4).

## Log

### 2026-10-28
- Task created from the split of 056; acceptance criteria drawn from the 056 PRD.
- Assigned to track B in the two-track split; depends only on its own track and the 063 contract.

### 2026-11-12
- Widened for PRD v2.0 of 056: takes over the task 049 retirement migration and `AppConnections.vue` from 075, which now builds GitHub on its MCP server.
- Slack half done (above). GitHub half held back until 075's tools are pinned and on.

### 2026-11-13 — GitHub half dropped
- The owner decided to keep the task 049 GitHub sync as a workspace integration (056 decisions 31 and 32). Nothing GitHub is removed. Moving the App connections page into the Integrations page is task 106.
- With that, 079 is its Slack half, which is built and merged.
