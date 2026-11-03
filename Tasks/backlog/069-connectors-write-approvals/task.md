---
id: 069
title: Connectors — every outside write is a proposal only the connection owner approves
status: backlog
priority: high
depends_on: [068]
created: 2026-10-28
---

# 069 — Connectors — every outside write is a proposal only the connection owner approves

Sub task of 056 (`Tasks/backlog/056-personal-app-connectors/task.md`, the PRD). FR numbers refer to that PRD; its decisions and section 10 (security, privacy, testability, feature flag) apply here.

## Goal
Nothing is sent to an outside service before the connection's owner sees exactly what goes out and approves it.

## Scope
- Write tools `proposeOnly` at every autonomy level, both paths (FR-21)
- MCP writes filed as proposals waiting in the Inbox; the tool reply says so (FR-21)
- New gate `connection_owner`: an owner or admin cannot approve for someone else (FR-22)
- Approved payload is what is sent; an edit is re-validated and shown again; one attempt; result or error kept on the proposal (FR-23)
- Backend payload for the approval card (card UI in 078)

## Out of scope
- Approval card screens (078)

## Acceptance criteria
- [ ] A write from an agent run and from MCP each becomes a proposal
- [ ] An admin's approval is refused
- [ ] What is sent equals what was approved (asserted against a fake provider)
- [ ] A second attempt on the same approval is refused

## Constraints & notes
- Track: B — tools (using that token safely)
- Depends on: 068
- Reuse `Modules/Mcp/propose.js` and `approval.js`.
