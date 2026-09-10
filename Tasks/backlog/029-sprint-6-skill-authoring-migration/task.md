---
id: 029
title: Sprint 6 — skill authoring and migration
status: backlog
priority: medium
depends_on: [025, 028]
created: 2026-09-10
---

# 029 — Sprint 6 — skill authoring and migration

Status: backlog · depends on 025, 028 · sprint 6 · two weeks · branch `feat/sprint-6-skill-authoring-migration` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 6. Filed 2026-09-10.

## Goal
A workspace admin composes an agent from skills they wrote, in the product.

## Scope
1. The Skill Library becomes a library: create, edit, dry-run against a chosen task, risk preview from the union of emitted actions, retire. Agent settings pick skills from the manifest; the three duplicated input tables in the frontend (`agentFit.js`, `skillInputs.js`, `taskSplit.js`) are deleted with their parity test. (ADR 003 phase 2)
2. The reporter (`digest.ceo`) and project-guide skills re-expressed as data; per-skill model pin exposed in the editor. (ADR 003 phase 3, migration half)

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| Skills | Skill Library | extend | A real library: create, edit, dry-run, risk preview, retire; today it lists the action registry |
| Skills | Agent settings → skills | extend | Pick skills from the manifest; effective actions shown as the intersection with the agent's allowed actions |
| F Routing | Agent and skill settings → model pin | extend | Per-skill pin in the editor (shared with Sprint 4) |

## Defects closed
None directly.

## Out of scope
- External reads for data skills: Sprint 11.

## Acceptance
- [ ] An admin creates a new skill, assigns it to an agent, runs it on a task and sees its outcome, with no deploy.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- The authoring surface ships in the same sprint as the last runtime piece it needs, and the owner sweeps it before merge.
- The dry-run-against-a-task control is the same pattern 021 item 12 asks for on automation rules; build it once.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
