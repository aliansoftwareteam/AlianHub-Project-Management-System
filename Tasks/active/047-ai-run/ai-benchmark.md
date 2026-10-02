# 047: the AI benchmark sheet (AI-1)

First written 2026-10-02 against `beta` as of pull request #1412. Revised the same day against `beta` at a24135f (pull request #1525). Tracker: AP-441, sprint "047 wave".

This is the sheet only. No run has been made yet, so every measured cell is empty. The marks below are a reading of the code, not a result.

What it is for: finish line eight (a) in `task.md`. Of the 25 benchmark jobs, at least 15 must be done by one sentence plus one approval.

Where things come from:
- The 25 jobs, their start states and their end conditions: `Tasks/active/046-better-than-clickup/benchmark-25-jobs.md`. They are not repeated here.
- The pass rules: `task.md`, slice AI-1, "What counts as success".
- The tools and the rules that hold them: read from `Modules/Mcp/` and `Modules/Agents/` (the registry group files in `Modules/Agents/registry/`) on 2026-10-02. The rating of every tool action was dumped from the registry with the three tool flags on.

## How to read it

**Each step of a job is one of four things.** These are the words used in the step lists.
- **read:** the tool changes nothing.
- **at once:** the change is applied now and shows Undo. It is one task, and it can be undone.
- **waits:** the tool files a proposal and changes nothing. A person approves it in AlianHub. This counts as one approval.
- **refused:** the tool answers with a refusal and the reason.

**Each of the 18 jobs has one mark.**
- **should pass:** every step is a read or is applied at once, and nothing in the code stands in the way.
- **should pass with approval:** exactly one step waits for a person, and every other step is a read or is applied at once.
- **cannot pass yet:** a step is refused, no tool does a part of the job, or the code forces two or more approvals. The pass rule allows one.

**What the marks assume.**
- The project is on its default setting, "Act on single tasks, propose anything wider" (`DEFAULTS` in `Modules/Agents/projectPolicy.js`).
- `MCP_TOOLS_V2` and `AGENT_TAINT_ROUTING` are off. "How to run it" says what changes when they are on.
- The connection holds "Manage tasks" and "Write docs". For job 3 it also holds the chat permission, and an owner or admin has approved it for that app.
- The agent changes no more than 10 tasks in the project inside 10 minutes. The 11th change in that window waits (`directTasks` in `Modules/Agents/projectLimits.js:11`, counted in `Modules/Agents/directChanges.js`). Running many jobs back to back in QA Sandbox can reach it.
- A mark that rests on how the code files a batch was read from `Modules/Mcp/tools.js`, not run.

**Columns of the 25-job table.** "Start" is the screen the person has open in AlianHub. "Here", "this list" and "this task" in a sentence mean that screen. The sentence is typed once, in a fresh conversation. Items are named `[AI bench] ...` so they do not collide with the earlier runs. "Pick": "15" is one of the fifteen chosen jobs, "Reserve" is one of the three reserves, "No" is not run for the count. "Verdict" is measured and stays empty until the run.

## The 25 jobs

| # | Job | Start | The sentence | Pick | Verdict |
|---|---|---|---|---|---|
| 1 | Create a task with assignee, due date and priority | The list | Add a task "[AI bench] Write release note" for me, due tomorrow, high priority. | 15 | |
| 2 | Quick-create from anywhere | Home | Add a task "[AI bench] Call supplier" to [AI bench] list. | 15 | |
| 3 | Turn a message into a task | The chat | Make a task in [AI bench] list from the last message in the scratch channel. | 15 | |
| 4 | Subtasks to three levels | The parent task | Under "[AI bench] Parent" add a subtask "Child", under that "Grandchild", and under that "Great-grandchild". | Reserve | |
| 5 | Folder, subfolder, list, and move a task | The list | In QA Sandbox make a folder "[AI bench] folder", inside it a subfolder "[AI bench] subfolder", inside that a list "[AI bench] inner list", and move "[AI bench] Write release note" into that list. | Reserve | |
| 6 | Duplicate a project | The project | Duplicate the project QA Sandbox as "[AI bench] Sandbox copy", with its lists, statuses and views. | No | |
| 7 | Bulk-edit twenty tasks | The list | Set "[AI bench] bulk 01" to "bulk 20" to high priority and assign them all to (the teammate). | 15 | |
| 8 | Group by a custom field | The list | Show me this list grouped by Stage. | 15 | |
| 9 | Filter and save a view | The list | Show my tasks due this week and save it as a view called "[AI bench] Mine this week". | 15 | |
| 10 | Everything list | Home | Show me all my tasks across every project. | 15 | |
| 11 | Board drag | The list | Move "[AI bench] Design" to In Progress. | 15 | |
| 12 | Custom fields of the main types | The list | Add fields to this project: a text field Note, a number field Cost, a dropdown Stage with Alpha and Beta, a date field Review date and a people field Reviewer. On "[AI bench] Write release note" set them to: ok, 120, Beta, tomorrow, me. | 15 | |
| 13 | Totals of a number field | The list | Show the total of Cost for each group, and show on "[AI bench] Parent" the total Cost of its subtasks. | 15 | |
| 14 | Comment with a mention, reply in a thread | The task | On this task, comment "please review" and mention (the teammate), then reply to that comment with "Done". | No | |
| 15 | Share a doc | Docs | Create a doc "[AI bench] Launch notes" in QA Sandbox with the line "First draft", and tell me who can see it. | 15 | |
| 16 | Doc history restore | The doc | In the doc "[AI bench] Launch notes" change the line to "Second draft", then restore the first version. | No | |
| 17 | Timer and manual time | The task | Start a timer on this task and stop it, then log 1 hour 30 minutes on it for today. | 15 | |
| 18 | Weekly timesheet, submit and approve | Home | Submit my timesheet for this week and approve it. | No | |
| 19 | Dependency and Gantt shift | The list | Make "[AI bench] Build" wait on "[AI bench] Design", then move Design two working days later. | 15 | |
| 20 | Sprint | The list | Create a sprint "[AI bench] Sprint 9" for two weeks from today and add "[AI bench] bulk 01" to "bulk 05" to it. | Reserve | |
| 21 | Automation rule | The project | When a task's status changes to Done, send the assignees the notice "[AI bench] Done notice". | No | |
| 22 | Dashboard card | Dashboards | Create a dashboard "[AI bench] Board" with a card of tasks by status. | No | |
| 23 | Workload view | Home | Show me each person's workload in QA Sandbox for this week, counted in tasks. | 15 | |
| 24 | Search | Home | Open the task about the supplier, and open the doc about the launch. | 15 | |
| 25 | Invite a member; a private project | Home | Invite (a test address) as a member, and make QA Sandbox private with access for (the teammate) only. | No | |

The pick is the one this sheet made on 2026-10-02: 15 jobs and 3 reserves. It is unchanged by this revision. Row 15 of the owner's open decisions in `task.md` is still open.

## The marks: 15 delegations and 3 reserves

Counts: of the 15, **10 should pass, 3 should pass with approval, 2 cannot pass yet.** All 3 reserves cannot pass yet.

| # | Job | Pick | Mark | Why, in one line | The file that shows it | Measured verdict |
|---|---|---|---|---|---|---|
| 1 | Create a task | 15 | should pass | One `task.create` carries the assignee, the date and the priority, and `person.me` answers "me" and "tomorrow". | `Modules/Mcp/manageTools.js:421`, `Modules/Mcp/contextTools.js:141` | |
| 2 | Quick-create | 15 | should pass | The list is named in the sentence, and `task.create` is applied at once. | `Modules/Mcp/manageTools.js:421`, `Modules/Mcp/workTools.js:159` | |
| 3 | Message to task | 15 | should pass | `chat.messages.list` gives the id of the newest message and `task.from_message` makes the task at once. The connection must hold the chat permission. | `Modules/Mcp/chatTools.js:141`, `Modules/Mcp/intentTools.js:200` | |
| 7 | Bulk-edit twenty | 15 | cannot pass yet | Twenty tasks with two changes each are 40 operations, a batch takes 25, and each batch waits as its own proposal, so two approvals. | `Modules/Mcp/manageTools.js:33`, `Modules/Mcp/tools.js:538` | |
| 8 | Group by a field | 15 | should pass with approval | No saved view groups by Stage, so `view.create` waits, and that is the one approval. | `Modules/Mcp/setupTools.js:287`, `Modules/Agents/registry/setup.js:11` | |
| 9 | Filter and save a view | 15 | should pass with approval | `view.create` takes `mine` and `due: this_week`, and it waits as one proposal. | `Modules/Mcp/setupTools.js:123`, `Modules/Mcp/setupTools.js:287` | |
| 10 | Everything list | 15 | should pass | `screen.link` opens the everything screen on "Me" and changes nothing. | `Modules/Mcp/screenTools.js:115`, `frontend/src/views/Everything/Everything.vue:357` | |
| 11 | Board drag | 15 | should pass | `task.status.set` to a status that is not a done one is applied at once. | `Modules/Mcp/manageTools.js:410`, `Modules/Agents/projectPolicy.js:139` | |
| 12 | Five custom fields | 15 | should pass with approval | `fields.create` carries the five first values, so one proposal makes the fields and fills them. | `Modules/Mcp/setupTools.js:264`, `Modules/Mcp/setupTools.js:77` | |
| 13 | Totals of a number field | 15 | cannot pass yet | Part (a) is a `view.create` proposal and part (b) is a `fields.create` rollup proposal, so two approvals. | `Modules/Mcp/setupTools.js:264`, `Modules/Mcp/setupTools.js:287` | |
| 15 | Share a doc | 15 | should pass | `page.create` makes the doc at once as an agent's draft, and `project.get` names the project's people. | `Modules/Mcp/manageTools.js:281`, `Modules/Agents/pageRequests.js:55` | |
| 17 | Timer and manual time | 15 | should pass | `timelog.start`, `timelog.stop` and `timelog.create` are each applied at once. | `Modules/Mcp/tools.js:194`, `Modules/Agents/actions.js:344` | |
| 19 | Dependency and shift | 15 | should pass | The link and both date changes are applied at once, but the server does not shift Build, so the agent must move it. | `Modules/Mcp/workTools.js:222`, `frontend/src/views/Projects/composables/ganttShift.js` | |
| 23 | Workload view | 15 | should pass | `screen.link` opens the project on its workload view, on the current week. | `Modules/Mcp/screenTools.js:24`, `Modules/Mcp/screenTools.js:115` | |
| 24 | Search | 15 | should pass | Two searches and two links, all reads. | `Modules/Mcp/tools.js:87`, `Modules/Mcp/dataTools.js:221` | |
| 4 | Three levels of subtasks (reserve) | Reserve | cannot pass yet | The third `subtask.create` is refused: a task tree stops at three levels. | `Modules/Tasks/helpers/taskTreeRules.js:28` | |
| 5 | Folder, list, move (reserve) | Reserve | cannot pass yet | `folder.create` waits, and a `task.move` cannot be undone, so it always waits too: two approvals. | `Modules/Agents/registry/manage.js:24`, `Modules/Agents/projectPolicy.js:167` | |
| 20 | Sprint (reserve) | Reserve | cannot pass yet | `list.sprint.set` waits and the five `task.move` calls wait as a second proposal: two approvals. | `Modules/Mcp/setupTools.js:414`, `Modules/Agents/registry/manage.js:24` | |

## Step by step

Tool names are the ones a connected agent sees. "Reads" are listed once, in the order the agent would use them. The first column of each line is the mark.

**Job 1, create a task.** should pass.
- `person.place` (read, for "here"), `person.me` (read: the person's id and today's date).
- `task.create` with `assigneeIds`, `priority` and `dueDate`: at once.

**Job 2, quick-create.** should pass.
- `projects.list`, `lists.list` (read).
- `task.create`: at once.

**Job 3, message to task.** should pass.
- `chat.channels.list`, `chat.messages.list` with `limit` 1 (read, newest first), `lists.list` (read).
- `task.from_message`: at once. Its description is the message text with a link back.
- Without the chat permission, `chat.channels.list` and `chat.messages.list` are refused (`optIn: CHAT_SCOPE` in `Modules/Mcp/chatTools.js`), and `task.from_message` answers that a chat message was not read (`NEEDS_CHAT` in `Modules/Mcp/intentTools.js`). That is a setup step, see "Connect Claude".

**Job 4, three levels (reserve).** cannot pass yet.
- `person.place` or `tasks.search` (read).
- `subtask.create` Child: at once. `subtask.create` Grandchild: at once. `subtask.create` Great-grandchild: refused, "Subtasks nest three levels deep at most, and that parent is already on the third" (`Modules/Tasks/helpers/taskTreeRules.js:8`, `MAX_DEPTH` at line 4).
- Decided on 2026-10-02: the rule stays and the job is rewritten. The new sentence is not written yet.

**Job 5, folder, subfolder, list, move (reserve).** cannot pass yet.
- `lists.list` (read).
- `folder.create` with `subfolders` and `lists` (`Modules/Mcp/setupTools.js:387`): waits. One proposal makes the folder, the subfolder and the inner list. Folders go one level deep, and a subfolder holds lists.
- After the approval, `lists.list` (read) for the new list's id, then `tasks.search` (read).
- `task.move`: waits, on every setting, because a move cannot be undone (`undoable: false` at `Modules/Agents/registry/manage.js:24`, answered as `NOT_UNDOABLE` at `Modules/Agents/projectPolicy.js:167`).
- Two approvals. `task.lists.add` is applied at once but only adds the task to the list; it keeps its home list, so it is not a move.

**Job 7, bulk-edit twenty.** cannot pass yet.
- `person.place`, `tasks.search`, `members.list` (read).
- `tasks.batch` with `task.update` (priority) and `task.assign` for each task: 40 operations. A batch takes at most 25 (`BATCH_MAX`, `Modules/Mcp/manageTools.js:33`), so two calls.
- Each call names more than one task, so it runs nothing and waits as one proposal (`Modules/Mcp/tools.js:538`, `fileBatch` at line 508). Two approvals. See "Job 7: how many approvals".

**Job 8, group by a field.** should pass with approval.
- `person.place`, `fields.list` (read). `screen.link` with `groupBy` (read): it opens a saved view that already groups that way, and there is none, so it answers the plain link and a note (`Modules/Mcp/screenTools.js:91`).
- `view.create` with `groupBy` set to the Stage field's id: waits. This is the one approval.
- After the approval, `screen.link` again gives the link to the saved view.
- Open: a saved view shows to everyone on the project. Whether "show me" may save one is not settled (gap 20).

**Job 9, filter and save a view.** should pass with approval.
- `person.place`, `person.me` (read).
- `view.create` with `mine: true` and `due: "this_week"`, named "[AI bench] Mine this week": waits. One approval.

**Job 10, everything list.** should pass.
- `screen.link` with `screen: everything` and `mine: true` (read). The page opens on "Me". `tasks.search` can answer in the conversation instead.

**Job 11, move a card.** should pass.
- `tasks.search`, `statuses.list` (read).
- `task.status.set`: at once. A status of a done type would wait or be refused by the project's rule (`closes` in `Modules/Agents/projectPolicy.js:139`); In Progress is not one.

**Job 12, five custom fields.** should pass with approval.
- `person.place`, `fields.list`, `person.me`, `tasks.search` (read).
- `fields.create` with the five definitions and `values` for the release-note task: waits. One approval makes the fields and sets the five values.
- `proposal.get` (read) says what became of the proposal.

**Job 13, totals of a number field.** cannot pass yet.
- `person.place`, `fields.list` (read).
- (a) `view.create` with the Cost column shown (`showFieldIds`): waits.
- (b) `fields.create` with a rollup, `function: sum`, `source: Cost`: waits. A rollup shows its number once the person approves it (`Modules/Mcp/setupTools.js:60`).
- `task.fields.list` (read) shows the saved total on the parent.
- Two proposals, two approvals. By reading `fileBatch`, one `tasks.batch` holding both would be one proposal, but no tool text asks for that. Not run.

**Job 15, share a doc.** should pass.
- `projects.list` (read).
- `page.create`: at once. The doc is saved as an agent's draft (`draft: true`, `Modules/Agents/pageRequests.js:66`). A person approves a draft at `Modules/Pages/controller.js:529`.
- `project.get` (read) names the project's members, who can open a project doc.
- Open: whether a draft counts for the end condition. Sharing with one named person has no tool.

**Job 17, timer and manual time.** should pass.
- `person.place`, `person.me` (read).
- `timelog.start`: at once. `timelog.stop`: at once. `timelog.create` with `minutes: 90` and `date` from `person.me`: at once.
- A stop under half a minute keeps the entry with 0 minutes (`Modules/Agents/actions.js:367`). `timelog.create` reads its day in UTC (`timelogEntry`, `Modules/Agents/actions.js:176`), so the agent passes the person's own date.
- Both timers and entries are refused in an approved timesheet week, with the reason (`Modules/Agents/actions.js:353`, `:375`).

**Job 19, dependency and shift.** should pass.
- `person.place`, `tasks.search`, `workdays.get` (read).
- `task.relation.add` (Build `blocked_by` Design): at once.
- `task.update` on Design: at once. `task.update` on Build: at once.
- The server does not move a task that waits on the one you moved. The shift lives in the web Gantt (`frontend/src/views/Projects/composables/ganttShift.js`). The agent has to move Build itself, which is one more change than the sentence names.

**Job 20, sprint (reserve).** cannot pass yet.
- `person.place`, `person.me` (read).
- `list.create`: at once.
- `list.sprint.set` with the first and last day (`Modules/Mcp/setupTools.js:414`): waits.
- `tasks.search` (read), then `tasks.batch` of five `task.move`: waits as one proposal, because a move cannot be undone and the batch names five tasks.
- Two approvals. By reading `fileBatch`, putting `list.sprint.set` and the five moves in one `tasks.batch` would make one proposal. Not run.
- `task.lists.add` refuses a sprint (`constraint` in `Modules/Agents/registry/taskLists.js`).

**Job 23, workload view.** should pass.
- `projects.list` (read), `screen.link` with `screen: project` and `view: workload` (read). It opens on this week. The link cannot pick the unit; the person picks tasks on the page.

**Job 24, search.** should pass.
- `tasks.search`, `screen.link` for the task. `pages.search`, `screen.link` for the doc. All reads.

## The jobs not picked, read again

The seven jobs outside the count, against today's code. They are not run for the count.

- **Job 6, duplicate a project.** `project.duplicate`: waits, one approval. It would read as should pass with approval (`Modules/Mcp/setupTools.js:362`, #1467).
- **Job 14, comment and reply.** `task.comment` is applied at once. A reply in a task's comment thread has no tool: `page.comment.reply` is for docs. These are the person's own words.
- **Job 16, restore a doc version.** `page.update` keeps the old text as a version, but no tool lists or restores versions (`Modules/Agents/pageRequests.js:79`). A person's decision.
- **Job 18, timesheet.** `timesheet.read` only. No tool submits or approves. Approving is a person's decision.
- **Job 21, automation rule.** `automation.catalogue` and `automation.create` (`Modules/Mcp/automationTools.js:68`): waits, and only an owner's or an admin's agent may ask for it. It would read as should pass with approval. The rule starts switched off unless the proposal says otherwise.
- **Job 22, dashboard card.** `dashboard.card.add` with `newDashboard` and `card: tasks_by_status`: waits, one approval (`Modules/Mcp/dashboardTools.js:25`, `Modules/Agents/dashboardRequests.js:30`). It would read as should pass with approval.
- **Job 25, invite and private project.** No tool invites a person or changes who can open a project. `permissions.edit` is on the never-list.

Jobs 6, 21 and 22 now read as likelier passes than the three reserves. The reserves count only if one of the fifteen fails, and all three cannot pass yet. This is for the owner's decision 15. The sheet's pick is not changed here.

## Job 7: how many approvals

Read from the code on 2026-10-02 at a24135f, after #1427. Nothing here changed since. `tests/agent-proposal-cards.test.js` ("benchmark job 7") runs the same numbers.

- **Two tools for each task.** `task.update` sets the priority; it does not take assignees (`EDITED` in `Modules/Mcp/manageTools.js`). `task.assign` sets the assignee. Twenty tasks with two fields each are 40 operations.
- **One batch call takes 25.** `BATCH_MAX` in `Modules/Mcp/manageTools.js:33` is the `maxItems` of `tasks.batch`. A call with 40 operations is refused before anything is read, and nothing is filed.
- **A call that names more than one task runs nothing.** `runBatch` in `Modules/Mcp/tools.js` counts the tasks the operations name; above one it goes to `fileBatch`, which files every change of that call as one proposal, approved or declined whole. This holds on both project settings.
- **So today: two batch calls, two proposals, two approvals.** For example 25 and 15, or 20 and 20. Each approval applies its changes one by one; nothing changes before it.
- **Against the pass rule** (at most one approval) job 7 fails today, and only because of the cap. Each proposal is one card and one click.
- **The cap that would make it one: 40.** With `BATCH_MAX` at 40 the job is one call, one proposal and one approval. A proposal's list of changes has no size limit of its own (`create` in `Modules/Agents/proposals.js`), and the card names the first five tasks and counts the rest.
- **The cap is not changed here.** It is the owner's call: a bigger batch is a bigger change behind one click. The other way to one approval, also not built, is a `task.update` that takes assignees, which makes the job 20 operations.
- **Without a batch the count of tasks still stops it.** Twenty single calls apply the first 10 tasks at once and wait for each task after that (`Modules/Agents/directChanges.js`, `directTasks` 10 in 10 minutes).

## The three reserves

They are measured too. They count only if one of the fifteen fails.

1. **Job 4, three levels of subtasks.** The first two levels work today. The third is refused by the product's own rule. The rule stays; the job is to be rewritten.
2. **Job 20, sprint.** The list, the sprint days and the five moves all have tools now. They need two approvals: one for the days and one for the moves.
3. **Job 5, folder, subfolder, list, move.** The folder, the subfolder and the list are one proposal now. The move of the task waits as a second approval, because a move cannot be undone.

## The biggest gaps

1. **One sentence that needs two proposals.** Job 7 is cut by a batch of 25 against 40 operations. Job 13 needs a view and a rollup field. Job 20 needs the sprint days and the moves. The pass rule allows one approval for a sentence, and the code counts one approval for each proposal.
2. **A move of a task always waits.** It cannot be undone, so it is never applied at once, on any project setting (`Modules/Agents/projectPolicy.js:167`, #1476). Jobs 5 and 20 both end in a move.
3. **The third level of subtasks is refused.** It is a product rule (`Modules/Tasks/helpers/taskTreeRules.js:4`). Job 4 cannot pass until the job is rewritten.

Not in the count but still without a tool: a reply in a task's comment thread (job 14), a doc's versions (job 16), a timesheet's submit and approve (job 18), an invitation and who can open a project (job 25).

## Where this differs from the list in `task.md`

`task.md` names 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 17, 19, 20 and 21 as the fifteen, with 5, 15 and 22 as reserves. That list is the owner's open decision 15.

This sheet picks by what the tools can do:
- **In:** 23 and 24. `task.md` left them out because they are already short by hand. They still count toward "15 of 25", and both should pass.
- **In:** 15, moved up from reserve. The tool exists and should pass.
- **Out to reserve:** 4 and 20. Each cannot pass yet.
- **Out:** 21 and 22. They now have tools and read as should pass with approval. See "The jobs not picked, read again".
- **Job 17's sentence is longer here.** The job's end condition is two time entries, so the sentence asks for the timer and the manual entry. `task.md` asks for the manual entry only.

If the owner keeps the list in `task.md`, the marks above still hold. Only the Pick column changes. Under that list: jobs 1, 2, 3, 8, 9, 10, 11, 12, 17 and 19 read as should pass or should pass with approval; jobs 4, 7, 13 and 20 cannot pass yet; job 21 should pass with approval.

## How to run it

### 1. Turn the flags on (the owner does this)

The owner turns these on in their own `.env` on the local build. No agent edits that file.

```
MCP_OAUTH=on
MCP_TOOLS_DATA=on
MCP_TOOLS_MANAGE=on
MCP_TOOLS_WORK=on
```

Then restart the server.

What each one gives:
- `MCP_OAUTH`: Claude can connect as an app, with a consent screen.
- `MCP_TOOLS_DATA`: reading projects, lists, statuses, comments, docs and timesheets, logging time, `screen.link`, `person.place`, `person.me`, `workdays.get`, `task.fields.list`, `proposal.get` and the chat reads.
- `MCP_TOOLS_MANAGE`: changing tasks, the batch call, writing docs and `task.from_message`.
- `MCP_TOOLS_WORK`: tags, links between tasks, lists, folders, sprints, doc comments, goals, fields, views, project setup, project create and copy, dashboard cards, automations and the work queue.

Two more settings change the result. Write their values at the top of the run sheet.
- `MCP_TOOLS_V2`: when on, a write rated not reversible, or one that reaches the whole workspace, waits for approval (`isDestructive` in `Modules/Mcp/annotations.js`). A task move already waits on every setting, so V2 adds nothing to jobs 5 and 20.
- `AGENT_TAINT_ROUTING`: when on, a connected app's change that reaches more than one task waits for approval. That includes a new task, a new list, a link between tasks and a new doc. Many "at once" steps above then become "waits", and the marks of jobs 1, 2, 3, 15, 19 and 11 would change.

`screen.link` needs the server to know its own web address (`WEBURL` or `APIURL`). Without one it answers that no link can be given.

### 2. Connect Claude with the manage grant

1. In AlianHub open AI, then Connect your AI.
2. The page shows the address to paste. In Claude: Settings, then Connectors, then Add custom connector.
3. Claude opens AlianHub's consent screen. Tick "Manage tasks" and "Write docs". Both start unticked. For job 3 also tick "Read messages in channels you are in". It starts unticked, and a connection made before it existed never gets it.
4. An owner or admin approves the app for those permissions in Settings, Agent clients.
5. The Connect your AI page changes to "Connected" when the first call arrives. The connection is also listed under Accounts, Connected apps.

To check before the run:
- The page says the address must be reachable from outside the network. How Claude reaches a build on localhost is not settled.
- Whether Claude can register itself, or an owner must add it under Agent clients first. `MCP_OAUTH_DCR` exists for this and is off by default.
- Whether the Claude app asks before each tool call. `task.md` counts an approval asked by the AI app as one approval. Choose one setting for the whole run, and write it down.
- For job 21, the person behind the connection must be an owner or an admin.

### 3. Prepare the project

- Use project "QA Sandbox". Leave its agent settings on the defaults: "Agents and Done" on "With approval", "Connected agents" on "Act on single tasks, propose anything wider".
- Make the start state of each job as the benchmark file says, with `[AI bench]` names. Jobs 7 and 20 need "[AI bench] bulk 01" to "bulk 20". Jobs 8 and 13 need the Stage and Cost fields. Job 3 needs one message in the scratch channel.
- Open the start screen in AlianHub before each sentence. `person.place` trusts a screen opened in the last 60 minutes.
- Leave 10 minutes between runs that change many tasks in QA Sandbox, or raise the project's count of tasks an agent may change at once (`directTasks`, 1 to 100). Write the value down.

### 4. Run each job three times

- 15 jobs and 3 reserves, three runs each: 54 short conversations.
- Each run is a fresh conversation. A model does not always answer the same way.
- Type the sentence exactly as written. Say nothing else unless the agent asks.
- Stop the clock when the end condition in the benchmark file is true on the screen.
- Reset the start state between runs. Delete nothing: archive or rename with a run number.

### 5. What to record for every run

| Field | What to write |
|---|---|
| Sentence said | The exact text typed, and any second sentence |
| Tool calls made | The tool names in order, as the conversation shows them, and how many |
| Approvals asked | How many, and where: in the Claude app or in AlianHub |
| Time | Seconds from sending the sentence to the end condition |
| Result | Pass, pass with corrections, or fail |
| What went wrong | The refusal text, the wrong value, the question asked, or the thing changed that was not asked for |

At the top of the sheet: the date, the build, the AI app with its version and model, the grants ticked, and the values of the six settings above.

The record, one row per run:

| Job | Run | Sentence said | Tool calls made | Approvals (app / AlianHub) | Time (s) | Result | What went wrong |
|---|---|---|---|---|---|---|---|
| | 1 | | | | | | |
| | 2 | | | | | | |
| | 3 | | | | | | |

### 6. How a job is judged

From `task.md`:
- **Pass:** the end condition is reached with one sentence, at most one approval and no correction.
- **Pass with corrections:** the end condition is reached, but the person changed something or answered a question.
- **Fail:** the end condition is not reached, a second sentence was needed, or something was changed that the sentence did not ask for.
- A job counts toward the fifteen when at least two of its three runs are a clean pass, and no run changed anything it was not asked to.

After the run, fill the Verdict columns above, write the number into the AI row of `Tasks/active/046-better-than-clickup/scorecard.md`, and list everything the run left in the project at the end of this file.

## Gaps found while writing

Each line is a job where a tool is missing or a rule would stop the agent. Read again on 2026-10-02 at a24135f. "Closed" names the pull request, or the file where the tool is now. "Open" has no tool or no decision yet.

**Tools that were missing**

1. **Job 3, reading chat.** Closed by #1429: `chat.channels.list` and `chat.messages.list` (`Modules/Mcp/chatTools.js:129`). Reading chat is a permission of its own, so the connection must be given it.
2. **Job 1, and every "for me" or "mine".** Closed by #1429: `person.me` (`Modules/Mcp/contextTools.js:141`).
3. **Job 9, the due date in a view.** Closed by #1425: `due`, or `dueFrom` and `dueTo` (`Modules/Mcp/setupTools.js:123`).
4. **Jobs 8 and 10, a link that carries a grouping or "Me".** Partly closed by #1425. The everything screen opens on "Me". A project or a list opens on a saved view that already shows it that way. With no such view the plain link comes back with a note, so a grouping nobody saved still needs `view.create`.
5. **Job 12, fields and their first values.** Closed by #1425 and #1429: `fields.create` takes `values`, and `proposal.get` says what became of a proposal (`Modules/Mcp/contextTools.js:230`).
6. **Job 13, a total of a number field.** Closed for the tools by #1465: `fields.create` makes a rollup or a formula, and `task.fields.list` reads a task's values (`Modules/Mcp/setupTools.js:60`, `Modules/Mcp/contextTools.js:193`). What stays: the view for (a) and the rollup for (b) are two proposals.
7. **Job 5, a folder or a subfolder.** Closed by #1450: `folder.create` (`Modules/Mcp/setupTools.js:387`). What stays: the move waits as a second approval.
8. **Job 20, a sprint with dates.** Closed by #1450: `list.sprint.set` (`Modules/Mcp/setupTools.js:414`). What stays: the moves wait as a second approval.
9. **Job 19, the working days.** Closed by #1429: `workdays.get` (`Modules/Mcp/contextTools.js:168`). The check on `task.update` is answered: it does not move the tasks that wait on the one it moved. The shift is in the web Gantt, so the agent moves Build itself.
10. **Job 21, automations.** Closed by #1423: `automation.catalogue` and `automation.create`. The rule is always a proposal, and only an owner's or an admin's agent may ask for one.
11. **Job 22, a dashboard card.** Closed by #1465 for one card: `dashboard.card.add` (`Modules/Mcp/dashboardTools.js:25`). The cards a connected agent may add are listed in `CARDS` in `Modules/Agents/dashboardRequests.js:23`. A card that needs a project, a list or a question is added in AlianHub.
12. **Job 14, a reply in a task's comment thread.** Open. No tool.
13. **Job 16, a doc's versions.** Open. No tool lists or restores them.
14. **Job 15, sharing a doc with one named person.** Open. No tool, and the web app cannot do this either.
15. **Job 18, submitting or approving a timesheet.** Open. No tool.
16. **Job 6, duplicating a project.** Closed by #1467: `project.duplicate` asks for the copy and a person approves it. The copy is private to the approver. Tasks are copied only when asked for, without their assignees, and a project with more than 300 tasks is copied without them.
17. **Job 25, an invitation or who can open a project.** Open. No tool.

New since the first sheet and tied to no job above: `project.setup` (#1420) and `project.create` (#1433). Neither duplicates a project.

**Rules that stop the agent, or that do less than the plan says**

18. **Job 4.** The task tree stops at task, subtask, sub-subtask. Decided on 2026-10-02: the rule stays and the job is rewritten. The new sentence is not written yet.
19. **Job 7.** Closed by #1427 for the wider-than-one-task rule: a batch that names more than one task waits as one proposal. Read again: the job is 40 changes and a batch takes 25, so it ends in two approvals. A cap of 40 would make it one. See "Job 7: how many approvals".
20. **Job 8.** A saved view shows to everyone on the project. The pass rule fails a run that changes something the sentence did not ask for. To settle: whether "show me" may save a view.
21. **Job 17.** Checked. `timelog.stop` keeps the entry, with 0 minutes under half a minute. `timelog.create` reads its day in UTC, and `person.me` gives the person's own date for the agent to pass.
22. **Jobs 5 and 20.** Changed by #1476: a connected agent's move of a task always waits, on every project setting. The five moves of job 20, sent as one batch, wait as one proposal.
23. **Job 15.** A doc an agent creates is a draft until a person approves it. To check: whether that counts toward "one approval".
24. **Under "Propose everything".** A connected app's comments, links and timers were refused, not queued (`progress.md`, #1394). Not read again on this pass. Jobs 14 and 17 may not pass in a project on that setting.

**To settle before the first run**

25. How Claude reaches a local build, and how the app gets approved (see "Connect Claude" above).
26. Whether the Claude app's own "allow this tool" prompts count as approvals. If each one counts, any job with more than one tool call fails.
27. Which fifteen: this sheet's, or the list in `task.md` (the owner's open decision 15). Until the owner decides, this sheet's pick stands.
