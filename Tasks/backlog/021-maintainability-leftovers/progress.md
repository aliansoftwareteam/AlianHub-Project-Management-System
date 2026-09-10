# Progress: Maintainability leftovers verified 2026-09-10

## Checklist
Tick each box with the commit that closed it.

- [ ] Delete dead `Modules/notification/routes.js`
- [ ] No `GET /api/v1/notifications/preferences` route exists: the path falls through to `GET /api/v1/notifications/:id` (`Modules/settings/settingNotifications/routes.js:7`) and answers with a document whose `userId` is the literal string `"preferences"`. Add the GET route or make the `:id` handler reject a non-ObjectId id (found during the 017 UI sweep, 2026-09-10)
- [ ] `Modules/Sprints/controller.js:172/233` — "UserId required" from `HandleHistory` during the demo seed
- [ ] `docker-compose.yml:24/61/102` — parameterise or document the `container_name` values
- [ ] Instance restore orphans databases of companies created after the backup
- [ ] Wasabi "Some uploads failed" with empty detail
- [ ] `.claude/MIGRATION-task-type-icons-and-keys.md` still documents the deleted script; migrations runner has no dry-run/verify mode
- [ ] ADR 002 amendment for Agenda-on-global (`docs/adr/002-automation-and-agent-engines.md:75`)
- [ ] Delete `--kiln-*` aliases (`tokens.css:384-389`) and the legacy Header kiln classes once `ah.legacyNav` goes
- [ ] Stale `.wizard-step-fill` comment in `TemplateSelectForm.vue:189` and inert `.tsf-fill-list` classes
- [ ] Run-history drawer for `GET /api/v2/automations/:id/runs`
- [ ] "Test on a real task" dry-run endpoint for automation rules
- [ ] Trash the sample/fixture rows in the "AlianHub Redesign" dogfood project

## Last step
Not yet started.

## Blockers
None.

## Log

### 2026-09-10
- Task created from the 2026-09-10 audit that closed tasks 001, 002, 004, 005 (both), 006-ai-native-pages-shell, 007, 009, 011 and 012.
