# 017 — progress

Branch `feat/agent-memory` (from `beta` 64f4f507).

## 2026-09-10 — research and PRD
- Four parallel read-only sweeps: agent backend (finding memory, runs, proposals, schema pattern, tests), project generator prompts (injection points per prompt, fake-model pattern), frontend surfaces (project detail tab, My Settings, Inbox decline, run detail), and a stale-task / open-PR audit.
- `task.md` rewritten as the PRD from the findings; `contract.md` drafted. Both wait for the owner's answer on the LangChain question (engine on LangGraph or not) before build.
- Housekeeping done: five merged agent worktrees removed.

## Checklist
- [ ] Owner confirms PRD and the LangChain decision
- [ ] A. store + registration + `memory.js`
- [ ] B. writers (brief, approve, decline reason, episode, owner)
- [ ] C. read path in five prompts + generic skills
- [ ] D. UI (project card, My Settings, Inbox reason, run detail episode)
- [ ] Gates + owner browser sweep

## Last step
Workstreams merged and green; review workflow and sweeps in progress.

## 2026-09-10 — owner decision: build on LangChain
- LangGraph JS is the engine and the store (see task.md "Decision"); PRD and contract rewritten for it.
- Spike in the scratchpad: CommonJS load, interrupt/resume, per-db store all work.
- Landed: `@langchain/langgraph`, `@langchain/core`, `@langchain/langgraph-checkpoint-mongodb` in package.json; `Modules/Agents/engine/persistence.js` with `tests/agent-persistence.test.js` (4 passing).
- Three workstreams (A engine, B memory + prompts, C frontend) start on worktrees from this branch.

## 2026-09-10 — B: memory module, API, prompt injection
- `Modules/Agents/memory.js` on `persistence.storeFor`: `contextFor`, `remember`, `find`, `update`, `retire`, `recordEpisode`, `listProject`, `listUser`, `setPreference`, `preferenceCandidate`, `fromBrief`, `rememberApprovedChanges`. Rows are never deleted; a repeat sighting bumps the counter.
- `Modules/Agents/memoryController.js` + five routes in `routes.js` (project memory GET/POST, `PUT /memory/:id` with body `scopeId`, preferences GET/PUT). `notify` mirrors the `agentActivity` switch on the notification settings.
- Prompts: `prompts/shared/memory-handling.md` appended to the coverage, clarify, brief and plan systems; a paragraph in `guide/system.md`; the block injected at coverage (workspace defaults, not counted), clarify (before coverage), brief (after coverage), plan (after the approved assumptions) and the guide (`## What this workspace has decided before`). `executeAgents.start` writes the brief rows; `projectGuide` renders `MEMORY:` from `context.memory`.
- Tests: `agent-memory-store` (22), `agent-memory-api` (12), `ai-project-memory` (9), plus a `MEMORY:` case in `agent-skills` and `ai-project-guide`.
- Deviations from the contract: a fourth preference status `counting` for 1–2 declines; `update`/`retire` take `scopeId` (the row id alone does not name the namespace); `preferenceCandidate` returns the row with `promoted`.

## 2026-09-10 — three workstreams merged (commits 1f1a70cc C, fbc4170a A, 8e3060b0 B, 650f4e41 single-fetch)
| Workstream | What landed | Tests |
|---|---|---|
| A engine | `engine/graph.js` StateGraph gather → analyse → review → act → propose → hold (interrupt) → remember; `executeSkill` delegates; approve/decline resume the thread, fall back to `runs.finish` for pre-graph runs; `declineReason`, `episode`, `threadId` declared; revert updates the episode | `agent-graph` 14; existing run/proposal suites adjusted to mock `gather`/`analyse` |
| B memory | `memory.js` on the LangGraph store (contextFor, remember, update/retire, recordEpisode, listProject/listUser, preferenceCandidate, fromBrief, rememberApprovedChanges); `memoryController.js` five routes; memory block in coverage/clarify/brief/plan/guide prompts and the guide skill; `prompts/shared/memory-handling.md` | `agent-memory-store` 22, `agent-memory-api` 12, `ai-project-memory` 9 |
| C frontend | ProjectMemoryCard on the project detail tab; My Settings "AI agents" card with decline candidates; Inbox decline reason step; run detail Outcome block | vitest 115 (+31) |

Gates on the merged branch: `npm test` 140 suites / 1716 tests, lint 0 errors, vitest 115, `npm run i18n:check` clean after moving 21 `Settings.agents_*` keys that had landed inside `PermissionMode` (a3b95c54), frontend build ok. Persistence round-trips against the real MongoDB (store writes `agent_memory` in the company db).

Deviations recorded by the workstreams: propose/hold are two nodes (a resumed node re-runs from its first line); preference rows carry a `counting` status before `candidate`; `PUT /memory/:id` bodies carry `scopeId`; `notify` mirrors `agentActivity` on notification settings; episodes are written for skipped/failed runs too.

Open: adversarial review workflow running; in-process sweep against the real db and model; owner UI sweep once logged in on the Browser pane.
