# Progress: Sprint 10 — external agents: OAuth, scopes, delegation

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: OAuth 2.1 on the MCP server per the 2025-11-25 authorization spec: protected-resource metadata, PKCE, resource
- [ ] Step 2: Inbound external agent sessions as workflow step executors: an OAuth client with `actor=agent`, delegation on 
- [ ] Step 3: (added, carried from the original 018) Governance: an admin approves external agent clients per company; audit
- [ ] Step 4: (added, carried from the original 018) MCP conformance test against the spec's authorization flow, and the sec
- [ ] Interface: Task panel → agent strip (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 10) |
| 2026-09-21 | Started after Sprints 5 and 8. Planned against `beta` into nine pull requests (see task.md Decisions); the owner settled every open question. S2 (authorization server core, #795) is in its review fix round; S1 (resource metadata and scope challenges) and S5 (tool contract v2) started. |
| 2026-09-21 | S2 merged: #795 `4c80c48d` (build 265), the in-app OAuth 2.1 authorization server behind `MCP_OAUTH` (PKCE S256, resource indicators, exact redirects with the loopback port rule, single-use codes, rotating refresh with family revocation, client metadata documents fetched without redirects, migration 040). S1 merged: #797 `8369619f` (build 269), protected resource metadata, 401 challenges and 403 `insufficient_scope`, a scope map per tool. S4 merged: #802 `9fd60e5d` (build 273), `/mcp` accepts audience-bound OAuth tokens (`off`/`both`/`only`), rechecks the delegating person on every call, computes visibility for that person, never accepts a session as authorization and never passes the token on. S3 (#805, consent and approvals) and S5 (#798, tool contract v2) are in review fixes; S7 (sessions and the live strip) and S9 (conformance) started. Keep `MCP_OAUTH` off until S3 merges. |

## Last step
S1, S2, S4 merged (builds 265–273). S3 and S5 in review fixes; S7 and S9 in progress; then S6 and S8.
