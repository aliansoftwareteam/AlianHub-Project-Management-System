# 017 — Agent memory the product owns

Status: backlog · depends on 015, 016 · branch `feat/agent-memory` (from `beta`)

## Goal
The second project in a workspace is briefed and planned better than the first, because the agents remember what this workspace decided, prefers and has already been told.

## Shape (from research [57][58][59][60])
- **Semantic, per project:** decisions and constraints, written by the brief step and by approved proposals; small, block-sized, shown on the project page and editable.
- **Semantic, per user:** preferences (tone, review depth, notify), written from settings and from repeated decline reasons.
- **Episodic, per run:** what was proposed, approved, declined, reverted, and why; generalises the existing finding memory.
- **Read path:** brief scorer, plan and guide prompts receive the project and user blocks and the last N episodic entries as context; never the raw run log.
- **Recompute, never store:** counts, assignee load, due dates — fetched at use time.

## Out of scope
- Vector search; the blocks are small and keyed. Revisit if a workspace exceeds a few hundred entries per project.
- Cross-workspace memory.

## Acceptance
- [ ] Approving a proposal that changes a project decision writes the decision block; the next plan for that project reflects it (test with a fixed prompt and a fake model).
- [ ] A user who declined three proposals for the same reason sees that reason offered as a preference.
- [ ] Memory is company-scoped; a test proves no cross-company read.
- [ ] Project page shows and lets the owner edit what the agents remember.
