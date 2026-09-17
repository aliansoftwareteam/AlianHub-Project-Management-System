# Progress: Sprint 8 — security hardening

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Server-side permission enforcement for browser sessions, after bringing the backend catalogue to parity with t
- [ ] Step 2: Service identities for the engine, workers, indexer and router; step-scoped short-lived credentials minted per
- [ ] Step 3: Agent egress through an allow-listing proxy per tenant.
- [ ] Step 4: Audit as append-only with a per-tenant hash chain; audit retention at least as long as run retention; tainted-
- [ ] Step 5: Http-only session cookies and a content security policy, which is frontend work with the socket and refresh fl
- [ ] Interface: Accounts → tokens (extend)
- [ ] Interface: Instance console → egress allowlist (new)
- [ ] Interface: Instance console → enforcement (new)
- [ ] Interface: Audit log (extend)
- [ ] Defects closed: #2, #9, #20
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 8) |
| 2026-09-16 | Started, in parallel with Sprint 7. Planned against `beta` at `cb9ce0e9` into the fourteen pull requests listed under Decisions in task.md; none of the five steps existed, and the planning pass found two defects that ship first as slices 0a and 0b. The owner settled per-workspace enforcement and how erasure treats the audit chain. Slices 0a, 0b and 1 started, each in its own worktree. |
| 2026-09-16 | Slice 0b merged: #737 `e691b378` (build 212), AI-generated lists are parsed as JSON with a shape check. Slice 0a merged: #738 `d781f3a8` (build 213), tasks no longer carry a session token and migration 028 clears stored values. Slice 1 merged: #740 `9ef9bf2e` (build 214), the server permission evaluator agrees with the web app without refusing anything `beta` allowed; the differences that remain are recorded with tests for the report-only slice. An independent review found one new API-token refusal (request ids compared by case) and a migration that would have changed what the web app shows; both were fixed before merge and the migration was dropped, leaving 029 free. |
| 2026-09-17 | Owner decisions: an audit row that changes is recorded as a new chained row; the chain hash is keyed with a new `AUDIT_CHAIN_KEY`; existing API tokens without an expiry keep working for 30 days after mandatory expiry turns on. Slice 2 (report-only enforcement for web sessions, migration 029) and slice 7 (mandatory token expiry and explicit scopes) started. |

## Last step
Slices 0a, 0b and 1 merged (builds 212–214). Slices 2 and 7 in progress; slice 5 waits for slice 2, since both touch the audit recorder.
