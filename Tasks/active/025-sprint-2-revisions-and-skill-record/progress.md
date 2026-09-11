# Progress: Sprint 2 — agent revisions and the skill record

## Checklist
One pull request per step; tick with the merge commit.

- [ ] Step 1: Agent revisions and skill revisions as immutable documents; a run pins both at start; promote and roll back ar
- [ ] Step 2: The skill record, its validator returning field-level errors like the automation rule validator, the frozen ca
- [ ] Step 3: Save-time validation of emitted actions, and the effective-actions intersection with the agent's allowed actio
- [ ] Step 4: The intake skill
- [ ] Interface: Agent settings → revision history (new)
- [ ] Interface: Run detail → pinned revision (extend)
- [ ] Exit gate met and gates green

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 2) |
| 2026-09-11 | Step 2 on `feat/s2-skill-record`: `agent_skills` record and validator, frozen catalogues (5 inputs, 5 readers, 9 partials, 14 emit actions), `GET /api/v2/agents/skills` + `/catalogues`, owner/admin create, update and retire, hybrid `getSkill` (data first, code second, `enabled: false` skipped), `skillSlugOf` skips disabled skills; a data skill runs end to end through the graph with the fake provider |

## Last step
Not started.
