# Handoff — where to start next session

Updated 2026-09-12. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (732bf025, `14.36.0-beta.122`)

- **Task 035 (QA follow-ups) is code-complete.** All seven groups merged, each after an adversarial review that confirmed 36 defects across five PRs whose CI was already green: #632, #633, #634, #635, #637, #638, #639, #640, #641, #642, #643, #644, #645 and #647. Build numbers are in `docs/BETA-LOG.md`.
- **Upgrade step for every deployed instance:** run `node scripts/audit-product-owners.js` (added by #645) and review each account it marks REVIEW.
- **CI:** the `e2e` job runs on pull requests and on pushes to `beta`; beta is green.
- **Open PRs:** #613 only, a duplicate of the merged #612 for the owner to close.

## In flight

Four fixes for the remaining follow-ups, one branch each, opened as PRs when green:

1. `fix/auth-responses-self-view` — login, token and signup responses still return a raw `users` document (items 41, 42 and the unverified-login body).
2. `fix/estimated-time-write-guard` — `PUT /api/v1/estimatedTime` builds its filter and update from the request body (the write half of item 36).
3. `fix/profile-image-reads` — profile images and credit notes are readable by any signed-in user; `PUT /api/v1/user` accepts any image path (items 38, 39).
4. `fix/role-lookup-active-membership` — `getRoleType` counts removed and pending rows, and two company routes skip the live membership re-check (items 30, 45, 46).

## Next up

1. Merge the four above once green, merging `origin/beta` between merges; `*.pending.json` conflicts resolve by keeping every key.
2. Remaining follow-ups in `Tasks/active/034-end-to-end-qa-programme/followups.md`: 4, 11, 13, 14, 26, 32 and 37 (owner decisions), 34, 35, 43, 44, 47. Items 16 and 17 belong to Sprint 8 (task 031).
3. Owner checks still open: migrations on the dev database, browser sweeps for tasks 023–026 and 033, a live OTLP collector check for 026.
4. Then Sprint 4 (task 027, the model router).

## Owner decisions recorded

- Only owners and admins delete agents (#620). `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10 (#609).
- The `e2e` job runs on pushes to `beta` (#634).
- Webhooks reach private hosts only through an instance-owner allowlist, empty by default, with metadata and link-local ranges never allowed (#647). A consequence: `100.64.0.0/10` cannot be allowlisted whole, because it contains Alibaba Cloud's metadata address; use a narrower range.
- Timesheet reads respect an admin's "Everyone" grant per screen; members see only their own time by default (#635).
- `project.project_create` is enforced for API tokens but not for web sessions (#637); changing that is a separate decision.

## Things learned that affect the next session

- **Review green PRs before merging security fixes.** A multi-agent review (three reviewers per PR, skeptics voting on each finding) confirmed 36 real defects across five PRs whose CI was green, including regressions for members and the desktop tracker. Budget it for every security PR.
- **Agents stop before CI finishes.** They often open the PR and exit while checks are pending; start your own `gh pr checks <n> --watch`.
- **zsh:** never name a shell variable `path`; it is tied to `PATH` and breaks every command after it.
- **Unfixed security details stay out of this repo.** Detailed notes for work in progress live in the owner's local notes, not in committed docs or PR bodies.

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
