# 013 — progress

Branch `feat/maintainable-system`, merged to `beta` as PR #542, merge commit `d75df67b`, build `14.36.0-beta.19`.

Per-workstream detail stays in `progress-A.md`, `progress-B.md`, `progress-C.md` and `progress-integration.md`. This file is the checkable record.

## Checklist

Derived from `task.md`: the workstream deliverables A.1–A.5, B.1–B.8, C.1–C.7, and the five bullets of "Verification (end to end)" as V1–V5. Everything ticked landed in `d75df67b` (#542). State verified against `origin/beta` at `71c9332f` on 2026-09-12.

**A — admin & operations**

- [x] A.1 First-run inside the app — `Modules/Setup/routes.js` serves `GET /api/v2/setup/status`, `POST /api/v2/setup/complete` and the SSE `/events/:id`, registered at `index.js:230` outside `initializeControllers`; `Modules/CheckInstallStep` deleted; `frontend/src/views/Setup/SetupWizard.vue` routed at `/setup` (`router/auth/index.js:4`) behind the `router/setupStatus.js` guard — `d75df67b` (#542)
- [x] A.2 Instance console — `Modules/Instance/` with `guard.js`, `probes.js`, `settingsCatalog.js`, `backups.js`, `health.js`, `logsPath.js`, `maintenance.js`; `routes.js` serves public-config, settings GET/PUT, health, upgrade, migrations/run, logs and the six backup routes; all seven `frontend/src/views/Settings/Instance/*.vue` pages exist and are routed at `router/settings/index.js:177` — `d75df67b` (#542)
- [x] A.3 Migrations — `migrations/index.js` runner plus 20 numbered migrations, `migrations/store.js`, `scripts/migrate.js status|up|down` and the `migrate` / `migrate:status` npm scripts — `d75df67b` (#542)
- [x] A.4 Hardening — helmet behind `HELMET_ENABLED` (`index.js:29`), rate limit from `GLOBAL_RATE_LIMIT_PER_MIN` (`index.js:39`), `trust proxy` from `TRUST_PROXY` (`index.js:23`); `under-maintenance/` deleted and replaced by `Modules/Instance/maintenance.js` mounted at `index.js:63` — `d75df67b` (#542)
- [x] A.5 `docs/ADMIN-GUIDE.md` — exists with all eight promised anchors (#install, #first-run, #configure, #https, #upgrade, #backup-restore, #troubleshooting, #reference) — `d75df67b` (#542)

**B — developer maintainability**

- [x] B.1 Hygiene — `.tmp-pr515/` deleted in the 2026-09-10 housekeeping PR; `scripts/unused-components.js` exists and is asserted at zero by `tests/conventions/unused-components.test.js` — `d75df67b` (#542)
- [ ] B.2 Gates — **partly delivered.** `.github/workflows/ci.yml` is there and green (backend `npm ci && npm run lint && npm test`; frontend lint, vitest and build; plus an e2e job), Node 20, on PR and push to `beta`/`main`/`staging`; root `.eslintrc.cjs` and the `unit` + `conventions` jest projects are in place. **Outstanding:** `task.md` asked for `main.yml` to trigger on push to `main` only; `.github/workflows/main.yml:7` still triggers on push to `staging`.
- [x] B.3 Dead code — `dashboard-old`, `ProjectListing`, `section-left` are all at zero hits across `frontend/src`, `index.js`, `scripts` and `Dockerfile`; `installation/` and `under-maintenance/` are untracked by git (`git ls-files` count 0). The literal task.md grep returns 23, but every hit is the English word "installation" in prose — 21 in `frontend/src/locales/*`, one in `scripts/env-doc.meta.json`, one in a `scripts/dev.js` message — `d75df67b` (#542)
- [x] B.4 Tenant scoping — done 2026-09-27 (PR #1052). All four modules `task.md` named read the verified company: `Modules/createProject/controller.js` earlier, and now `Modules/Trash/controller.js` and `Modules/Instance/controller.js` (audit export: an explicit admin `companyId` is annotated, the header goes through `tenantOf`), plus the bulk task route, whose `companyId` comes from `validatedCompanyOf` in `Modules/Tasks/helpers/taskWriteFields.js`. The baseline is empty since #928. The convention now also counts `req.query?.companyId` and keeps the Trash and Instance controllers off direct header reads.
- [x] B.5 Observability — `Config/requestContext.js`, `Config/requestLog.js` (mounted at `index.js:56`), `Config/errorHandler.js` and `Config/respond.js` all exist — `d75df67b` (#542)
- [x] B.6 Project tree migration — `ProjectListing.vue` and `ProjectListComponent.vue` are gone; `frontend/src/views/Projects/composables/useProjectTree.js` exists with `frontend/tests/useProjectTree.spec.js` — `d75df67b` (#542)
- [x] B.7 i18n namespaces — `grep -c "V2: {" frontend/src/locales/en.js` is 0; `scripts/i18n-rename-namespace.js` and `tests/conventions/i18n-namespaces.test.js` exist — `d75df67b` (#542)
- [x] B.8 Docs from code — `scripts/env-doc.js` + `scripts/env-doc.meta.json` regenerate `docs/ENV.md`; `docs/DEVELOPER-GUIDE.md` exists; `find Modules -name routes2.js` returns nothing — `d75df67b` (#542)

**C — day-to-day usability**

- [x] C.1 Navigation — `frontend/src/components/organisms/Shell/navItems.js:32-42` carries all nine rail items (home, projects, inbox, planner, chat, ai, docs, dash, time); the project More menu is grouped and `components/organisms/ImportDialog/ImportDialog.vue` exists — `d75df67b` (#542)
- [x] C.2 "+ New" in the project header — `frontend/src/views/Projects/components/NewInProjectMenu.vue` — `d75df67b` (#542)
- [x] C.3 Project apps — `frontend/src/components/molecules/ProjectAppsList/ProjectAppsList.vue` — `d75df67b` (#542)
- [x] C.4 Tidy-up — `frontend/src/utils/lifecycle.js`, `Modules/Trash/` (routes + controller, mounted at `index.js:157`), `frontend/src/views/Trash/TrashPage.vue` — `d75df67b` (#542)
- [x] C.5 Onboarding for every role — `frontend/src/composable/useOnboardingChecklist.js`, one tour system in `components/organisms/Tour/tourSteps.js` with `tests/tour-selectors.test.js`; `DELETE /api/v2/sample-data` at `Modules/Trash/routes.js:7` — `d75df67b` (#542)
- [x] C.6 i18n discipline — `scripts/i18n-check.js`, `scripts/i18n-backfill.js`, `scripts/i18n-allowlist.json`, `tests/conventions/i18n-check.test.js`; the rule is in `CLAUDE.md` — `d75df67b` (#542)
- [x] C.7 Open dogfood fixes — recorded per fix in `progress-C.md` (own-update refresh, notification defaults, priority icon fallback, labelled sprint-report select) — `d75df67b` (#542)

**Verification (end to end)**

- [x] V1 Gate on every merge — `ci.yml` runs backend lint + `npm test` (the `unit` and `conventions` projects, so `env-doc`, `i18n-check`, `unused-components` and the tenant ratchet are all inside it) and frontend lint + vitest + build on every push to `beta`. All checks pass on the tip of `beta`: `gh pr checks 684` → backend, frontend and e2e all green at `71c9332f`
- [ ] V2 Admin path (empty Mongo → `#/setup`, Docker compose healthy, settings save and masking, backup + restore drill, `curl /health` 200/503, a Member never seeing the Instance group) — **delivered and evidenced at merge time**, in `progress-integration.md` (fresh-instance drill, backup/restore drill, Docker drill, Instance console browser pass). **State unknown today:** none of it has been re-run against the current `beta`, and the "a Member never sees the Instance group" half was never evidenced against a real member account
- [x] V3 Developer path — the three structural greps are at zero (B.3 above), `routes2.js` is gone, the `V2: {` count is zero; `X-Request-Id` and the forced-500 round trip were evidenced in `progress-integration.md` ("Gate after B"); a failing test is blocked by `ci.yml` — `d75df67b` (#542)
- [ ] V4 Team path at 1280 and 800 px as **owner, admin and member** — **partly delivered.** The owner half is evidenced in `progress-integration.md` (Home, project at 800 px, Settings → Projects, bulk delete → Trash → restore, project switcher at 1440). **Outstanding:** there is no record anywhere in this task of the admin or the member pass, nor of the `fr` locale sweep the bullet asks for
- [x] V5 Backend tests added — all 14 named suites exist: `migrations-runner`, `instance-settings-catalog`, `setup-status`, `health`, `logs-path`, `backup-manifest`, `tasks-bulk-archive-trash`, `trash-controller`, `lifecycle-mapping`, `conventions/tenant-scoping`, `conventions/i18n-namespaces`, `conventions/i18n-check`, `conventions/unused-components`, `conventions/env-doc` — `d75df67b` (#542)

**G10, folded in from the retired task 005**

- [x] G10 Permission descriptions — `frontend/src/components/molecules/Setting/PermissionMatrix.vue` shows `PermissionDesc.<rule.key>` under every permission row and group header, `te()`-guarded, falling back to a stored `rule.desc` and never showing a raw key; search matches the description shown. `frontend/tests/unit/permissionDescriptions.spec.js` mounts the matrix with the seeded catalogue and keeps the 98 keys (6 parents + 92 children) one to one with the seeded rules (no orphans; only the never-rendered `toggle` holder has no sentence) — PR #1041

## Last step

Audited 2026-09-12. The build is on `beta` and its gate is green, but four items from `task.md` were unfinished (B.2 `main.yml`, B.4 tenant adoption in three modules, G10 permission descriptions, V4 admin and member passes); G10 is done since #1041 (build 505, 2026-09-27) and V2 has not been re-verified since merge, so the task stays in `active/`.

## Blockers

The admin and member passes (V4) and the "a Member never sees the Instance group" half of V2 need a non-owner account. `docs/QA-DEMO-TEAM.md` and `.demo-accounts.local.json` now provide one, so this is schedulable rather than blocked.

## Log

| Date | Step | Result | Evidence |
|---|---|---|---|
| 2026-09-04 | Build and merge | done | Full detail in `progress-A.md`, `progress-B.md`, `progress-C.md`, `progress-integration.md`; PR #542, merge `d75df67b`, build `14.36.0-beta.19` |
| 2026-09-10 | Leftovers audit | 3 open | `progress-integration.md` "Verified remaining": B.2, B.4 and G10; task 021 was filed for the *other* leftovers and explicitly leaves these three on 013 |
| 2026-09-12 | Record audited | stays active | Checklist above rebuilt from `task.md` against `origin/beta` `71c9332f`. Everything in workstreams A and C is delivered; B is delivered apart from B.2's `main.yml` trigger (still `staging`) and B.4's three unadopted modules (Trash, Instance, Tasks bulk); G10 is still open (0 `PermissionDesc` consumers, 107 dead keys). The V1 gate is green on the tip of `beta` (`gh pr checks 684`). V4's admin and member passes and V2's member check have no record and were never run. Status line corrected from "active · Started 2026-09-04" to name what remains; YAML frontmatter added (it had none). |
| 2026-09-27 | G10 permission descriptions | done | PR #1041 (`fix/permission-descriptions`): the matrix reads `PermissionDesc.<rule.key>` for rows and group headers. The namespace holds 98 keys, not 107, all matching seeded rules. The failing-first `permissionDescriptions.spec.js` was 14/18 red on beta and 18/18 green after the fix; CI green (backend, frontend, e2e) |
| 2026-09-27 | B.4 tenant scoping | done | PR #1052 (`refactor/tenant-helpers-trash-instance-bulk`). Trash, the instance audit export's header path, and every task write, including `POST /api/v2/tasks/bulk`, now resolve the company through `tenantOf`. A `companyid` header outside the token audience gets 403 `You do not have access to this company`. The failing-first `tests/trash-instance-bulk-tenant.test.js` plus the convention extension were 13 red on beta and green after the fix (38 suites, 1801 tests); CI green (backend, frontend, e2e) |
