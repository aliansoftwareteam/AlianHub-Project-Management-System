---
id: 002
title: Make the task-type migration production-ready
status: active
priority: high
depends_on: []
created: 2026-08-14
---

# Make the task-type migration production-ready

## Goal
Evaluate `scripts/migrate-task-type-icons.js` (backfills library icons/colors + repairs
malformed task-type keys) and close the production-readiness gaps so ops can run it safely.

## Scope (per user's decisions)
- **Post-apply verification (add):** after `--apply`, run the spec's checks and print PASS/FAIL —
  (a) no project `taskTypeCounts` entry with a NaN/duplicate key; (b) no task whose `TaskType`
  matches a project entry but whose `TaskTypeKey` failed to resolve (rewrite miss); (c) icon
  fields (`iconType/iconValue/iconColor`) present on catalog + templates + project entries.
  Also expose a standalone `--verify` (checks only, no writes) for post-restore re-checks.
- **Auto cache-bust (add):** `myCache` is in-process node-cache, so the migration (separate
  process) can't clear the live backend's cache directly. Effective path: best-effort HTTP
  `POST ${APIURL}api/v1/removeCache` for `tasktype:<cid>`, `taskTypeTemplate:<cid>`,
  `UserProjectData:<cid>:` after `--apply`; on failure, print the exact manual command + the
  "restart backend" fallback. (Endpoint is unauthenticated.)
- **Per-project failure isolation:** wrap each project's writes so an error names the exact
  project (`ProjectName`/`_id`) — the helper has no transactions, so backup is the rollback and
  ops needs to know which project to restore. Fail-fast preserved.

## Out of scope (per user's decisions)
- **main_chats / chat projects** — the spec lists them (they carry `taskTypeCounts`), but keeping
  the script projects-only for this pass. Documented as a deliberate exclusion in the header.
- **All-companies loop** — stays single `--company` (spec decision #3).
- **Catalog re-sequence (spec B4)** — cosmetic; nothing references those keys; left as-is.
- **TaskType casing normalization (spec B3)** — left as-is; mis-cased tasks surface as orphans
  in the report. Noted as a known limitation, not changed (avoids touching report aggregation).

## Acceptance criteria
- [ ] `--apply` runs verification automatically and prints per-check PASS/FAIL.
- [ ] `--verify` runs the same checks with zero writes.
- [ ] After `--apply`, the script best-effort clears the three cache keys via the endpoint and,
      on failure, prints the exact manual command + restart note (no misleading in-process call).
- [ ] A per-project write failure aborts with a message naming the project.
- [ ] Header documents the main_chats exclusion; pure-logic unit test still passes.
- [ ] Dry-run output unchanged in shape (still writes nothing).

## Notes
- DB helper `MongoDbCrudOpration(companyId, {type,data}, method)` → `model[method](...data)`;
  `handleConnection(companyId)` connects to the company DB. Supports find/count/updateOne/
  updateMany. No sessions/transactions.
- Cache keys confirmed in `Modules/settings/templates/{settingTaskType,taskType}/controller.js`
  and `Modules/Project/controller/getProjectList.js`.
