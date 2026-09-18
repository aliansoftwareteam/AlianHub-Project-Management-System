---
id: 030
title: Sprint 7 — knowledge and retrieval
status: active
priority: medium
depends_on: [024]
created: 2026-09-10
---

# 030 — Sprint 7 — knowledge and retrieval

Status: active · started 2026-09-16 · depends on 024 · sprint 7 · three weeks · one branch per slice from `beta`, running in parallel with Sprint 8 (task 031)

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
- Plan (2026-09-16), twelve pull requests in merge order: 0 Ask applies the private-sprint rule to its sources; 1 retrieval interface, lexical first, access control at query time (`KNOWLEDGE_RETRIEVAL`, off); 2 chunk store and page ingestion off the event bus; 3 comments, transcripts and workspace pages as sources; 4 file text extraction and project guides; 5 performance read action; 6 embeddings and hybrid fusion; 7 hosted vector adapter; 8 agent-scoped memory; 9 Ask "why this answer" panel; 10 instance knowledge sources console; 11 retire the regular-expression path. Parallel tracks: 0 any time; after 1: 2, 5, 9; after 2: 3, 4, 6, 8, 10; 7 after 6.
- Shared with Sprint 8 (2026-09-16): migrations 024–027 belong to this sprint and 028 onward to Sprint 8. `Config/permissionGuard.js` belongs to Sprint 8; `Modules/Agents/scope.js` and `Config/contentAccess.js` are called, not changed, by either sprint without the integrator's agreement. Each sprint keeps its own i18n namespaces.
- A departed member's private pages leave the index; their shared tasks, comments and pages stay searchable (owner, 2026-09-16).
- Pages drafted by agents are indexed and always ranked below pages people wrote (owner, 2026-09-16).
- Erasure redacts personal fields in audit rows, which sit outside the hash, so the audit chain still verifies (owner, 2026-09-16).
- Embeddings come from OpenAI (`text-embedding-3-small`) with an instance key; per-workspace keys follow Sprint 8's secrets store (owner, 2026-09-17).
- Erasure by person removes the person's private pages and the comments they wrote from the knowledge index; transcripts stay, since they hold other participants' words; the app's own records are untouched (owner, 2026-09-17).
- An agent retrieving knowledge during a run sees only what the person who started the run can see, further limited to the agent's own projects (owner, 2026-09-18).
- Hosted deployments keep vectors in MongoDB Atlas Vector Search inside each tenant's database; self-hosted installs keep the in-database cosine adapter (owner, 2026-09-18).
- The held-out question set is about thirty real questions the owner writes, each with its expected source, kept in the owner's private notes; retrieval defaults on only after the comparison passes (owner, 2026-09-18).
