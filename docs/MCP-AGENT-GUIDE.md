# Working in AlianHub from an outside agent (MCP)

An AI agent you run yourself, such as Claude on your own plan, can work in AlianHub through the MCP endpoint at `<your AlianHub URL>/mcp`. It acts as the person whose token it carries: it sees what that person can open in the web app and changes what that person's role lets them change. Nothing here gives an agent more than its person has.

Every id below is a placeholder.

## What decides which tools an agent has

Three things, in this order.

1. **What the server offers.** The base tools are always offered. The rest are switched on by the person who runs the server:

   | Setting | Adds |
   |---|---|
   | `MCP_TOOLS_DATA=on` | `projects.list`, `project.get`, `sprints.list`, `statuses.list`, `comments.list`, `pages.search`, `page.get`, `timesheet.read`, `comment.create`, `timelog.create` |
   | `MCP_TOOLS_MANAGE=on` | `fields.list`, `subtasks.list`, `members.list`, the planning filters of `tasks.search`, and the task management tools `task.update`, `task.assign`, `task.field.set`, `task.move`, `task.archive`, `task.restore` |
   | `MCP_TOOLS_V2=on` | Names next to ids, paged lists, and a person's approval for any call that cannot be undone |

2. **What the token was created with.** A token has scopes (read, write) and, for the task management tools, the grant `tasks:manage`. A token keeps exactly what it was created with. The grant cannot be added to a token later, so a token made before these tools existed lists and runs none of them; create a new token to use them.

3. **What the person may do.** Each call is checked against the person's role and the project's permissions, the projects and private sprints they can open, and the token's own project list when it was narrowed to some projects. Another person's personal list and a conversation the person is not in are closed to everyone, owners and admins included.

An agent connected through OAuth (`MCP_OAUTH`) is held to the scopes its grant names. It cannot hold `tasks:manage` yet, so the task management tools are for personal access tokens for now.

## Creating a token

In the web app, open the AI accounts page, choose **My account**, then **New token**.

- Give it a name, and choose the project it is limited to, or all your projects.
- Tick **Let this agent manage tasks** to create it with `tasks:manage`. The box is shown only while `MCP_TOOLS_MANAGE` is on. Leave it unticked for an agent that should only read, comment, set a status and file tasks.
- Where the server requires it, choose an expiry and the read and write scopes. The grant needs the write scope.

The token is shown once. Add it to the agent as a bearer token:

```
claude mcp add alianhub --transport http "<your AlianHub URL>/mcp?companyId=<workspace id>" --header "Authorization: Bearer <token>"
```

Revoke a token on the same screen. A revoked or expired token stops working on its next call, and so does the token of someone removed from the workspace.

## What happens to a write

- It is checked first: the scope, the grant, the arguments against the tool's schema (an unknown argument, a wrong type or an out-of-range value is refused), and whether the person can open the task, the project and the list it names.
- It runs through the same server code the web app's own task actions use, so the activity log, the notifications and the counters are the ones a person's change produces.
- It is recorded in the agent audit log with what it replaced. Where the result says `undoable: true`, a person can undo it from that log within the workspace's undo window.
- With `MCP_TOOLS_V2` on, a call that cannot be undone (`task.move`) is not run. It is filed as a proposal in the Inbox, and the result says `pending: true`. A person who can open the same task and holds the same permission approves or declines it.
- A refusal says why, and is recorded too.

There is no tool that deletes a task or moves it to the trash.

## The tools

Arguments are JSON. A result is JSON text.

### Finding work

`tasks.next`: the tasks assigned to you, most urgent first.

```json
{ "name": "tasks.next", "arguments": {} }
```

`tasks.search`: tasks you can open, by text, status or project. With `MCP_TOOLS_MANAGE` on it also filters by assignee, list and due date, and each task carries its assignees, start date, estimate, subtask count and the tasks above it.

```json
{ "name": "tasks.search", "arguments": { "projectId": "<project id>", "assigneeId": "<member id>", "dueFrom": "2026-11-01", "dueTo": "2026-11-30" } }
```

`task.get`: one task as a brief, with its goal, acceptance criteria, relations and what the comments settled.

```json
{ "name": "task.get", "arguments": { "taskId": "<task id>" } }
```

`subtasks.list`: the direct subtasks of a task. Call it again on a subtask to go one level down.

```json
{ "name": "subtasks.list", "arguments": { "taskId": "<task id>" } }
```

`projects.list`, `project.get`, `sprints.list`, `statuses.list`: the projects you can open, and a project's lists and statuses.

```json
{ "name": "sprints.list", "arguments": { "projectId": "<project id>" } }
```

`members.list`: active members by name, with their role. With a `projectId`, each row says whether that person can open the project.

```json
{ "name": "members.list", "arguments": { "query": "priya", "projectId": "<project id>" } }
```

`fields.list`: the custom fields a project's tasks carry, with each field's type, the options of a dropdown and the task types it is used for.

```json
{ "name": "fields.list", "arguments": { "projectId": "<project id>" } }
```

`comments.list`, `pages.search`, `page.get`, `docs.read`, `timesheet.read`: a task's comments, pages you can open, and time entries.

```json
{ "name": "comments.list", "arguments": { "taskId": "<task id>" } }
```

### Changing a task

These need `tasks:manage`.

`task.update`: title, description, priority, due date, start date and estimate. One call may set several; a field left out is not touched. A day is read in the time zone of the person behind the token. `dueDate: null` clears the due date.

```json
{ "name": "task.update", "arguments": { "taskId": "<task id>", "title": "Ship the importer", "priority": "HIGH", "dueDate": "2026-11-14", "estimateMinutes": 240, "reason": "Agreed in planning" } }
```

`task.assign`: `set` replaces the assignees, `add` and `remove` change the list. Each person added must be an active member who can open the task's project.

```json
{ "name": "task.assign", "arguments": { "taskId": "<task id>", "mode": "add", "userIds": ["<member id>"] } }
```

`task.field.set`: one custom field. The value is in the field's own type: text, a number, `true` or `false`, a day, an option's id or label, a rating, a list of member ids. `null` clears it. A field that is not used for the task's type, or belongs to another project, is refused.

```json
{ "name": "task.field.set", "arguments": { "taskId": "<task id>", "fieldId": "<field id>", "value": "API" } }
```

`task.move`: a top-level task, with all its subtasks, to another list in its own project or in another project you may move tasks into. In another project the task takes the status and task type of the same name there, and keeps the assignees who can open that project. A subtask cannot be moved on its own.

```json
{ "name": "task.move", "arguments": { "taskId": "<task id>", "projectId": "<project id>", "sprintId": "<list id>" } }
```

`task.archive` and `task.restore`: archive a task with its subtasks, and bring it back.

```json
{ "name": "task.archive", "arguments": { "taskId": "<task id>", "reason": "Superseded" } }
```

### The rest of the writes

These need the write scope only.

`task.create`, `subtask.create`: file a task or a subtask, in its opening status and unassigned.

```json
{ "name": "task.create", "arguments": { "projectId": "<project id>", "title": "Importer drops empty rows", "priority": "MEDIUM" } }
```

`task.status.set`: move a task to an in-progress or in-review status. A person closes a task.

```json
{ "name": "task.status.set", "arguments": { "taskId": "<task id>", "status": "In review" } }
```

`task.comment`, `comment.create`, `task.link`: comment on a task, or attach a pull request or document link.

```json
{ "name": "task.comment", "arguments": { "taskId": "<task id>", "body": "Found the cause; fix is in the linked pull request." } }
```

`timelog.start`, `timelog.stop`, `timelog.create`: your own time on a task.

```json
{ "name": "timelog.create", "arguments": { "taskId": "<task id>", "minutes": 45, "date": "2026-11-03" } }
```

## What an agent cannot do yet

Writing pages, changing a project or its lists, saved views and dashboards, automations, time approval, bulk changes, tags, checklists, attachments, watchers, task relations, converting a task to a subtask and back, merging and duplicating. Deleting is not planned.
