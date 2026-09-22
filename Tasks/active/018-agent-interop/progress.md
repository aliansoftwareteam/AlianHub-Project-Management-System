# Progress: Sprint 10 — external agents: OAuth, scopes, delegation

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: OAuth 2.1 on the MCP server per the 2025-11-25 authorization spec: protected-resource metadata, PKCE, resource — #795 `4c80c48d` (265), #797 `8369619f` (269), #802 `9fd60e5d` (273)
- [x] Step 2: Inbound external agent sessions as workflow step executors: an OAuth client with `actor=agent`, delegation on  — #810 `aab33561` (278), #820 `20ee19e6` (289)
- [x] Step 3: (added, carried from the original 018) Governance: an admin approves external agent clients per company; audit — #805 `b8ac941c` (277)
- [x] Step 4: (added, carried from the original 018) MCP conformance test against the spec's authorization flow, and the sec — #807 `a2b7f8c3` (276)
- [x] Interface: Task panel → agent strip (extend) — #810 `aab33561` (278)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 10) |
| 2026-09-21 | Started after Sprints 5 and 8. Planned against `beta` into nine pull requests (see task.md Decisions); the owner settled every open question. S2 (authorization server core, #795) is in its review fix round; S1 (resource metadata and scope challenges) and S5 (tool contract v2) started. |
| 2026-09-21 | S2 merged: #795 `4c80c48d` (build 265), the in-app OAuth 2.1 authorization server behind `MCP_OAUTH` (PKCE S256, resource indicators, exact redirects with the loopback port rule, single-use codes, rotating refresh with family revocation, client metadata documents fetched without redirects, migration 040). S1 merged: #797 `8369619f` (build 269), protected resource metadata, 401 challenges and 403 `insufficient_scope`, a scope map per tool. S4 merged: #802 `9fd60e5d` (build 273), `/mcp` accepts audience-bound OAuth tokens (`off`/`both`/`only`), rechecks the delegating person on every call, computes visibility for that person, never accepts a session as authorization and never passes the token on. S3 (#805, consent and approvals) and S5 (#798, tool contract v2) are in review fixes; S7 (sessions and the live strip) and S9 (conformance) started. Keep `MCP_OAUTH` off until S3 merges. |
| 2026-09-22 | S5 merged: #798 `bad46931` (build 275), names in results, signed cursors, annotations from ratings, destructive calls filed as proposals approved only as filed, with the token and the requester's visibility rechecked at approval. S9 merged: #807 `a2b7f8c3` (build 276), the official MCP conformance suite in CI and a scripted client through the whole authorization flow, including the acceptance case (a write refused with `insufficient_scope`, then allowed after step-up). S3 merged: #805 `b8ac941c` (build 277), the consent screen, per-workspace client approval with a scope ceiling enforced on every request, escaped Inbox text. S7 merged: #810 `aab33561` (build 278, replacing #808), outside agent sessions, delegation that keeps the assignee, a signed and timestamped webhook through the egress gateway, the ten-second first-activity rule, the live agent strip. |
| 2026-09-22 | S8 merged: #820 `20ee19e6` (build 289), the `external_agent` workflow step behind `EXTERNAL_AGENT_STEPS` (needs `EXTERNAL_AGENT_SESSIONS`): one session per run and step, delegated as the run's starter; every session and tool call rechecks that the run is running, the step still waits for that session, and the grant and client approval are live, or the call is refused and the session closed; revocation fails the step by name with an attributed refusal. S6 merged: #821 `014fc92d` (build 291), ten MCP data tools behind `MCP_TOOLS_DATA` (projects, sprints, statuses, comments, pages, timesheet reads; comment and time-log writes), each read through the delegating person's visibility. #822 `dcec1f18` (build 290) fixed an order-dependent audit lookup in the egress allowlist suite that S6's new file exposed. |

## Last step
Every slice merged (S1–S9, builds 265–291). The exit gate waits on the owner's sweeps: the consent screen and approvals, the live agent strip, a workflow with an outside agent step, and the data tools against a real client. Flags stay off until then: `MCP_OAUTH`, `EXTERNAL_AGENT_SESSIONS`, `EXTERNAL_AGENT_STEPS`, `MCP_TOOLS_V2`, `MCP_TOOLS_DATA`.
