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
Contract agreed with the owner decision; workstreams A, B, C building in parallel.

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
