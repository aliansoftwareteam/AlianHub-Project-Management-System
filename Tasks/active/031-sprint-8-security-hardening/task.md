---
id: 031
title: Sprint 8 — security hardening
status: active
priority: high
depends_on: [024]
created: 2026-09-10
---

# 031 — Sprint 8 — security hardening

Status: active · started 2026-09-16 · depends on 024 · sprint 8 · three weeks · one branch per slice from `beta`, running in parallel with Sprint 7 (task 030)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 8. Filed 2026-09-10.

## Goal
Authorization is enforced where the data is, and a leaked credential buys minutes.

## Scope
1. Server-side permission enforcement for browser sessions, after bringing the backend catalogue to parity with the frontend on per-project overrides (013's G10 is the same surface); staged as report-only for two weeks, logging would-be denials, then enforced.
2. Service identities for the engine, workers, indexer and router; step-scoped short-lived credentials minted per step and verified against the live step; provider keys and integration secrets in a secrets store referenced by handle, with rotation and revocation; per-tenant provider keys.
3. Agent egress through an allow-listing proxy per tenant.
4. Audit as append-only with a per-tenant hash chain; audit retention at least as long as run retention; tainted-context marking so a run that read external content routes its risky actions to approval.
5. Http-only session cookies and a content security policy, which is frontend work with the socket and refresh flows adjusted.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| G Security | Accounts → tokens | extend | Expiry mandatory, scopes never empty, last use, step-scoped credentials shown as such |
| G Security | Instance console → egress allowlist | new | The hosts agents may fetch, per workspace |
| G Security | Instance console → enforcement | new | Report-only or enforce, with the would-be denial log |
| G Security | Audit log | extend | An integrity indicator per row and a filter for refusals |

## Defects closed
#2, #9, #20 from the document's defect table.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] The three critical findings from the defect list are closed by design, not by patch; a would-be denial report over two weeks shows no legitimate traffic blocked.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Report-only mode is the safety net for the enforcement change, since the last attempt caused false denials in production.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
- Plan (2026-09-16), fourteen pull requests in merge order: 0a stop storing session credentials on tasks; 0b parse generated lists without eval; 1 align the server permission evaluator with the web app; 2 report-only enforcement for web sessions (`PERMISSION_ENFORCEMENT_MODE`); 3 map every task write to its permission key; 4 instance enforcement console; 5 per-tenant audit hash chain (`AUDIT_CHAIN`); 6 risky actions from tainted runs go to approval (`AGENT_TAINT_ROUTING`); 7 mandatory token expiry and explicit scopes (`API_TOKEN_STRICT`); 8 service identities and step credentials (`STEP_CREDENTIALS`); 9 tenant secrets by handle (`SECRETS_STORE`); 10 workspace egress allowlist (`AGENT_EGRESS_ALLOWLIST`); 11 http-only session cookies (`SESSION_COOKIE_HTTPONLY`); 12 content security policy (`CSP_MODE`). 0a and 0b are defects found while planning and ship first; slice 1 may not deny anything allowed today.
- Shared with Sprint 7 (2026-09-16): migrations 028 onward belong to this sprint and 024–027 to Sprint 7. `Config/permissionGuard.js` belongs to this sprint; `Modules/Agents/scope.js` and `Config/contentAccess.js` are called, not changed, by either sprint without the integrator's agreement. Each sprint keeps its own i18n namespaces.
- Enforcement mode is set per workspace, with the instance value as the default; a workspace moves to enforce once its would-be-denial log is clean (owner, 2026-09-16).
- Erasure redacts personal fields in audit rows, which sit outside the hash, so the audit chain still verifies (owner, 2026-09-16).
- Slice 1 (#740) dropped its migration, so slice 2 takes migration 029 (2026-09-17).
- An audit row that changes after it is written is recorded as a new chained row; rows are never edited in place (owner, 2026-09-17).
- The audit chain hash is keyed with a new `AUDIT_CHAIN_KEY` secret, so someone with database write access cannot recompute the chain (owner, 2026-09-17).
- Existing API tokens without an expiry keep working for 30 days after mandatory expiry turns on, and owners are shown which tokens need replacing (owner, 2026-09-17).
- A workspace shows as ready to move from report-only to enforce once its would-be-denial log has had no rows for 14 days in a row; the owner still switches the mode (owner, 2026-09-17).
- Workspace owners and admins see a workspace-wide list of tokens that still need an expiry: name, owner, deadline and last use, never the token (owner, 2026-09-17; slice 7b).
- Slice 3 grew two follow-on slices from its reviews: 3b (#751) keeps task writes in the authorised company and to their own fields, and 3c validates the task index queries and takes the actor and counts from stored data (2026-09-18).
- Migration numbers used so far: 028 (#738), 029 (#743), 030 (#750); 031 is held by the secrets store (#759) and 033 by the content security policy slice. Sprint 7's slice 4 takes 032, a deviation from the 024–027 split because those four are used (2026-09-19).
- The secrets store is keyed with a new `SECRETS_KEY` environment variable, separate from `JWT_SECRET` and `AUDIT_CHAIN_KEY` (owner, 2026-09-19; slice 9).
- Agent egress is checked by an in-app gateway rather than a proxy container, and an empty allowlist keeps today's behaviour (owner, 2026-09-19; slice 10).
- Slice 6 (#757) defines `origin` on retrieved passages (`member`, `agent`, `external`; absent reads as not external); Sprint 7's slice 4 is the first to set it (2026-09-19).
- Slice 9b: a workspace key wins for that workspace with the instance key as fallback; a set key that will not open refuses the call rather than billing the instance owner; keys only, provider selection unchanged, so a workspace with its own key but no instance provider configured still reports unconfigured (async selection is the follow-up); management is owners/admins, interactive only (owner, 2026-09-20).
- Slice 11: an explicit Authorization header wins over the session cookie when both are present; login/refresh bodies keep carrying tokens (the tracker needs them; the P1-SEC-09 bar is that page JS stops reading cookies); multi-tab refresh races rely on the reuse-grace window with a single retry; session presence comes from the live user fetch and stored user id, with no new probe endpoint (owner, 2026-09-20).
- Stored uploads served from the app's own storage download with a non-executable type unless they are an image (SVG under a sandbox policy), PDF, plain text, audio or video, and every upload response carries a sandbox policy. This applies whatever `CSP_MODE` is, because the policy trusts the app's own origin (2026-09-21; slice 12).
- Still open: a maximum token lifetime, if the architecture document names none (slice 7); how the Google Drive picker works under an enforced policy, since it needs eval. Recommended: a separate popup page with its own policy; until decided, installs that use Drive stay on `report` (2026-09-21).
