# Migration Plan — Task-Type Icons + Malformed-Key Repair

Companion to [PRD](./PRD-task-type-icon-library.md) / [IMPL](./IMPL-task-type-icon-library.md).
This is the deferred **migration**: (A) backfill library icons + colors onto existing
task types, and (B) repair malformed task-type keys (`NaN`, duplicates) **and update every
task that references them**.

> Status: shipped as **`migrations/004-task-type-icons.js`**, with the logic in
> [`migrations/lib/taskTypeIcons.js`](../migrations/lib/taskTypeIcons.js) and its unit check in
> [`.claude/tests/test-task-type-migration.js`](./tests/test-task-type-migration.js). The standalone
> `scripts/migrate-task-type-icons.js` this plan first described was replaced by the migrations
> runner (0c0234f1) and no longer exists. The sections below are the design record.

## How it runs

The runner applies `004-task-type-icons` once, at boot, for **every company**, and records the
outcome per company in `global.schema_versions`; a company that fails is retried on the next boot.
With `MIGRATIONS_AUTO=false`, an operator runs it by hand:

```bash
mongodump --uri "$MONGODB_URL" --out ./backup-<date>   # the only rollback; 004 has no down()
npm run migrate:status
npm run migrate
```

Each company returns a summary (`projects`, `keyFixes`, `merged`, `tasksRewritten`, `iconsSet`),
and the migration clears `tasktype:<companyId>`, `taskTypeTemplate:<companyId>` and
`UserProjectData:<companyId>:*` itself.

What changed from the plan below:
- **No dry-run and no post-apply verify mode.** The runner has neither; both are still open on
  task 021. Take the backup first.
- **All companies, not one** (decision #3 was for the manual one-off script).
- **Same-value duplicates are merged** onto one keeper (§B2 step 3), should a project have any.
- **No catalog re-sequence (§B4).** The company catalog and templates get icons only; their keys
  are left as they are.
- **Status-like rows (§B5) are left in place** and get icons like any other type; nothing reports
  their usage.

### Pre-deploy baseline — company `6571e7165470e64b12032734` (historical)
Captured against the original script's dry-run, for comparison with the per-company summary:
- Projects scanned: **865**; needing key fixes: **1** (`Alian Hub ERP` → `feedback_&_revision null→4`, 1 task).
- Total tasks to re-key: **1**. Orphan tasks (untouched): **~9,980** — dominated by `TaskType:"task"`
  in projects whose `taskTypeCounts` omits a "task" entry (pre-existing; resolves by key, left alone).
- Status-like usage: **0**.
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
above is the company *catalog*; the migration re-runs detection per **project** `taskTypeCounts`,
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

## Decisions (resolved)
1. **Status-like rows** — *pending numbers*: dry-run reports usage counts (B5 option ii); decide
   leave vs remove after. Not removed in this pass.
2. **Orphan tasks** — leave `TaskTypeKey` untouched, report only. ✅
3. **Scope** — this one company only. ✅
4. **Duplicates** — no same-`value` dupes exist → no merges; distinct types sharing a key are
   re-keyed, one keeper retains the key (prefer entry with an icon, then lowest/first). ✅
