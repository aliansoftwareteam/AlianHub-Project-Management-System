# Progress: Sprint 8 — security hardening

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: Server-side permission enforcement for browser sessions, after bringing the backend catalogue to parity with t — code complete: #740 `9ef9bf2e` (build 214), #743 `e3b1e540` (218), #749 `9d4dd00c` (222), #751 `f669c689` (224); the two-week report-only period runs per workspace once the owner turns it on
- [ ] Step 2: Service identities for the engine, workers, indexer and router; step-scoped short-lived credentials minted per
- [ ] Step 3: Agent egress through an allow-listing proxy per tenant.
- [ ] Step 4: Audit as append-only with a per-tenant hash chain; audit retention at least as long as run retention; tainted- — chain and retention done in #750 `94f6d206` (build 225); tainted-context marking is slice 6
- [ ] Step 5: Http-only session cookies and a content security policy, which is frontend work with the socket and refresh fl
- [x] Interface: Accounts → tokens (extend) — #744 `88246531` (build 219); owner and member sweep still to record
- [ ] Interface: Instance console → egress allowlist (new)
- [ ] Interface: Instance console → enforcement (new) — slice 4 in progress
- [x] Interface: Audit log (extend) — #750 `94f6d206` (build 225); owner and member sweep still to record
- [ ] Defects closed: #2, #9, #20
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 8) |
| 2026-09-16 | Started, in parallel with Sprint 7. Planned against `beta` at `cb9ce0e9` into the fourteen pull requests listed under Decisions in task.md; none of the five steps existed, and the planning pass found two defects that ship first as slices 0a and 0b. The owner settled per-workspace enforcement and how erasure treats the audit chain. Slices 0a, 0b and 1 started, each in its own worktree. |
| 2026-09-16 | Slice 0b merged: #737 `e691b378` (build 212), AI-generated lists are parsed as JSON with a shape check. Slice 0a merged: #738 `d781f3a8` (build 213), tasks no longer carry a session token and migration 028 clears stored values. Slice 1 merged: #740 `9ef9bf2e` (build 214), the server permission evaluator agrees with the web app without refusing anything `beta` allowed; the differences that remain are recorded with tests for the report-only slice. An independent review found one new API-token refusal (request ids compared by case) and a migration that would have changed what the web app shows; both were fixed before merge and the migration was dropped, leaving 029 free. |
| 2026-09-17 | Owner decisions: an audit row that changes is recorded as a new chained row; the chain hash is keyed with a new `AUDIT_CHAIN_KEY`; existing API tokens without an expiry keep working for 30 days after mandatory expiry turns on. Slice 2 (report-only enforcement for web sessions, migration 029) and slice 7 (mandatory token expiry and explicit scopes) started. |
| 2026-09-17 | Slice 2 merged: #743 `e3b1e540` (build 218), browser sessions pass through the permission check in off, report and enforce modes, the mode set per workspace with the instance value as default, would-be denials recorded after the response without bodies or paths; its review found two refusals enforce would have added (invitation acceptance, a member's own preferences) and both were fixed first. Slice 7 merged: #744 `88246531` (build 219), mandatory expiry and explicit scopes behind `API_TOKEN_STRICT`, a per-token 30-day grace, MCP reads now checking the read scope. Slice 3 merged: #749 `9d4dd00c` (build 222), every task write mapped to its key and judged through the enforcement mode, ids resolved the way the handlers resolve them. Owner decisions: a workspace shows as ready to enforce after 14 days without a would-be denial; owners and admins get a workspace list of tokens still needing an expiry (slice 7b). |
| 2026-09-18 | Slice 3b merged: #751 `f669c689` (build 224), task writes stay in the authorised company and change only their own fields, no stub tasks on update; the adversarial review found nothing that breaks it and its further findings became slice 3c. Slice 5 merged: #750 `94f6d206` (build 225), the per-tenant audit hash chain, after three review rounds fixed eleven defects (stored text normalised the way BSON stores it, only verified amendments applied on every read path including export, a chained row never edited in place whatever the flag, the head mirrored from what each process wrote, undo refusing before an inverse it cannot record). Slices 3c, 4 (enforcement console) and 7b started. |

## Last step
Steps 1 and 4's chain are merged (builds 214–225). Slices 3c, 4 and 7b in progress; then slice 6 (tainted runs), 8 (service identities), 9 (secrets), 10 (egress), 11 (http-only cookies) and 12 (CSP).
