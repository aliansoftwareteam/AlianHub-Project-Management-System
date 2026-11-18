---
id: 068
title: Connectors — tool framework: one definition registered for agents and MCP
status: active
priority: high
depends_on: [063]
created: 2026-10-28
---

# 068 — Connectors — tool framework: one definition registered for agents and MCP

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
A connector tool is defined once in its provider and becomes both an agent tool and an MCP tool, acting only on the caller's own connection.

## Scope
- Tool definition: key `<provider>.<object>.<verb>`, label, read/write, required scope, input schema, output shape, caps (FR-18)
- Registration in the agent registry and as MCP tools
- Connection resolution: the run's person or the MCP token's person; none → "connect <provider> on My connections"; reserved `connectionId` param (FR-19)
- Scope checked at call time, naming the product to tick (FR-9)
- Reads: text only, capped per read and per run, taint kind `connector`, no web fetch after (FR-20)
- Every provider call through `agentFetch` in the workspace egress context with the provider's hosts (FR-24)
- MCP scopes `connectors:read` and `connectors:write` on the consent screen (FR-25)

## Out of scope
- Write approval flow (069)
- Audit/usage/quotas (070)
- Google tools themselves (071)

## Acceptance criteria
- [ ] A fake provider's tool is callable from an agent run and from MCP with no extra wiring
- [ ] A call never reaches another person's connection
- [ ] A token without `connectors:read` does not see the tools
- [ ] After a connector read the run cannot web-fetch

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 063
- Depends only on the contract part of 063, not its code: build against a stub `resolveConnection` and the fake provider server until track A's 066 lands. Reuse `readLimits.js`, `taint.js`, `agentFetch.js`, `Modules/Mcp/scopes.js`.
