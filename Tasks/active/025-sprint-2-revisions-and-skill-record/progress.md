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
| 2026-09-11 | Step 1 on `feat/s2-agent-revisions`: `agent_revisions` collection, `Modules/Agents/revisions.js`, revision endpoints, run pin (`agentRevision`, `skillRevision`), migration 009, revision history panel and run-detail pin. Deviation: a settings save creates n+1 and promotes it live in one operation (today's behaviour); draft/candidate only through `POST /agents/:id/revisions`. Skill revisions pin key + module hash until step 2 makes skills data. Gates green: jest unit 1875, conventions 92, vitest 142, i18n:check, eslint. Owner API and browser sweeps still to record. |
| 2026-09-11 | Step 2 on `feat/s2-skill-record`: `agent_skills` record and validator, frozen catalogues (5 inputs, 5 readers, 9 partials, 14 emit actions), `GET /api/v2/agents/skills` + `/catalogues`, owner/admin create, update and retire, hybrid `getSkill` (data first, code second, `enabled: false` skipped), `skillSlugOf` skips disabled skills; a data skill runs end to end through the graph with the fake provider |
| 2026-09-11 | Step 3 on `feat/s2-effective-actions`: agent create and update refuse unknown (`unknown_skill`) and disabled or retired (`skill_disabled`) skill keys with field errors; `effectiveActions(agent, skill)` in `Modules/Agents/skills/effectiveActions.js` narrows every generic skill's changes in the orchestrator (code and data alike); `GET /api/v2/agents/manifest` lists agents by id with each skill's source and effective actions |
| 2026-09-11 | Step 4 on `feat/s2-brief-parse-data`: `brief.parse` written as a data skill (`Modules/Agents/skills/seeds/briefParse.js`), seeded per company by migration `010-seed-brief-parse-skill` (insert if absent, idempotent); parity test holds its proposals equal to the code skill's on four fixtures. Vocabulary learned: filters (`trim`, `clip`, `int`, `bullets`), sections `{{#x}}`/`{{^x}}`, the `emitted` root and an optional `summary` template |

## Last step
Step 1 implemented and under review (PR from `feat/s2-agent-revisions`); the owner's sweeps against the real database and browser are outstanding.
