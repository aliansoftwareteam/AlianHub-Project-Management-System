# Agents roadmap — from the 2026-09-05 research

> The table below was delivered through task 017 (PR #552). The programme that follows it is the sprint plan filed on 2026-09-10; see "Sprint programme" at the end.

Source: `Tasks/active/015-guided-project-brief/research.md` (74 sources). Principle: every slice merges to `beta` behind the existing agents flag with the three gates (static review, API sweep, browser sweep) inside the task. One release from beta to main at the end of the programme (owner decision, 2026-09-05).

| Order | Task | Slice delivers | Size | Bet from the research |
|---|---|---|---|---|
| 0 | 014 (PR #543) | AI hub fixes on beta; member sweep | done except member sweep | — |
| 1 ∥ | 015 | Complete brief, agent-drafted and approved; agent / person split per task; Guide agent per project | 2 weeks | 1 · generated guide per project |
| 1 ∥ | 016 | Risk rating per action; policy-reviewed L2 that escalates only risky actions; whole-run revert with owner-set window; per-company budget ledger with 80/100% alerts; model and region in the instance console | 3 weeks | 2 · graded autonomy, 3 · reversible events, 6 · self-hosting |
| 3 | 017 | Project memory (decisions, constraints), user preferences, episodic run record; read by brief, plan and guide prompts | 2 weeks | 4 · memory the product owns |
| 4 | 018 | OAuth 2.1 and scopes on the MCP server; more of the data model exposed; inbound external agent sessions (Claude Code first) with typed activities; delegation keeps a human assignee | 3 weeks | 5 · MCP both ways |
| ∥ | 019 | Eval set of 20–50 real tasks graded on outcome, replayed on every prompt change; one trace per run; /ai dashboard | starts with 016, ongoing | evals and observability |

Why this order: 015 and 016 run in parallel (owner decision, 2026-09-05) — 015 is the user-visible promise and its evidence gate is cheap, 016 is what makes L2 safe enough to leave on; 017 needs 015's brief and 016's run records to have something to remember; 018 is the largest external surface and benefits from everything before it being stable; 019 runs alongside from 016 because the policy engine needs measurements to tune.

## Decisions (owner, 2026-09-05)
- 015 and 016 run in parallel, each on its own branch from `beta`, separate agent teams.
- A new agent defaults to **L1 Suggest**.
- All slices land on `beta`; one release to `main` at the end.
- PR #543 (014) merges now; the member-role sweep happens on beta before the release.

## File ownership while 015 and 016 run together
| Owner | Files |
|---|---|
| 016 | `Modules/Agents/{actions,runs,policy,controller}.js` (run and agent endpoints), `Modules/Agents/agentAudit.js`, budget code, instance console panels, `views/Ai/AgentSettings.vue`, run detail views |
| 015 | `Modules/AIProjectGenerator/**`, `Modules/Agents/taskSplit.js`, `Modules/Agents/skills/projectGuide.js`, `AiProjectCreator.vue`, the `AiProject` locale namespace |
| Shared, integrator merges | `Modules/Agents/routes.js` (each adds its own lines), `frontend/src/locales/en.js` (separate namespaces), `frontend/src/views/Ai/agentFit.js` (015 only reads it; 016 does not touch it) |

015's execute hook into `runs.create` uses the public functions of runs.js as they are on beta today; if 016 changes their signatures, 016 updates the call site at merge.

## Sprint programme (owner decision 2026-09-10)

Source: `docs/AI-PLATFORM-ARCHITECTURE.md`. One task per sprint, one pull request per step, everything on `beta` behind flags, one release to `main` at the end. Sprints 7 and 8 can run on a parallel track.

| Sprint | Task | Delivers | Size | Needs | Status |
|---|---|---|---|---|---|
| 0 | 023 | stop the bleeding: exploitable findings and cost correctness | one week | — | done |
| 1 | 024 | shared AI core and run correctness | two weeks | 023 | done |
| 2 | 025 | agent revisions and the skill record | two weeks | 024 | done |
| 3 | 026 | observability foundation | two weeks | 024 | done |
| 4 | 027 | the model router | two weeks | 024, 026 | done |
| 5 | 028 | the workflow engine | three weeks | 024, 027 | done |
| 6 | 029 | skill authoring and migration | two weeks | 025, 028 | next |
| 7 | 030 | knowledge and retrieval | three weeks | 024 | backlog |
| 8 | 031 | security hardening | three weeks | 024 | backlog |
| 9 | 019 | evals and routing measurement | two weeks | 026, 027, 030 | backlog |
| 10 | 018 | external agents: OAuth, scopes, delegation | three weeks | 028, 031 | backlog |
| 11 | 032 | data skills reach outside (ADR 003 phase 4) | two weeks | 029, 031 | backlog |

Totals: 12 tasks, 55 steps, about 27 weeks of engineering. Sprints 0 to 5 are delivered — tasks 023, 024, 025, 026, 027 and 028 are all in `Tasks/done/`, Sprint 5 closed by PR #684 (merge `71c9332f`, build 159) — Sprint 6 (task 029) is next, and Sprints 7 to 11 are backlog. Existing 018 and 019 were rewritten as Sprints 10 and 9; Sprint 11 (ADR 003 phase 4) was added because the document's plan had no home for it.
