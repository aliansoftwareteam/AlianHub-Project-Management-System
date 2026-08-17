# Progress: Make the task-type migration production-ready

## Checklist
- [x] Header: document main_chats exclusion + --verify usage
- [x] Per-project write failure isolation (name the project)
- [x] Post-apply verification (checks a/b/c) + PASS/FAIL output
- [x] Standalone --verify mode (no writes)
- [x] Best-effort HTTP cache-bust via /api/v1/removeCache + manual fallback
- [x] Re-run unit test (pure logic) — still passes; syntax check OK; arg-guard OK
- [ ] Live dry-run on a real company DB (ops step — can't do in this env)

## Last step
Hardening implemented in scripts/migrate-task-type-icons.js. Verified: node -c passes, unit
test passes, --company guard works. Full run needs a company DB (ops). Ready to commit.

## Blockers
None. (Can't run the full migration here — no company DB; logic is unit-tested.)

## Log

### 2026-08-14
- Evaluated scripts/migrate-task-type-icons.js vs .claude/MIGRATION-task-type-icons-and-keys.md.
- Confirmed via code: main_chats carries taskTypeCounts (schema.js), DB helper supports the
  needed methods, cron.js unrelated, cache is in-process node-cache with an unauthenticated
  /api/v1/removeCache endpoint. Unit test passes.
- User decisions: main_chats OUT, single-company, add verification + cache-bust.
