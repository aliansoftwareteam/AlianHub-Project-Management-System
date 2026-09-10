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
