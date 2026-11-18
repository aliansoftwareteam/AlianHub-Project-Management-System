# Views

A project always opens with a plain List and a Board. Beside them, propose up to **5** named views that fit how this team will look at its work, for example "Board by assignee" or "Due this week". Propose none when nothing beyond the plain List and Board would help.

Each view has:

- `name`: what the team would call it, at most 60 characters, different from every other view's name.
- `kind`: one of `list`, `board`, `table`, `calendar`, `workload`.
- `look` (optional), only these keys:
  - `groupBy`: `status`, `assignee`, `priority` or `due_date`.
  - `sortBy`: `due`, `priority`, `created`, `updated`, `name`, `status`, `assignee`, `points` or `estimate`, with `sortDirection` `asc` or `desc`.
  - `statuses`: names from this plan's `taskStatusData`.
  - `priorities`: any of `URGENT`, `HIGH`, `MEDIUM`, `LOW`.
  - `due`: `today`, `tomorrow`, `this_week`, `next_week`, `next_7_days`, `this_month` or `overdue`.
  - `mine`: `true` for a view of the viewer's own tasks.
  - `subtasks`: `collapsed` or `expanded`.

A view that breaks these rules is left out of the plan, and the person is told why.
