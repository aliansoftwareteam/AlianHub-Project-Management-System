# Moving from ClickUp

For a team lead who wants the team's tasks out of ClickUp and into AlianHub. You export a file from ClickUp, upload it here, check a preview, and confirm. Nothing is written before you confirm.

Everything in the tables below is what the importer does to the sample export in `tests/fixtures/clickup-export-sample/`, checked by `tests/clickup-import-end-to-end.test.js`. That sample is invented. No export from a real ClickUp account has been run through it yet, so treat the first import of your own file as a trial (see [Undo](#undo)).

## Before you start

1. **Invite your team first**, with the email addresses they use in ClickUp. People are matched by email only. Anyone who is not a member yet is left unassigned; the import invites nobody.
2. **Have an owner or admin run the import.** Only then does each comment stay under the name of the person who wrote it. When anyone else imports, every colleague's comment is stored under the importing person, with the author's name in front.
3. **Keep each file under 2,000 rows.** A larger file is refused. Export list by list, or folder by folder.
4. **Import each task once.** Nothing recognises a task that is already here: the same file imported twice gives you every task twice.

## 1. Export from ClickUp

*As of 2026-10, and not checked against ClickUp's screens; their menus may differ.*

ClickUp has two exports, and they do not carry the same columns:

| Export | Where | Carries |
|---|---|---|
| View export | Open the Space, Folder or List, open a List view, choose **Export view**, pick CSV or Excel, with all columns and subtasks included | Tasks, subtasks, statuses, assignees, dates, priorities, tags, **custom fields** |
| Workspace export | Workspace settings, **Imports / Exports** | Tasks and the above, plus **comments, checklists and attachments** |

Pick one per list. If you import both files, every task arrives twice.

## 2. Import into AlianHub

1. Open **Settings**, then **Import & export**, and press **Start an import** (owners and admins). Inside a project, anyone who may create tasks can open **More** in the project toolbar and choose **Import tasks…** instead.
2. Choose **ClickUp**.
3. Under **ClickUp export (CSV or Excel)**, pick the file. `.csv`, `.xlsx` and `.xls` are read; only the first sheet.
4. **Where should the tasks go?**
   - **A new project for each ClickUp list**: each list becomes a project of the same name holding one list of the same name. You need permission to create projects.
   - **An existing project**: choose the **Project** and the **List**. Every task of every ClickUp list in the file goes into that one list. Leave **Add missing statuses and tags to the project** ticked unless you may not edit the project's details; with the box ticked and without that permission the import is refused.
5. Press **Next** and read the preview: tasks and subtasks per ClickUp list, new statuses, new tags, custom fields, who will be assigned, who is "not in this workspace", how many rows will be skipped, and the table **What this import will bring in**.
6. Press **Import N task(s)**. The bar moves one ClickUp list at a time.
7. Read the summary (**What came in**, rows skipped, **Left unassigned**) before pressing **Done**.

Started from inside a project, the import goes into that project and step 4 only asks for the list.

## What comes across

| From ClickUp | In AlianHub |
|---|---|
| Task name | The task name. Letters outside English (ä, €, 日本語) are kept |
| Subtasks | Kept, three levels deep: task, subtask, subtask of a subtask |
| Status | A status of the same name. `complete`, `closed`, `done`, `resolved` land on the project's first done status; `to do`, `open`, `backlog`, `new` on its first open status. Any other status is added to the project |
| Assignees | Members matched by email who can open the project. Several assignees are kept |
| Due date, start date | Kept to the minute when the file gives them in ClickUp's number form (the `Due Date` and `Start Date` columns) |
| Time estimate | Kept, in minutes |
| Priority | High and low are kept; normal is Medium here |
| Tags | A tag the project already has is reused whatever its capitals; the others are added |
| Checklists | Kept with what was ticked |
| Comments | Text, author and time |
| Custom fields | Created once on the project and filled: short text, text, number, currency, date, drop down, labels, checkbox, email, phone, website, people, rating, progress |
| Description | Kept and shown in the task panel |

## What changes shape

| From ClickUp | What you get |
|---|---|
| Spaces and folders | Not created. The preview shows them beside each list name, and that is all |
| Lists | One project per list, or all lists poured into one list of an existing project |
| A subtask on the fourth level or deeper | Moved up to the third level, under the subtask on the second. The summary names each one |
| A subtask whose parent is in another list, or not in the file | Becomes a task. The summary names each one |
| Priority `urgent` | High. A task with no priority becomes Medium |
| Attachments | A link on the task, in its Links list, to the file where ClickUp holds it. No file is copied, so the link stops working when ClickUp stops serving it |
| A comment by someone who is not a member | Stored under the person importing, as "Their Name: the comment" |
| A comment with no time in the file | Dated at the moment of the import |
| Description formatting | Headings, bullet and numbered lists and links are kept; a link reads "label (address)". Bold, italic, code and tables stay as the characters typed (`**bold**`). HTML is shown as text |
| A custom field of a type with no match here (location, formula and the like) | A text field holding the cell as written |
| Drop-down options | Made from the values found in the file. Colours and unused options are not carried |
| A date given only as words ("Friday, December 5th 2025") | Read as that day at midnight on the server's clock |
| Task IDs | Every task gets a new key in its project. ClickUp's IDs and custom IDs are not kept |
| Creator and created date | The person importing, at the time of the import |

## What does not come across

| Thing | What happens |
|---|---|
| A row with no task name | Skipped, and listed with its row number |
| A date the importer cannot read, such as day-first `15/12/2025` | The task arrives without that date. **Nothing reports it** |
| A field value that does not fit its field ("lots" in a currency field) | Left empty, and counted as "did not fit their field" |
| Assignees who are not members, or who cannot open the project | Left off the task, and listed |
| New statuses and tags, when **Add missing statuses and tags** is off | Unknown statuses fall onto the project's first status; new tags are left out and listed |
| Time tracked, dependencies and linked tasks, task type, watchers, points, custom ID | The columns are recognised and not read. Every task arrives as a plain task. The preview does not mention them |
| Any other column | Ignored without a word |
| Two rows with the same Task ID | Both arrive as separate tasks |
| The files behind attachments, Docs, views, automations, goals, dashboards, recurring schedules, reminders, guests and permissions | Not in the export file, so not imported |

## Check afterwards

1. **Count.** "N task(s) created" should equal ClickUp's task count for those lists, less the skipped rows listed under it.
2. **Tree.** Open one task that has subtasks, and every task the summary says was moved or imported as a task.
3. **People.** Read the **Left unassigned** line. Invite those people, then assign their tasks by hand; the import will not do it later.
4. **Dates.** Open five tasks that had a due date in ClickUp. Filter for tasks with no due date and compare with ClickUp, because an unreadable date is dropped silently.
5. **Fields and statuses.** Compare the "did not fit their field" count with what you expect, open a task that uses each custom field, and look at the board: added statuses sit at the end of the project's status list.

## How long it takes

Not measured. There is no timing for 40, 1,000 or 10,000 tasks yet, so this guide gives none. What the code fixes:

- A file holds at most 2,000 rows, so 10,000 tasks means at least five files.
- The whole file is sent once for the preview, then one request per ClickUp list. The server accepts 2 MB per request unless `BODY_LIMIT` is raised; a list with long descriptions or many comments can reach that before it reaches 2,000 rows.
- Tasks are created first, level by level, then comments and links are saved one at a time. The dialog must stay open until it shows the summary.

## What your team notices

Imported comments notify nobody and count as unread for nobody. Imported tasks have no watchers, so no "task created" notice goes out. People looking at the project see the tasks appear, and the project's activity log gets one "created" line per task. Imported tasks are created the normal way, so an automation or webhook that reacts to new tasks in that project may run once per task; that has not been tested.

## Undo

There is no undo, and imported tasks carry no mark that says which import made them. So make the import easy to throw away:

- Choose **A new project for each ClickUp list**. To undo, delete those projects.
- Or create an empty list in the project and import into that. To undo, delete the list.

If you imported into a list that already had work in it, the imported tasks have to be picked out and deleted by hand. In every case the statuses, tags and custom fields the import added to an existing project stay until you remove them.
