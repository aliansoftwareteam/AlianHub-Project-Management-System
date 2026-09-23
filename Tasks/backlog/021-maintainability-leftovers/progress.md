# Progress: Maintainability leftovers verified 2026-09-10

## Checklist
Tick each box with the commit that closed it.

- [x] Delete dead `Modules/notification/routes.js` — a053929d (already deleted on beta)
- [x] No `GET /api/v1/notifications/preferences` route exists: the path falls through to `GET /api/v1/notifications/:id` (`Modules/settings/settingNotifications/routes.js:7`) and answers with a document whose `userId` is the literal string `"preferences"`. Add the GET route or make the `:id` handler reject a non-ObjectId id (found during the 017 UI sweep, 2026-09-10) — route added in db5a84a3; `:id` now refuses non-ObjectId (400) and other users' ids (403) — f391f3eb
- [x] `Modules/Sprints/controller.js:172/233` — "UserId required" from `HandleHistory` during the demo seed — f61b1748
- [x] `docker-compose.yml:24/61/102` — parameterise or document the `container_name` values — b0660302
- [ ] Instance restore orphans databases of companies created after the backup
- [ ] Wasabi "Some uploads failed" with empty detail
- [x] `.claude/MIGRATION-task-type-icons-and-keys.md` still documents the deleted script — ad582067
- [ ] Migrations runner has no dry-run/verify mode
- [x] ADR 002 amendment for Agenda-on-global (`docs/adr/002-automation-and-agent-engines.md:75`) — f5087ecb
- [ ] Delete `--kiln-*` aliases (`tokens.css:384-389`) and the legacy Header kiln classes once `ah.legacyNav` goes
- [x] Stale `.wizard-step-fill` comment in `TemplateSelectForm.vue:189` and inert `.tsf-fill-list` classes — 273cc0da
- [ ] Run-history drawer for `GET /api/v2/automations/:id/runs`
- [ ] "Test on a real task" dry-run endpoint for automation rules
- [ ] Trash the sample/fixture rows in the "AlianHub Redesign" dogfood project

## Last step
Five items closed on `chore/maintainability-leftovers-021`; the rest are untouched.

## Blockers
None.

## Log

### 2026-09-10
- Task created from the 2026-09-10 audit that closed tasks 001, 002, 004, 005 (both), 006-ai-native-pages-shell, 007, 009, 011 and 012.

### 2026-09-23
- `Modules/notification/routes.js` was already gone: a053929d removed it with the unregistered
  insertnotification route.
- The "UserId required" came from `utils/sampleTasks.js` `ensureDemoSprints`, which created the
  demo project's extra sprints through `addSprintFun` with `userData: {}` — the setup wizard's demo
  project, not `scripts/demo/` (that seed passes a real actor). It now passes the project owner.
- The migration doc now points at `migrations/004-task-type-icons.js` and says what the runner
  does differently; the runner's missing dry-run/verify mode is split onto its own box.
- The preferences route had already landed with 026 (db5a84a3). The `:id` read still answered any
  string, creating a defaults document for it, and handed any member another user's settings;
  both refused now (tests 16feed4a first, fix f391f3eb).
- Compose container names read `ALIANHUB_{APP,MONGO,COTURN}_CONTAINER` with the old names as
  defaults (b0660302). Volume and network names are still fixed, so `docker compose -p drill`
  shares the data volume with the main install.
