---
id: 075
title: Connectors — GitHub through its MCP server, the first registered MCP app
status: active
priority: high
depends_on: [092, 093, 100]
created: 2026-10-28
---

# 075 — Connectors — GitHub through its MCP server, the first registered MCP app

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A member's AI looks up and links pull requests with the member's own GitHub account through GitHub's MCP server, on self-hosted and hosted installs. This proves the registered-app path and the shared sign-in service.

## Scope
- GitHub catalog entry: kind `mcp`, server `https://api.githubcopilot.com/mcp/`; sign-in through a registered GitHub app (the shared service on hosted instances, the instance or company app elsewhere) or a personal token (FR-42, built in 100)
- Allow-list written here from the server's own tool list, including `github.pull_request.read`, `github.pull_request.search`, `github.issue.read` and the reads the AI chat needs for "what is the status of this PR?"; any write (comment, review) as a proposal
- `pull_request.get` replaced by `github.pull_request.read` on the caller's connection; linking a pull request to a task uses it (FR-37)
- Tell admins that the task 049 sync will be retired; the removal and its migration are 079
- Setup page for self-hosted installs: register the GitHub app, callback, scopes, or use personal tokens

## Out of scope
- Removing the old sync, mapping, cron runner and screens (079)

## Acceptance criteria
- [ ] A member links a pull request to a task through their own connection, in each of three ways: a self-hosted install with its own app, a hosted instance through the shared service, and a personal token
- [ ] Two members with different GitHub accounts each see only what their own account can see
- [ ] A comment asked for by the AI is a proposal only the connection's owner approves
- [ ] Tested against a fake GitHub MCP server

## Constraints & notes
- Track: B — tools (using that access safely)
- Phase 1. Depends on: 092, 093, 100
