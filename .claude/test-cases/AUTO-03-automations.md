# Test Cases — AUTO-03 Automation Builder (AHE-3737)

Saved automation rules: **conditions** (which tasks) + **actions** (set priority).
Applied **on demand** as a safe bulk update of matching tasks. Event-triggered
execution (`task_created` / `task_status_changed`) is stored on the rule but
**not** wired into core task-event flows — documented extension — so automations
can never disrupt live task mutations.

**Collection:** `automation_rules` (per-company).
**Endpoints** (all JWT + companyId under `/api/v1/automations`):
- `POST /` create · `GET /` list (with human summary) · `PUT /:id` · `DELETE /:id`
- `POST /preview` `{conditions}` — count + sample of matching tasks (no mutation)
- `POST /:id/apply` — apply the rule's set_priority to all matching tasks now

**Frontend:** Integrations hub → **Automations** section (build rule, list, Apply now, delete).

## Pure-rule unit tests (`tests/automation-rules.test.js`) — 10/10 passing

| Group | Cases |
|-------|-------|
| validateRule | valid · missing name + no valid action (2 errors) · unknown condition keys + bad priority filtered out · unknown trigger → manual |
| matchTask | all conditions hold · any mismatch fails · empty conditions match anything |
| buildMatch | always scopes parent + non-deleted · adds provided conditions (oid passthrough) |
| describe | human summary string |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create rule | name + "any project, priority LOW → HIGH" | Rule listed with summary `priority=LOW → set priority HIGH` |
| M2 | Apply | Click "Apply now" | All matching LOW tasks become HIGH; "N affected last run" updates |
| M3 | Project-scoped | conditions.projectId set | Only that project's tasks affected |
| M4 | Validation | create with no name / no action | 400 with clear message |
| M5 | Injection guard | conditions with `{hacker:'…'}` | Stripped; only whitelisted keys (projectId/priority/statusType) kept |
| M6 | companyId isolation | two companies | each lists/applies only its own rules + tasks |
| M7 | Delete | remove a rule | soft-deleted, gone from list |

## Guards / non-regression
- Apply is an explicit, user-triggered **bulk update** (like a bulk edit) — `updateMany` `$set Task_Priority` on a whitelist-built match (parent tasks, not deleted). No event hooks, no socket-loop risk, no core mutation path touched.
- Conditions + actions are whitelisted in the pure validator — a rule can't inject arbitrary Mongo or unsupported fields.
- New `automation_rules` collection + new route prefix; additive only.

## Roadmap (documented extension)
More actions (assignee, status, add-comment, move-sprint) and live `task_created` / `task_status_changed` triggers via a guarded event listener — deferred to keep this increment from touching core task-event flows.
