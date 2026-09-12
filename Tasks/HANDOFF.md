# Handoff — where to start next session

Updated 2026-09-12. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (71c9332f, `14.36.0-beta.159`)

- **Sprint 5 (task 028, the workflow engine) is closed** and moved to `Tasks/done/`. Five steps merged — #669 (build 144), #674 (149), #675 (151), #677 (152), #678 (154) — the six interface rows in #680 (155), #681 (156) and #682 (157), and the exit gate in #683 (158): a fifteen-step workflow killed at step eleven resumes there and writes every effect exactly once. Writing that gate found a real hole first: `scheduler.readySet` offered only `pending` steps, so a killed run waited for a person to press resume. Defect #17 closed — the stored hourly run limit is now the loop's admission control.
- **Sprints 0 to 4 are closed too:** 0 to 2 by #676 (build 150), 3 and 4 by #673 (148). Sprint 5 leaves task 029 (Sprint 6) as the next sprint.
- **Task 035 (QA follow-ups):** the first wave closed on the 11th; the second wave merged #649 to #656, each reproduced with a failing test before the fix. Build numbers are in `docs/BETA-LOG.md`, details in `Tasks/active/035-qa-followups/progress.md`.
- **Tasks 013 to 017 audited against the code (2026-09-12).** All five had merged to `beta` long ago behind stale prose status lines. Each now carries a real checklist keyed to its own acceptance criteria. **017 (agent memory) is closed** — all ten bullets met — and moved to `Tasks/done/`. The other four stay in `active/` with precisely one kind of gap each: 013 has three code leftovers (`main.yml` still triggers on `staging`; the tenant helper is unadopted in Trash, Instance and Tasks bulk; 107 `PermissionDesc` keys have no consumer) plus an admin and member pass that was never run; 014 and 016 are fully built and are waiting only on the member-role **browser** sweep of the `/ai` and trust-layer screens; 015 is waiting on two of its three domain briefs in the browser and on an owner decision about labelling plan-only skills as `agent`. Two orphaned follow-ups surfaced: the instruction guard's patterns (`Modules/AICore/instructionGuard.js:5-13`) do not catch "Ignore your rules…" and are recorded in no task file, and task 021's entry for `GET /api/v1/notifications/preferences` is stale because the route now exists.
- **Upgrade steps for a deployed instance:**
  1. `node scripts/audit-product-owners.js` (from #645) and review every account it marks REVIEW.
  2. Migration 013 runs at server start; it activates seats that SSO and SCIM created with the invited status.
  3. Operator routes changed shape in #655: the preset key now travels in the `x-preset-key` header, and first-install setup is `POST /api/v1/setPresetCompany`. Update runbooks and bookmarks.
  4. `TRACKER_PKCE_LEGACY_UNTIL` (from #653) is unset by default, so trackers already installed keep signing in. Set it to a date once the new tracker build has rolled out.
  5. `WORKFLOW_ENGINE` is off by default and off is today's behaviour exactly, so sprint 5 changes nothing until it is turned on. Migrations 016 (workflow runs and step runs) and 020 (workflow definitions) run at server start either way. The workflow API answers 503 with the reason while the flag is off.
- **Open PRs:** #613 only, a duplicate of the merged #612 for the owner to close.

## Next up

1. **Owner decisions**, listed in `followups.md`: item 32 (should saving a project filter for another user answer 403, as the task side does?), item 37 (who writes the subscription `invoices` collection?), item 35 (make auth cookies unreadable by JavaScript, which changes how the frontend reads them), and whether the planner's estimate permission should line up with the timesheet permissions (#656).
2. **Remaining follow-ups:** 14, 26, 55, 56 and 57, plus the new 58 — the workflow screens sit outside the AI section's chrome, so the rail goes dark on them and the builder has no way back. Items 16 and 17 belong to Sprint 8 (task 031).
3. **Owner checks still open:** migrations on the dev database; the owner and member sweep of the six sprint 5 workflow screens, which is task 028's one unmet acceptance bullet; the Stats and Upgrade sweep and the Docker label check for task 033. The 013–017 audit adds three more, all now unblocked by the demo team: the member-role browser sweep of the `/ai` screens (014) and of the trust-layer screens (016), and the admin and member pass of the day-to-day screens at 1280 and 800 px (013). One decision goes with them — whether a task an agent can only *plan* should carry a label other than `agent` (015).
4. **Then Sprint 6** (task 029, skill authoring and migration): the Skill Library becomes a real library — create, edit, dry-run, risk preview, retire — the three duplicated frontend input tables go, and the reporter and project-guide skills are re-expressed as data. It depends on 025 and 028, both now closed.

## Owner decisions recorded

- Only owners and admins delete agents (#620). `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10 (#609).
- The `e2e` job runs on pushes to `beta` (#634).
- Webhooks reach private hosts only through an instance-owner allowlist, empty by default, with metadata and link-local ranges never allowed (#647). `100.64.0.0/10` cannot be allowlisted whole; use a narrower range.
- Timesheet reads respect an admin's "Everyone" grant per screen; members see only their own time by default (#635).
- `project.project_create` is enforced for API tokens but not for web sessions (#637).
- A private sprint is visible to its assignees plus owners and admins, the rule the rest of the app already used (#656).

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
