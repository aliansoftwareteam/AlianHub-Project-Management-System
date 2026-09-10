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

## 2026-09-10 — Review fixes (F2: engine, persistence, skills)
- `remember()` on a resumed thread finishes the run only while it is still `waiting_approval`; a run stopped meanwhile is abandoned, keeps its status and gets no episode. `resumeGraph` surfaces `abandoned: true`.
- `act()` re-checks the run before every perform, so stop/pause-all mid-loop halts the remaining actions; `afterAct` routes an abandoned run to END.
- `runGraph`/`resumeGraph` await `persistence.ready(companyId)`. The saver's `ttl` is a plain number of seconds — the `{ defaultTtl, refreshOnRead }` shape belongs to the store only; fixed and verified against the real MongoDB: TTL index (15552000 s) on `agent_checkpoints` and `agent_checkpoint_writes`, unique `(namespaceStr, key)` on `agent_memory`. A thread that ends without an interrupt is deleted from the checkpointer by the caller, never inside a node.
- A skill that throws fails the run with an episode built from the run row (acted = ok actions, spend from the row, `outcome` = the error) and tells memory.
- A thread parked after a failed `remember` (no interrupt, `next` non-empty) is driven on by the next resume with `invoke(null)`.
- Memory is fetched only for skills that render it: `usesMemory: false` on `qa-review`, `pr.summary`, `digest.ceo`; `brief.parse` renders a `MEMORY:` block with a DATA rule in its system prompt.
- Tests: `persistence.mongoClient()` throws under jest unless `useInMemory()` is active; `agent-revert` opts in; the reap test seeds a mid-node run and asserts `{ reaped: 1 }`; mongo-backed persistence cases (db per company, collections, one client, `close()` reset, `ready()` never rejects). `agent-proposal-atomic` seeds `runId: null`, so it never reaches persistence — left as is.
- Gates: `npm test` 140 suites / 1728 tests, lint 0 errors, `docs/ENV.md` regenerated for the new `NODE_ENV` reference.
## 2026-09-10 — Review fixes (F3, frontend)
- `useAgentPreferences`: save sends only the fields whose draft differs from the baseline and skips the request when nothing changed; candidate accept/dismiss send `{ status }` only (no `scopeId`), so the composable no longer takes `userId`.
- `useProjectMemory`: sequence token guards `load` so a slower earlier project cannot overwrite the current one (result, error and loading all gated); `updateRow`/`retireRow` send `{ projectId, … }`; a server answer with a new id replaces the row under its old id instead of appending.
- `AiInbox`: decline chip and free-text note are mutually exclusive (chip click clears the note, typing clears the chip); `DECLINE_REASONS` now imported from the shared helper.
- New `views/Ai/episodeText.js` (`DECLINE_REASONS`, `normaliseEpisode`, `declinedLine`, `episodeSummary`) used by `AgentRunDetail` and `ProjectMemoryCard`; the card builds the episode line client-side from the numeric fields through `Ai.episode_*` / `Ai.decline_reason_<key>` instead of printing the server's English `summary`, and formats `at` through `useConvertDate().convertDateFormat(at, '', { showDayName: false })` (the store-backed company format; `useMoment` has no such method).
- `AgentRunDetail`: `failed`/`skipped`/`stopped` runs show a single `Ai.episode_not_reached` line instead of an all-zero Outcome block; the episode reads `declinedReason` only.
- `MySettings`: load error renders `EmptyState` with a `Settings.agents_retry` action wired to `agentPrefs.load`; candidate chips localise the four canned keys via `Settings.agents_candidate_<key>` and fall back to the row text.
- Keys added: `Ai.episode_not_reached`, `Settings.agents_retry`, `Settings.agents_candidate_{too_many_changes,wrong_tone,needs_person,not_now}`; `npm run i18n:backfill` filled 6 per locale; `npm run i18n:check` exit 0.
- Specs: `useProjectMemory` +3 (stale guard, superseded failure, id replacement), `agentPreferences` +4 (no-op save, retry, free-text candidate, reload clears error), `agentRunDetail` +1 (unreached statuses) with `declinedReason` fixtures and a params-echoing `t`, `aiInboxDecline` mutual-exclusion case, `projectMemoryCard` localised episode assertions. vitest 17 files / 122 tests (was 115); eslint clean on touched files.
- Gates: `cd frontend && npx vitest run` 122/122, `npm run build` in `frontend/` exit 0, `npm run i18n:check` exit 0, eslint clean. Branch `fix/017-review-f3` from `feat/agent-memory` (d934aa44); not pushed.
## 2026-09-10 — Review fixes (F1: memory, prompts, proposals)
Findings fixed, by the review's numbering: 1 (project memory reaches the plan, clarify, brief, guide and tasks-plan prompts; workspace-level constraints for a new project), 2 (guide `projectId` gated by project visibility), 3 (approvals remember the executed change list), 4 (slug hash on truncation), 5 (episodes on `agent_runs`), 6 (per-section budgets; one decision per proposal for subtasks), 7 (`notify` lives only on the notification settings), 8 (agent tokens cannot read memory over REST), 9 (`PUT /memory/:id` scope contract), 10 (decline reason validated), 11 (rewording re-keys), 12 (`instructionGuard` shared by the clarifier and memory), 13 (brief parsing), 14 (candidate counting), 15 (preference text is not editable), 16 (`settleRun` hardening), 17 (this note and `contract.md`).

Deviations from the review's suggested fixes:
- 6: only `subtask.create` changes collapse into one "Approved N subtasks under "<task>"" row per proposal; `task.create`, `page.draft` and `task.sprint.move` keep one row each because their labels are the decision.
- 5: `recordEpisode` keeps its signature but `projectId` is only used for logging; the run row's `_id` is already company-scoped, and the graph passes `task.ProjectID` when the run has no project of its own, which a filter would have missed.
- 1c: a retired project constraint also retires its workspace copy only when that project is the one that first stated it; a repeat from another project only bumps the counter.
- 16: `approve` refuses with 409 "Run was stopped." only for a `stopped` run; a proposal on a `done`/`failed`/reaped run still approves (its changes are the person's decision) and the run is left as it is, with the parked thread dropped.
- 7: `Modules/notification/defaults` is required lazily inside `setAgentActivity` — at module load it pulls `utils/data` → `Modules/Sprints/controller.js`, which Babel refuses to parse under jest.
- The graph suite's `memory` mock gained `DECLINE_REASON_TEXT` (A-owned file) because `proposals.DECLINE_REASONS` is now derived from it.
- `tests/fixtures/fakeMongo.js` learned `sort`/`limit` on `find` (the review assumed it already did).

Follow-ups for other workstreams: the frontend `useProjectMemory.put()` matches rows by `id`, which now changes on a text edit (the finding at memory.js:160 noted it); `useAgentPreferences.settle` no longer needs to send `scopeId`.
