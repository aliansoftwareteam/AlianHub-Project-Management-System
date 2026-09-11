# Progress: Sprint 2 — agent revisions and the skill record

## Checklist
One pull request per step; tick with the merge commit.

- [x] Step 1: `agent_revisions`, run pins `agentRevision` and `skillRevision` (data skills pin their version), promote and rollback endpoints, migration 009, revision history panel — #577 `ec93c373`; revision routes check skills since #580 `4d967052`
- [x] Step 2: `agent_skills` record, field-level validator, frozen catalogues, `GET /api/v2/agents/skills` manifest and catalogues, hybrid resolver — #576 `f43df39a`
- [x] Step 3: skill keys validated on agent create and update, `effectiveActions` for code and data skills, `GET /api/v2/agents/manifest` — #578 `9a63c426`; the same check on draft, promote and rollback — #580 `4d967052`
- [x] Step 4: `brief.parse` as a data skill, seeded by migration 010, parity test against the code skill — #579 `abb79e47`
- [x] Interface: Agent settings → revision history (new) — shipped in #577; owner and member sweep still to record
- [x] Interface: Run detail → pinned revision (extend) — shipped in #577; owner and member sweep still to record
- [ ] Exit gate met and gates green — code gates green on `beta` at `4d967052`; migrations 009 and 010, the in-process sweep and the owner and member sweeps still to run

## Log
| Date | Entry |
|---|---|
| 2026-09-10 | Filed from `docs/AI-PLATFORM-ARCHITECTURE.md` (sprint 2) |
| 2026-09-11 | Step 1 on `feat/s2-agent-revisions`: `agent_revisions` collection, `Modules/Agents/revisions.js`, revision endpoints, run pin (`agentRevision`, `skillRevision`), migration 009, revision history panel and run-detail pin. Deviation: a settings save creates n+1 and promotes it live in one operation (today's behaviour); draft/candidate only through `POST /agents/:id/revisions`. Skill revisions pin key + module hash until step 2 makes skills data. Gates green: jest unit 1875, conventions 92, vitest 142, i18n:check, eslint. Owner API and browser sweeps still to record. |
| 2026-09-11 | Step 2 on `feat/s2-skill-record`: `agent_skills` record and validator, frozen catalogues (5 inputs, 5 readers, 9 partials, 14 emit actions), `GET /api/v2/agents/skills` + `/catalogues`, owner/admin create, update and retire, hybrid `getSkill` (data first, code second, `enabled: false` skipped), `skillSlugOf` skips disabled skills; a data skill runs end to end through the graph with the fake provider |
| 2026-09-11 | Step 3 on `feat/s2-effective-actions`: agent create and update refuse unknown (`unknown_skill`) and disabled or retired (`skill_disabled`) skill keys with field errors; `effectiveActions(agent, skill)` in `Modules/Agents/skills/effectiveActions.js` narrows every generic skill's changes in the orchestrator (code and data alike); `GET /api/v2/agents/manifest` lists agents by id with each skill's source and effective actions |
| 2026-09-11 | Step 4 on `feat/s2-brief-parse-data`: `brief.parse` written as a data skill (`Modules/Agents/skills/seeds/briefParse.js`), seeded per company by migration `010-seed-brief-parse-skill` (insert if absent, idempotent); parity test holds its proposals equal to the code skill's on four fixtures. Vocabulary learned: filters (`trim`, `clip`, `int`, `bullets`), sections `{{#x}}`/`{{^x}}`, the `emitted` root and an optional `summary` template |
| 2026-09-11 | Steps 1–4 merged into `beta` (#576, #577, #578, #579), plus #580 closing the gap #578 left: revision routes skipped the skill check, so a draft could name an unknown skill and be promoted live. #577 and #576 each needed one rebase. Two agents stopped on the usage limit and were relaunched with no work lost. |
| 2026-09-11 | Gates on merged beta: backend unit 1965 tests, conventions 94, frontend vitest 142, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done. |
| 2026-09-11 | Deviations: a settings save still goes live in one step, and draft or candidate revisions exist only through `POST /agents/:id/revisions`; qa-review and pr.summary stay code skills because their readers are outside the vocabulary; brief.parse needed four vocabulary additions (filters, sections, the `emitted` root, a `summary` template). |

## Last step
All four steps merged. Remaining: migrations 009 and 010 on the dev database, the in-process sweep, and the owner and member sweep of the revision history panel and the run's pinned revision; then move 025 to `done/`.
