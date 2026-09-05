# 018 — MCP in both directions: OAuth, scopes, external agents as teammates

Status: backlog · depends on 016 · branch `feat/agent-interop` (from `beta`)

## Goal
AlianHub speaks the standard both ways: an external agent (Claude Code first) connects with OAuth and least-privilege scopes, and can be delegated a task inside AlianHub where it shows up as a teammate with typed activity, a human still assigned.

## Scope (from research [18][19][20][62][63][64][66])
- **Outbound:** MCP server moves from bearer tokens to OAuth 2.1 per the 2025-11-25 authorization spec: protected-resource metadata, PKCE, resource indicators, audience-bound tokens, scopes `tasks:read`, `tasks:write`, `projects:read`, `docs:read`, `time:write`, challenged incrementally. Destructive tools flagged so clients prompt. Results carry names, not ids; pagination by default.
- **Data model coverage:** projects, sprints, statuses, comments, pages, timesheets, in addition to the 11 tools today.
- **Inbound:** external agent identity (OAuth client with `actor=agent`), delegation on a task (human assignee stays, agent delegated), agent session with typed activities `thought | action | elicitation | response | error`, a 10-second first-activity rule, and a session state shown in the task panel agent strip.
- **Governance:** admin approves external agent clients per company; audit rows attribute to the agent and the delegating human.

## Out of scope
- A2A. Watch the protocol; adopt when a second partner needs agent-to-agent hand-off.
- Marketplace of agents.

## Acceptance
- [ ] Claude Code connects via OAuth with `tasks:read` only and is refused a write with a scope challenge; after step-up it writes and the audit row names it.
- [ ] Delegating a task to Claude Code produces a session, activities appear in the task panel within 10 s, the human assignee is unchanged, and the result lands as a proposal or a linked PR.
- [ ] MCP conformance test against the spec's authorization flow; security best practices checklist (no token pass-through, session not used as auth).
