---
id: 018
title: Sprint 10 — external agents: OAuth, scopes, delegation
status: active
priority: medium
depends_on: [028, 031]
created: 2026-09-10
---

# 018 — Sprint 10 — external agents: OAuth, scopes, delegation

Status: active · started 2026-09-21 · depends on 028, 031 · sprint 10 · three weeks · branch `feat/agent-interop` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 10. Filed 2026-09-10.

## Goal
An outside agent is a teammate with typed activities and a human still assigned, not a token with a bearer header.

## Scope
1. OAuth 2.1 on the MCP server per the 2025-11-25 authorization spec: protected-resource metadata, PKCE, resource indicators, audience-bound tokens; scopes `tasks:read`, `tasks:write`, `projects:read`, `docs:read`, `time:write` challenged incrementally; destructive tools flagged; results carry names not ids; pagination by default. More of the data model exposed with the same registry and rating discipline: projects, sprints, statuses, comments, pages, timesheets.
2. Inbound external agent sessions as workflow step executors: an OAuth client with `actor=agent`, delegation on a task with the human assignee kept, typed activities `thought | action | elicitation | response | error`, a ten-second first-activity rule, session state in the task-panel agent strip.
3. (added, carried from the original 018) Governance: an admin approves external agent clients per company; audit rows attribute to the agent and the delegating human; a revoked grant stops a session mid-step.
4. (added, carried from the original 018) MCP conformance test against the spec's authorization flow, and the security checklist: no token pass-through, a session is never used as auth.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| B Communication | Task panel → agent strip | extend | Session state and typed activities of a delegated external agent, within ten seconds of the first activity |

## Defects closed
None directly.

## Out of scope
- A2A: watch the protocol; adopt when a second partner needs agent-to-agent hand-off.
- Marketplace of agents.

## Acceptance
- [ ] An external coding agent completes a step in a workflow, its actions appear in the audit with the right attribution, a revoked grant stops it mid-step; Claude Code with `tasks:read` only is refused a write with a scope challenge and writes after step-up.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Rewritten 2026-09-10 from the original 018 as Sprint 10 of the architecture document; steps 3 and 4 are the original's governance and conformance items, which the document's sprint plan omitted.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
- Plan (2026-09-21), nine pull requests: S1 protected resource metadata and scope challenges on `/mcp`; S2 the authorization server core (`Modules/OAuthServer`, migration 040); S3 consent screen and per-company client approval (migration 041); S4 the MCP server accepts OAuth tokens (audience, company, no pass-through, audit attribution); S5 tool contract v2 (names in results, cursors, annotations, destructive calls open a proposal); S6 more of the data model; S7 agent sessions and a live agent strip (migration 042); S8 the `external_agent` step type; S9 conformance (the official MCP suite plus a scripted client) and the security checklist. Parallel: S1 with S2; after S2, S3 with S4; after S1, S5 with S6; S8 after S4 and S7. Migrations for this sprint start at 040.
- The authorization server lives in the app, handwritten on the tracker PKCE pattern, with opaque hashed tokens bound to one workspace (owner, 2026-09-21).
- Clients register with client ID metadata documents and admin pre-registration; dynamic registration exists behind `MCP_OAUTH_DCR=off` (owner, 2026-09-21).
- An outside agent learns of a delegation by a signed webhook through the egress gateway, and the ten-second first-activity clock starts at delivery (owner, 2026-09-21).
- Access tokens last 15 minutes, refresh tokens 30 days with rotation, a grant at most 90 days (owner, 2026-09-21).
- A destructive action is one whose rating is irreversible or any workspace-scope write; from MCP it opens a proposal a person approves (owner, 2026-09-21).
- Scopes: `tasks:read`, `tasks:write`, `projects:read`, `docs:read`, `time:read`, `time:write` (owner, 2026-09-21).
- Outside agents may be delegated tasks in private sprints only when the delegating person is a sprint member and an admin has opted the client in (owner, 2026-09-21).
- Outside agent sessions count as tainted, so their risky writes go to approval (owner, 2026-09-21).
- The assignee stays; an unassigned task gets the delegating person, who is notified (owner, 2026-09-21).
- Personal access tokens keep working on `/mcp` for one more release, then only OAuth tokens (owner, 2026-09-21).
- Loopback redirect URIs (`127.0.0.1`, `[::1]` and `localhost`) match exactly except for the port, per RFC 8252 §7.3 and OAuth 2.1 §2.3.1; `localhost` is included because the MCP specification's examples use it (2026-09-21).
