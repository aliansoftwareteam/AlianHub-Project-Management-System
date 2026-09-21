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

## Last step
S2 in review fixes (#795); S1 and S5 in progress; then S3, S4, S6, S7, S8, S9.
