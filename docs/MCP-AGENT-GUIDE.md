# Working in AlianHub from an outside agent (MCP)

An AI agent you run yourself, such as Claude on your own plan, can work in AlianHub through the MCP endpoint at `<your AlianHub URL>/mcp`. It acts as the person whose token it carries: it sees what that person can open in the web app and changes what that person's role lets them change. Nothing here gives an agent more than its person has.

Every id below is a placeholder.

## What decides which tools an agent has

Three things, in this order.

1. **What the server offers.** The base tools are always offered. The rest are switched on by the person who runs the server:

   | Setting | Adds |
   |---|---|
   | `MCP_TOOLS_DATA=on` | `projects.list`, `project.get`, `sprints.list`, `statuses.list`, `comments.list`, `pages.search`, `page.get`, `timesheet.read`, `comment.create`, `timelog.create` |
   | `MCP_TOOLS_MANAGE=on` | The task management tools and the doc writing tools below, for tokens created with the matching grant |
   | `MCP_TOOLS_V2=on` | Names next to ids, paged lists, and a person's approval for any call that cannot be undone |

2. **What the token was created with.** A token has scopes (read, write) and may have grants:

   | Grant | Gives |
   |---|---|
   | `tasks:manage` | `task.update`, `task.assign`, `task.field.set`, `task.move`, `task.archive`, `task.restore`, `tasks.batch`, `comment.update`, the reads `fields.list`, `subtasks.list`, `members.list`, `task.history`, `task.links.list`, and the fuller forms of `tasks.search`, `task.get`, `task.create`, `subtask.create`, `task.comment` and `task.status.set` |
   | `docs:manage` | `page.create`, `page.update` |

   A token keeps exactly what it was created with. A grant cannot be added to a token later, so a token made before these tools existed lists and runs exactly what it did before; create a new token to use them. The two grants are separate: a token may manage tasks without writing docs, and the reverse.

3. **What the person may do.** Each call is checked against the person's role and the project's permissions, the projects and private lists they can open, and the token's own project list when it was narrowed to some projects. Another person's personal list and a conversation the person is not in are closed to everyone, owners and admins included.

An agent connected through OAuth (`MCP_OAUTH`) is held to the scopes its connection names. It can hold either grant as the scope of the same name, `tasks:manage` or `docs:manage`, and only when all three of these are true:

- **The app asked for it** when it sent the person to sign in.
- **The person ticked it** on the consent screen. Both start unticked, each with a sentence saying what it allows; everything else the app asked for is granted together as before.
- **An owner or admin approved it for that app by name** under Settings, Agent clients. Approving an app without choosing permissions never includes either one, and an app an admin registered without a list of permissions cannot be given them at all; register it again naming them.

An app connected before these scopes existed, and any connection where one of the three is missing, lists and runs exactly what it did before. The write scope never stands in for a manage scope, and a manage scope never stands in for the write scope: closing a task through `task.status.set` takes both `tasks:write` and `tasks:manage`.

Taking it back works at each level and takes effect on the app's next call: an owner or admin removes the permission from the app, or revokes the app, under Settings, Agent clients; the person withdraws the one permission, or revokes the whole connection, under Accounts, Connected apps.

## Creating a token

In the web app, open the AI accounts page, choose **My account**, then **New token**.

- Give it a name, and choose the project it is limited to, or all your projects.
- Tick **Let this agent manage tasks** to create it with `tasks:manage`, and **Let this agent write docs** to create it with `docs:manage`. The boxes are shown only while `MCP_TOOLS_MANAGE` is on. Leave both unticked for an agent that should only read, comment, set an in-progress status and file tasks.
- Where the server requires it, choose an expiry and the read and write scopes. A grant needs the write scope.

The token is shown once. Add it to the agent as a bearer token:

```
claude mcp add alianhub --transport http "<your AlianHub URL>/mcp?companyId=<workspace id>" --header "Authorization: Bearer <token>"
```

Revoke a token on the same screen. A revoked or expired token stops working on its next call, and so does the token of someone removed from the workspace.

## What happens to a write

- It is checked first: the scope, the grant, the arguments against the tool's schema (an unknown argument, a wrong type or an out-of-range value is refused), and whether the person can open the task, the project, the list or the doc it names.
- It runs through the same server code the web app's own actions use, so the activity log, the notifications and the counters are the ones a person's change produces. The activity log names the person and the agent: "Priya Shah (via Claude) has changed Status as Done".
- It is recorded in the agent audit log with what it replaced. Where the result says `undoable: true`, a person can undo it from that log within the workspace's undo window.
- With `MCP_TOOLS_V2` on, a call that cannot be undone (`task.move`) is not run. It is filed as a proposal in the Inbox, and the result says `pending: true`. A person who can open the same task and holds the same permission approves or declines it.
- For an app connected through OAuth, with `AGENT_TAINT_ROUTING` on, a write that reaches past one task (`task.create`, `task.move`, `task.archive`, `task.restore`, `page.create`, `page.update`) is filed the same way when the connection holds the manage scope the tool needs, and refused when it does not. Approval asks the connection again: it must still be live and still hold that scope, the app must still be approved for it in the workspace, and the person must still have a seat and be able to open what the change touches. A proposal filed by a connection that has since been revoked or narrowed cannot be approved.
- A refusal says why, and is recorded too.

There is no tool that deletes a task, a doc or a comment, or moves one to the trash.

## When the server answers 429

Every caller of one address shares one allowance with the web app (1000 requests a minute by default). Over it, the server answers HTTP 429 with a JSON body carrying `code: "server_busy"` and `retryAfter` in seconds, and a `Retry-After` header. Wait that long, then send the same call again; nothing was done. Use `tasks.batch` rather than many single calls, and page through lists instead of asking for everything.

## The tools

Arguments are JSON. A result is JSON text.

### Finding work

`tasks.next`: the tasks assigned to you, most urgent first.

```json
{ "name": "tasks.next", "arguments": {} }
```

`tasks.search`: tasks you can open, by text, status or project. With `tasks:manage` it also filters by assignee, list and due date, and each task carries its assignees, start date, estimate, subtask count and the tasks above it.

```json
{ "name": "tasks.search", "arguments": { "projectId": "<project id>", "assigneeId": "<member id>", "dueFrom": "2026-11-01", "dueTo": "2026-11-30" } }
```

`task.get`: one task as a brief, with its goal, acceptance criteria, checklist, relations, links and what the comments settled. With `tasks:manage` it also carries the assignees, the subtask count, the tasks above it and each link's id.

```json
{ "name": "task.get", "arguments": { "taskId": "<task id>" } }
```

`subtasks.list`: the direct subtasks of a task. Call it again on a subtask to go one level down.

```json
{ "name": "subtasks.list", "arguments": { "taskId": "<task id>" } }
```

`task.history`: the activity log the task panel shows, newest first.

```json
{ "name": "task.history", "arguments": { "taskId": "<task id>", "limit": 20 } }
```

`task.links.list`: the pull requests, branches and documents attached to a task.

```json
{ "name": "task.links.list", "arguments": { "taskId": "<task id>" } }
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

### Creating work

`task.create`, `subtask.create`: without `tasks:manage`, a title (and for a task a description, a list and a priority), in the opening status and unassigned. With it, everything known goes in the one call: description, assignees, priority, due and start dates, status, task type, estimate and links. The result carries the task's key. Subtasks nest three levels deep at most.

```json
{ "name": "subtask.create", "arguments": { "taskId": "<task id>", "title": "Pull request 1261", "status": "In review", "assigneeIds": ["<member id>"], "links": [{ "url": "https://example.com/acme/app/pull/1261", "label": "PR 1261" }] } }
```

### Changing a task

These need `tasks:manage`, except where a plain form is described.

`task.status.set`: without the grant, an in-progress or in-review status only; a person closes the task. With it, any status the task's project defines, a done or closed one included. A close made this way is recorded as closed for the person through the agent, and the work stays marked unchecked until a person checks it. It applies at once and can be undone. Where the workspace's agent policy has a person check an agent's work before it is closed, the close is refused and a person closes the task.

```json
{ "name": "task.status.set", "arguments": { "taskId": "<task id>", "status": "Done", "reason": "Pull request merged" } }
```

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

`task.move`: a top-level task, with all its subtasks, to another list in its own project or in another project you may move tasks into. In another project the task takes the status and task type of the same name there, and keeps the assignees who can open that project. Its subtasks take the task's assignees, as they do when a person moves a task in the web app. A subtask cannot be moved on its own.

```json
{ "name": "task.move", "arguments": { "taskId": "<task id>", "projectId": "<project id>", "sprintId": "<list id>" } }
```

`task.archive` and `task.restore`: archive a task with its subtasks, and bring it back.

```json
{ "name": "task.archive", "arguments": { "taskId": "<task id>", "reason": "Superseded" } }
```

`tasks.batch`: up to 25 write tools in one call, run in order. Each operation is checked and applied on its own and reports its own result, so one refusal neither stops nor undoes the others: a batch is not all-or-nothing. The operations that applied are recorded as one group that a person can undo together. An operation cannot use the id of a task an earlier operation created; make those calls separately.

```json
{ "name": "tasks.batch", "arguments": { "reason": "Friday tidy", "operations": [
  { "tool": "task.status.set", "arguments": { "taskId": "<task id>", "status": "Done" } },
  { "tool": "task.assign", "arguments": { "taskId": "<other task id>", "mode": "add", "userIds": ["<member id>"] } }
] } }
```

### Comments, links and time

`task.comment`, `comment.create`: comment on a task. With `tasks:manage`, a member named as `@[Their Name](their member id)` is notified, and `@[All](everyone)` reaches everyone who can open the task.

```json
{ "name": "task.comment", "arguments": { "taskId": "<task id>", "body": "Ready for review @[Priya Shah](<member id>)" } }
```

`comment.update`: change the text of a comment an agent wrote for you. A comment a person wrote is refused.

```json
{ "name": "comment.update", "arguments": { "taskId": "<task id>", "commentId": "<comment id>", "text": "Fixed in the second commit." } }
```

`task.link`: attach a pull request, branch or document link.

```json
{ "name": "task.link", "arguments": { "taskId": "<task id>", "url": "https://example.com/acme/app/pull/12", "label": "PR 12" } }
```

`timelog.start`, `timelog.stop`, `timelog.create`: your own time on a task.

```json
{ "name": "timelog.create", "arguments": { "taskId": "<task id>", "minutes": 45, "date": "2026-11-03" } }
```

### Docs

These need `docs:manage`.

`page.create`: a doc in a project, or one for the whole workspace when no project is named. The text is plain text or simple Markdown (headings, lists, paragraphs). The doc is marked as an agent's draft until a person approves it. `taskId` links it to a task, and `parentPageId` makes it a sub-page.

```json
{ "name": "page.create", "arguments": { "title": "Release notes 14.36", "text": "# What changed\n\n- Faster lists\n- A new importer", "projectId": "<project id>" } }
```

`page.update`: a doc's title, its text, or both. The text replaces the body. What it replaces is kept in the doc's version history first, under the person behind the token, so a person can always restore it.

```json
{ "name": "page.update", "arguments": { "pageId": "<page id>", "text": "# What changed\n\n- Faster lists" } }
```

## What an agent cannot do yet

Change a project, its lists or its members; saved views and dashboards; automations; time approval; tags, checklists, attachments and watchers; task relations; converting a task to a subtask and back, merging and duplicating; comments on a doc. Deleting is not planned.
