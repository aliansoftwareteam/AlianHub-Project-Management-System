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
   | `MCP_TOOLS_WORK=on` | `tags.list`, `task.tags.add`, `task.tags.remove`, `task.relations.list`, `task.relation.add`, `task.relation.remove`, `lists.list`, `list.create`, `list.rename`, `list.move`, `page.comments.list`, `page.comment.create`, `page.comment.reply`, `page.comment.assign`, `goals.list`, `goal.get`, `goal.target.set`, `goal.target.sources.add`, `goal.target.sources.remove`, `task.lists.list`, `task.lists.add`, `task.lists.remove`, and `sprintId` on `tasks.search`, for every token that reads or writes; none of them needs a grant |
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

The `MCP_TOOLS_WORK` tools take the plain scopes: `projects:read` for `tags.list`, `lists.list`, `goals.list` and `goal.get`, `tasks:read` for `task.relations.list` and `task.lists.list`, `docs:read` for `page.comments.list`, and `tasks:write` for each of their writes.

An app connected before these scopes existed, and any connection where one of the three is missing, lists and runs exactly what it did before. The write scope never stands in for a manage scope, and a manage scope never stands in for the write scope: closing a task through `task.status.set` takes both `tasks:write` and `tasks:manage`.

Taking it back works at each level and takes effect on the app's next call: an owner or admin removes the permission from the app, or revokes the app, under Settings, Agent clients; the person withdraws the one permission, or revokes the whole connection, under Accounts, Connected apps.

## Creating a token

In the web app, open the AI accounts page, choose **My account**, then **New token**.

- Give it a name, and choose the project it is limited to, or all your projects.
- Tick **Let this agent manage tasks** to create it with `tasks:manage`, and **Let this agent write docs** to create it with `docs:manage`. The boxes are shown only while `MCP_TOOLS_MANAGE` is on. Leave both unticked for an agent that should only read, comment, set an in-progress status and file tasks, and, where `MCP_TOOLS_WORK` is on, tag and link tasks, create, rename and move lists and comment on docs.
- Where the server requires it, choose an expiry and the read and write scopes. A grant needs the write scope.

The token is shown once. Add it to the agent as a bearer token:

```
claude mcp add alianhub --transport http "<your AlianHub URL>/mcp?companyId=<workspace id>" --header "Authorization: Bearer <token>"
```

Revoke a token on the same screen. A revoked or expired token stops working on its next call, and so does the token of someone removed from the workspace.

## What happens to a write

- It is checked first: the scope, the grant, the arguments against the tool's schema (an unknown argument, a wrong type or an out-of-range value is refused), and whether the person can open the task, the project, the list or the doc it names.
- It runs through the same server code the web app's own actions use, so the activity log, the notifications and the counters are the ones a person's change produces. The activity log names the agent and the person it acted for: "Claude, for Priya Shah has changed Status as Done". The line is stored as an agent's, so the task's activity and the project's activity log mark it and can be narrowed to changes made by an agent. An automation rule does not answer the change unless the rule was set to react to changes made by automations and agents.
- It is recorded in the agent audit log with what it replaced. Where the result says `undoable: true`, a person can undo it from that log within the workspace's undo window.
- With `MCP_TOOLS_V2` on, a call that cannot be undone (`task.move`) is not run. It is filed as a proposal in the Inbox, and the result says `pending: true`. A person who can open the same task and holds the same permission approves or declines it.
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

## What an agent cannot do yet

Create, share, archive or delete a goal, or add and remove its targets; change a project or its members; create, rename or move a folder; archive or restore a list; start or complete a sprint; create or edit a project's tags; saved views and dashboards; automations; time edits and time approval; checklists, attachments and watchers; converting a task to a subtask and back, merging and duplicating; reactions, files and resolving on a doc comment, and editing one; reactions on a task comment. Deleting is not planned.
