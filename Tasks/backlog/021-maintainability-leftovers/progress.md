# Progress: Maintainability leftovers verified 2026-09-10

## Checklist
Tick each box with the commit that closed it.

- [x] Delete dead `Modules/notification/routes.js` — a053929d (already deleted on beta)
- [x] No `GET /api/v1/notifications/preferences` route exists: the path falls through to `GET /api/v1/notifications/:id` (`Modules/settings/settingNotifications/routes.js:7`) and answers with a document whose `userId` is the literal string `"preferences"`. Add the GET route or make the `:id` handler reject a non-ObjectId id (found during the 017 UI sweep, 2026-09-10) — route added in db5a84a3; `:id` now refuses non-ObjectId (400) and other users' ids (403) — f391f3eb
- [x] `Modules/Sprints/controller.js:172/233` — "UserId required" from `HandleHistory` during the demo seed — f61b1748
- [x] `docker-compose.yml:24/61/102` — parameterise or document the `container_name` values — b0660302
- [x] Instance restore orphans databases of companies created after the backup — 06fbfaf8 (restore reports them; owner drops each one by typing its name)
- [x] Wasabi "Some uploads failed" with empty detail — 26fb03e7 (server storage copies log the same detail)
- [x] `.claude/MIGRATION-task-type-icons-and-keys.md` still documents the deleted script — ad582067
- [x] Migrations runner has no dry-run/verify mode — 9043b599 (`npm run migrate -- up --dry-run`, `npm run migrate -- verify`, `verify` on 004)
- [x] ADR 002 amendment for Agenda-on-global (`docs/adr/002-automation-and-agent-engines.md:75`) — f5087ecb
- [ ] Delete `--kiln-*` aliases (`tokens.css:384-389`) and the legacy Header kiln classes once `ah.legacyNav` goes
- [x] Stale `.wizard-step-fill` comment in `TemplateSelectForm.vue:189` and inert `.tsf-fill-list` classes — 273cc0da
- [x] Run-history drawer for `GET /api/v2/automations/:id/runs` — 988d520d (tests 61dbfbca)
- [x] "Test on a real task" dry-run endpoint for automation rules — 07d6d95b, editor button f2bed2fe (tests 1dc5954e, 07200e8d)
- [ ] Trash the sample/fixture rows in the "AlianHub Redesign" dogfood project

## Last step
Migrations runner dry-run and verify landed (9043b599); the MIGRATION doc half of that item is still open.
Five items closed on `chore/maintainability-leftovers-021`; the rest are untouched.

## Blockers
None.

## Log

### 2026-09-10
- Task created from the 2026-09-10 audit that closed tasks 001, 002, 004, 005 (both), 006-ai-native-pages-shell, 007, 009, 011 and 012.

### 2026-09-23 — 007 follow-ups
- Run-history drawer on the automations list (History button per rule). The runs endpoint answers the newest 50 and does not page, so the drawer says so at 50 rather than paging.
- `POST /api/v2/automations/:id/dry-run { taskId }`: owner/admin (the edit gate), task must be in a project the caller can open (404 otherwise). Only reads; a no-write test fails when a save, a socket emit, a fetch or an action run is put back into the handler.
- Not changed here: the runs endpoint itself; its access rules are being reviewed separately.
### 2026-09-23
- Restore orphans: a restore lists company databases no company or user names (name, size) in its result and as a warning in the instance log, and drops none. Settings, Instance, Backups lists them; `POST /api/v2/instance/orphan-databases/:name/drop` drops one after the typed name and a fresh reference check (409 when still referenced).
- Upload detail: "Some uploads failed:" now names each file with code, status and message; URLs lose their query string. Server storage seed copies log the same line.
- Split the MIGRATION-doc / dry-run item in two and closed the runner half (9043b599). `up --dry-run` records writes at the driver and reports a read-after-write migration (032 on a real database) as cannot dry-run; `verify` runs read-only, with 004 as the first check.
- Found on the harness: setup seeds and the task type form still create task types with an uploaded image and no library icon, so 004's check accepts an uploaded image as an icon.
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
