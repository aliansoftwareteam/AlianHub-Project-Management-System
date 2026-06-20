# Test Cases — AUTO-06 Slack Slash-Command Bot (AHE-3740)

A `/alianhub` Slack slash command. Public endpoint, authenticated by the
per-workspace **verification token** stored on the company's `slack` connection
(AUTO-04). Easy setup: paste the Request URL + Verification Token from your Slack
app — no OAuth, no raw-body capture, no global-parser changes.

**Endpoint:** `POST /api/v1/slack/command/:companyId` — **PUBLIC** (not under the
`/api/v1/integrations` JWT mount), rate-limited, own urlencoded parser. companyId
in the URL is not secret; the verification token authenticates.

**Commands (read-only):** `help`, `projects` (lists active project names). Always
replies with an ephemeral message.

## Pure-rule unit tests (`tests/slack-rules.test.js`) — 12/12 passing

| Group | Cases |
|-------|-------|
| parseCommand | empty → help · known subcommand (case-insensitive) + rest · unknown → help |
| verifyToken | equal → true · different → false · length-mismatch / empty → false (constant-time) |
| verifySignature | valid HMAC `v0=` → true · wrong secret → false · missing parts → false (forward-compat signed-request path) |
| responses | ephemeral shape · helpText lists commands · projectsText empty vs list |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Setup | Marketplace → connect Slack with the app's Verification Token; copy the Request URL from the Slack card | URL `…/api/v1/slack/command/<companyId>` shown with setup hint |
| M2 | `/alianhub help` | run in Slack | Ephemeral help listing commands |
| M3 | `/alianhub projects` | run in Slack | Ephemeral list of active project names |
| M4 | Bad token | POST with wrong `token` | 401 "Verification failed." |
| M5 | Not configured | company without a slack connection | Ephemeral "Slack isn't connected… add it in Marketplace." |
| M6 | Unknown subcommand | `/alianhub foo` | Falls back to help |
| M7 | companyId isolation | two workspaces | each resolves its own company's connection + projects |

## Guards / non-regression
- PUBLIC route lives under `/api/v1/slack/...`, deliberately NOT `/api/v1/integrations/...`, so it bypasses JWT while every other integrations route stays protected. Rate-limited.
- Auth via constant-time token compare; verification token is a secret field (redacted everywhere it's read back).
- Read-only commands — no task mutation, no user-mapping, no DM/posting. Own route-scoped urlencoded parser; global body parsing untouched.
- `verifySignature` (HMAC) shipped + tested for the future signed-request upgrade (needs a raw-body capture, documented).

## Roadmap
Mutating commands (`/alianhub new …`) once Slack-user → AlianHub-user mapping + OAuth are added; outbound notifications to `default_channel`.
