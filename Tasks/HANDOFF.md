# Handoff — where to start next session

Updated 2026-09-17. Read this first, then `Tasks/index.md`. Overwrite this file at the end of every session.

## State of `beta` (45f20831, `14.36.0-beta.215`)

- **Sprints 7 and 8 run in parallel** (tasks 030 and 031, started 2026-09-16). Each `task.md` holds the slice plan in merge order, the ownership split (migrations 024–027 are Sprint 7's and 028 onward Sprint 8's; `Config/permissionGuard.js` is Sprint 8's; neither sprint changes `Modules/Agents/scope.js` or `Config/contentAccess.js` without the integrator) and every owner decision.
  - **Sprint 7 merged:** slice 0 #735 (build 210), Ask applies the private-sprint rule; slice 1 #739 (215), the retrieval interface behind `KNOWLEDGE_RETRIEVAL`, off by default.
  - **Sprint 8 merged:** slice 0b #737 (212), AI-generated lists parsed as JSON instead of evaluated; slice 0a #738 (213), tasks no longer store a session token; slice 1 #740 (214), the server permission evaluator agrees with the web app.
  - **In flight on 2026-09-17:** Sprint 7 slices 2 (chunk store and page ingestion, `KNOWLEDGE_INDEXER`, migration 025) and 9 (Ask "why this answer" panel); Sprint 8 slices 2 (report-only enforcement for web sessions, `PERMISSION_ENFORCEMENT_MODE`, migration 029) and 7 (mandatory token expiry and explicit scopes, `API_TOKEN_STRICT`).
  - **Next wave once those land:** Sprint 7 slices 3, 4, 6, 8, 10; Sprint 8 slices 3, 4, 5.
- **Task 035:** #733 (build 208), a sign-in checks the account before it opens a session. Follow-ups 65–71 are in `Tasks/active/034-end-to-end-qa-programme/followups.md`.
- **Owner's local server:** build 215, main checkout at `45f20831`, frontend built on 2026-09-16 (nothing in `frontend/src` changed since). Migrations 024 and 028 are applied there.
- **Upgrade steps for a deployed instance:**
  1. `node scripts/audit-product-owners.js` (from #645) and review every account it marks REVIEW.
  2. Migrations run at server start: 013 activates SSO and SCIM seats created as invited; 028 clears a stored field on tasks (#738); 024 creates a text index on pages (#739).
  3. Operator routes changed shape in #655: the preset key travels in the `x-preset-key` header, and first-install setup is `POST /api/v1/setPresetCompany`.
  4. `TRACKER_PKCE_LEGACY_UNTIL` (from #653) is unset by default, so installed trackers keep signing in; set a date once the new tracker build has rolled out.
  5. Flags that are off by default, where off is today's behaviour exactly: `WORKFLOW_ENGINE`, `KNOWLEDGE_RETRIEVAL`.

## Next up

1. **Merge the four in-flight slices**, each after an independent review, since all four change who may see or do what. Then start the next wave above, keeping to the file and migration ownership in the task files.
2. **Owner decisions still open:**
   - Sprint 7: where hosted vectors live (slice 7), who an agent retrieves as (slice 8 and agent use of retrieval), the held-out question set and its pass score (slice 11 and the flag default).
   - Sprint 8: what counts as a clean would-be-denial log (slices 2 and 4), a maximum token lifetime if the architecture document names none (7), the secrets key (9), in-app egress or a proxy container and what an empty allowlist means (10).
   - Older: follow-ups 32, 35, 37 and 56.
3. **Remaining follow-ups:** 14, 26, 55–64 and the new 65–71.
4. **Owner checks still open:** migrations on the dev database are current; the owner and member sweep of the six Sprint 5 workflow screens (task 028); the Stats and Upgrade sweep and the Docker label check (task 033); the member browser sweep of the `/ai` screens (014) and of the trust-layer screens (016); the admin and member pass of the day-to-day screens at 1280 and 800 px (013); every new interface row of Sprints 7 and 8 as it lands.
5. **Owner actions — an agent cannot do these:**
   - Sprint 6's two open acceptance bullets: an admin creating, assigning and running a skill end to end (needs `AI_API_KEY`), and the browser sweeps of the Skill Library, the editor, the dry-run panel and agent settings → skills.
   - The quota recompute has never been run; the stored `projectCount` values are wrong in both directions.
   - Duplicate migration 021: decide whether to renumber one to 022 together with its ledger row, or leave both and never reuse 021.
   - Two API keys pasted into a chat transcript need rotating; details stay in the owner's local notes.
   - `AI_API_KEY` is empty in `.env`, so nothing that calls a live model runs locally.

## Owner decisions recorded

- **2026-09-16/17, Sprints 7 and 8:** enforcement mode is set per workspace with the instance value as default; a departed member's private pages leave the knowledge index while shared content stays; agent-drafted pages are indexed and ranked below pages people wrote; erasure redacts personal fields in audit rows outside the hash; an audit row that changes is appended as a new chained row; the chain hash is keyed with `AUDIT_CHAIN_KEY`; existing API tokens without an expiry keep working 30 days after mandatory expiry turns on; embeddings come from OpenAI.
- Tasks 014 and 016 closed to `done/` with only their member browser sweep outstanding (2026-09-12).
- An agent task is not plan-only, so the `agent` label in `Modules/Agents/taskSplit.js` stays (2026-09-12).
- Only owners and admins delete agents (#620). `REFRESH_TOKEN_REUSE_GRACE_SECONDS` defaults to 10 (#609).
- The `e2e` job runs on pushes to `beta` (#634).
- Webhooks reach private hosts only through an instance-owner allowlist, empty by default, with metadata and link-local ranges never allowed (#647).
- Timesheet reads respect an admin's "Everyone" grant per screen; members see only their own time by default (#635).
- `project.project_create` is enforced for API tokens but not for web sessions (#637).
- A private sprint is visible to its assignees plus owners and admins (#656).

## Things learned that affect the next session

- **Review before merging anything that changes access.** On 2026-09-16 independent reviewers of green PRs found a new API-token refusal (#740 compared request ids by case), a migration that would have changed what the web app shows (#740), and access-rule tests that still passed with their rule removed (#739). Ask reviewers to prove a rule's test fails without the rule.
- **Agents end their turn while their own runs are still going.** Brief them to run `gh pr checks --watch` in the foreground and not end the turn before it finishes. If one stops anyway, read its worktree and logs, watch the run yourself, then resume it with `SendMessage`.
- **The `alianhub` MCP tools vanish from a session when localhost:4000 goes down**, and a local-scope server can only be reconnected through `/mcp`. Keep the tracker current through its HTTP endpoint meanwhile.
- **Pulling the owner's main checkout restarts nodemon**, and tracker calls during the restart come back empty. Wait for `/health` to report the new build first.
- **Unfixed security details stay out of this repo.** They live in the owner's local notes; PR bodies and committed docs stay neutral until the fix merges.
- **Parallel agents:** keep to 6–8 heavy agents with `jest --maxWorkers=2`, and check `uptime` first.
- **Never `git stash` in a worktree.** The stash stack is shared by every worktree. Set work aside with a WIP commit; agents commit with `git -c core.hooksPath=/dev/null commit` and run eslint themselves.
- **Known-failing tests flip with the fix.** A test marked `it.failing` turns CI red once its bug is fixed; the fix PR flips it by exact title.
- **Merge churn:** PRs that add i18n keys conflict on the `*.pending.json` files after each merge; resolve by keeping every key from both sides. Keep git's default merge subject, since a custom `merge:` subject fails commitlint.
- **Integration runs** need `--runInBand` locally, because `instance.int.test.js` turns maintenance mode on for the shared server.
- Agent worktrees have no `node_modules` and cannot source nvm; give agents `PATH="$HOME/.nvm/versions/node/v20.20.2/bin:<repo>/node_modules/.bin:$PATH"` or symlink the parent's `node_modules`. Husky's pre-push rejects a detached HEAD and branch names outside `<type>/<kebab>`.
- Use `grep -a`: some `.js` files are detected as binary and plain `grep` skips them. In zsh, never name a shell variable `path`.
- The frontend builds with `vue-cli-service build`; its "magic comment" warnings are pre-existing.
- **Demo team:** credentials in `.demo-accounts.local.json` at the repo root (gitignored). Session tokens come from `npm run demo:token -- --email <demo email>`; see `docs/QA-DEMO-TEAM.md`.

## Handy commands

```bash
npm run nodemon             # backend on :4000 under Node 20
cd frontend && npm run build
npm run version:show
npm run migrate -- status
npx jest --selectProjects unit conventions --maxWorkers=2
E2E_MONGODB_URL=mongodb://127.0.0.1:<own port> npx jest --selectProjects integration --runInBand
cd frontend && npx vitest run
npm run i18n:check
```
