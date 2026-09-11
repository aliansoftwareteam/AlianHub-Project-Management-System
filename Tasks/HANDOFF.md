# Handoff — where to start next session

Updated 2026-09-11 (night). Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (0afa408a, `14.36.0-beta.116`)

- **Task 035 (QA follow-ups):** merged today #632 project filters and task reads (build 108), #633 company updates and verification email (build 109), #634 e2e on beta pushes and harness fixes (build 110), #638 access tokens without the refresh token and tracker one-time codes (build 115), #640 invite links (build 111), #641 verification resend and dial code (build 113), #642 automation dispatch rejections (build 112), #644 user and company check for the caller only (build 114), #643 server-controlled company fields (build 116).
- **CI:** the `e2e` job now runs on every push to `beta` as well as on PRs; the first beta run passed.
- **Earlier today:** the QA programme (task 034) merged through build 105 and Sprint 3 (task 026) is code-complete; see their progress files.
- **Open PRs:** #635, #636, #637, #639 (held, see below), #613 (duplicate of #612, owner to close).

## Resume here first

Five pieces of work are in flight. Fix agents were pushing to these branches when the session ended; they may not have finished. For each, check the branch head and CI, read the PR's "Review fixes" section, and finish any review finding still open. The owner's local notes hold the full review data.

1. **Signup authorization fix** (`fix/signup-product-owner-mass-assignment`, critical). A PR may not exist yet. Merge it first once green, then run the audit script it adds on every deployed instance and review the accounts it lists.
2. **#639** storage uploads and profile images: a Wasabi upload regression, capture uploads, the Wasabi bucket-size cron.
3. **#637** default sprint: tenant pinning at the HTTP entry and a failed sprint reported as success.
4. **#636** webhook private-host allowlist: wider never-allowed ranges, a prefix floor, hex entries, a redirect test.
5. **#635** timesheet and invoice scoping: member regressions (task joins, the desktop tracker's Today list) and the remaining time reads.

Merge in that order and merge `origin/beta` into the rest after each merge. `frontend/src/locales/*.pending.json` conflicts resolve by keeping every key from both sides.

A separate local session was changing the unverified-login response. It must keep returning `userData._id`, which the login page's resend button needs.

## Next up after that

1. A docs PR closing task 035: tick groups 3, 4 and 6 with their builds and regenerate `docs/BETA-LOG.md`.
2. Unscheduled follow-ups in `Tasks/active/034-end-to-end-qa-programme/followups.md`: items 4, 11, 13, 14, 26, 30 and 45, 34, 35, 38, 39, 41–44, 46, 47. Owner decisions: 32 and 37.
3. Owner checks: migrations on the dev database, browser sweeps for tasks 023–026 and 033, a live OTLP collector check for 026.
4. Sprint 4 (task 027, the model router).

## Owner decisions recorded

- Only owners and admins delete agents (#620). `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10 (#609).
- The `e2e` job runs on pushes to `beta` (#634).
- Webhooks to private hosts are allowed only through an instance-owner allowlist that is empty by default (#636, pending merge).
- Timesheet reads respect an admin's "Everyone" grant in the permission matrix; members see only their own time by default (#635, pending merge).

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
