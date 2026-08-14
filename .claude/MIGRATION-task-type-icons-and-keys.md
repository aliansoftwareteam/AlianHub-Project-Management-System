# Migration Plan — Task-Type Icons + Malformed-Key Repair

Companion to [PRD](./PRD-task-type-icon-library.md) / [IMPL](./IMPL-task-type-icon-library.md).
This is the deferred **migration**: (A) backfill library icons + colors onto existing
task types, and (B) repair malformed task-type keys (`NaN`, duplicates) **and update every
task that references them**.

> Status: SPEC. This document is the reviewed contract, **not** the thing that runs at deploy.
> The deploy artifact is a standalone script (see §"Deploy artifact"). No script written yet.

## Deploy artifact — what actually runs

This `.md` is a spec. The migration executes as a **one-off Node script** (repo has no migration
framework; follows the `scripts/*.js` ops-script pattern, e.g. `seed-formula-rollup-types.js`):

- `scripts/migrate-task-type-icons.js --company <id>` → **dry-run** (default): prints the full
  report (key remaps, task rewrite counts, status-like usage, orphans), writes nothing.
- `scripts/migrate-task-type-icons.js --company <id> --apply` → performs it, after a backup.

Run manually by ops during the deploy window, once per company. Scope for this run: **one
company only** (per decision #3).

### Deploy runbook
```bash
# 1. Backup (only safety net — no automatic rollback)
mongodump --uri "$MONGODB_URL/<companyId>" --out ./backup-<companyId>-<date>

# 2. Dry-run — review the report, confirm numbers match the baseline below
node scripts/migrate-task-type-icons.js --company <companyId>

# 3. Apply
node scripts/migrate-task-type-icons.js --company <companyId> --apply

# 4. Clear caches so the app serves fresh data (or restart the backend)
#    keys: tasktype:<companyId>, taskTypeTemplate:<companyId>, UserProjectData:<companyId>:*
```
Rollback = `mongorestore` from step 1. Changes are additive (icon fields) plus one key fix, so
restore is rarely needed, but keep the dump until verified in the app.

### Dry-run baseline — company `6571e7165470e64b12032734` (captured pre-deploy)
Expected report (data may drift before deploy; investigate large deltas):
- Projects scanned: **865**; needing key fixes: **1** (`Alian Hub ERP` → `feedback_&_revision null→4`, 1 task).
- Total tasks to re-key: **1**. Orphan tasks (untouched): **~9,980** — dominated by `TaskType:"task"`
  in projects whose `taskTypeCounts` omits a "task" entry (pre-existing; resolves by key, left alone).
- Status-like usage: **0** (`in_progress` present, 0 tasks; others absent). → status-like rows carry
  no task usage; safe to leave (or drop from catalog later).
- Catalog entries: **46**; template entries: **9**; project entries: all 865 get icons.

---

## 0. Key facts that constrain the design (from codebase audit)

- **Keys are project-scoped.** A task carries `TaskType` (value string, e.g. `"bug"`) **and**
  `TaskTypeKey` (Number). Resolution is always `project.taskTypeCounts.find(t => t.key === TaskTypeKey)`
  — never against the company catalog.
- **Three stores, seeded from each other, then independent:**
  - (a) company `settings` TASK_TYPE `settings[]` — seed + `totalStatus` sequencing.
  - (b) `task_type_templates` collection `taskTypes[]` — template copies.
  - (c) **project `taskTypeCounts[]`** — *the keys tasks actually point at*. Also mirrored in
    `main_chats` docs for chat "projects".
- **No task references (a) or (b).** Fixing keys there is cosmetic (clean future seeds); the
  risky work is (c) + the `tasks` collection.
- **The safe disambiguator is the `TaskType` value string, not the key.** With duplicate/`NaN`
  keys, the key is ambiguous; the value string is not.
- **Reports/dashboards aggregate by `TaskType` string** → unaffected by re-keying.
- **No migration framework exists.** Closest prior art: `Modules/projectSetting/controller.js`
  `changeTaskType` (per-project old→new key remap) — model the re-key on it.
- **DB-per-company.** Migration runs **per company database**.

---

## Workstream A — Icon + color backfill (LOW risk, key-independent)

Writes `iconType='library'`, `iconValue`, `iconColor` onto existing task types, matched by the
stable **`value`** (fallback `name`) — never by key, so it's immune to the key mess.

**Mapping source (precedence):**
1. The reviewed per-type table (the 46-row mapping already approved — Task/Bug/Design/Sub Task
   + Sales/Design/Finance/etc.), keyed by `value`.
2. Fallback for any value not in the table → `iconForName(name)` + `colorForName(name)` from
   [iconLibrary.js](../frontend/src/utils/iconLibrary.js) (keyword map → generic default).

**Apply to all three stores** so new projects seed correctly and existing ones render:
- (a) `settings` TASK_TYPE `settings[]`
- (b) `task_type_templates` `taskTypes[]`
- (c) every project `taskTypeCounts[]` + `main_chats` `taskTypeCounts[]`

**Idempotent:** re-running just re-sets the same fields. Non-destructive: leaves `taskImage`
intact as the upload fallback.

---

## Workstream B — Malformed-key repair (HIGH risk, per-project + tasks)

Runs **per project** (and per chat project). The company catalog (a)/(b) get a cosmetic
re-sequence separately (Step B4) since no task depends on them.

### B1. Detect
For each project `taskTypeCounts[]`, flag entries where `key` is:
- `NaN` / non-integer / missing, or
- **duplicated** within that project's array.
Projects with all-unique integer keys are already clean → skip (report only).

### B2. Re-key by value (the safe rewrite)
Per project:
1. Compute `nextKey = max(valid integer keys) + 1`.
2. For each entry needing a new key, assign a fresh unique integer, tracked **by `value`**:
   `newKeyByValue[value] = <fresh key>`. Entries with a valid unique key keep it.
3. **Collision keeper (decision #4)**: within a group sharing a key, let **one entry retain the
   collided key** so its tasks need no rewrite; reassign the rest. Keeper preference: the entry
   that already has an icon set, tie-broken by lowest existing key / first seen. (True same-`value`
   duplicates would be *merged* — keep one, repoint tasks, drop the other — but **this company has
   none**; see the collision inventory below, which is all distinct-value / same-key.)
4. Write the corrected `taskTypeCounts[]` back to the project (and `main_chats`).

**Collision inventory (this company's catalog — distinct types sharing a key):**
| Collided key | Task types |
|---|---|
| `12` | Training Task · Financial Analysis |
| `13` | admin · Bookkeeping |
| `23` | In Progress · In Review · Backlog · Approved · Done · Complete |
| `NaN` | UI · UX · Graphic Design · Branding · Web Design · Print Design · Motion Graphics · Photography/Videography · Content Creation · Storyboarding · Feedback & Revision |

No duplicate **values** exist → no merges; every distinct type gets a unique key. (Note: the
above is the company *catalog*; the script re-runs detection per **project** `taskTypeCounts`,
which may differ.)

### B3. Rewrite task references (lockstep, same project only)
For every `tasks` doc in the project (parents **and** subtasks) — and chat tasks for chat
projects:
- Resolve intended type by the task's **`TaskType` value string** → `newKeyByValue[TaskType]`.
- Set `TaskTypeKey = newKey` (and normalize `TaskType` if the value casing drifted).
- **Orphans** (task's `TaskType` matches no entry, or `TaskType` empty + `NaN` key): **leave
  `TaskTypeKey` untouched and report only** (decision #2). Do not reassign — surface them in the
  report with task ids/counts for manual handling.

> Why value-based: it sidesteps the ambiguous old key entirely. A task with `TaskTypeKey:23`
> (shared by six types) is disambiguated by *which* value it carries, not the 23.

### B4. Re-sequence catalog keys (cosmetic)
Re-assign unique sequential keys in (a) `settings` TASK_TYPE `settings[]` and fix `totalStatus`
to the max; same for (b). No task rewrite needed (nothing points here). Purely so future
project creation seeds clean keys.

### B5. Status-like leakage — REPORT usage, decide after (decision #1, pending)
`In Progress`, `In Review`, `Backlog`, `Approved`, `Done`, `Complete` (values `in_progress`…)
are workflow statuses that leaked into the task-type catalog (same bad import as the `NaN` keys).
The dry-run **must count how many real tasks resolve to each** (across every project's
`taskTypeCounts`) — that number gates the choice:
- **(i) Leave** — keep as selectable types, fix keys + icons. Zero risk, but the "Add Task Type"
  UI keeps offering "Done"/"Complete" as *types* (confusing; invites more bad data).
- **(ii) Report only (recommended first step)** — no change; surface usage counts so (iii) can be
  chosen safely.
- **(iii) Remove** — cleans the catalog, but **destructive**: any task resolving to one becomes an
  orphan. Only safe once (ii) shows zero usage.
They're coupled — (iii) is unsafe without (ii)'s counts. **Plan: run (ii) in the dry-run, then
decide (i) vs (iii) from the numbers.**

---

## Safety & execution

- **Backup first**: `mongodump` the company DB (or at least `tasks`, `projects`, `main_chats`,
  `settings`, `task_type_templates`). Rollback = restore.
- **Dry-run mode (default)**: script emits a full report — per project: key remaps, task counts
  to be rewritten, merges, orphans — and writes **nothing**. Only `--apply` mutates.
- **Per-company**: loop tenants (or take a `companyId`), connect to that DB (`mongoConnector`).
- **Idempotent**: re-running a completed migration is a no-op (already-unique keys skipped;
  icon fields re-set to same values).
- **Batched writes** with `bulkWrite` per project; wrap each project's taskTypeCounts + task
  updates so a project is all-or-nothing.
- **Verification queries** after apply:
  - no `taskTypeCounts` entry with `NaN`/duplicate key in any project;
  - every `tasks.TaskTypeKey` resolves to exactly one entry in its project;
  - counts of rewritten tasks match the dry-run report;
  - every task type has `iconType`, `iconValue`, `iconColor`.
- **Cache bust**: clear `tasktype:${companyId}`, `taskTypeTemplate:${companyId}`,
  `UserProjectData:*` after apply (see the removeCache keys in the settings controllers).
- **Socket note**: no live emit needed for a maintenance migration; users refresh. If run hot,
  consider emitting a project-update so open boards re-resolve icons.

## Ordering
1. Backup → 2. Dry-run, review report (esp. orphans + merges + status-like) →
3. `--apply` Workstream B (keys) → 4. `--apply` Workstream A (icons/colors) →
5. Verify → 6. Cache bust.
(A after B so icon fields land on the final, corrected entries.)

## Decisions (resolved)
1. **Status-like rows** — *pending numbers*: dry-run reports usage counts (B5 option ii); decide
   leave vs remove after. Not removed in this pass.
2. **Orphan tasks** — leave `TaskTypeKey` untouched, report only. ✅
3. **Scope** — this one company only. ✅
4. **Duplicates** — no same-`value` dupes exist → no merges; distinct types sharing a key are
   re-keyed, one keeper retains the key (prefer entry with an icon, then lowest/first). ✅
