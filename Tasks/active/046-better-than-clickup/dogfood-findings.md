# 046 — Dogfood findings: running this task through AlianHub itself

Started 2026-10-01 at about 15:20 IST, after the owner asked why this work is not run through AlianHub in real time.

## How it is used
- Each open pull request and each piece of running work is a subtask of AP-441, with the PR link and a status.
- The subtasks are written through the MCP endpoint (`/mcp`) with a personal access token, as "Local PM via claude-code".
- A small helper script outside the repository makes the calls.
- An earlier try to write one subtask per open PR in a single batch was refused by the session's permission check. It was not retried. Single calls work.

## Found by use, most missed first
1. **An agent cannot mark a merged PR Done.** `task.status.set` accepts only in-progress and in-review status names, so finished work stays "In Review" until a person closes it.
2. **A subtask takes three calls.** `subtask.create` accepts only a title, so the link and the status are two more calls each. It takes no description, assignee, priority or due date, and there is no bulk create.
3. **A subtask's key is hard to read.** The first one came back as `AP-441-st0r`, not a number in the project's sequence. Check how the web app shows it and whether it can be searched by.
4. **A task's subtasks could not be listed through MCP.** #1261 added `subtasks.list`; it is behind `MCP_TOOLS_MANAGE`, which is off by default.
5. **Only 11 of 24 tools are on locally.** `MCP_TOOLS_DATA` and `EXTERNAL_AGENT_SESSIONS` are off, so there is no `projects.list`, `sprints.list`, `comments.list` or `timesheet.read`. These are flags, not token scopes.
6. **One shared rate limit.** Tracker calls and the web app share one bucket per address (1,000 requests a minute). Under load the tracker gets a 429.
7. **Tokens last about a day,** so a long-running agent loses access overnight.
8. **Not AlianHub's fault, but part of the experience:** the Claude desktop session cannot reconnect an MCP server the user added after it failed at start. Only a new session picks it up.

## What #1261 (MCP parity part 1, build 719) added
- Reads: `fields.list`, `subtasks.list`, `members.list`. `tasks.search` takes assignee, list and due-date filters and returns assignees, start date, estimate, subtask count and the tasks above each task.
- Writes: `task.update` (title, description, priority, due date, start date, estimate), `task.assign`, `task.field.set`, `task.move`, `task.archive`, `task.restore`. There is no delete tool.
- All of it is off until `MCP_TOOLS_MANAGE=on`. A write tool runs only for a personal access token created with the `tasks:manage` grant. The grant is chosen when the token is made and cannot be added later.
- The guide is `docs/MCP-AGENT-GUIDE.md`.

## To use it locally (waiting for the owner)
1. Set `MCP_TOOLS_MANAGE=on` and `MCP_TOOLS_DATA=on` in the local `.env`.
2. Restart the server.
3. Create a new token with "Let this agent manage tasks" ticked.

## The plan for MCP parity part 2
What an agent still cannot do, most missed first. The order is from the integrator's notes. Most of it is also under "What an agent cannot do yet" in `docs/MCP-AGENT-GUIDE.md`, which #1261 added; that section does not name items 1, 4, 5, 17 and 18, or the time edits in item 16.

1. Hold the manage grant over OAuth, so Claude.ai connectors can use the write tools. Today only a personal access token can.
2. Write docs (pages).
3. Bulk changes.
4. Set any status, including Done (finding 1).
5. Create a task or a subtask that is already assigned, dated and typed (finding 2).
6. Tags and checklists.
7. Task relations.
8. Convert a task to a subtask and back; merge; duplicate.
9. Lists, sprints and folders.
10. Edit a project.
11. Attachments.
12. Watchers.
13. Saved views.
14. Dashboards.
15. Automations.
16. Time edits and time approval.
17. Edit a comment; reactions.
18. Task history.

Deleting is not planned.

## Oddities to fix along the way
- `tasks.search` returns `estimateHours` as the stored minutes divided by 3,600.
- `task.update` with several fields is not atomic.
- A change made through MCP is emitted as the person's change, with no agent actor. Think about a loop guard for automations.
- The `mcp-conformance` job never ran locally; it runs in CI.
- The token form's new checkbox has not been looked at in a browser.
