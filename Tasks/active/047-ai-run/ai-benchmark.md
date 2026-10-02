# 047: the AI benchmark sheet (AI-1)

Written 2026-10-02 against `beta` as of pull request #1412. Tracker: AP-441, sprint "047 wave".

This is the sheet only. No run has been made yet, so every verdict cell is empty.

What it is for: finish line eight (a) in `task.md`. Of the 25 benchmark jobs, at least 15 must be done by one sentence plus one approval.

Where things come from:
- The 25 jobs, their start states and their end conditions: `Tasks/active/046-better-than-clickup/benchmark-25-jobs.md`. They are not repeated here.
- The pass rules: `task.md`, slice AI-1, "What counts as success".
- The tool names: read from `Modules/Mcp/` on 2026-10-02. Each one was checked with grep.

## How to read the table

- **Start** is the screen the person has open in AlianHub. "Here", "this list" and "this task" in a sentence mean that screen.
- **The sentence** is typed to the connected Claude, once, in a fresh conversation. Items are named `[AI bench] ...` so they do not collide with the earlier runs.
- **Tools today** names the tools the agent needs, as they exist in the code. "Missing" means no tool does that part.
- **Approvals** counts approvals asked in AlianHub. It assumes the project is on its default setting, "Act on single tasks, propose anything wider", and that `MCP_TOOLS_V2` and `AGENT_TAINT_ROUTING` are off. "How to run it" says what changes when they are on.
- **Pick**: "15" is one of the fifteen chosen jobs. "Reserve" is one of the three reserves. "No" is not run for the count.
- **Verdict** stays empty until the measured run.

## The 25 jobs

| # | Job | Start | The sentence | Tools today | Approvals | Pick | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | Create a task with assignee, due date and priority | The list | Add a task "[AI bench] Write release note" for me, due tomorrow, high priority. | `person.place` (which list is "here"), `members.list` (to find the person), `task.create`. No tool says who "me" is | None | 15 | |
| 2 | Quick-create from anywhere | Home | Add a task "[AI bench] Call supplier" to [AI bench] list. | `projects.list`, `lists.list`, `task.create` | None | 15 | |
| 3 | Turn a message into a task | The chat | Make a task in [AI bench] list from the last message in the scratch channel. | `lists.list`, `task.from_message`. Missing: a tool that reads the messages of a chat channel, so the agent cannot get the message id. `person.place` does not know which chat is open | None | 15 | |
| 4 | Subtasks to three levels | The parent task | Under "[AI bench] Parent" add a subtask "Child", under that "Grandchild", and under that "Great-grandchild". | `person.place` or `tasks.search`, then `subtask.create` three times. The third call is refused: a task tree holds a task, a subtask and a sub-subtask, no deeper (`Modules/Tasks/helpers/taskTreeRules.js`) | None | Reserve | |
| 5 | Folder, subfolder, list, and move a task | The list | In QA Sandbox make a folder "[AI bench] folder", inside it a subfolder "[AI bench] subfolder", inside that a list "[AI bench] inner list", and move "[AI bench] Write release note" into that list. | Folder and subfolder: missing. `lists.list`, `list.create` (it can put a list in a folder that exists), `tasks.search`, `task.move` | None. One if `MCP_TOOLS_V2` is on, because `task.move` cannot be undone | Reserve | |
| 6 | Duplicate a project | The project | Duplicate the project QA Sandbox as "[AI bench] Sandbox copy", with its lists, statuses and views. | `person.place` or `projects.list`, then `project.duplicate` (#1467). It copies the folders, lists, statuses, fields and views, and the tasks only when the sentence asks for them. The copy is private to the person who approves it | One, always | No | |
| 7 | Bulk-edit twenty tasks | The list | Set "[AI bench] bulk 01" to "bulk 20" to high priority and assign them all to (the teammate). | `person.place`, `tasks.search`, `members.list`, then `tasks.batch` running `task.update` and `task.assign`. That is 40 changes and a batch takes 25, so two batch calls | Two since #1427: each batch call waits as one proposal. See "Job 7: how many approvals" | 15 | |
| 8 | Group by a custom field | The list | Show me this list grouped by Stage. | `person.place`, `fields.list`, `view.create` with the field as the grouping. `screen.link` opens a list but cannot carry a grouping | One. It saves a view that everyone on the project sees | 15 | |
| 9 | Filter and save a view | The list | Show my tasks due this week and save it as a view called "[AI bench] Mine this week". | `person.place`, `view.create` with `mine`. Missing: `view.create` has no filter on the due date | One | 15 | |
| 10 | Everything list | Home | Show me all my tasks across every project. | `screen.link` (screen `everything`), or `tasks.search` to answer in the conversation. The link cannot switch on "Me" | None | 15 | |
| 11 | Board drag | The list | Move "[AI bench] Design" to In Progress. | `tasks.search`, `statuses.list`, `task.status.set` | None | 15 | |
| 12 | Custom fields of the main types | The list | Add fields to this project: a text field Note, a number field Cost, a dropdown Stage with Alpha and Beta, a date field Review date and a people field Reviewer. On "[AI bench] Write release note" set them to: ok, 120, Beta, tomorrow, me. | `person.place`, `fields.list`, `fields.create` (all five in one call), then `tasks.search` and `task.field.set` five times inside `tasks.batch`. The values can be set only after the approval, and nothing tells the agent that it happened | One | 15 | |
| 13 | Totals of a number field | The list | Show the total of Cost for each group, and show on "[AI bench] Parent" the total Cost of its subtasks. | (a) `fields.list`, `view.create` with the Cost column shown. (b) Missing: `fields.create` has no rollup type, and no tool reads the field values of a task | One, for (a) | 15 | |
| 14 | Comment with a mention, reply in a thread | The task | On this task, comment "please review" and mention (the teammate), then reply to that comment with "Done". | `person.place`, `members.list`, `task.comment` with the mention. Reply in a task's thread: missing (`page.comment.reply` is for docs only) | None | No | |
| 15 | Share a doc | Docs | Create a doc "[AI bench] Launch notes" in QA Sandbox with the line "First draft", and tell me who can see it. | `projects.list`, `page.create`, `project.get` (the members). Share with a person: missing. A doc is shared with its project from the start | None. The doc is marked an agent's draft until a person approves it. To check: whether that counts | 15 | |
| 16 | Doc history restore | The doc | In the doc "[AI bench] Launch notes" change the line to "Second draft", then restore the first version. | `pages.search`, `page.update`. Restore a version: missing | None | No | |
| 17 | Timer and manual time | The task | Start a timer on this task and stop it, then log 1 hour 30 minutes on it for today. | `person.place`, `timelog.start`, `timelog.stop`, `timelog.create` | None | 15 | |
| 18 | Weekly timesheet, submit and approve | Home | Submit my timesheet for this week and approve it. | `timesheet.read` only. Submit and approve: missing | Not reached | No | |
| 19 | Dependency and Gantt shift | The list | Make "[AI bench] Build" wait on "[AI bench] Design", then move Design two working days later. | `tasks.search`, `task.relation.add`, `task.update` for Design, then `task.update` for Build. Missing: a tool that reads the working days. To check: whether Build moves by itself | None | 15 | |
| 20 | Sprint | The list | Create a sprint "[AI bench] Sprint 9" for two weeks from today and add "[AI bench] bulk 01" to "bulk 05" to it. | `list.create`, `tasks.search`, `task.move` five times inside `tasks.batch`. Missing: a tool that turns a list into a sprint and sets its dates. `task.lists.add` refuses a sprint | None. Five proposals if `MCP_TOOLS_V2` is on | Reserve | |
| 21 | Automation rule | The project | When a task's status changes to Done, send the assignees the notice "[AI bench] Done notice". | Missing | Not reached | No | |
| 22 | Dashboard card | Dashboards | Create a dashboard "[AI bench] Board" with a card of tasks by status. | Missing | Not reached | No | |
| 23 | Workload view | Home | Show me each person's workload in QA Sandbox for this week, counted in tasks. | `projects.list`, `screen.link` (the project, view `workload`). The link opens on this week. It cannot pick the unit | None | 15 | |
| 24 | Search | Home | Open the task about the supplier, and open the doc about the launch. | `tasks.search` and `screen.link` for the task, `pages.search` and `screen.link` for the doc | None | 15 | |
| 25 | Invite a member; a private project | Home | Invite (a test address) as a member, and make QA Sandbox private with access for (the teammate) only. | Missing. The never-list holds `permissions.edit` (`Modules/Agents/registry.js`). To check: whether making a project private falls under it | Not reached | No | |

## The fifteen, and why

Listed from the most likely to pass to the least. "Today" is what the code says will happen before any new tool is built.

1. **Job 11, move a card.** One task, one status. The tool exists and a change to one task is applied at once.
2. **Job 2, quick-create.** The list is named in the sentence, so nothing has to be guessed.
3. **Job 24, search.** Two reads and two links. Nothing changes, so nothing waits.
4. **Job 23, workload view.** One link. The person picks the unit on the screen.
5. **Job 10, Everything list.** One link, or the answer in the conversation. "Me" on the page is the person's click.
6. **Job 7, bulk-edit twenty.** The tools exist. Since #1427 a batch that names more than one task waits, and the 40 changes do not fit one batch, so today it asks for two approvals and misses the pass rule by one. See "Job 7: how many approvals".
7. **Job 1, create a task.** One call carries the assignee, the date and the priority. The risk is "for me": no tool tells the agent who its person is.
8. **Job 17, time.** Three small tools. The risk is the timer: in the web app a timer under one minute logs nothing.
9. **Job 19, dependency and shift.** The link and both date changes have tools. The agent has to work out the working days by itself.
10. **Job 8, group by a field.** It works through a saved view and one approval. The risk: saving a view is more than the sentence asked.
11. **Job 12, five fields.** One call and one approval make the fields. Today the five values need the agent to come back after the approval, which may take a second sentence.
12. **Job 15, a doc.** `page.create` makes it in the project, and the project's people can see it from the start. Today the doc is a draft until a person approves it.
13. **Job 9, filter and save.** The view, its name and "mine" work. Today "due this week" cannot be stored.
14. **Job 13, totals.** Part (a) should work through a view with the Cost column: run 2 saw a Total row per group once the column is shown. Today part (b) has no tool.
15. **Job 3, message to task.** The tool exists and fills the task from the message. Today the agent cannot find the message.

Expected today: jobs 11, 2, 24, 23, 10, 1, 17, 19 and 8 can pass. That is nine at best. Job 7 needs one approval fewer (see "Job 7: how many approvals"). Jobs 12, 15, 9, 13 and 3 each need one small piece first. Those pieces are in "Gaps found while writing".

## Job 7: how many approvals

Read from the code on 2026-10-02, after #1427. `tests/agent-proposal-cards.test.js` ("benchmark job 7") runs the same numbers.

- **Two tools for each task.** `task.update` sets the priority; it does not take assignees (`EDITED` in `Modules/Mcp/manageTools.js`). `task.assign` sets the assignee. Twenty tasks with two fields each are 40 operations.
- **One batch call takes 25.** `BATCH_MAX` in `Modules/Mcp/manageTools.js` is the `maxItems` of `tasks.batch`. A call with 40 operations is refused before anything is read, and nothing is filed.
- **A call that names more than one task runs nothing.** `runBatch` in `Modules/Mcp/tools.js` counts the tasks the operations name; above one it goes to `fileBatch`, which files every change of that call as one proposal, approved or declined whole. This holds on both project settings.
- **So today: two batch calls, two proposals, two approvals.** For example 25 and 15, or 20 and 20. Each approval applies its changes one by one; nothing changes before it.
- **Against the pass rule** (at most one approval) job 7 fails today, and only because of the cap. Each proposal is one card and one click.
- **The cap that would make it one: 40.** With `BATCH_MAX` at 40 the job is one call, one proposal and one approval. Nothing else stands in the way: a proposal's list of changes has no size limit of its own (`create` in `Modules/Agents/proposals.js`), and the card names the first five tasks and counts the rest.
- **The cap is not changed here.** It is the owner's call: a bigger batch is a bigger change behind one click. The other way to one approval, also not built, is a `task.update` that takes assignees, which makes the job 20 operations.

## The three reserves

They are measured too. They count only if one of the fifteen fails.

1. **Job 4, three levels of subtasks.** The first two levels work today. The third is refused by the product's own rule, so the job or the rule has to change.
2. **Job 20, sprint.** The list and the five moves work today. Making the list a sprint with dates has no tool.
3. **Job 5, folder, subfolder, list, move.** The list and the move work today. Making a folder has no tool.

## Not picked, and why

- **Job 6, duplicate a project.** It had no tool when the fifteen were picked. It has one since #1467, `project.duplicate`, with its own rated action: one sentence and one approval.
- **Job 14, comment and reply.** These are the person's own words. The reply also has no tool.
- **Job 16, restore a doc version.** No tool. `task.md` treats it as a person's decision.
- **Job 18, timesheet.** No tool to submit or approve. Approving is a person's decision.
- **Job 21, automation rule.** No tool yet. It is the next part of AI-3.
- **Job 22, dashboard card.** No tool.
- **Job 25, invite and private project.** An invitation sends mail, and access is not an agent's to change.

## Where this differs from the list in `task.md`

`task.md` names 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 17, 19, 20 and 21 as the fifteen, with 5, 15 and 22 as reserves. That list is the owner's open decision 15.

This sheet picks by what the tools can do today:
- **In:** 23 and 24. `task.md` left them out because they are already short by hand. They still count toward "15 of 25", and both can pass today.
- **In:** 15, moved up from reserve. The tool exists.
- **Out to reserve:** 4 and 20. Each has a part that no tool can do today.
- **Out:** 21 and 22. Nothing exists for them yet.
- **Job 17's sentence is longer here.** The job's end condition is two time entries, so the sentence asks for the timer and the manual entry. `task.md` asks for the manual entry only.

If the owner keeps the list in `task.md`, the table above still holds. Only the Pick column changes.

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
- `MCP_TOOLS_DATA`: reading projects, lists, statuses, comments, docs and timesheets, logging time, `screen.link` and `person.place`.
- `MCP_TOOLS_MANAGE`: changing tasks, the batch call, writing docs and `task.from_message`.
- `MCP_TOOLS_WORK`: tags, links between tasks, lists, doc comments, goals, `fields.create`, `view.create` and the work queue.

Two more settings change the result. Write their values at the top of the run sheet.
- `MCP_TOOLS_V2`: when on, a change that cannot be undone, or that reaches the whole workspace, waits for approval. `task.move` is one. Jobs 5 and 20 then need approvals.
- `AGENT_TAINT_ROUTING`: when on, a connected app's change that reaches more than one task waits for approval. That includes a new task, a new list, a link between tasks and a new doc. Many "None" cells above then become "One".

`screen.link` needs the server to know its own web address (`WEBURL` or `APIURL`). Without one it answers that no link can be given.

### 2. Connect Claude with the manage grant

1. In AlianHub open AI, then Connect your AI.
2. The page shows the address to paste. In Claude: Settings, then Connectors, then Add custom connector.
3. Claude opens AlianHub's consent screen. Tick "Manage tasks" and "Write docs". Both start unticked.
4. An owner or admin approves the app for those permissions in Settings, Agent clients.
5. The Connect your AI page changes to "Connected" when the first call arrives. The connection is also listed under Accounts, Connected apps.

To check before the run:
- The page says the address must be reachable from outside the network. How Claude reaches a build on localhost is not settled.
- Whether Claude can register itself, or an owner must add it under Agent clients first. `MCP_OAUTH_DCR` exists for this and is off by default.
- Whether the Claude app asks before each tool call. `task.md` counts an approval asked by the AI app as one approval. Choose one setting for the whole run, and write it down.

### 3. Prepare the project

- Use project "QA Sandbox". Leave its agent settings on the defaults: "Agents and Done" on "With approval", "Connected agents" on "Act on single tasks, propose anything wider".
- Make the start state of each job as the benchmark file says, with `[AI bench]` names. Jobs 7 and 20 need "[AI bench] bulk 01" to "bulk 20". Jobs 8 and 13 need the Stage and Cost fields. Job 3 needs one message in the scratch channel.
- Open the start screen in AlianHub before each sentence. `person.place` trusts a screen opened in the last 60 minutes.

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

After the run, fill the Verdict column above, write the number into the AI row of `Tasks/active/046-better-than-clickup/scorecard.md`, and list everything the run left in the project at the end of this file.

## Gaps found while writing

Each line is a job where a tool is missing or a rule would stop the agent. A coordinator can turn each into a slice.

Marked on 2026-10-02 at build 772: "Closed" names the pull request that closed a gap, and "Partly closed" says what is still missing. A line with no mark is still open. The table of the 25 jobs above is as written at #1412, except job 7, whose "Approvals" cell was revised with "Job 7: how many approvals". For a closed gap, the job's "Tools today" and "Approvals" cells are out of date until the sheet is revised.

**Tools that are missing**

1. **Job 3.** No tool reads the messages of a chat channel. `task.from_message` needs a message id and the agent has no way to find one. **Closed by #1429:** `chat.channels.list` and `chat.messages.list` answer the message ids. Reading chat is a permission of its own, so the connection must be given it.
2. **Job 1, and every "for me" or "mine".** No tool tells the agent who its person is. `members.list` finds a person by name only. **Closed by #1429:** `person.me`.
3. **Job 9.** `view.create` cannot filter on the due date. It filters on status, priority, people and text. **Closed by #1425:** `due`, or `dueFrom` and `dueTo`.
4. **Jobs 8 and 10.** `screen.link` cannot carry a grouping, a filter or "Me". A view that is only looked at has to be saved, which changes the project for everyone. **Partly closed by #1425:** the everything screen opens on "Me". A project or a list opens on a saved view that already shows it that way. With no such view the plain link comes back with a note, so a grouping nobody saved still needs `view.create`.
5. **Job 12.** Fields and their first values are not one proposal. The values wait for the approval, and no tool tells the agent that a proposal was approved. **Closed by #1425 and #1429:** `fields.create` carries the first values in the same approval, and `proposal.get` says what became of a proposal.
6. **Job 13.** `fields.create` has no rollup type. No tool reads the field values of a task, so the agent cannot add them up either. **Partly closed by #1429:** `task.fields.list` reads a task's field values. There is still no rollup type.
7. **Job 5.** No tool makes a folder or a subfolder. `list.create` and `list.move` only use folders that exist.
8. **Job 20.** No tool turns a list into a sprint or sets its dates.
9. **Job 19.** No tool reads the workspace's working days. To check: whether `task.update` moves the tasks that wait on the one it moved. **Closed by #1429:** `workdays.get`. The check on `task.update` is still to do.
10. **Job 21.** No tool reads the rule catalogue or makes a rule (AI-3, automations, not started). **Closed by #1423:** `automation.catalogue` and `automation.create`. The rule is always a proposal, and only an owner's or an admin's agent may ask for one.
11. **Job 22.** No tool makes a dashboard or a card.
12. **Job 14.** No tool replies in a task's comment thread.
13. **Job 16.** No tool lists or restores a doc's versions.
14. **Job 15.** No tool shares a doc with one named person. The web app cannot do this either.
15. **Job 18.** No tool submits or approves a timesheet.
16. **Job 6.** No tool duplicates a project. **Closed by #1467:** `project.duplicate` asks for the copy and a person approves it. The copy is private to the approver, whoever is on the project it is copied from. Tasks are copied only when asked for, without their assignees, and a project with more than 300 tasks is copied without them.
17. **Job 25.** No tool invites a person or changes who can open a project.

New since this sheet and tied to no job above: `project.setup` (#1420) sets up a project that exists from one plan, and `project.create` (#1433) proposes a new project with its setup. Neither duplicates a project: job 6 has its own tool, `project.duplicate` (#1467).

**Rules that would refuse, or that do less than the plan says**

18. **Job 4.** The task tree stops at task, subtask, sub-subtask. The job asks for one level more, so the third `subtask.create` is refused. Either the job is rewritten or the rule changes. **Decided on 2026-10-02:** the rule stays and the job is rewritten. The new sentence is not written yet.
19. **Job 7.** Twenty tasks change with no preview and no approval, because a batch is 25 single-task changes and each is applied at once. Decision 6 in `task.md` says anything wider than one task waits. **Closed by #1427:** a batch that names more than one task runs nothing and waits as one proposal. **Checked on 2026-10-02:** job 7 is 40 changes and a batch takes 25, so it ends in two proposals and two approvals, which is one approval too many. A cap of 40 would make it one; the cap is not changed. See "Job 7: how many approvals".
20. **Job 8.** A saved view shows to everyone on the project. The pass rule fails a run that changes something the sentence did not ask for. To settle: whether "show me" may save a view.
21. **Job 17.** In the web app a timer under one minute logs nothing. To check: whether `timelog.stop` leaves an entry. `timelog.create` reads the day in UTC, which is not always the person's "today".
22. **Jobs 5 and 20.** `task.move` cannot be undone. With `MCP_TOOLS_V2` on, each move is its own proposal, so five moves ask for five approvals. **Changed by #1427:** the five moves of job 20, sent as one batch, wait as one proposal. To check with `MCP_TOOLS_V2` on.
23. **Job 15.** A doc an agent creates is a draft until a person approves it. To check: where that approval is given and whether it counts toward "one approval".
24. **Under "Propose everything".** A connected app's comments, links and timers are refused, not queued (`progress.md`, #1394). Jobs 14 and 17 cannot pass in a project on that setting.

**To settle before the first run**

25. How Claude reaches a local build, and how the app gets approved (see "Connect Claude" above).
26. Whether the Claude app's own "allow this tool" prompts count as approvals. If each one counts, any job with more than one tool call fails.
27. Which fifteen: this sheet's, or the list in `task.md` (the owner's open decision 15). Until the owner decides, this sheet's pick stands.
