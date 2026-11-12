# Progress: Connectors — GitHub through its MCP server, the first registered MCP app

## Checklist
- [x] GitHub entry: `providers/github/` (MCP, GitHub App sign-in, personal token, account from `api.github.com/user`)
- [x] Tools: pull request read and checks, pull request search, issue read, comment (write, approval card), all with `shape: null`
- [x] Sign-in: registered app (instance, company, shared service) and personal token (built in 100 and 093)
- [x] Token calls ask for JSON, which GitHub answers only when asked
- [x] Setup page `docs/connectors/github.md`
- [ ] Pin the shapes with `scripts/connector-tool-shapes.js` and a GitHub test account
- [ ] Link a pull request to a task from the task screen through `github.pull_request.read`
- [ ] Admin notice about the task 049 sync (with 079's migration)
- [ ] A manual run against GitHub

## Last step
The definition is in, and GitHub can be connected by GitHub App or personal token. Its tools stay off until their shapes are pinned with a real account. The task screen's "link a pull request" is not built.

## Blockers
A GitHub App and a test account, to pin the shapes and run it once for real.

## Log

### 2026-11-12
- Rewritten for PRD v2.0 (decisions 18, 21, 22, 27).
- Read GitHub's published metadata:
  - The protected resource `https://api.githubcopilot.com/mcp` points to the authorization server `https://github.com/login/oauth`, with PKCE S256 and no registration endpoint, so GitHub needs an app registered once.
  - Its resource scopes are those of an OAuth App (`repo`, `read:org`, …).
- Chose a GitHub App over an OAuth App:
  - The module keeps a connection by refreshing its token, and only a GitHub App's user tokens expire and refresh. An OAuth App's never do, so its answer is refused with `no_refresh_token`.
  - A GitHub App's tokens carry the app's permissions rather than scopes, so the `repos` product lists no scopes.
- `providers/github/index.js`:
  - Personal token accepted, account from `GET api.github.com/user`.
  - Dead grants are `bad_refresh_token` and `invalid_grant`.
  - Rate limits are 403 and 429 (403 counts only with a rate-limit signal).
  - No revoke: GitHub's per-app revoke is a DELETE with basic auth, which the module does not make; disconnect forgets the tokens here.
- `agentFetch.callProvider` now sends `Accept: application/json`; GitHub answers a token call as a form without it, and the other providers answer JSON either way.
- `providers/github/tools.js`:
  - `pull_request_read` with `method: get` serves the read; `method: get_status` serves the checks.
  - Also `search_pull_requests`, `issue_read` and `add_issue_comment`.
  - The read's input is `{ owner, repo, pullNumber }`, which the AI chat's pull request rule (097) sends.
- Tests: `tests/connector-mcp-apps.test.js` covers the definition, token-only until an app is set, then both; the JSON `Accept` on the token call; the read's input; tools off until pinned.
