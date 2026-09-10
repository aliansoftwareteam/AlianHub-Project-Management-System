---
id: 032
title: Sprint 11 — data skills reach outside (ADR 003 phase 4)
status: backlog
priority: medium
depends_on: [029, 031]
created: 2026-09-10
---

# 032 — Sprint 11 — data skills reach outside (ADR 003 phase 4)

Status: backlog · depends on 029, 031 · sprint 11 · two weeks · branch `feat/sprint-11-data-skills-reach` (from `beta`)

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
