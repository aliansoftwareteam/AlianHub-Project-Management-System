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

## Last step
Slices 0 and 1 in progress.
