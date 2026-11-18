# Automations

Propose up to **3** automations that would save this team routine clicks, for example "When a task is done, tell the person who created it". Propose none when nothing obvious fits. Each one is made switched off; the team switches it on in Automations when they want it.

Each automation has:

- `name`: what it does in plain words, at most 80 characters.
- `trigger`, one of:
  - `task.created`, `task.status_changed`, `task.assignee_changed`, `task.priority_changed`, `task.lead_changed`, `task.due_date_changed`, `task.renamed`, `task.sprint_changed`, `task.updated`, `task.due_date_passed`, `task.subtasks_all_done`.
- `conditions` (optional, up to 10), each `{ "field", "op", "value" }`:
  - `statusRef` with `changedTo`, `changedFrom`, `in` or `notIn`: a name from this plan's `taskStatusData`, or `open`, `in progress` or `done`.
  - `Task_Priority` with `eq`, `neq`, `changedTo` or `changedFrom`: `LOW`, `MEDIUM` or `HIGH`.
  - `AssigneeUserId` with `empty` or `notEmpty` (no value).
  - `isParentTask` with `eq`: `true` or `false`.
- `actions` (1 to 3), each `{ "action", "config" }`, only these:
  - `set_status`: `{ "status": a name from taskStatusData }`.
  - `set_priority`: `{ "priority": "LOW" | "MEDIUM" | "HIGH" }`.
  - `add_comment`: `{ "body": text }`.
  - `create_subtask`: `{ "title": text }`.
  - `assign`: `{ "mode": "add", "userIds": ["task_creator"] }`.
  - `notify`: `{ "recipients": ["task_assignees" | "task_creator" | "task_watchers"], "message": text }`.

Never name a person in an automation; use the roles above. Never include `enabled`. An automation that breaks these rules is left out of the plan, and the person is told why.
