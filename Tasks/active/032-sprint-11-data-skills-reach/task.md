---
id: 032
title: Sprint 11 — data skills reach outside (ADR 003 phase 4)
status: active
priority: medium
depends_on: [029, 031]
created: 2026-09-10
---

# 032 — Sprint 11 — data skills reach outside (ADR 003 phase 4)

Status: active · started 2026-09-21 · depends on 029, 031 · sprint 11 · two weeks · branch `feat/sprint-11-data-skills-reach` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 11. Filed 2026-09-10.

## Goal
A data skill can read declared external sources through the tenant's egress allowlist, so the PR-review skill stops being the last code skill that does not need an evidence layer.

## Scope
1. Declared external reads join the skill vocabulary: URL and API readers with a declared host, capped size and time, resolved through the per-tenant egress proxy from Sprint 8, and validated against the allowlist at save.
2. The PR-review skill (`pr.summary`) re-expressed as a data skill; `qa-review` stays code by design because it measures page facts.
3. The Skill Library editor exposes declared reads with the allowlist check, and the replay record captures what was fetched.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| Skills | Skill Library → declared reads | extend | A skill declares the hosts it reads, checked against the workspace allowlist at save |

## Defects closed
None directly.

## Out of scope
- Custom code in a sandboxed runtime (ADR 003 phase 5) stays deferred.

## Acceptance
- [ ] An admin authors a skill that reads a declared external endpoint, a non-allow-listed host is refused at save, and a fetched body appears in the replay record.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- Added 2026-09-10: ADR 003 phase 4 had no sprint in the architecture document's plan; the document gains this sprint in the same change.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
- Plan (2026-09-21), six pull requests: S0 drop credentials on cross-origin redirects and taint every hop; S1 `url` and `api` readers with declared hosts checked against the workspace allowlist at save (`SKILL_EXTERNAL_READS`); S2 run-time reads rechecked against the live list, credentials only by secret handle; S3 fetches in the replay record; S4 declared reads in the Skill editor; S5 `pr.summary` as a data seed (`PR_SUMMARY_AS_DATA`). Migrations for this sprint start at 036.
- The PR-review skill makes no GitHub or GitLab API calls today; it fetches the public `.diff` page without credentials, so private repositories already fail. Authenticated reads for private pull requests are new scope for later (2026-09-21).
- A declared read's host must always be on the workspace allowlist, even when the list is empty; an empty list keeps today's open behaviour for agent page fetches only (owner, 2026-09-21).
- The workspace list is the only source; there is no instance-wide override (owner, 2026-09-21).
- The replay keeps the first 32 KB of a fetched body after redaction, plus a hash of the whole body, under the existing replay retention (owner, 2026-09-21).
- Credentials are per skill, as a handle to a workspace secret of kind `skill_read` chosen by an admin, and a secret may only be sent to the hosts it names (owner, 2026-09-21).
- A dry run fetches through the same checks and writes no replay (owner, 2026-09-21).
- The allowlist is edited only in the instance console; the Skill editor links to it (owner, 2026-09-21).
