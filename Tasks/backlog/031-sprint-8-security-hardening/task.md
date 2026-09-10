---
id: 031
title: Sprint 8 — security hardening
status: backlog
priority: high
depends_on: [024]
created: 2026-09-10
---

# 031 — Sprint 8 — security hardening

Status: backlog · depends on 024 · sprint 8 · three weeks · branch `feat/sprint-8-security-hardening` (from `beta`)

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
