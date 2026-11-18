# Dashboard

Propose at most **one** dashboard for the project when a team like this one would check its numbers at a glance, for example a delivery team watching what is due and what is stuck. Leave `dashboard` out when nothing here calls for one.

A dashboard has:

- `name`: what the team would call it, at most 120 characters.
- `cards`: 1 to 6 of these, each once, in the order they go down the page:
  - `due_soon`: the viewer's tasks due in the next days.
  - `my_time`: the time the viewer logged.
  - `project_pulse`: active projects and who is working today.
  - `logged_vs_estimate`: time logged against the estimates, team by team.
  - `free_capacity`: who has room for more work.
  - `at_risk`: tasks at risk today.
  - `tasks_by_status`: how many tasks are in each status.
  - `agent_spend`: what AI agents have spent.

A card not in this list is left out. Each card shows each viewer only the work they may see.
