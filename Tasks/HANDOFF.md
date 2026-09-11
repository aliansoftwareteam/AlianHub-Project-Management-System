# Handoff — where to start next session

Updated 2026-09-11. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (4d967052)

- Sprint 2 (task 025) is **code-complete and merged**: PRs #576–#580. Agents have immutable revisions pinned per run, skills are data with a validator and manifest, and `brief.parse` runs as a data skill. Progress ticked in `Tasks/active/025-sprint-2-revisions-and-skill-record/progress.md`.
- The AI-core shims are gone (#575); every consumer requires `Modules/AICore/` and a conventions test rejects the old paths.
- Sprint 1 (task 024) is **code-complete and merged**: PRs #566–#572, one per step. `Modules/AICore/` exists with shims at the old paths; consumers are not yet repointed. Progress ticked in `Tasks/active/024-sprint-1-shared-core-run-correctness/progress.md`.
- Sprint 0 (task 023) is **code-complete and merged**: PRs #555–#562, one per step, each with a test that reproduced its defect first. Progress ticked in `Tasks/active/023-sprint-0-stop-the-bleeding/progress.md`.
- Task 017 (agent memory and the run engine on LangGraph JS) merged via #552. ADR 003 and `docs/AI-PLATFORM-ARCHITECTURE.md` merged via #554. The twelve sprint tasks (023–032, rewritten 018/019) merged via #553.
- All gates green on merged beta: backend jest 1965 tests, `tests/conventions` 94, frontend vitest 142, `npm run i18n:check` exit 0, eslint 0 errors, `vue-cli-service build` done.
- No open PRs. No unmerged branches with work on them.

## Still open on task 023 (needs the live environment, owner does these)

1. `npm run migrate -- up` on the dev database (migration `007-encrypt-integration-secrets`).
2. The in-process sweep with the real model: confirm every configured provider books a non-zero cost, and that an unpriced model is refused with the named reason.
3. Owner and member browser sweep of the undo deadline: run detail page and Settings → Audit log; record it in 023's progress.md, then move 023 to `done/`.

## In flight (2026-09-11, afternoon)

- **Sprint 3 (task 026) is active.** Five agents build steps 1, 2, 3, 4 and 6 in parallel: OpenTelemetry and trace ids with the run trace view, the replay record and replay view, the metrics endpoint and AI hub health, provider error codes, and the single exception path. Step 5 (rate alerts) starts once metrics merge.
- **QA programme (task 034) is active.** Wave 1: the demo IT team seed for the local database and the Playwright plus real-database harness with a CI job. Area waves (ten areas, sweep plus suite) start when both merge.
- **Versioning (task 033) is merged.** Every merge to beta is a numbered build (`npm run version:show`). After merges, run `npm run version:log` and commit `docs/BETA-LOG.md` in the follow-up docs PR (CLAUDE.md Rule 4).

## Still open on task 024 (Sprint 1)

1. Run the migrations on the dev database: `npm run migrate -- up` (007 and 008, then Sprint 2's 009 and 010).
2. In-process sweep with the real model; owner and member sweep of Instance console → AI agents spend card; then move 024 to `done/`.

## Still open on task 025 (Sprint 2)

1. Owner and member sweep of Agent settings → revision history and Run detail → pinned revision.
2. In-process sweep: change an agent, promote and roll back a revision, start a run and confirm it names its revision; run `brief.parse` on a real task through the seeded data skill.
3. Then move 025 to `done/`.

## Next: Sprint 3 — task 026 (`Tasks/backlog/026-sprint-3-observability-foundation/`)

Move it to `active/` and work its steps, one PR each, from `beta`:

1. OpenTelemetry with the trace identifier on the run row, every step row, every audit row and every log line; logs move to structured records; the exporter is off unless an endpoint is configured.
2. The replay record per model call: prompt hash and reference, retrieved chunk identifiers, raw response, model and parameters, agent and skill revisions, with a retention and redaction policy. (absorbs 019 "trace per run")
3. A metrics endpoint behind admin auth: rate, errors and duration per workflow, step, agent and model; token and cost counters; approval, decline and revert rates. (absorbs 019 "dashboard in /ai", the health half)
4. Provider error codes preserved end to end and grouped, so an error tracker has something to group.
5. Alerts on rates: error rate per agent, approval rate falling, cost against forecast, queue age.
6. (added) The two competing uncaught-exception handlers collapse into one path that reports, flushes and exits.

## Things learned today that affect the next session

- Background agents can stop on the account usage limit mid-task. Check the remote branch and the worktree before relaunching; so far none had pushed partial work.
- Use `grep -a` in this repo: some `.js` files are detected as binary and plain `grep` skips them silently.

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
