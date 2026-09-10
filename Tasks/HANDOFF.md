# Handoff — where to start next session

Updated 2026-09-10. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (94dc7df7)

- Sprint 0 (task 023) is **code-complete and merged**: PRs #555–#562, one per step, each with a test that reproduced its defect first. Progress ticked in `Tasks/active/023-sprint-0-stop-the-bleeding/progress.md`.
- Task 017 (agent memory and the run engine on LangGraph JS) merged via #552. ADR 003 and `docs/AI-PLATFORM-ARCHITECTURE.md` merged via #554. The twelve sprint tasks (023–032, rewritten 018/019) merged via #553.
- All gates green on merged beta: backend jest 144 suites / 1766 tests, `tests/conventions` 88, frontend vitest 126, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done.
- No open PRs. No unmerged branches with work on them.

## Still open on task 023 (needs the live environment, owner does these)

1. `npm run migrate -- up` on the dev database (migration `007-encrypt-integration-secrets`).
2. The in-process sweep with the real model: confirm every configured provider books a non-zero cost, and that an unpriced model is refused with the named reason.
3. Owner and member browser sweep of the undo deadline: run detail page and Settings → Audit log; record it in 023's progress.md, then move 023 to `done/`.

## Next: Sprint 1 — task 024 (`Tasks/backlog/024-sprint-1-shared-core-run-correctness/`)

Move it to `active/` and work the seven scope steps, one PR each, from `beta`:
1. `Modules/AICore/` with re-export shims (provider factory, usage/pricing, instruction guard, single model call, persistence factory); `Modules/ProjectTemplates/controller.js` onto the factory.
2. Run idempotency key + in-flight claim (partial unique index, duplicate-key catch) and a reaper for proposals stuck in applying.
3. Job lock aligned with the model timeout; missing server timeouts set.
4. Loop depth threaded from the envelope through agent actions (`Modules/Agents/actions.js` context).
5. Spend recorded at the core boundary for every AI feature.
6. Run spend cap checked before the model call from a token estimate, reconciled after.
7. `agent_runs` TTL keyed to terminal status only (`utils/mongo-handler/createSchema.js`).

Cross-links to tick when done: 006 progress "Budgets enforced pre-call + usage accounting" (step 5) and "Evaluate `run.spendCapUsd` before the model call" (step 6).

## Things learned today that affect the next session

- Merging PRs needs the owner's say-so each session; the auto-mode classifier denies `gh pr merge` otherwise.
- Agent worktrees have no `node_modules` and cannot source nvm; give agents `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:<repo>/node_modules/.bin:$PATH"` and let them symlink the parent's `node_modules` (root and `frontend/`) without committing it. Husky's pre-push rejects a detached HEAD; rebase on a throwaway branch and push `HEAD:<branch>`.
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
