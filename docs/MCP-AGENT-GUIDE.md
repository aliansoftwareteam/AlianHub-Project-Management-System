# Working in AlianHub from an outside agent (MCP)

An AI agent you run yourself, such as Claude on your own plan, can work in AlianHub through the MCP endpoint at `<your AlianHub URL>/mcp`. It acts as the person whose token it carries: it sees what that person can open in the web app and changes what that person's role lets them change. Nothing here gives an agent more than its person has.

This guide is written from the code in `Modules/Mcp/`, `Modules/OAuthServer/` and `Modules/Agents/registry/`. For the person who connects an app and wants plain steps, see `docs/CONNECT-YOUR-AI.md`.

Every id below is a placeholder.

## For the person who runs the server

Everything below is off until you switch it on. Each setting is read on every call, so a value you set takes effect without rebuilding anything; restart the server after you edit `.env`.

| Setting | Default | What it turns on |
|---|---|---|
| `MCP_OAUTH` | off | Connecting Claude or ChatGPT by address, with a consent screen. `on`, `true`, `1` and `yes` mean `both` (apps and personal tokens work). `only` refuses personal tokens. Needs `MCP_OAUTH_ISSUER` or `APIURL` to be an `https` origin (plain `http` only on `localhost` outside production), or the server does not start. |
| `MCP_TOOLS_DATA` | off | The data tools: the projects, lists, statuses, comments, docs and timesheet reads, `comment.create`, `timelog.create`, `screen.link`, `person.place`, `person.me`, `workdays.get`, `task.fields.list`, `proposal.get`, and reading chat. It is also the only setting that offers the `chat:read` permission |
| `MCP_TOOLS_MANAGE` | off | The task management tools and the doc writing tools, and the `tasks:manage` and `docs:manage` permissions. A token or app gets them only by asking for them by name |
| `MCP_TOOLS_WORK` | off | Tags, links between tasks, lists, doc comments, goals, fields, saved views, project setup, new projects, automations, dashboard cards and the work queue. They need no manage permission |
| `MCP_TOOLS_V2` | off | Names next to ids, paged lists, tool annotations, and an approval for any call rated as one that cannot be undone or that reaches the whole workspace |
| `AGENT_PERFORMANCE_READ` | off | `performance.read` |
| `AGENT_TAINT_ROUTING` | off | A connected app's write that reaches past one task waits for a person. See "What happens to a write" |
| `EXTERNAL_AGENT_SESSIONS` | off | Delegating a task to a connected app, and the tools `session.activity`, `session.complete` and `session.fail` |
| `MCP_OAUTH_DCR` | off | Lets an app register itself. With it off, an owner or admin adds the app under Settings, Agent clients, or the app names itself by a client ID metadata document |
| `MCP_CURSOR_SECRET` | derived | The key that signs list cursors while `MCP_TOOLS_V2` is on. At least 32 characters and not equal to `JWT_SECRET` |
| `WEBURL` or `APIURL` | none | Where `screen.link` builds its addresses. With neither set, `screen.link` says it cannot give a link |

The lifetimes and limits of connected apps are set by `MCP_OAUTH_ACCESS_TOKEN_MINUTES` (15), `MCP_OAUTH_REFRESH_TOKEN_DAYS` (30), `MCP_OAUTH_GRANT_MAX_DAYS` (90), `MCP_OAUTH_RATE_LIMIT_PER_MIN` (30), `MCP_OAUTH_CLIENT_METADATA_CACHE_SECONDS` (300) and `MCP_OAUTH_TOKEN_SECRET`. The numbers in brackets are the defaults. `.env.example` explains each one.

A tool's setting decides whether the server offers it. The person's token decides whether that person may use it. The Connect your AI page names each of `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` that is off.

An owner or admin controls the rest from inside AlianHub:

- Settings, Agent clients: which apps may connect, and the most each may be given.
- A project's detail screen: "Agents in this project" and "Agents working at the same time", including "Pause all agents".
- AI, Audit log: every change an agent made, with Undo while the undo window is open (24 hours by default; the setting is "Undo window (hours)" under Instance settings, AI agents).

## What decides which tools an agent has

Three things, in this order.

1. **What the server offers.** The first group below is always offered. Every other group needs its setting from the table above.

2. **What the token was created with.** A token has scopes (read, write) and may have grants:

   | Grant | Gives |
   |---|---|
   | `tasks:manage` | The tools of the "Manage" group that change tasks or read for planning, `task.from_message`, and the fuller forms of `tasks.search`, `task.get`, `task.create`, `subtask.create`, `task.comment`, `comment.create` and `task.status.set` |
   | `docs:manage` | `page.create`, `page.update` |
   | `chat:read` | `chat.channels.list`, `chat.messages.list` |

   A token keeps exactly what it was created with. A grant cannot be added to a token later, so a token made before these tools existed lists and runs exactly what it did before; create a new token to use them. The grants are separate: a token may manage tasks without writing docs, and the reverse. Reading chat is its own grant too: no scope and no other grant carries it, so a token reads chat only when its person ticked it by name.

3. **What the person may do.** Each call is checked against the person's role and the project's permissions, the projects and private lists they can open, and the token's own project list when it was narrowed to some projects. Another person's personal list and a conversation the person is not in are closed to everyone, owners and admins included.

An agent connected through OAuth (`MCP_OAUTH`) is held to the scopes its connection names. It can hold each grant as the scope of the same name, `tasks:manage`, `docs:manage` or `chat:read`, and only when all three of these are true:

- **The app asked for it** when it sent the person to sign in.
- **The person ticked it** on the consent screen. Each starts unticked, with a sentence saying what it allows (for `chat:read`, "Read messages in channels you are in"); everything else the app asked for is granted together.
- **An owner or admin approved it for that app by name** under Settings, Agent clients. Approving an app without choosing permissions never includes any of them, and an app an admin registered without a list of permissions cannot be given them at all; register it again naming them.

`chat:read` is listed and can be asked for only while `MCP_TOOLS_DATA` is on. It is not one of the scopes an app gets when it asks for none, and `tasks:read` does not include it: an app connected before it existed reads no chat until its person connects it again and ticks it.

The write scope never stands in for a manage scope, and a manage scope never stands in for the write scope: closing a task through `task.status.set` takes both `tasks:write` and `tasks:manage`.

Taking it back works at each level and takes effect on the app's next call: an owner or admin removes the permission from the app, or revokes the app, under Settings, Agent clients; the person withdraws the one permission, or revokes the whole connection, under AI, Accounts, Connected apps.

## Every tool, by group

80 tools in all. How to read the tables:

- **Permission** is the scope an OAuth app needs. A personal token with the read scope holds every `*:read` scope, and one with the write scope holds every `*:write` scope, except the manage and chat permissions, which a token holds only as grants.
- **What it does** says how a call ends with the settings at their defaults (`MCP_TOOLS_V2` and `AGENT_TAINT_ROUTING` off, a project on "Act on single tasks, propose anything wider"):
  - **Reads**: nothing changes.
  - **At once**: the change is made and recorded in the audit log. Where the result says `undoable: true`, a person can undo it.
  - **Waits**: the call changes nothing. It files a request in the AI Inbox, answers `pending: true` and a `proposalId`, and a person approves or declines it.
- A list tool takes `limit` and, with `MCP_TOOLS_V2` on, a `cursor`. Its page size is 25 unless noted, and at most 100.
- Every write also takes an optional `reason` (at most 500 characters) that goes into the audit log.

### Always offered (11 tools)

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `tasks.next` | `tasks:read` | Reads. The tasks assigned to you, most urgent first | `projectId` optional; the first 5 (paged with `MCP_TOOLS_V2`) |
| `tasks.search` | `tasks:read` | Reads. Tasks you can open, by text, status or project. With `tasks:manage` it also filters by assignee, list and due date | `limit` 10 by default, at most 50 |
| `task.get` | `tasks:read` | Reads. One task as a brief | Needs `taskId` |
| `task.comment` | `tasks:write` | At once. A comment on a task. With `tasks:manage` a member can be named with `@[Their Name](their member id)` | Needs `taskId`, `body` |
| `task.status.set` | `tasks:write` (and `tasks:manage` for the full form) | At once for In progress or In review. With `tasks:manage`, any status of the project; a close follows the project's rule and by default waits | Done is never available without `tasks:manage` |
| `task.link` | `tasks:write` | At once. Attaches a pull request, branch or document link | Needs `taskId`, `url`; `kind` is `pr`, `branch`, `doc` or `url` |
| `task.create` | `tasks:write` | At once. A task with a title, description, list and priority, unassigned, in the opening status. With `tasks:manage` also assignees, dates, status, type, estimate and links | Title 250 characters, description 20000, at most 20 assignees and 10 links |
| `subtask.create` | `tasks:write` | At once. A subtask under a task | Three levels deep at most |
| `timelog.start` | `time:write` | At once. Starts your timer on a task | Your own time only |
| `timelog.stop` | `time:write` | At once. Stops the running timer and writes the entry | Your own time only |
| `docs.read` | `docs:read` | Reads. A doc linked from a task, by page id | Text up to 40000 characters |

### Performance numbers, `AGENT_PERFORMANCE_READ` (1 tool)

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `performance.read` | `time:read` | Reads. Logged time, estimate against actual, velocity and cumulative flow | Up to 5 projects, a range of at most 120 days; needs `from` and `to` |

### Data tools, `MCP_TOOLS_DATA` (18 tools)

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `projects.list` | `projects:read` | Reads. Projects you can open | `query`, `limit` |
| `project.get` | `projects:read` | Reads. One project: key, privacy, members, number of statuses | Needs `projectId` |
| `sprints.list` | `projects:read` | Reads. The lists of one project. A private list is listed only for its people and for owners and admins | Needs `projectId` |
| `statuses.list` | `projects:read` | Reads. A project's statuses in board order | Needs `projectId` |
| `comments.list` | `tasks:read` | Reads. A task's comments, newest first | Needs `taskId` |
| `pages.search` | `docs:read` | Reads. Docs you can open, by title | `query`, `projectId`, `limit` |
| `page.get` | `docs:read` | Reads. One doc with its full text | Text up to 40000 characters |
| `timesheet.read` | `time:read` | Reads. Time entries, yours by default; another person's only where the timesheet screens show them to you | `userId`, `from`, `to`, `projectId`, `limit` |
| `comment.create` | `tasks:write` | At once. A comment on a task, stored as plain text | Needs `taskId`, `text` |
| `timelog.create` | `time:write` | At once. A finished time entry of your own. A day in an approved timesheet period is refused | Needs `taskId`, `minutes` |
| `screen.link` | `projects:read` | Reads. The web address of a place in AlianHub | See "Show me" below |
| `person.place` | `projects:read` | Reads. The project, list or task the person last opened | No arguments; "fresh" for 60 minutes |
| `person.me` | `projects:read` | Reads. Who the connection acts for: id, name, role, time zone, today's date | No arguments |
| `workdays.get` | `projects:read` | Reads. The working days of the workspace or of one project | `projectId` optional; no list of public holidays |
| `task.fields.list` | `tasks:read` | Reads. A task's custom fields and what each holds | Text over 2000 characters is cut |
| `proposal.get` | `tasks:read` | Reads. What became of a change that waited for a person | Only a proposal this same connection filed |
| `chat.channels.list` | `chat:read` | Reads. Chat channels the person can open. Direct messages are never listed | `query`; at most 200 channels |
| `chat.messages.list` | `chat:read` | Reads. Recent messages of one channel (`channelId`) or one task's comment thread (`taskId`) | 20 by default, at most 50; text cut at 2000 characters |

### Manage tools, `MCP_TOOLS_MANAGE` (16 tools)

These need the `tasks:manage` permission, except `page.create` and `page.update`, which need `docs:manage`. `task.from_message` also needs `MCP_TOOLS_DATA`.

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `fields.list` | `tasks:manage` | Reads. A project's custom fields with type and options | Needs `projectId` |
| `subtasks.list` | `tasks:manage` | Reads. The direct subtasks of a task | Needs `taskId` |
| `members.list` | `tasks:manage` | Reads. Active members by name, with role; with `projectId`, whether each can open the project | `query`, `limit` |
| `task.history` | `tasks:manage` | Reads. The task's activity log, newest first | `limit` |
| `task.links.list` | `tasks:manage` | Reads. Pull requests, branches, documents attached to a task | Needs `taskId` |
| `task.update` | `tasks:manage` | At once. Title, description, priority, due date, start date, estimate | A field left out is not touched |
| `task.assign` | `tasks:manage` | At once. `set`, `add` or `remove` assignees | At most 20; each must be an active member who can open the project |
| `task.field.set` | `tasks:manage` | At once. One custom field of a task; `null` clears it | A field not used for the task's type is refused |
| `task.move` | `tasks:manage` | At once, and it cannot be undone. With `MCP_TOOLS_V2` on it waits. A top-level task with its subtasks, to another list or project | A subtask cannot be moved alone |
| `task.archive` | `tasks:manage` | At once. Archives a task with its subtasks | Nothing is deleted |
| `task.restore` | `tasks:manage` | At once. Brings an archived task back | |
| `comment.update` | `tasks:manage` | At once. Changes a comment an agent wrote for you | A person's comment is refused |
| `tasks.batch` | `tasks:manage` | At once when every operation names the same task. Waits, as one request, when the operations name more than one task | Up to 25 operations; a waiting batch stays inside one project |
| `task.from_message` | `tasks:manage` | At once. A task made from a chat message or a task comment you can read | Needs `messageId`; a direct message needs `projectId` |
| `page.create` | `docs:manage` | At once. A doc, marked as an agent's draft until a person approves it | Plain text or simple Markdown |
| `page.update` | `docs:manage` | At once. A doc's title or text. The old text is kept in the version history | Plain text or simple Markdown |

The grant also gives fuller forms of tools in the first group, which are the same names with more arguments: `tasks.search`, `task.get`, `task.create`, `subtask.create`, `task.comment`, `comment.create` and `task.status.set`.

### Work tools, `MCP_TOOLS_WORK` (32 tools)

None of these needs a grant. A read takes the read scope and a write takes the write scope.

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `tags.list` | `projects:read` | Reads. A project's tags | Needs `projectId` |
| `task.relations.list` | `tasks:read` | Reads. Tasks a task is linked to, and how | Only tasks you can open |
| `task.lists.list` | `tasks:read` | Reads. Lists a task was added to beside its home list | Only lists you can open |
| `lists.list` | `projects:read` | Reads. A project's lists and folders | Needs `projectId` |
| `page.comments.list` | `docs:read` | Reads. A doc's comments, oldest first | `limit` at most 100 |
| `goals.list` | `projects:read` | Reads. The goals you can read, with progress and targets | `mine`, `archived`, `limit` |
| `goal.get` | `projects:read` | Reads. One goal | Needs `goalId` |
| `automation.catalogue` | `projects:read` | Reads. What a rule can be made of | No arguments |
| `queue.list` | `tasks:read` | Reads. Work waiting for an agent: questions its person asked it in chat, and work in projects whose project manager is switched on | At most 25 items; `projectId` optional |
| `task.tags.add` | `tasks:write` | At once. Puts a project tag on a task | Tag by id or name |
| `task.tags.remove` | `tasks:write` | At once. Takes a tag off | |
| `task.relation.add` | `tasks:write` | At once. Links two tasks: `blocks`, `blocked_by`, `duplicates`, `duplicated_by`, `relates_to` | One link per pair |
| `task.relation.remove` | `tasks:write` | At once. Removes the link on both tasks | |
| `task.lists.add` | `tasks:write` | At once. Adds a top-level task to another list | Not a Scrum sprint, backlog or personal list; at most 10 lists per task |
| `task.lists.remove` | `tasks:write` | At once. Takes a task out of an added list | The home list never changes |
| `list.create` | `tasks:write` | At once. A list at the top level or in a folder | Name at most 100 characters |
| `list.rename` | `tasks:write` | At once. Renames a list | An archived list is refused |
| `list.move` | `tasks:write` | At once. Moves a list into a folder or to the top level | Its own project only |
| `page.comment.create` | `tasks:write` | At once. A comment on a doc | At most 10000 characters |
| `page.comment.reply` | `tasks:write` | At once. A reply in a doc comment thread | |
| `page.comment.assign` | `tasks:write` | At once. Gives a doc comment thread to a member, or clears it | |
| `goal.target.set` | `tasks:write` | At once. The value of a target set by hand | A target counted from tasks is refused |
| `goal.target.sources.add` | `tasks:write` | At once. Counts one more list or task toward a target | `kind` is `list` or `task` |
| `goal.target.sources.remove` | `tasks:write` | At once. Stops counting one | |
| `queue.claim` | `tasks:write` | At once. Takes one queue item for 30 minutes | A claim gives no extra rights |
| `queue.release` | `tasks:write` | At once. Gives an item back | |
| `fields.create` | `tasks:write` | Waits, always. Up to 10 custom fields, a rollup or a formula among them, with up to 50 first values | Field names 80 characters |
| `view.create` | `tasks:write` | Waits, always. A saved view | Name 60 characters |
| `project.setup` | `tasks:write` | Waits, always. Statuses, lists, fields, views, automations and first tasks for an existing project | Up to 10 statuses, 10 lists, 10 fields, 5 views, 5 automations, 30 tasks |
| `project.create` | `tasks:write` | Waits, always. A new project, with or without a plan | Name 3 to 100 characters, description up to 2000 |
| `automation.create` | `tasks:write` | Waits, always, for an owner or admin. One automation rule for one project | Six step kinds; see "Automations" |
| `dashboard.card.add` | `tasks:write` | Waits, always, for the dashboard's owner. One card on a dashboard they own, or on a new private one | Eight kinds of card; see "Dashboards" |

### Delegated sessions, `EXTERNAL_AGENT_SESSIONS` (3 tools)

| Tool | Permission | What it does | Limits |
|---|---|---|---|
| `session.activity` | `tasks:write` | Writes the session record only. Reports what the app is doing on a delegated task | Text up to 4000 characters, 60 a minute; the first call within ten seconds, with its handle |
| `session.complete` | `tasks:write` | Closes the session as done, with a short summary | |
| `session.fail` | `tasks:write` | Closes the session as failed, with a reason | |

### Stricter settings

The "At once" rows above change when a stricter setting is on. Nothing here makes an agent able to do more.

- A project set to "Propose everything" files every connected agent write in that project. For an app, the call is filed only when the tool is covered by a manage permission the app holds, and refused otherwise.
- With `AGENT_TAINT_ROUTING` on, an app's write that reaches past one task (a new task, a move, an archive, a link, a list change, a doc comment, a doc, a goal change) waits when the app holds the manage permission the tool needs, and is refused when it does not.
- With `MCP_TOOLS_V2` on, `task.move`, `goal.target.set`, `goal.target.sources.add` and `goal.target.sources.remove` wait.
- A close (a done status) follows the project's "Agents and Done" rule, whatever the settings above say.

## Connect your AI

Sign-up ends on a step called **Connect your AI**, and the same page stays under AI, Connect your AI. It can be skipped; the setup card on Home offers it again.

- **Claude and ChatGPT** connect by address. The page shows the address (`<your AlianHub URL>/mcp`) only while `MCP_OAUTH` is on; with it off the page says so and points to the token instead.
- **Claude Code and other tools** connect with a token, made under AI, Accounts, My account, as described below. With `MCP_OAUTH=only` tokens are refused, and the page says that instead.
- The page lists what an agent can do on this install, and names each of `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` that is off.
- The page says **Connected** once the person's own agent has made a call: an agent token of theirs, or an app they connected, that has a last-used time in this workspace. It reads `GET /api/v2/api-tokens/ai-connection`, which answers for the signed-in person only and returns no token, hash or prefix. Another person's connection never counts.
- An agent works while its app is open or running on a schedule. AI that runs inside AlianHub with nobody's app open (the Ask card, AI fields, agents on a schedule) needs a model key on the server; that key is optional.

## Creating a token

In the web app, open AI, then Accounts, choose **My account**, then **New token**.

- Give it a name, and choose the project it is limited to, or all your projects.
- Tick **Let this agent manage tasks** to create it with `tasks:manage`, and **Let this agent write docs** to create it with `docs:manage`. The boxes are shown only while `MCP_TOOLS_MANAGE` is on. Tick **Let this agent read chat** to create it with `chat:read`; that box is shown only while `MCP_TOOLS_DATA` is on. Leave both unticked for an agent that should only read, comment, set an in-progress status and file tasks, and, where `MCP_TOOLS_WORK` is on, tag and link tasks, create, rename and move lists and comment on docs.
- Where the server requires it, choose an expiry and the read and write scopes. A manage grant needs the write scope, and reading chat needs the read scope.

The token is shown once. Add it to the agent as a bearer token:

```
claude mcp add alianhub --transport http "<your AlianHub URL>/mcp?companyId=<workspace id>" --header "Authorization: Bearer <token>"
```

Revoke a token on the same screen. A revoked or expired token stops working on its next call, and so does the token of someone removed from the workspace.

## What happens to a write

- It is checked first: the scope, the grant, the arguments against the tool's schema (an unknown argument, a wrong type or an out-of-range value is refused), and whether the person can open the task, the project, the list or the doc it names.
- It runs through the same server code the web app's own actions use, so the activity log, the notifications and the counters are the ones a person's change produces. The activity log names the agent and the person it acted for: "Claude, for Priya Shah has changed Status as Done". The line is stored as an agent's, so the task's activity and the project's activity log mark it and can be narrowed to changes made by an agent. An automation rule does not answer the change unless the rule was set to react to changes made by automations and agents.
- It is recorded in the agent audit log with what it replaced. Where the result says `undoable: true`, a person can undo it from that log within the workspace's undo window.
- With `MCP_TOOLS_V2` on, a call rated as one that cannot be undone or that reaches the whole workspace (`task.move`, `goal.target.set`, `goal.target.sources.add` and `goal.target.sources.remove`) is not run. It is filed as a proposal in the Inbox, and the result says `pending: true`. A person who can open the same task and holds the same permission approves or declines it.
- For an app connected through OAuth, with `AGENT_TAINT_ROUTING` on, a write that reaches past one task (`task.create`, `task.move`, `task.archive`, `task.restore`, `page.create`, `page.update`) is filed the same way when the connection holds the manage scope the tool needs, and refused when it does not. Approval asks the connection again: it must still be live and still hold that scope, the app must still be approved for it in the workspace, and the person must still have a seat and be able to open what the change touches. A proposal filed by a connection that has since been revoked or narrowed cannot be approved.
- The `MCP_TOOLS_WORK` writes follow the same rule without needing a manage scope to run. Under `AGENT_TAINT_ROUTING`, a tag stays on one task and runs. A link between tasks, a list change, adding a task to another list or taking it out, and a doc comment reach past one task: each is refused for a connection without the manage scope, and filed for a person when the connection holds `tasks:manage` (links and lists) or `docs:manage` (doc comments), with approval asking that scope again. A change to a goal reaches everyone the goal is shared with: it is refused without `tasks:manage` and filed with it.
- A goal belongs to no project. A token kept to some projects reads a goal only when the goal counts tasks and every list and task it counts is in those projects, and it changes no goal.
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

With `MCP_TOOLS_WORK` on, `tasks.search` takes `sprintId` for every token: the tasks that live in that list and the tasks added to it from another list. A task added to the list still carries its home list in `sprintId`. An added task is answered only when you can open its home, and only when you can open the list you named; a token kept to some projects needs both inside them.

```json
{ "name": "tasks.search", "arguments": { "sprintId": "<list id>" } }
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

`tags.list`: the tags one project defines, each with its id, name and colour. Argument: `projectId`.

```json
{ "name": "tags.list", "arguments": { "projectId": "<project id>" } }
```

`task.relations.list`: the tasks a task is linked to, each with the type of the link (`blocks`, `blocked_by`, `duplicates`, `duplicated_by`, `relates_to`), a readable label and the linked task's key, title, status, project and list. Only linked tasks you can open are listed, and nothing says whether there are others. Argument: `taskId`.

```json
{ "name": "task.relations.list", "arguments": { "taskId": "<task id>" } }
```

`task.lists.list`: the lists a task was added to beside its home list, each with its project, name, who added it and when. Only lists you can open are listed, and nothing says whether there are others. Argument: `taskId`.

```json
{ "name": "task.lists.list", "arguments": { "taskId": "<task id>" } }
```

`lists.list`: the live lists of one project, each with the folder and the parent folder it sits in, and the project's live folders and subfolders. A private list is listed only for the people on it, and for owners and admins. Argument: `projectId`.

```json
{ "name": "lists.list", "arguments": { "projectId": "<project id>" } }
```

`page.comments.list`: the comments on a doc you can open, oldest first. A reply names its thread in `threadId`; a thread that is assigned names who holds it and whether it is resolved. Arguments: `pageId`, and `limit` (at most 100).

```json
{ "name": "page.comments.list", "arguments": { "pageId": "<page id>", "limit": 50 } }
```

### Creating work

`task.create`, `subtask.create`: without `tasks:manage`, a title (and for a task a description, a list and a priority), in the opening status and unassigned. With it, everything known goes in the one call: description, assignees, priority, due and start dates, status, task type, estimate and links. The result carries the task's key. Subtasks nest three levels deep at most.

```json
{ "name": "subtask.create", "arguments": { "taskId": "<task id>", "title": "Pull request 1261", "status": "In review", "assigneeIds": ["<member id>"], "links": [{ "url": "https://example.com/acme/app/pull/1261", "label": "PR 1261" }] } }
```

### A project's own policy

An owner or admin sets two things per project, on the project's detail screen under "Agents in this project". Both only hold an agent back: they never give a connection more than its grants and its person's permissions allow.

| Setting | Values | What a call gets |
|---|---|---|
| Agents and Done | `never` | A close is refused. A person closes the task |
| | `approval` (default) | A close is filed as a proposal (`pending: true`) and applies when a person approves it |
| | `yes` | A close applies at once and the work stays marked unchecked |
| Connected agents | `single_task` (default) | Nothing extra is held: the rules under "What happens to a write" decide |
| | `propose_all` | Every write in the project is filed as a proposal |

On the same screen, under "Agents working at the same time", an owner or admin sets how many agents may work in the project at once (1 to 20, 3 by default) and can choose **Pause all agents**. While agents are paused, no agent takes work or changes anything in that project, and every agent write there is refused, until someone chooses **Resume agents**. People carry on as usual.

A task created already in a done status counts as a close. A write that reaches two projects (a move, a link between tasks) follows the stricter of the two. The workspace's "a person checks before Done" switch always wins over the project. An app connected through OAuth files a proposal only for a tool its manage scope covers, so a held call of any other tool (a comment, a link, a timer) is refused, as is every held call of an app with no manage scope. An agent's token on the web app's own routes cannot file one either, so there a held write is refused and the MCP tool is the way to propose it.

### Changing a task

These need `tasks:manage`, except where a plain form is described.

`task.status.set`: without the grant, an in-progress or in-review status only; a person closes the task. With it, any status the task's project defines, a done or closed one included. A close made this way is recorded as closed for the person through the agent, and the work stays marked unchecked until a person checks it. Whether it applies at once is the project's choice (see "A project's own policy" above): by default the close is filed as a proposal and a person approves it. Where the workspace's agent policy has a person check an agent's work before it is closed, the close is refused and a person closes the task, whatever the project says.

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

`tasks.batch`: up to 25 write tools in one call, run in order. When every operation names the same task, each is checked and applied on its own and reports its own result, so one refusal neither stops nor undoes the others: that batch is not all-or-nothing. The operations that applied are recorded as one group that a person can undo together. When the operations name more than one task, nothing runs: the changes are filed as one request that waits in the AI Inbox for a person to approve or decline whole, and the result says `pending: true`. A waiting batch stays inside one project; send one batch for each project. An operation cannot use the id of a task an earlier operation created; make those calls separately.

```json
{ "name": "tasks.batch", "arguments": { "reason": "Friday tidy", "operations": [
  { "tool": "task.status.set", "arguments": { "taskId": "<task id>", "status": "Done" } },
  { "tool": "task.assign", "arguments": { "taskId": "<other task id>", "mode": "add", "userIds": ["<member id>"] } }
] } }
```

### Tags, links between tasks and lists

These need `MCP_TOOLS_WORK` and the write scope, and no grant. Each asks the person for the permission the web app asks for the same change.

`task.tags.add`, `task.tags.remove`: put one of the project's tags on a task, or take it off. Arguments: `taskId`, `tag` (a tag id or name from `tags.list`), and `reason`. A tag another project defines is refused. The result says `changed: false` when the task already had the tag, or never had it.

```json
{ "name": "task.tags.add", "arguments": { "taskId": "<task id>", "tag": "Bug", "reason": "Triage" } }
```

`task.relation.add`: link a task to another task you can open. Arguments: `taskId`, `relatedTaskId`, `type` (`blocks`, `blocked_by`, `duplicates`, `duplicated_by` or `relates_to`, read from the first task), and `reason`. The other task shows the matching link. Two tasks hold one link; to change its type, remove it and add it again.

```json
{ "name": "task.relation.add", "arguments": { "taskId": "<task id>", "relatedTaskId": "<other task id>", "type": "blocked_by" } }
```

`task.relation.remove`: remove the link between two tasks, on both of them. Arguments: `taskId`, `relatedTaskId`, and `reason`. Both tasks must be ones you can open.

```json
{ "name": "task.relation.remove", "arguments": { "taskId": "<task id>", "relatedTaskId": "<other task id>" } }
```

`task.lists.add`: add a top-level task to another list, in its own project or another one. The task stays in its home list and keeps that project's statuses; its subtasks show under it. Arguments: `taskId`, `projectId` and `sprintId` (the other list and the project it is in, from `lists.list`), and `reason`. You must be able to open the task and the list, and to move tasks in both projects. A Scrum sprint, a backlog and a personal list are refused, and so is a subtask, a task in a personal list and an eleventh list. Adding a task to a list gives nobody access to it: people who cannot open its home list do not see it there.

```json
{ "name": "task.lists.add", "arguments": { "taskId": "<task id>", "projectId": "<project of the other list>", "sprintId": "<other list id>" } }
```

`task.lists.remove`: take a task out of a list it was added to. Arguments: `taskId`, `projectId`, `sprintId`, and `reason`. You must be able to open the task and the list, and to move tasks in the task's project or in the list's. The home list is never changed here.

```json
{ "name": "task.lists.remove", "arguments": { "taskId": "<task id>", "projectId": "<project of the other list>", "sprintId": "<other list id>" } }
```

`list.create`: a list in a project, at the top level or in one of the project's folders or subfolders. Arguments: `projectId`, `name` (at most 100 characters), `folderId`, and `reason`. It needs the permission to create lists in that project.

```json
{ "name": "list.create", "arguments": { "projectId": "<project id>", "name": "Sprint 14", "folderId": "<folder id>" } }
```

`list.rename`: arguments `projectId`, `sprintId` (the list), `name`, and `reason`. It needs the permission to rename lists. An archived list is refused.

```json
{ "name": "list.rename", "arguments": { "projectId": "<project id>", "sprintId": "<list id>", "name": "Sprint 14: importer" } }
```

`list.move`: a list into a folder or subfolder of its own project, or to the top level with `folderId: null`. Its tasks go with it. Arguments: `projectId`, `sprintId`, `folderId`, and `reason`. It needs any one of the permissions the web app takes for a move: rename lists, change a list's sharing, or create lists.

```json
{ "name": "list.move", "arguments": { "projectId": "<project id>", "sprintId": "<list id>", "folderId": null } }
```

Undo, from the agent audit log: a tag and a link are put back as they were, a task added to a list is taken out and one taken out is added again, a rename and a move are reversed, and a list an agent created is moved to the trash while it is still empty. There is no tool that archives or deletes a list or a folder.

### Fields and saved views

These need `MCP_TOOLS_WORK` and the write scope, and no grant. A field or a view shows to everyone on the project, so a call never makes one: it is always filed for a person, whatever the project's policy says, and answers `pending` with the proposal it filed. The Inbox shows the person exactly what will be made: each field with its type and options, or the view with its layout and what it shows. An outside client's call is filed only when its connection holds `tasks:manage`, and approval asks that scope again. Once approved, each runs the web app's own route as the person behind the token, so it asks the permission the web app asks: custom fields (on the project or on tasks) for a field, views or project details for a view.

`fields.create`: add up to 10 custom fields to one project in one call. Arguments: `projectId`, `fields` (each with `name`, `type` and, for a dropdown, `options` as plain text; `description` is optional), and `reason`. The types are `text`, `textarea`, `number`, `money`, `date`, `dropdown`, `checkbox`, `email`, `phone`, `url`, `people`, `rating` and `progress`. Options are cleaned to plain text, at most 30 of 60 characters each. A field is made for that project alone, never company-wide. A field the project already has by that name is kept, not made twice. Several fields are one proposal and one approval; the result names each field as made, kept, or not saved and why.

```json
{ "name": "fields.create", "arguments": { "projectId": "<project id>", "fields": [{ "name": "Budget", "type": "money" }, { "name": "Region", "type": "dropdown", "options": ["North", "South"] }] } }
```

The fields and their first values can be one approval: add `values`, up to 50, each with `taskId`, `field` (the name of a field of this call or of one the project already has) and `value` (as `task.field.set` takes it; `null` clears).

```json
{ "name": "fields.create", "arguments": { "projectId": "<project id>", "fields": [{ "name": "Cost", "type": "number" }], "values": [{ "taskId": "<task id>", "field": "Cost", "value": 120 }] } }
```

- `values` is for a connection that may use `task.field.set` itself: the tool is on (`MCP_TOOLS_MANAGE`) and the connection holds `tasks:manage`. Any other connection is refused, and nothing is filed.
- The call is refused at once, and nothing is filed, when a task is not one of that project that the person can open, when a field name is neither in the call nor in the project, when a value is not one the field takes, or when the person may not edit custom fields on a task.
- The Inbox card lists each value under the fields, on its task by name. A value on a task the person looking cannot open is counted, not named.

`fields.create` also takes the two types AlianHub works out, as the field form makes them. Neither takes a value.

- `rollup`: a number worked out for each task from the subtasks under it, on every level. Give `function` (`sum`, `avg`, `count`, `min`, `max`) and `source`, the name of the number field it reads: a field of the same call or one the project already has, of type `number`, `money`, `rating`, `progress`, `formula` or `rollup`. `count` with no `source` counts the subtasks.
- `formula`: a number worked out from the task's own number fields. Give `expression`: numbers, fields by name in braces, `+ - * /`, brackets, and `SUM`, `AVG`, `MIN`, `MAX`, `COUNT`, `ROUND`, `IF`, as in `{Price} - {Cost}`.

```json
{ "name": "fields.create", "arguments": { "projectId": "<project id>", "fields": [{ "name": "Cost total", "type": "rollup", "function": "sum", "source": "Cost" }] } }
```

A rollup of a field that is not there or is not a number, and a formula that cannot be read or that closes a circle with another formula, are answered at once and nothing is filed. The Inbox card says in words what each works out. A rollup has its number on each task as soon as it is approved; a formula has it on a task once a field value of that task is next saved. Read the number with `task.fields.list`. `project.setup` and `project.create` take the other types only.
- Approved, the fields are made first, then each value is set as `task.field.set` sets it, and only on a live task of the project that the person behind the token and the approver can both open and may both edit the fields of. A value that is not set does not stop the others: `values` in the result says, for each, `set` or the reason.
- Undo puts each value back to what the task held, then takes the fields away as above. A value on a task the person undoing cannot open stays, and so does the field that holds it.

`view.create`: add a saved view to one project. Arguments: `projectId`, `name`, `kind` (`list`, `board`, `table`, `calendar` or `workload`; a list when left out), and what the view shows: `groupBy` and `sortBy` (a built-in choice or the id of a custom field), `sortDirection`, `mine`, `assigneeIds`, `statuses` (by name), `priorities`, `search`, `subtasks`, `showFieldIds`, and a due date: `due` (`today`, `tomorrow`, `this_week`, `next_week`, `next_7_days`, `this_month` or `overdue`) or a range of days in `dueFrom` and `dueTo` (`YYYY-MM-DD`). The due date is stored as the row the task filter saves, so a span is counted from the day the view is opened, a day of a range is that day where the person looking is, and `overdue` is "due before today" whatever the status; add `statuses` to leave closed tasks out. The view starts as a copy of the project's view of that kind, as "duplicate view" does; a project with no view of that kind answers so at once. A status or a field the project does not have is left out, and the result's `leftOut` names the part. The result holds the view's web address when the server has one set.

```json
{ "name": "view.create", "arguments": { "projectId": "<project id>", "name": "My open work", "kind": "board", "groupBy": "priority", "mine": true } }
```

`project.setup`: set up a project that exists from one plan, in one call. Arguments: `projectId`, and any of `statuses` (up to 10 names of at most 60 characters), `lists` (up to 10 names of at most 100 characters), `fields` (up to 10, as in `fields.create`), `views` (up to 5, each as in `view.create`, plus `showFields`: fields of the same plan to show as columns, by name), `rules` (up to 5 automations, each the `trigger`, `conditions` and `actions` of `automation.create`, without the project) and `tasks` (up to 30 first tasks, each a `name` and, when wanted, a `list` and a `status` by name, one `assigneeId` and a `dueDate` as YYYY-MM-DD), and `reason`. Every name is cleaned to plain text. The whole plan is one proposal and one approval, and the Inbox shows every part on one card. It cannot make a project.

```json
{ "name": "project.setup", "arguments": { "projectId": "<project id>", "statuses": ["In Review"], "lists": ["Backlog", "This week"], "fields": [{ "name": "Budget", "type": "money" }], "views": [{ "name": "Review board", "kind": "board", "groupBy": "status", "showFields": ["Budget"] }], "rules": [{ "trigger": "task.status_changed", "conditions": [{ "field": "statusRef", "op": "changedTo", "value": "In Review" }], "actions": [{ "action": "notify", "config": { "recipients": ["task_assignees"], "message": "Ready for review" } }] }], "tasks": [{ "name": "Write the brief", "list": "Backlog", "status": "In Review", "dueDate": "2026-11-02" }] } }
```

What happens to a plan:

- A plan with a part its person may not make by hand is refused at once, and the answer names the part and the permission. So is a plan with a view of a kind the project has no view of.
- Approved, each part runs the web app's own route as the person behind the token, and only where the approver may make that part by hand too. A part that fails does not stop the others: the result lists each part with what was made, what was kept and what was not made, and `notMade` names each of those with the reason.
- A status is added as a working stage, before the statuses that close a task. A status the project already has by that name is kept. One the company has in its own status list is taken from there with its colours. One the company does not have is added to that list first, which only an owner or an admin may do: the plan's person and its approver both have to be one, or that status is not made.
- Lists are created at the top level of the project. A list is not checked against the lists the project has, so read `lists.list` first.
- The person approving can untick any single status, list, field, view, automation or task on the card. Only what stays ticked is made, and the proposal keeps what was approved. A part that cannot be made without one that is unticked (a view that shows a field of the plan, a task in a list or a status of the plan, an automation that names a status of the plan) is unticked with it; an approval that keeps one without the other is refused and says which two.
- Automations and first tasks are made last, in that order, and each is made as the action a call for it alone runs: `automation.create` and the `task.create` that takes a task's details. So each meets the same checks: the connection's actions, the permissions of the person behind the token, the project's rule for agents, and for an automation an owner or an admin as approver. A plan with a rule or a task that its connection could not ask for alone is refused at once; one that names a list, a status or a person that is in neither the plan nor the project is answered at once. A rule may name a status of the same plan. A rule of a plan always starts switched off.
- Each automation and each task has its own audit row and its own undo; undoing the proposal undoes them first.
- Undo takes back what the plan made, newest part first: its views, its fields (as for `fields.create`), its lists while they are empty, and its statuses while no task is in them. Whatever is in use stays, and the undo names it and says why. A status added to the company's list stays in that list, as it does when a person takes a status off a project.

`project.create`: ask for a new project, with or without a plan for it, in one call. Arguments: `name` (3 to 100 characters), `description` (what it is for, up to 2000 characters), any of `statuses`, `lists`, `fields` and `views` as in `project.setup`, and `reason`. A view is a list or a board view, the kinds a new project starts with, and names no person and no field by id. The project and its plan are one proposal and one approval, and the Inbox shows the name, who will be on it and every part on one card. It cannot make an automation or a task.

```json
{ "name": "project.create", "arguments": { "name": "Website relaunch", "description": "Everything for the new site.", "statuses": ["In Review"], "lists": ["Backlog", "This week"], "fields": [{ "name": "Budget", "type": "money" }], "views": [{ "name": "Review board", "kind": "board", "groupBy": "status", "showFields": ["Budget"] }] } }
```

What happens to a new project:

- The call makes nothing. It is refused at once when the person behind the token may not create a project by hand, or may not make a part of the plan under the company's permissions, and the answer says which. A token kept to some projects cannot ask for one.
- Approved, the project is made by the Create project screen's own route, as the person who approved, who must be allowed to create a project by hand. It is a blank project (To Do, In Progress and Done, one list, a list and a board view), private, with only the approver on it. Its key is made from the first letters of its name, with a number added when that key is taken.
- Then the description and each part of the plan are made as `project.setup` makes them: as the person behind the token, and only where the approver may make that part too. When someone other than that person approved, the person is not on the new project (unless they are an owner or an admin), so no part is made and `notMade` says so; the approver adds them, and `project.setup` does the rest.
- The proposal is listed for the person whose agent asked and for owners and admins.
- Undo moves the project to the trash through the project's own route, as the person undoing, who must be allowed to delete it; a person restores it from the trash. A project that holds a task or a doc by then stays: the undo is refused and says why. Nothing is deleted for good.

Undo, from the Inbox or the agent audit log: a view an agent added is removed, and nothing else. Each field it made is switched off, as the field form's own switch does, only while it is still that project's alone and no task holds a value in it; a rollup or a formula is switched off whatever number its tasks store, since nobody typed it. A field that holds a value, or that someone has since put on another project, stays, and the undo names it and says why.


### Automations

These need `MCP_TOOLS_WORK`; `automation.catalogue` takes the read scope and `automation.create` the write scope, and neither needs a grant. A rule runs later with nobody watching, so a call never makes one: it is always filed for a person, whatever the project's policy says, and no "always do this" covers it. Only an owner or an admin can have a rule proposed for them, and only an owner or an admin can approve it, as on the Automations page.

`automation.catalogue`: what a rule can be made of. No arguments. It answers the triggers that start from a task, the condition fields with their operators, and the steps an agent may propose with their settings: `set_status`, `set_priority`, `add_comment`, `create_subtask`, `assign` and `notify`.

`automation.create`: propose one rule for one project. Arguments: `projectId`, `trigger` (a key from the catalogue), `conditions` (each with `field`, `op` and, where the operator takes one, `value`; all must hold), `actions` (each with `action` and its `config`), `enabled` (the rule is saved switched off unless this is `true`) and `reason`. Write a status, a person or a task type by its name; a name the project does not have is answered at once and nothing is filed.

```json
{ "name": "automation.create", "arguments": { "projectId": "<project id>", "trigger": "task.status_changed", "conditions": [{ "field": "statusRef", "op": "changedTo", "value": "Done" }], "actions": [{ "action": "notify", "config": { "recipients": ["task_assignees"], "message": "Done, thank you" } }] } }
```

What is refused, with the reason: a step that runs an agent; any step outside the six above, which is where a step that sends an email, calls a webhook or posts to Slack would be; a trigger that does not start from a task (a form, a schedule); and the switch that lets a rule react to changes made by automations and agents, which only a person sets. A rule made this way does not run on an agent's change.

The Inbox shows the approver the project, what starts the rule, the rule in a sentence, each step, and whether it starts switched on. For an owner or an admin it also shows how many tasks of the last 30 days the rule matches, with up to three of them, counted the way the Automations page counts and only over what that person can open. Approving saves the rule through the Automations page's own create route as the person who approved: the rule is theirs, not the agent's and not the token's, and anything that page would refuse is refused.

Undo, from the Inbox or the agent audit log: the rule is deleted, as the Automations page deletes it, whether it is on or off. A rule someone has edited since stays, and the undo says so; switch it off or delete it on the Automations page.

### Dashboards

`dashboard.card.add` needs `MCP_TOOLS_WORK` and the write scope, and no grant; an outside client's call is filed only when its connection holds `tasks:manage`. A dashboard is changed by its owner alone, so a call never adds a card: it is filed for the person the agent works for, and only that person can approve it. A token kept to some projects cannot use it, since a dashboard belongs to no project.

Arguments: `dashboardId` (a dashboard the person owns) or `newDashboard` (the name of a new dashboard, made private to them), `card`, `period` and `reason`. The cards are the ones the dashboard editor adds with nothing more to fill in: `due_soon`, `my_time`, `project_pulse`, `logged_vs_estimate`, `free_capacity`, `at_risk`, `tasks_by_status` and `agent_spend`. `my_time`, `project_pulse`, `logged_vs_estimate` and `tasks_by_status` cover a span of time and take `period`: `auto`, `today`, `this_week`, `last_week`, `this_month`, `last_month` or `last_30_days`; left out, the card starts on the span the editor gives it. A card that first asks for a project, a list or a question (burndown, velocity, ask a question) is added in AlianHub, as is sharing a dashboard.

```json
{ "name": "dashboard.card.add", "arguments": { "newDashboard": "Team overview", "card": "tasks_by_status", "period": "this_week" } }
```

A dashboard that is not there and one the person cannot open are answered alike, as not found; one that belongs to someone else, or already holds 60 cards, is answered at once, and nothing is filed. The Inbox shows the dashboard by name and the card in the editor's words, to a viewer who can open the dashboard. Approving runs the dashboard editor's own routes as that person: the card goes under the cards already there, and it shows each viewer only the work they may see.

Undo, by the dashboard's owner: the card is removed. A dashboard the change made is deleted with it while that card is all it holds; one that has gained a card since, or was there before, stays.

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

### Comments on a doc

These need `MCP_TOOLS_WORK` and the write scope, and no grant: anyone who can open a doc may comment on it, as in the web app. The comment is stored as the person's, as plain text.

`page.comment.create`: arguments `pageId`, `text` (at most 10000 characters), and `reason`. A member named as `@[Their Name](their member id)` is notified when they can read the doc.

```json
{ "name": "page.comment.create", "arguments": { "pageId": "<page id>", "text": "The second table is out of date @[Priya Shah](<member id>)" } }
```

`page.comment.reply`: arguments `pageId`, `commentId` (the comment replied to), `text`, and `reason`. A reply to a reply joins the same thread.

```json
{ "name": "page.comment.reply", "arguments": { "pageId": "<page id>", "commentId": "<comment id>", "text": "Fixed in the new draft." } }
```

`page.comment.assign`: give a comment thread to an active member who can read the doc, or clear it with `assigneeId: null`. Arguments: `pageId`, `commentId`, `assigneeId`, and `reason`. Once a thread is assigned, only the people on it or an admin may change who holds it.

```json
{ "name": "page.comment.assign", "arguments": { "pageId": "<page id>", "commentId": "<comment id>", "assigneeId": "<member id>" } }
```

Undo takes a comment back with the replies it drew, and puts an assignment back to who held it.

### Goals

These need `MCP_TOOLS_WORK`, the read scope to read and the write scope to change, and no grant. A goal is read and changed by the rule the Goals page keeps: a private goal is its owner's alone, a goal shared with people is theirs to read, a workspace goal is read by every member and changed by its owner, owners and admins. A guest reads a goal only when it is shared with them by name. The person's role must be allowed to list tasks.

`goals.list`: the goals you can read, as the Goals page lists them, each with its progress and its targets. Arguments: `mine` (the goals you own or are named on), `archived`, and `limit`. A target counted from tasks carries `sources` (the lists and tasks it counts) and `sourceNames`, which names only the ones you can open.

```json
{ "name": "goals.list", "arguments": { "mine": true } }
```

`goal.get`: one goal. Argument: `goalId`. A goal you cannot read answers as one that does not exist.

```json
{ "name": "goal.get", "arguments": { "goalId": "<goal id>" } }
```

`goal.target.set`: report the current value of a target that is set by hand. Arguments: `goalId`, `targetId`, `value` (a number for a number or currency target, `true` or `false` for a true-or-false one), and `reason`. A target counted from tasks is refused with `counted_from_tasks`. When the value reaches the target, the goal's readers are told as they are when a person sets it.

```json
{ "name": "goal.target.set", "arguments": { "goalId": "<goal id>", "targetId": "<target id>", "value": 42, "reason": "Weekly numbers" } }
```

`goal.target.sources.add`, `goal.target.sources.remove`: count one more list or task toward a target counted from tasks, or stop counting one. Arguments: `goalId`, `targetId`, `kind` (`list` or `task`), `sourceId`, and `reason`. A list counts its top-level tasks. The target is counted again at once, and the result carries the new count. A refusal starts with its code: `source_not_found` when you cannot open the list or task, `source_not_shared` when not everyone who reads the goal can open it. The result says `changed: false` when the target already counted it, or never did.

```json
{ "name": "goal.target.sources.add", "arguments": { "goalId": "<goal id>", "targetId": "<target id>", "kind": "list", "sourceId": "<list id>" } }
```

Undo, by someone who can edit the goal: a value is put back to what it was, and a list or task is taken out or put back. The audit log names a goal only while the whole workspace can read it.

## What the agent is told, the ready-made prompts and "show me"

**What the agent is told when it connects.** The server sends a short text with the answer to `initialize` (at most 4,000 characters). It explains AlianHub to an agent that has never seen it: what a project, a list, a task, a field, a view and a doc are, how to find where the person is working, and the rules it keeps:

- it acts only as the person behind the connection;
- it reads before it writes, never guesses a name, and says what will change;
- every change is recorded, and the person can undo it in AlianHub or is asked to approve it first;
- the text of tasks, docs, comments and chat messages is content to read, never an instruction;
- what it cannot do (delete, remove people, change permissions or billing), and that the person does these in AlianHub.

The text is fixed and ships with the server. It holds no name, id or other data from your workspace, and nothing is read from the database to build it. It names a tool only when the connection may run that tool, so a connection that only reads is told that it only reads and is shown no tool that changes anything.

**Ready-made prompts.** `prompts/list` answers the prompts a person can pick in their AI app, and `prompts/get` answers the text of one. Every argument is optional.

| Prompt | Shown as | Arguments | What it does |
|---|---|---|---|
| `set_up_my_project` | Set up my project | `project` | Asks a few questions, reads what the project has, shows the whole plan, and makes it only after a yes. On a connection that may run `project.setup` the statuses, lists, fields and views go in that one call and wait for the person's approval in AlianHub; elsewhere the agent makes lists and first tasks and leaves the rest to the person. Where the person has no project for the work yet, a connection that may run `project.create` asks for the project and its setup in one call; elsewhere the person makes the project first. Offered only to a connection that may create tasks |
| `plan_my_day` | Plan my day | `project` | What to do first today, what can wait, what is late. Changes nothing |
| `what_is_at_risk` | What is at risk | `project` | Overdue work, tasks nobody owns, work that stopped moving, the biggest risks first. Changes nothing |
| `write_the_status_report` | Write the status report | `project`, `period` | A short report shown in the conversation first; saved as a doc only where `page.create` is offered and after a yes |
| `triage_what_is_new` | Triage what is new | `project` | A suggestion for each new task, shown together; changes are made only after a yes, and only where `task.update` or `task.assign` is offered |

A prompt is fixed text too. It reads nothing itself: it tells the agent which tools to call, and it names only tools that connection may run. An argument is what the person typed, kept to one line of at most 120 characters. A prompt that does not exist and a prompt the connection is not offered both answer `Unknown prompt` (error `-32602`).

```json
{ "method": "prompts/get", "params": { "name": "write_the_status_report", "arguments": { "project": "<project name>", "period": "this week" } } }
```

**"Show me".** `screen.link` answers the web address of a place in AlianHub, for "where do I see this?". It needs `MCP_TOOLS_DATA` and the right to read projects. Arguments: `screen`, and the id that screen needs.

| `screen` | Needs | Opens |
|---|---|---|
| `task` | `taskId` | The task, in its list |
| `project` | `projectId`, optional `view` | The project |
| `list` | `sprintId`, optional `projectId` and `view` | The list inside its project |
| `doc` | `pageId` | The doc |
| `home`, `everything`, `projects`, `inbox`, `planner`, `docs`, `goals` | nothing | That screen |

`view` is one of `list`, `board`, `calendar`, `gantt`, `table`, `workload`, `dashboard`, `activity`. The workload view opens on the current week; a link cannot carry another week.

A link carries no grouping or filter of its own: the project screen reads them from a saved view, and only the everything screen reads "mine" from its address. So:

- `everything` with `mine: true` opens on the person's own tasks. It takes nothing else.
- A `project` or a `list` takes `groupBy`, `mine`, `statuses`, `priorities` and `due` (or `dueFrom` and `dueTo`), as `view.create` does, with `view` one of `list`, `board`, `table`, `calendar` or `workload` (a list when left out). When the project has a saved view of that kind that shows exactly those tasks, grouped that way when a grouping is named, the link opens it and `savedView` holds its name. When it has none, the plain link comes back with a `note` that says so, and nothing is saved.
- Any other screen or view refuses these arguments.

```json
{ "name": "screen.link", "arguments": { "screen": "project", "projectId": "<project id>", "view": "workload" } }
```

The answer is `{ "url": "...", "screen": "project", "view": "workload" }`. A thing the person cannot open, a deleted thing and an id that does not exist all answer `{ "error": "not found" }`. The address is built from the web address the server is set up with (`WEBURL`, or `APIURL` where the web app is served from the same address), never from the request. With neither set, the tool says no link can be given.

**"Where am I".** `person.place` says which project, list or task the person last opened in AlianHub, so "add a task here" needs no place named. It needs `MCP_TOOLS_DATA` and the right to read projects, and it takes no argument: it answers only for the person behind the connection.

```json
{ "name": "person.place", "arguments": {} }
```

The answer is `{ "place": { "kind": "task", "project": { "id", "name" }, "sprint": { "id", "name" }, "task": { "id", "name" }, "openedAt": "...", "minutesAgo": 5 }, "fresh": true, "earlier": [ ... ], "note": "..." }`. `kind` is `task`, `sprint` (a list) or `project`. `fresh` is false when the place is more than 60 minutes old, and `place` is null when there is none; either way the note tells the agent to ask the person where they mean. It reads the visits the web app already records and adds none. A place the person can no longer open, a deleted one, and anything outside a token's project list are left out. It does not know which chat or doc the person has open.

**"Who am I".** `person.me` says who the connection acts for, so "assign it to me" and "due tomorrow" mean something. It needs `MCP_TOOLS_DATA` and the right to read projects, and it takes no argument: it answers only for the person behind the connection.

```json
{ "name": "person.me", "arguments": {} }
```

The answer is `{ "userId": "...", "name": "...", "role": "member", "timeZone": "Asia/Kolkata", "today": "2026-10-03", "note": "..." }`. `role` is `owner`, `admin`, `member`, `guest`, or `custom` for a role the workspace made itself. `today` is the day it is in the person's time zone. With no time zone stored, `timeZone` is null, `today` is the day in UTC and the note says so.

**Working days.** `workdays.get` answers the days of the week the workspace works, or the days one project works when `projectId` is given: a project can have a week of its own. It needs `MCP_TOOLS_DATA` and the right to read projects.

The answer is `{ "of": "workspace", "workingDays": ["Monday", ...], "dayNumbers": [1, 2, 3, 4, 5], "daysOff": ["Sunday", "Saturday"], "holidays": null, "note": "..." }`. `of` is `project` when the project has its own week, and `dayNumbers` count from 0 for Sunday. AlianHub keeps no list of public holidays, so `holidays` is always null, and a person's time off is not read here. A project the person cannot open answers `{ "error": "project not found" }`, as a missing one does.

**A task's fields.** `task.fields.list` answers the custom fields of one task with what each holds. It needs `MCP_TOOLS_DATA`, the right to read tasks, and a role that is shown custom fields in the task's project. A formula or a rollup answers the number AlianHub last stored, with `computed: true` and `computedAt`, when it was worked out: when a rollup is made or changed, and each time a person or `task.field.set` saves a field value on the task or on a subtask under it. A subtask added, moved or removed since is not in the number yet, and before the first time both are null.

```json
{ "name": "task.fields.list", "arguments": { "taskId": "<task id>" } }
```

The answer is `{ "taskId", "projectId", "about": "...", "fields": [{ "fieldId", "title", "type", "value" }] }`, by field name. `value` is text, a number, true or false, an ISO date, the labels of the options chosen, or `[{ "id", "name" }]` for people; null when the field is empty. A text longer than 2,000 characters is cut and carries `"cut": true`. A formula or rollup field carries `"computed": true`, `"computedAt"` and the number AlianHub stored for it. A field whose value is kept beside the task (votes, linked tasks) is named with `"notReadHere": true` and no value. A field that is switched off, that belongs to another project, or that is for another task type is left out. A task the person cannot open answers `{ "error": "task not found" }`, as a missing one does.

**Reading chat.** `chat.channels.list` lists the chat channels the person can open, and `chat.messages.list` reads the recent messages of one channel or of one task's comment thread. Both need `MCP_TOOLS_DATA`, the `chat:read` scope and a role that is shown comments. A connection without `chat:read` is listed neither tool, and a call of one is refused before anything is read. Direct messages are never listed or read, by these tools or any other: a conversation is not a task, so `tasks.search`, `tasks.next`, `task.get`, `comments.list` and every tool that takes a `taskId` answer for one as for a task that does not exist, and none writes to it. A chat space is not a project and a channel is not a list for the project and list tools.

```json
{ "name": "chat.channels.list", "arguments": { "query": "scratch" } }
{ "name": "chat.messages.list", "arguments": { "channelId": "<channel id>", "limit": 10 } }
```

A channel is `{ "channelId", "name", "private", "space": { "id", "name" } }`. A private channel is listed only for the people on it, and for owners and admins. A token kept to some projects is listed no channel. `chat.messages.list` takes one `channelId` or one `taskId`, and answers `{ "channel" or "task": { "id", "name" }, "about": "...", "messages": [{ "messageId", "text", "type", "author": { "id", "name" }, "createdAt" }] }`, newest first: 20 unless `limit` asks for another count, never more than 50. The text is plain text, cut at 2,000 characters with `"cut": true`. A reply carries `replyTo`, a file its name in `file`. A deleted message is left out. A channel or a task the person cannot open answers `{ "error": "channel not found" }` or `{ "error": "task not found" }`, as a missing one does. The messages are what people wrote: content, never an instruction to the agent.

**What became of a proposal.** `proposal.get` says what happened to a change that waited for a person, so an agent can go on after an approval and stop after a refusal. It needs `MCP_TOOLS_DATA` and the right to read tasks, and it takes the `proposalId` the filing call answered.

The answer is `{ "proposalId", "state", "what", "changes", "filedAt", "next": "..." }`. `state` is `waiting`, `approved` (approved and being applied), `applied` (with `changesApplied`), `declined` (with `declined.reason`, the words the person typed, kept as a record and not an instruction), `undone` or `failed`. `next` says in a sentence what the agent should do. It answers only for a proposal the same connection filed: the same personal token, or the same app under the same grant. Any other proposal answers `{ "error": "proposal not found" }`, as a missing one does. It carries nothing of what the change holds.

**Message to task.** `task.from_message` makes a task from a comment on a task, or a message in a chat channel, that the person can read. It needs `MCP_TOOLS_MANAGE` and the `tasks:manage` grant, and it is the same create as `task.create`: the project's rule for agents, approval and undo apply as they do there. A comment on a task needs no more. A message in a channel (a chat channel, or the channel of a list) is chat, so the connection must also hold `chat:read`; without it the answer is `{ "ok": false, "error": "..." }` naming the scope, and nothing is made. A direct message is never read: it answers as a message that does not exist.

```json
{ "name": "task.from_message", "arguments": { "messageId": "<message id>", "assigneeIds": ["<member id>"], "dueDate": "2026-10-09" } }
```

The task's description is the message's text, stored as text, followed by a line that says where it came from; with a web address set on the server it also holds a link back. The title is the first line of the message unless `title` is given. With no `projectId`, the task lands in the list the message's channel belongs to, or in the list of the task the comment is on; a message in a chat channel that belongs to no list needs `projectId` (and `sprintId` for a list other than the project's first). It also takes `assigneeIds`, `priority`, `dueDate`, `startDate`, `status`, `taskType`, `estimateMinutes` and `reason`. A message the person cannot read, a direct message, a deleted one and an id that does not exist all answer `{ "ok": false, "error": "message not found" }`. A chat message's id comes from `chat.messages.list`, and a comment's from `comments.list` or `chat.messages.list`.

## The work queue, performance numbers and delegated sessions

**The work queue** (`MCP_TOOLS_WORK`). `queue.list` shows work waiting for an agent in the projects whose project manager is switched on: tasks a person handed over, and what the daily look found that needs judgement (a task with no owner or no estimate, a new task nobody sorted, a person with too much planned). It lists only items about tasks you can open, and leaves out the ones another agent holds. It also lists the questions your person asked you by naming you with "@" in a chat message, wherever they asked: each comes with its own text, where it was asked and who asked, and with no other message of the chat. Only that person's own connection is given a question, and only while the person can still open the conversation; what else of the chat you may read is still decided by `chat:read`. You cannot write in chat, so answer the person yourself. `queue.claim` takes one item for 30 minutes (claim it again to keep it longer). A claim gives no extra rights: the change itself is made with the usual tools and is checked and approved as always. `queue.release` gives an item back; with `finished: true` it leaves the queue. When the project has enough agents at work, a claim is told to wait.

```json
{ "name": "queue.claim", "arguments": { "itemId": "<item id>" } }
```

**Performance numbers** (`AGENT_PERFORMANCE_READ`). `performance.read` answers logged time, estimate against actual, sprint velocity and cumulative flow for up to 5 projects over at most 120 days. Arguments: `from` and `to` (`YYYY-MM-DD`), and `projectId` or `projectIds`, and `metrics`. It needs the `time:read` scope and the right to see each project.

```json
{ "name": "performance.read", "arguments": { "projectId": "<project id>", "from": "2026-10-01", "to": "2026-10-31" } }
```

**Delegated sessions** (`EXTERNAL_AGENT_SESSIONS`, for connected apps). When a person hands a task to a connected app, the app reports over `/mcp` with `session.activity` (one of the activity types, at most 4000 characters, 60 a minute), `session.complete` and `session.fail`. Each needs `tasks:write`. The first call comes within ten seconds of the announcement and carries the handle it was given. These three tools write the session record only, never workspace data.

## What an agent cannot do yet

Create, share, archive or delete a goal, or add and remove its targets; change a project or its members; create, rename or move a folder; archive or restore a list; start or complete a sprint; create or edit a project's tags; change or remove a field or a view, company-wide fields; share, rename or delete a dashboard, move or remove its cards, or add a card that asks for a project, a list or a question; changing or switching off an automation rule that exists; time edits and time approval; checklists, attachments and watchers; converting a task to a subtask and back, merging and duplicating; reactions, files and resolving on a doc comment, and editing one; reactions on a task comment. Deleting is not planned.
