# Handoff — where to start next session

Updated 2026-09-11. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (3dc9d97f)

- Sprint 1 (task 024) is **code-complete and merged**: PRs #566–#572, one per step. `Modules/AICore/` exists with shims at the old paths; consumers are not yet repointed. Progress ticked in `Tasks/active/024-sprint-1-shared-core-run-correctness/progress.md`.
- Sprint 0 (task 023) is **code-complete and merged**: PRs #555–#562, one per step, each with a test that reproduced its defect first. Progress ticked in `Tasks/active/023-sprint-0-stop-the-bleeding/progress.md`.
- Task 017 (agent memory and the run engine on LangGraph JS) merged via #552. ADR 003 and `docs/AI-PLATFORM-ARCHITECTURE.md` merged via #554. The twelve sprint tasks (023–032, rewritten 018/019) merged via #553.
- All gates green on merged beta: backend jest 155 suites / 1857 tests, `tests/conventions` 92, frontend vitest 129, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done.
- No open PRs. No unmerged branches with work on them.

## Still open on task 023 (needs the live environment, owner does these)

1. `npm run migrate -- up` on the dev database (migration `007-encrypt-integration-secrets`).
2. The in-process sweep with the real model: confirm every configured provider books a non-zero cost, and that an unpriced model is refused with the named reason.
3. Owner and member browser sweep of the undo deadline: run detail page and Settings → Audit log; record it in 023's progress.md, then move 023 to `done/`.

## Still open on task 024 (Sprint 1)

1. Repoint the thirteen consumers off the shim paths (`Modules/AIProjectGenerator/usage.js`, `llmProvider/`, `instructionGuard.js`, `Modules/Agents/engine/persistence.js`) onto `Modules/AICore/`, one module per PR, then delete the shims and the allowlist entries in `tests/conventions/ai-core-boundary.test.js`.
2. `npm run migrate -- up` on the dev database (migration `008-agent-run-expiry`, after 007).
3. In-process sweep with the real model; owner and member sweep of the Instance console → AI agents spend card; then move 024 to `done/`.

## Next: Sprint 2 — task 025 (`Tasks/backlog/025-sprint-2-revisions-and-skill-record/`)

Move it to `active/` and work its four steps, one PR each, from `beta`:
1. Immutable agent and skill revisions; a run pins both at start; promote and rollback endpoints; states draft, candidate, live, superseded.
2. The `agent_skills` record, its validator, the frozen catalogues, the `GET /api/v2/agents/skills` manifest, hybrid `getSkill` honouring `enabled: false`.
3. Save-time validation of emitted actions; effective actions = skill ∩ agent.allowedActions ∩ registry.
4. `brief.parse` re-expressed as a data skill.

## Things learned today that affect the next session

- Merging PRs needs the owner's say-so each session; the auto-mode classifier denies `gh pr merge` otherwise.
- Agent worktrees have no `node_modules` and cannot source nvm; give agents `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:<repo>/node_modules/.bin:$PATH"` and let them symlink the parent's `node_modules` (root and `frontend/`) without committing it. Husky's pre-push rejects a detached HEAD; rebase on a throwaway branch and push `HEAD:<branch>`.
- Every Sprint 1 step touched `agent_runs`, so parallel branches conflicted in turn; when several PRs share a schema file, merge them in order and rebase each on the freshly merged beta (an agent per rebase works well).
- The frontend builds with `vue-cli-service build`, not vite. The "magic comment" warnings in that build are pre-existing.
- Approximate permission mappings in `Modules/Agents/registry.js` (reminder.create, page.draft, docs.read, chat.post, task.link, deploy.staging) are documented in PR #560 and worth a reviewer's eye during Sprint 8.
- `markUndone` in `Modules/Agents/undo.js` still swallows its own failure; scheduled for Sprint 8 (task 031), not a Sprint 0 gap.

## Handy commands

```bash
npm run nodemon             # backend on :4000 (Node 20: source ~/.nvm/nvm.sh && nvm use 20)
cd frontend && npm run serve
npm run migrate -- status
npx jest --selectProjects unit && npx jest tests/conventions
cd frontend && npx vitest run
npm run i18n:check
```
