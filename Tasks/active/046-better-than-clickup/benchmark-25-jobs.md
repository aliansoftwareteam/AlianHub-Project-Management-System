# 046: the 25-job benchmark

Written 2026-10-01. Tracker: AP-441, Track C.

This file holds three things:
1. The 25 everyday jobs and how they are counted, so two people perform and count them the same way.
2. A first measured run of AlianHub at build `14.36.0-beta.705`.
3. ClickUp's side of each job, with the source of every figure.

**Read this first.**
- **ClickUp has not been run hands-on by a person who saves the work.** Its figures come from two sources, marked on every row:
  - "look only": counted on 2026-10-01 in a throwaway list of a real ClickUp workspace, by opening menus and forms up to the saving button and then cancelling. Nothing was typed, saved or sent.
  - "documentation": counted from ClickUp's own help articles, read on 2026-10-01. Not measured.
- A full ClickUp run by a person is still needed. The sheet for it is at the end of this file.
- AlianHub was measured at build 705. `beta` was at build 739 when this was written. Four jobs failed or were hard only because the fix was merged after build 705. They are marked.
- The AlianHub run was driven through the page (clicks sent to named controls), at 1440 by 900. Steps are the ones a person makes with a mouse and keyboard. Two drags (Board, Gantt) were sent as drag events, not made by hand.

## How a job is counted

**Step.** One click, one drag, one distinct keyboard action (a shortcut, Enter, Esc, Tab, an arrow key), or one typed field. All the text typed into one field is one step, however long. A Shift-click is one click.

**Surface crossed.** Each page, modal dialog, side panel, popover or menu that opens during the job, after the starting screen. Reopening the same surface counts again. An inline row or an inline form in the page is not a surface.

**Not counted.** Hovering to reveal a control. Scrolling. Waiting for the system.

**Shortest path wins.** A keyboard shortcut counts if the product shows or documents it.

**Views.** Board, Gantt, Calendar and Workload views are taken as already added to the project in both products. Adding one is noted where it matters.

**Time.** A keystroke-level model estimate for a practised user. System response time is left out (speed is measured separately, in Track C1).

`T = 1.3·C + 2.4·D + 0.28·K + 0.28·N + 0.4·H + 1.35·(1 + S)` seconds

| Symbol | Meaning | Constant | Where it comes from |
|---|---|---|---|
| C | clicks | 1.3 s | point 1.1 s + press 0.1 s + release 0.1 s |
| D | drags | 2.4 s | point, press, point, release |
| K | keyboard actions | 0.28 s | one keystroke, average typist |
| N | characters typed | 0.28 s each | fixed by the job text, so equal for both products |
| H | hand moves between mouse and keyboard | 0.4 s | two for each typed field that follows a click, none for a field reached by a key |
| S | surfaces crossed | 1.35 s | one mental pause per surface, plus one at the start |

The constants are those of Card, Moran and Newell's keystroke-level model (1980). The rule for pauses is simplified to one per surface so that two people place them the same way.

## Standing start

- Signed in as the workspace owner. One teammate exists.
- A project "QA Sandbox" (in ClickUp: a Space of that name) with a list "[QA bench] list".
- Each job starts on the project's List view unless it says otherwise.
- Jobs are independent. Where a job needs something another job made, the start state says so.

## The 25 jobs

| # | Job | Start | Goal | End condition |
|---|---|---|---|---|
| 1 | Create a task with assignee, due date and priority | List view of "[QA bench] list" | New task "[QA bench] Write release note", assigned to me, due tomorrow, priority High | The row shows the name, me, tomorrow, High |
| 2 | Quick-create from anywhere | Home | Create "[QA bench] Call supplier" in "[QA bench] list" without leaving Home | Still on Home; the task is in the list |
| 3 | Turn a message into a task | A chat channel that holds the message "[QA bench] Please fix the login page" | Make a task from that message in "[QA bench] list" | A task holding the message text is in the list |
| 4 | Subtasks to three levels | Task "[QA bench] Parent" open | Add subtask "[QA bench] Child"; under it "[QA bench] Grandchild"; under that "[QA bench] Great-grandchild" | The tree shows three levels under the parent |
| 5 | Folder, subfolder, list, and move a task | List view | Create folder "[QA bench] folder"; inside it subfolder "[QA bench] subfolder"; inside that list "[QA bench] inner list". Move the job 1 task into the inner list | The sidebar shows the nest; the task is in the inner list |
| 6 | Duplicate a project | Project open | Duplicate "QA Sandbox" as "[QA bench] Sandbox copy" with lists, statuses and views (tasks not needed) | The copy is in the sidebar with the same lists |
| 7 | Bulk-edit twenty tasks | "[QA bench] list" holds "[QA bench] bulk 01" to "bulk 20" next to each other in one status group, with one other task in that group | Set priority High on all twenty and assign all twenty to one teammate | All twenty rows show High and the teammate |
| 8 | Group by a custom field | List view grouped by status; dropdown field "[QA bench] Stage" (Alpha, Beta) exists | Group the list by Stage | One group per option |
| 9 | Filter and save a view | List view, no filter | Show only tasks assigned to me and due this week; save as view "[QA bench] Mine this week" | A view tab of that name reopens with the filter |
| 10 | Everything list | Home | Open one list of tasks from every project I can open; narrow it to mine | Tasks from two or more projects in one list |
| 11 | Board drag | List view | Open Board; drag one card from To Do to In Progress | The card is in In Progress and the status is saved |
| 12 | Custom fields of the main types | List view | Add five fields: text "[QA bench] Note", number "[QA bench] Cost", dropdown "[QA bench] Stage" (Alpha, Beta), date "[QA bench] Review date", people "[QA bench] Reviewer". Fill each on the job 1 task: "ok", 120, Beta, tomorrow, me | The task shows five values |
| 13 | Totals of a number field | List view; "[QA bench] Cost" is filled on three tasks, one of them a subtask of "[QA bench] Parent" | (a) Show the total of Cost for each group without leaving the list. (b) Show on the parent the total of its subtasks' Cost | (a) a sum per group; (b) the parent shows the sum |
| 14 | Comment with a mention, reply in a thread | Task open | Post a comment that mentions the teammate ("@" and two letters, pick the person) and says "please review". Reply to that comment in its thread with "Done" | The comment shows the mention and one threaded reply |
| 15 | Share a doc | Docs screen | Create doc "[QA bench] Launch notes" in the project with the line "First draft". Share it so the teammate can open it, and confirm who can see it | The share panel lists the teammate |
| 16 | Doc history restore | The job 15 doc open | Change the line to "Second draft". Open history. Restore the first version | The doc reads "First draft" |
| 17 | Timer and manual time | Task open | Start a timer and stop it. Add a manual entry of 1 h 30 min for today | The task's time log shows two entries |
| 18 | Weekly timesheet, submit and approve | Home | Open this week's timesheet. Submit it. Approve it as the approver | The week shows as approved |
| 19 | Dependency and Gantt shift | List view; "[QA bench] Design" (Thursday to Friday) and "[QA bench] Build" (the next Monday to Tuesday); working week Monday to Friday | Make Build wait on Design. Open Gantt. Move Design two working days later | Build no longer starts before Design ends; no date falls on a non-working day |
| 20 | Sprint | Project open | Create sprint "[QA bench] Sprint 9", two weeks from today. Add five existing tasks | The sprint shows its dates and five tasks |
| 21 | Automation rule | Project open | A rule: when a task's status changes to Done, send the assignees the notice "[QA bench] Done notice". Switched on | The rule is listed and on |
| 22 | Dashboard card | Dashboards screen | Create dashboard "[QA bench] Board". Add a card of tasks by status | The card shows counts |
| 23 | Workload view | Home | Open each member's workload for this week in the project, counted in tasks | One row per person with this week's load |
| 24 | Search | Home | (a) Find the job 2 task by typing "supplier" and open it. (b) Open the job 15 doc from the command palette by typing "launch" | (a) the task is open; (b) the doc is open |
| 25 | Invite a member; a private project | Home | (a) Invite a person by an address of 22 characters, as a Member. (b) Make the project private and give one named member access | (a) the invitation is sent; (b) the project is private with its member list |

Coverage: capture and triage (1 to 3), organise (4 to 7), views (8 to 11), fields (12, 13), collaboration (14 to 16), time (17, 18), planning (19, 20), automation (21), reporting (22, 23), search (24), admin (25).

## First measured run: AlianHub, build 705

Run on 2026-10-01 in the owner's local app, in the QA Sandbox project.

**Result: 19 jobs done, 5 partly done, 1 blocked.**

| # | Job | Result | Steps | C | D | K | F | N | H | S | Time (s) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Create a task | Done | 7 | 6 | 0 | 0 | 1 | 29 | 2 | 2 | 20.8 |
| 2 | Quick-create | Done | 7 | 4 | 0 | 2 | 1 | 24 | 2 | 3 | 18.7 |
| 3 | Message to task | Done | 6 | 6 | 0 | 0 | 0 | 0 | 0 | 3 | 13.2 |
| 4 | Three levels of subtasks | Partly: one level of three | 3 for level one | 1 | 0 | 1 | 1 | 16 | 2 | 0 | — |
| 5 | Folder, subfolder, list, move | Done, by a hidden path | 20 | 14 | 0 | 3 | 3 | 58 | 6 | 11 | 53.9 |
| 6 | Duplicate a project | Blocked on build 705 | — | — | — | — | — | — | — | — | — |
| 7 | Bulk-edit twenty | Done | 8 | 8 | 0 | 0 | 0 | 0 | 0 | 2 | 14.5 |
| 8 | Group by custom field | Done | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 1 | 5.3 |
| 9 | Filter and save a view | Done | 10 | 9 | 0 | 0 | 1 | 25 | 2 | 3 | 24.9 |
| 10 | Everything list | Partly: my tasks only | 1 for my tasks | 1 | 0 | 0 | 0 | 0 | 0 | 1 | — |
| 11 | Board drag | Done | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 1 | 6.4 |
| 12 | Five custom fields, filled | Done | 59 | 34 | 0 | 9 | 16 | 144 | 18 | 8 | 106.4 |
| 13 | Totals of a number field | Partly: (b) only | 9 for (b) | 6 | 0 | 1 | 2 | 31 | 2 | 2 | — |
| 14 | Comment, mention, thread reply | Done | 7 | 2 | 0 | 3 | 2 | 20 | 4 | 1 | 13.3 |
| 15 | Share a doc | Done | 9 | 7 | 0 | 0 | 2 | 34 | 4 | 3 | 25.6 |
| 16 | Doc history restore | Partly: only with a version saved first | 10 with a saved version | 8 | 0 | 1 | 1 | 12 | 2 | 3 | — |
| 17 | Timer and manual time | Done | 6 | 5 | 0 | 0 | 1 | 2 | 2 | 0 | 9.2 |
| 18 | Timesheet, submit and approve | Done, the approvals page reached by address | 5 | 3 | 0 | 1 | 1 | 9 | 2 | 2 | 11.6 |
| 19 | Dependency and Gantt shift | Done | 8 | 6 | 1 | 0 | 1 | 5 | 2 | 3 | 17.8 |
| 20 | Sprint | Done | 16 | 14 | 0 | 1 | 1 | 19 | 2 | 8 | 36.8 |
| 21 | Automation rule | Done | 11 | 10 | 0 | 0 | 1 | 22 | 2 | 3 | 25.4 |
| 22 | Dashboard card | Done | 6 | 5 | 0 | 0 | 1 | 16 | 2 | 3 | 17.2 |
| 23 | Workload view | Done | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 8.0 |
| 24 | Search | Done | 7 | 0 | 0 | 5 | 2 | 14 | 0 | 4 | 12.1 |
| 25 | Invite; private project | Partly: counted to the last button, nothing sent or changed | at least 10 | 9 | 0 | 0 | 1 | 22 | 2 | 5 | — |

F is typed fields. A dash under Time means the job was not completed as written.

### The path taken, job by job

| # | Path in AlianHub |
|---|---|
| 1 | "Add task" row, type the name, date icon, tomorrow, priority icon (a full-height side panel), High, Save. The creator is assigned already. |
| 2 | Press C, type the name, pick the project, pick the list, Enter. A notice confirms; Home stays. |
| 3 | Hover the message, "Make a task" (the name is filled in), pick the project, pick the list, Create. |
| 4 | "Add subtask", type, Enter. A subtask's own panel and row offer no way to add a subtask on this build. |
| 5 | "+ New", "New folder", name, Enter. Folder menu, "New subfolder", name, Enter. "+ New", "New list", name, Enter: the list lands at the project root. Back to the first list, tick the task, "Sprint" in the bulk bar, the new list. Then the Calendar tab, the list's menu, "Move to folder", the subfolder. |
| 6 | No "Duplicate" entry in the project menu. |
| 7 | Tick the first row, Shift-click the last, Priority, High. The selection clears. Tick, Shift-click, Assignee, the teammate. |
| 8 | "Group by", the field. |
| 9 | Filter, field list, Due Date, option list, This week, Show Result, "Me", "Save as new view", type the name, Create view. |
| 10 | Home, "Assigned to me". One list across projects, mine only. No list of all tasks on this build. |
| 11 | Board tab, drag the card. |
| 12 | Five times: "+ Custom Field" in the task panel, pick the type, fill the form, Save. Then fill the five values in the task panel. |
| 13 | (a) The Cost column can be shown; a group shows a count, not a sum. (b) "+ Custom Field", Rollup, label, description, source field, Save; the parent shows the sum. |
| 14 | Click the comment box, type "@" and two letters, Enter picks the person, type the text, Enter. "Reply in thread", type, Enter. |
| 15 | Pick the project in the Docs sidebar, "New doc", click the title and type, click the body and type, Save, Share, "Who can see this doc". |
| 16 | History, "Save a version", close, edit, Save, History, "Restore this version", confirm. |
| 17 | "Start timer", "Stop and log time", "Add time", click Minutes, type 30, "Save time". |
| 18 | "Time" in the rail, "Submit week", the approvals page, Approve. |
| 19 | Open Design, "Relate", type "Build", click the result, close, Gantt tab, drag the bar, "Shift dependants". |
| 20 | "+ New", "New list", name, Enter. Calendar tab, the list's menu, "Make it a sprint", tick "Run this list as a sprint", duration, 2 weeks, Save. Open the source list, tick the first task, Shift-click the fifth, "Sprint", the sprint. |
| 21 | "Automate", "Use template" on the notify recipe, status to Done, recipient to "The assignees", type the message, "Save automation". |
| 22 | "+ Dashboard", click the name and type, Create, "Add your first card", Add on "Tasks by status". |
| 23 | The project in the Home sidebar, Workload tab, "Tasks". |
| 24 | (a) Cmd+K, type, Enter. (b) Cmd+K, type, arrow down, Enter. |
| 25 | (a) More, Members, Invite, click the address box, type, Send (not pressed). (b) More, Settings, Projects, "Private" on the project's card (not pressed); the member choice after it was not seen. |

### What each job showed

| # | Finding |
|---|---|
| 1 | Seven steps, two fewer than ClickUp's create dialog. Priority and assignee open a full-height side panel, not a small menu. |
| 2 | The dialog starts on the personal list; project and list cost four clicks. Its assignee list for the project had no entry for the person creating the task. |
| 3 | Works. The project and the list are picked by hand every time. The message shows no link to the task afterwards. |
| 4 | Levels two and three could not be created from the screen at build 705. The panel part merged later (#1240, build 722). |
| 5 | A list made from inside a folder landed at the project root (fixed later in #1265, build 731). "Move to folder" exists only in the list menu on the Calendar tab. An empty subfolder page showed the raw text "SPRINT DATA REQUIRED". |
| 6 | Not in build 705. Merged in #1257 (build 711). |
| 7 | The selection is cleared after each bulk change, so the second change needs the twenty tasks selected again. |
| 8 | Custom fields sit in the same menu as status and assignee. An unsaved grouping followed me into another list. |
| 9 | Assignee is not in the filter's field list; the "Me" switch covers it. |
| 10 | The Everything page merged in #1250 and #1262 (builds 713, 720), after build 705. |
| 11 | Works. A view added with "Add View" appears as a tab but is not opened. |
| 12 | The slowest job. Text, number and dropdown fields demand a placeholder and a description of ten characters or more. The label is not focused when the form opens. A date field needs an extra "Select" click and stores a time. Two different forms exist: the newer types ask for a label only. |
| 13 | No per-group total for a custom number field; only story points are totalled. The rollup field works: the parent showed 5 for a subtask value of 5. |
| 14 | Works. After a person is picked, the box shows raw markup until the comment is sent. |
| 15 | A doc is shared with its project by default, so the teammate needs no step. A doc cannot be shared with one named person. Saving is a button, not automatic. |
| 16 | After "First draft" was changed and saved, history said no versions yet: one is kept when someone else edits, every ten minutes, or when saved by hand. So the first text was gone. With a version saved by hand, restore worked. Restore asks through the browser's own confirm box. |
| 17 | A timer shorter than one minute logs nothing; the first try left no entry. |
| 18 | The approvals page has no entry in the rail, the More menu or the command palette. |
| 19 | The shift shows a preview first. The task that waits moved one working day, as far as needed, and the note named the working days. |
| 20 | "Make it a sprint" exists only in the list menu on the Calendar tab. Adding tasks to a sprint moves them out of their list. |
| 21 | The rule is built from a sentence and a few selects. There is no name field; the sentence is the name. |
| 22 | The catalogue says 11 of 23 cards are built. The status card covers every project and cannot be pointed at one. |
| 23 | The project's Workload view counts in hours, points or tasks. The Workload tab under Time counts hours only. |
| 24 | For "launch" the first result was a task from another project; the doc was second. |
| 25 | Invite sits under More, then Members. Project privacy sits under Settings, then Projects. |

Wording slips seen on the way: a new list is announced as "Sprint created successfully" and its name box says "Enter sprint name"; the bulk control that moves tasks between lists is labelled "Sprint"; "Updated 1 tasks"; "1 tasks across 1 projects"; the project header wraps to two lines at 1440 px when a list is open; in the Workload view the "Unsaved changes" bar takes a tall column on the left.

### The five slowest jobs

| Rank | Job | Steps | Time (s) | Why |
|---|---|---|---|---|
| 1 | 12 Five custom fields | 59 | 106.4 | Three required inputs per field, the form reopened five times, pickers in side panels |
| 2 | 5 Folder, subfolder, list, move | 20 | 53.9 | The list could not be made in the folder; it was moved there from the Calendar tab |
| 3 | 20 Sprint | 16 | 36.8 | The sprint switch is on the Calendar tab only; eight surfaces |
| 4 | 15 Share a doc | 9 | 25.6 | Title and body are two clicks and two typed fields; saving is a button |
| 5 | 21 Automation rule | 11 | 25.4 | Five clicks to change the status and the recipient of the recipe |

## ClickUp's side

ClickUp 4.x. The plan of the workspace used for the look-only pass was not shown on the screens visited; its invite dialog says inviting is free, and billing was not opened.

| # | ClickUp steps | Surfaces | Source | Note |
|---|---|---|---|---|
| 1 | 9 | 4 | Look only, not saved | Create dialog: name, Assignee, Me, Due date, Tomorrow, Priority, High, Create. The documented inline row is also 9 |
| 2 | 5 | 2 | Look only, in a list, not saved | The dialog takes the current list. From Home the location chip and the list add two clicks; not tried from Home. Documentation alone gives at least 3 |
| 3 | 2 | 1 | Documentation | The article does not say the task holds the message text |
| 4 | 9 | 0 | Documentation; level one seen look only (3 steps) | Needs the Nested Subtasks setting |
| 5 | at least 15 | 8 | Documentation | Subfolders go one level deep |
| 6 | at least 4 | 2 | Documentation | A copy takes all tasks; only archived ones can be left out |
| 7 | 7 | 3 | Look only, nothing applied | Click and Shift-click gave "20 Tasks selected". Priority sits under "More" at 1440 px. Whether the selection survives the first change was not seen. Documentation gives 5 |
| 8 | 2 by the column header (documentation); 3 by the Group menu (look only, not applied) | 1 to 2 | Both | The list's custom field sits in the same list as status |
| 9 | at least 11 | 5 | Documentation; the filter panel seen look only | How a saved view gets its name is not documented |
| 10 | 2 | 1 | Documentation | Called "All Tasks" |
| 11 | 2 | 1 | Documentation; the Board tab seen look only | The drag was not made |
| 12 | at least 34 | at least 8 | Creating: look only, cancelled (24 steps). Filling: documentation (at least 10) | A text field needs a name only. A dropdown opens with two option boxes |
| 13 | (a) 3. (b) not counted: no article was read for it | 1 | Documentation | Column totals need the Business plan or higher. A Rollup field type is in the field list (seen look only) |
| 14 | 7 | 2 | Documentation | Needs the Threaded Comments setting |
| 15 | at least 6 | 3 | Documentation | A doc saves by itself |
| 16 | at least 6 | 3 | Documentation | How often a version is kept is not documented |
| 17 | at least 5 | 1 | Documentation | Stopping a timer is not described |
| 18 | 6 | 4 | Documentation | Approvals need a prior setup and the Business plan or higher |
| 19 | 6, or 4 if "Reschedule dependencies" is already on | 3 | Documentation | Skipping non-working days is not on the free plan |
| 20 | at least 8 | 3 | Documentation | Needs a Sprint Folder; sprint names follow a numbering pattern |
| 21 | not determinable from documentation | at least 5 | Documentation | The action list has no plain "notify" action; the nearest are a comment or a message. The known part is at least 10 steps |
| 22 | at least 7 | at least 3 | Documentation | The status card needs the Unlimited plan or higher |
| 23 | 7 | 5 | Documentation | Unit and period must both be changed |
| 24 | 6 | 4 | Documentation | Opening the top result with Enter is not documented, so a click is counted |
| 25 | 7 | 3 | (a) look only, not sent (3 steps). (b) documentation (4 steps) | The invite dialog opens with the address box focused and Member chosen |

"At least" means the documented or seen actions only. Actions the article leaves out would add to it.

### Side by side (provisional)

| Outcome | Jobs | Count |
|---|---|---|
| AlianHub needs the same or fewer steps | 1, 8, 9, 11, 14, 18, 22, 23 | 8 |
| AlianHub needs more steps | 2, 3, 7, 19, 24, 25 | 6 |
| Unclear: ClickUp's figure is a lower bound | 5, 12, 15, 17, 20 | 5 |
| AlianHub did not complete the job at build 705 | 4, 6, 10, 13, 16 | 5 |
| ClickUp's figure could not be counted | 21 | 1 |

The finish line in `task.md` is "the same or fewer steps on at least 22 of 25". At build 705, with ClickUp mostly counted from documentation, the count is 8. Treat it as a first reading, not a verdict.

### Help articles used

Every article is on `help.clickup.com`. The public address is `https://help.clickup.com/hc/en-us/articles/<id>`. Those pages refused the fetch tool, so each was read through the help centre's own address for the same id, `https://help.clickup.com/api/v2/help_center/en-us/articles/<id>.json`, and relayed by a summarising tool. A step may have been compressed. All were read on 2026-10-01.

| Job | Article ids |
|---|---|
| 1 | 31463619842711, 6309647350807, 6304483666199, 6308688267671 |
| 2 | 6309647350807, 6309030550167 |
| 3 | 26425806391703, 29776622610199 |
| 4 | 6309825777943, 29665922829335, 6304431740055, 6310382044567 |
| 5 | 6308812667671, 36811914387479, 36811534175383, 33944215483159, 6329600534935, 33944541486871 |
| 6 | 6311301775255 |
| 7 | 6309768265495, 6329600534935 |
| 8 | 6310202447511 |
| 9 | 6308875427223, 6308948062871, 6310370965911, 19063083658135 |
| 10 | 6309783246103, 6310138041367, 6308948062871 |
| 11 | 26032576190615, 6310080798615, 6310172583831 |
| 12 | 6303481086487, 6303576489239, 6303499162647 |
| 13 | 6310124537751, 32274881672599 |
| 14 | 6309646134295, 6308954445591, 37683521255959 |
| 15 | 14237365820695, 14235667017495, 6325333637271 |
| 16 | 6328174371351, 6325436135191 |
| 17 | 6304106812823, 29754533547415 |
| 18 | 21302696626967, 27090646766231, 29754533547415 |
| 19 | 6310249474967, 12305064244247, 40982447293207, 6304547785367, 31562830514967, 29661004054167, 33032722352279 |
| 20 | 13856338063383, 35755228382359, 7563115668759, 36078645779479, 12311873339031, 35714017592471, 29664799512855 |
| 21 | 30241682127127, 6312128853015, 6312097314199, 6312119071383, 23477062949911 |
| 22 | 14236332445335, 14237901038231, 6312286653591, 21257864098071, 26985557505303 |
| 23 | 6310449699735, 30799712357271, 30799743741847, 30799529012247, 30657456679703 |
| 24 | 6533695640343, 6311703331479 |
| 25 | 6310498173079, 7255448709655, 6309266954263 |

## What is still needed

1. **A hands-on ClickUp run that saves the work**, in a throwaway Space, by a person. Use the sheet below.
2. **An AlianHub rerun on a build at or after 739**, for jobs 4, 5, 6, 10 and 13, whose fixes merged after build 705.
3. **Two drags made by hand** (jobs 11 and 19) in both products.
4. **Job 3 from an email**, which was not tried.
5. **Job 25 carried through** in a workspace where an invitation and a privacy change are allowed.

### Sheet for the ClickUp run

Count with the rules above. Write the ClickUp version and plan at the top. One row per job.

ClickUp version: ____  Plan: ____  Date: ____  Run by: ____

| # | Done, partly or blocked | C | D | K | F | S | Saved (yes or no) | What stood in the way |
|---|---|---|---|---|---|---|---|---|
| 1 | | | | | | | | |
| 2 | | | | | | | | |
| 3 | | | | | | | | |
| 4 | | | | | | | | |
| 5 | | | | | | | | |
| 6 | | | | | | | | |
| 7 | | | | | | | | |
| 8 | | | | | | | | |
| 9 | | | | | | | | |
| 10 | | | | | | | | |
| 11 | | | | | | | | |
| 12 | | | | | | | | |
| 13 | | | | | | | | |
| 14 | | | | | | | | |
| 15 | | | | | | | | |
| 16 | | | | | | | | |
| 17 | | | | | | | | |
| 18 | | | | | | | | |
| 19 | | | | | | | | |
| 20 | | | | | | | | |
| 21 | | | | | | | | |
| 22 | | | | | | | | |
| 23 | | | | | | | | |
| 24 | | | | | | | | |
| 25 | | | | | | | | |

N is fixed by the job text: 29, 24, 0, 64, 58, 23, 0, 0, 25, 0, 0, 101 plus any forced text, 0, 20, 34, 12, 2 to 6, 0, 0 to 5, 19, 22, 16, 0, 14, 22.

## Left in QA Sandbox by this run

All named `[QA bench] …` unless noted. Nothing was deleted.

- Lists: `list`, `inner list` (now inside the subfolder), `Sprint 9` (a planned sprint, 2026-10-01 to 2026-10-14).
- Folder `folder` with subfolder `subfolder`.
- Tasks: `Write release note`, `bulk 01` to `bulk 20`, `Parent` with subtask `Child`, `Design`, `Build`, `Call supplier`, `Please fix the login page`.
- Custom fields: `Note`, `Cost`, `Stage`, `Review date`, `Reviewer`, `Cost total` (a rollup).
- View `Mine this week`. View tabs added with "Add View", not renamed: Workload, Board, Gantt, Calendar.
- Doc `Launch notes`, with one saved version `v1`.
- Dashboard `Board` (visible to its creator only).
- One automation rule, left switched off.
- One comment with a reply, two time entries, and one dependency between `Design` and `Build`.
- One message in the scratch chat channel made by an earlier QA pass.
- The owner's timesheet for the week of 2026-09-28 is approved.
