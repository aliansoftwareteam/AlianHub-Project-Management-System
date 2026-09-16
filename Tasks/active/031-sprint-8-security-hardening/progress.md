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

## Last step
Slices 0a, 0b and 1 in progress.
