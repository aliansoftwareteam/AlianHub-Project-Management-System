---
id: 025
title: Sprint 2 — agent revisions and the skill record
status: done
priority: high
depends_on: [024]
created: 2026-09-10
---

# 025 — Sprint 2 — agent revisions and the skill record

Status: done · depends on 024 · sprint 2 · two weeks · branch `feat/sprint-2-revisions-and-skill-record` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 2. Filed 2026-09-10.

## Goal
Every run is reproducible, and a skill is data.

## Scope
1. Agent revisions and skill revisions as immutable documents; a run pins both at start; promote and roll back are pointer moves with an audit row. A revision carries a state (draft, candidate, live, superseded) and declares what it serves.
2. The skill record, its validator returning field-level errors like the automation rule validator, the frozen catalogues for inputs, readers, prompt partials and emitted actions, the manifest endpoint (`GET /api/v2/agents/skills`), and the hybrid resolver that reads a company's data skills first and the built-in code skills second. (ADR 003 phase 1)
3. Save-time validation of emitted actions, and the effective-actions intersection with the agent's allowed actions and the registry; the agent manifest endpoint so workflows and rules bind agents by id and optional revision.
4. The intake skill (`brief.parse`) re-expressed as a data skill. If it does not fit, the vocabulary is wrong and this sprint is where that is learned.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| A Lifecycle | Agent settings → revision history | new | Numbered revisions with who changed what and when, a diff between any two, promote and roll back as one click each, the revision badge on every run |
| A Lifecycle | Run detail → pinned revision | extend | Which agent revision and skill revision produced this run, linked |

## Defects closed
None directly.

## Out of scope
- Canary traffic shares and automatic demotion are designed in the document (section A) and land with the routing outcomes in Sprint 9.

## Acceptance
- [ ] A run six weeks old can name the exact skill, prompt hash and model that produced it.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- A seed migration writes the built-in skills as revision one in every company database. Runs created before the change resolve to a synthetic revision zero so nothing old breaks. Every new field is declared in the strict schema before the first write.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
