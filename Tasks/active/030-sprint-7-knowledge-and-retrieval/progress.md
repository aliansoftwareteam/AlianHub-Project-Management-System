# Progress: Sprint 7 — knowledge and retrieval

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: One retrieval interface with hybrid lexical and vector search; the lexical implementation ships first on the f
- [ ] Step 2: Ingestion off the event bus, extended to page, comment, attachment and memory events: extract, chunk on struct
- [ ] Step 3: Sources brought in order of value: page bodies, comments, meeting transcripts, uploaded files through text ext
- [ ] Step 4: The vector adapter for hosted deployments behind the interface; agent-scoped memory as a distinct scope in the
- [ ] Step 5: The regular-expression path in Ask is retired.
- [ ] Interface: Instance console → knowledge sources (new)
- [ ] Interface: Ask → citations (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 7) |
| 2026-09-16 | Started, in parallel with Sprint 8. Planned against `beta` at `cb9ce0e9` into the twelve pull requests listed under Decisions in task.md; none of the five steps existed. The owner settled three questions (departed members, agent drafts, erasure and the audit chain). Slices 0 (Ask private-sprint sources) and 1 (retrieval interface) started, each in its own worktree. |
| 2026-09-16 | Slice 0 merged: #735 `ff21c84c` (build 210), Ask's task sources apply the private-sprint rule through the shared `hiddenSprintFilter`. Slice 1 merged: #739 `45f20831` (build 215), `Modules/Knowledge` adds the retrieval interface, a per-caller visible set re-checked against live rows after ranking, and a MongoDB text-index adapter with an escaped-regex fallback, behind `KNOWLEDGE_RETRIEVAL` (off by default; with it off Ask runs exactly as before); migration 024 adds the pages text index. An independent review found no access defects, but rule tests that still passed with their rule removed and a malformed company opt-out that read as on under `all`; both were fixed before merge, each rule test proven to fail without its rule. |
| 2026-09-17 | Owner decision: embeddings come from OpenAI, which unblocks slice 6 once slice 2 merges. Slice 2 (chunk store and page ingestion off the event bus, `KNOWLEDGE_INDEXER` off by default, migration 025) and slice 9 (Ask "why this answer" panel) started. |

## Last step
Slices 0 and 1 merged (builds 210 and 215). Slices 2 and 9 in progress; after slice 2: 3, 4, 6, 8 and 10.
