---
id: 094
title: Connectors — Notion, the first app that registers itself
status: backlog
priority: high
depends_on: [092, 100]
created: 2026-11-12
---

# 094 — Connectors — Notion, the first app that registers itself

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD, v2.0). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A member connects Notion with no setup on any install. The AI chat, agents and their own AI then read, and propose writes, in their own Notion. This proves the self-registering path end to end.

## Scope
- Notion catalog entry: kind `mcp`, server `https://mcp.notion.com/mcp`, sign-in `self_register`, its allow-list written here from the server's own tool list (search and page read; page create and update as proposals)
- Registration once per workspace, reused by every member (FR-41); checked against Notion's known re-registration problem
- Notion's card on the Connectors screen: logo, one line, category
- The Phase 1 joint end-to-end test with GitHub (056 §11), on a self-hosted and a hosted instance

## Out of scope
- Notion as a built connector; background sync

## Acceptance criteria
- [ ] On a fresh install with nothing in `.env` for Notion, a member connects it from the Connectors screen
- [ ] A second member connects without a new registration; a new session never re-registers
- [ ] The AI chat, an agent run and MCP read through the member's own Notion; a page create waits in the Inbox
- [ ] Tested against a fake self-registering MCP server, plus one manual run against Notion itself, noted in progress

## Constraints & notes
- Track: A — connections, using track B's 092
- Phase 1. Depends on: 092, 100
