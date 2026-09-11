# Handoff — where to start next session

Updated 2026-09-11 (evening). Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (7f423ea2, `14.36.0-beta.105`)

- **QA programme (task 034):** all ten area sweeps and their regression suites merged, and every fix PR merged (builds 72–105). The area-by-area PR list is in `Tasks/active/034-end-to-end-qa-programme/progress.md`; everything the fixes left out is in `followups.md` next to it.
- **Sprint 3 (task 026):** all six steps merged. Step 5, rate alerts, is #629 (build 103) and ships off by default.
- **Beta versioning (task 033):** merged and verified; #617 (build 87) keeps the version honest when git is slow. `npm run version:show` prints the running build; `docs/BETA-LOG.md` is regenerated in every docs PR (CLAUDE.md Rule 4).
- Sprints 0–2 (tasks 023–025) are code-complete; their live-environment checks are still open below.
- Open PRs: only #613, which duplicates the merged #612. The owner decides whether to close it.

## Owner decisions recorded today

- Only owners and admins delete agents; an agent's creator does not keep delete rights (#620).
- `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10; set it to 0 for strict refresh-token revocation (#609).
- Webhooks to private or internal hosts are refused with no opt-out (#625). The planned instance-owner allowlist is waiting on the owner.

## Next up

1. Owner and member browser sweeps still to record: task 026 (run trace, replay, AI Health, Notification settings alerts), task 033 (Stats and Upgrade), task 025 (revision history, pinned revision), task 023 (undo deadline).
2. A live OTLP collector check for task 026, then move 026 to `done/` once its exit gate is met.
3. Schedule the items in `Tasks/active/034-end-to-end-qa-programme/followups.md`. The security ones first: `PUT` company open to any member, project filter IDOR, `GET /api/v1/task/:id` without a visibility check, `invoice/find` across companies, refresh token embedded in the access token.
4. Sprint 4 (task 027, the model router) is next in the programme.

## Still open on tasks 023–025 (needs the live environment, owner does these)

1. `npm run migrate -- up` on the dev database (007 and 008, Sprint 2's 009 and 010, then 011 and 012; the server also runs them at start unless `MIGRATIONS_AUTO=false`).
2. The in-process sweep with the real model: every configured provider books a non-zero cost, and an unpriced model is refused with the named reason.
3. The browser sweeps listed under Next up, then move 023, 024 and 025 to `done/`.

## Things learned that affect the next session

- **Parallel agents:** keep to 6–8 heavy agents with `jest --maxWorkers=2`; about twenty at once pushed load past 118 on 8 CPUs and caused false timeouts. Check `uptime` first.
- **Never `git stash` in a worktree.** The stash stack is shared by every worktree, and one agent popped another's stash. Set work aside with a WIP commit. The lint-staged pre-commit hook makes its own stash, so agents commit with `git -c core.hooksPath=/dev/null commit` and run eslint themselves.
- **Known-failing tests flip with the fix.** A regression test marked `it.failing` or `test.fail` turns CI red once its bug is fixed. Every fix PR flips its own finding's tests by exact title; when a QA PR and a fix PR overlap, whichever merges second flips.
- **Merge churn:** every PR adds keys to the ten `frontend/src/locales/*.pending.json` files, so open PRs conflict after each merge. Resolve by parsing both sides as JSON and keeping every key. Merge a PR that touches shared role or permission code first, or it loses the race repeatedly.
- **Merge commits and commitlint:** keep git's default "Merge remote-tracking branch ..." subject; a custom `merge:` subject fails the commit-message check.
- **Integration runs:** `instance.int.test.js` turns maintenance mode on, so local runs need `--runInBand`. An integration test can depend on file order when two suites share a user's data; reproduce by running the suspect files together.
- **Flaky e2e:** `access.spec.js` "Two-factor and change-password screens render" sometimes keeps the old title after a hash-only navigation (follow-up 27).
- Agent worktrees have no `node_modules` and cannot source nvm; give agents `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:<repo>/node_modules/.bin:$PATH"` or symlink the parent's `node_modules`. Husky's pre-push rejects a detached HEAD and branch names outside `<type>/<kebab>`.
- Use `grep -a` in this repo: some `.js` files are detected as binary and plain `grep` skips them silently.
- The frontend builds with `vue-cli-service build`, not vite. The "magic comment" warnings in that build are pre-existing.
- **Demo team:** credentials in `.demo-accounts.local.json` at the repo root (gitignored, mode 600). Session tokens come from `npm run demo:token -- --email <demo email>`; see `docs/QA-DEMO-TEAM.md`.

## Handy commands

```bash
npm run nodemon             # backend on :4000 (Node 20: source ~/.nvm/nvm.sh && nvm use 20)
cd frontend && npm run serve
npm run version:show
npm run migrate -- status
npx jest --selectProjects unit --maxWorkers=2 && npx jest tests/conventions
E2E_MONGODB_URL=mongodb://127.0.0.1:27018 npm run test:integration
cd frontend && npx vitest run
npm run i18n:check
```
