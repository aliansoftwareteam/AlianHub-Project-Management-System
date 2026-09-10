---
id: 030
title: Sprint 7 — knowledge and retrieval
status: backlog
priority: medium
depends_on: [024]
created: 2026-09-10
---

# 030 — Sprint 7 — knowledge and retrieval

Status: backlog · depends on 024 · sprint 7 · three weeks · branch `feat/sprint-7-knowledge-and-retrieval` (from `beta`)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`, "Development and integration plan", Sprint 7. Filed 2026-09-10.

## Goal
Agents and Ask can reach what the workspace actually knows, and only what the caller may see.

## Scope
1. One retrieval interface with hybrid lexical and vector search; the lexical implementation ships first on the full-text indexes that already exist, with access control applied at query time from the caller's visible set.
2. Ingestion off the event bus, extended to page, comment, attachment and memory events: extract, chunk on structure, embed, upsert against a content hash; tombstone on delete; cascade on project and user deletion; embedding model version on every chunk; an erasure path.
3. Sources brought in order of value: page bodies, comments, meeting transcripts, uploaded files through text extraction, project guides, and workspace-level pages that have no project. Structured performance data is reached through a registry read action, not embedded.
4. The vector adapter for hosted deployments behind the interface; agent-scoped memory as a distinct scope in the store.
5. The regular-expression path in Ask is retired.

## Interface
| Area | Surface | State | Delivers |
|---|---|---|---|
| E Knowledge | Instance console → knowledge sources | new | Sources indexed per workspace, freshness and size, embedding model, re-index and erasure controls |
| E Knowledge | Ask → citations | extend | Citations reflect the caller's visibility; a "why this answer" panel lists the retrieved passages with source and permission |

## Defects closed
None directly.

## Out of scope
- Anything in another sprint's scope.

## Acceptance
- [ ] A question about a private page is answered for its owner and not for a colleague; a deleted page disappears from answers within a minute.
- [ ] Every interface row above swept by the owner and by a member.
- [ ] Gates: `npm test`, vitest, `npm run i18n:check` after backfill, lint 0 errors, frontend build, the in-process sweep against the real database and model, and the owner's API and browser sweeps recorded in progress.md before merge.

## Decisions
- The index is built per tenant by a background migration; retrieval is flagged per tenant; answer quality is compared on a held-out set of real questions before the flag defaults on.
- Branch from `beta`, one slice per pull request, checks green before merge. New behaviour behind a flag whose default reproduces today. Schema fields declared before the first write; any shape change ships its migration in the same pull request. Deviations from the plan and their reasons recorded here.
