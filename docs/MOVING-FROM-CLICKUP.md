# Moving from ClickUp

For a team lead who wants the team's tasks out of ClickUp and into AlianHub. You export a file from ClickUp, upload it here, check a preview, and confirm. Nothing is written before you confirm.

Everything in the tables below is what the importer does to the sample export in `tests/fixtures/clickup-export-sample/`, checked by `tests/clickup-import-end-to-end.test.js`. That sample is invented. No export from a real ClickUp account has been run through it yet, so treat the first import of your own file as a trial: it can be undone (see [Undo](#undo)).

## Before you start

1. **Invite your team first**, with the email addresses they use in ClickUp. People are matched by email only. Anyone who is not a member yet is left unassigned; the import invites nobody.
2. **Have an owner or admin run the import.** Only then does each comment stay under the name of the person who wrote it. When anyone else imports, every colleague's comment is stored under the importing person, with the author's name in front.
3. **Keep each file under 2,000 rows.** A larger file is refused. Export list by list, or folder by folder.
4. **A task is imported into a project once.** Each imported task remembers its ClickUp task id, so importing the same file into the same project again creates nothing twice (see [Importing again](#importing-again)). This holds per project: a file imported as new projects a second time makes new projects again.

## 1. Export from ClickUp

*As of 2026-10, and not checked against ClickUp's screens; their menus may differ.*

ClickUp has two exports, and they do not carry the same columns:

| Export | Where | Carries |
|---|---|---|
| View export | Open the Space, Folder or List, open a List view, choose **Export view**, pick CSV or Excel, with all columns and subtasks included | Tasks, subtasks, statuses, assignees, dates, priorities, tags, **custom fields** |
| Workspace export | Workspace settings, **Imports / Exports** | Tasks and the above, plus **comments, checklists and attachments** |

To get both, import into **An existing project** twice: the workspace export first, then the view export of the same lists with **Update them from the file** chosen in the preview. The second import recognises each task by its ClickUp id and adds the custom fields to it. In the other order the checklists and attachment links are lost, because an update does not bring those.

## 2. Import into AlianHub

1. Open **Settings**, then **Import & export**, and press **Start an import** (owners and admins). Inside a project, anyone who may create tasks can open **More** in the project toolbar and choose **Import tasks…** instead.
2. Choose **ClickUp**.
3. Under **ClickUp export (CSV or Excel)**, pick the file. `.csv`, `.xlsx` and `.xls` are read; only the first sheet.
4. **Where should the tasks go?**
   - **A new project for each ClickUp list**: each list becomes a project of the same name holding one list of the same name. You need permission to create projects.
   - **An existing project**: choose the **Project** and the **List**. Every task of every ClickUp list in the file goes into that one list. Leave **Add missing statuses and tags to the project** ticked. If you may not edit the project's details, the dialog switches it off for you when you press **Next** and says so; unknown statuses then fall onto the project's first status.
5. Press **Next** and read the preview: tasks and subtasks per ClickUp list, new statuses, new tags, custom fields, who will be assigned, who is "not in this workspace", how many rows will be skipped, each date that could not be read, the columns that are not imported, the columns that are not recognised, and the table **What this import will bring in**. If tasks of the file are already in the project, the preview says how many and asks what to do with them.
6. Press **Import N task(s)**. The bar moves one ClickUp list at a time.
7. Read the summary (**What came in**, rows skipped, dates not read, **Left unassigned**) before pressing **Done**. **Undo this import** is on the same screen.

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
| A date written as numbers, such as `15/12/2025` | Read day first when the column shows it is: one date has a day past the twelfth and none has a month past it. A column where nothing tells (`05/12/2025` alone) is read month first |
| Task IDs | Every task gets a new key in its project. ClickUp's IDs and custom IDs are not kept |
| Creator and created date | The person importing, at the time of the import |

## What does not come across

| Thing | What happens |
|---|---|
| A row with no task name | Skipped, and listed with its row number |
| A date the importer cannot read ("next sprint", or a day-first date in a column that also holds month-first ones) | The task arrives without that date. The preview and the summary name the row, the column and the value |
| A field value that does not fit its field ("lots" in a currency field) | Left empty, and counted as "did not fit their field" |
| Assignees who are not members, or who cannot open the project | Left off the task, and listed |
| New statuses and tags, when **Add missing statuses and tags** is off | Unknown statuses fall onto the project's first status; new tags are left out and listed |
| Time tracked, dependencies and linked tasks, task type, watchers, points, custom ID | Not imported. Every task arrives as a plain task. The preview lists these columns under "Columns that are not imported" |
| Any other column | Ignored. The preview lists it under "Columns that are not recognised" |
| A second row with a Task ID that a row above already has | Left out, and listed with its row number. Subtasks that name that id go under the first row |
| The files behind attachments, Docs, views, automations, goals, dashboards, recurring schedules, reminders, guests and permissions | Not in the export file, so not imported |

## Check afterwards

1. **Count.** "N task(s) created" should equal ClickUp's task count for those lists, less the skipped rows listed under it.
2. **Tree.** Open one task that has subtasks, and every task the summary says was moved or imported as a task.
3. **People.** Read the **Left unassigned** line. Invite those people, then assign their tasks by hand; the import will not do it later.
4. **Dates.** Read the "dates could not be read" list and set those by hand. Open five tasks that had a due date in ClickUp, and if your dates are written as numbers check that day and month are the right way round.
5. **Fields and statuses.** Compare the "did not fit their field" count with what you expect, open a task that uses each custom field, and look at the board: added statuses sit at the end of the project's status list.

## How long it takes

Not measured. There is no timing for 40, 1,000 or 10,000 tasks yet, so this guide gives none. What the code fixes:

- A file holds at most 2,000 rows, so 10,000 tasks means at least five files.
- The whole file is sent once for the preview, then one request per ClickUp list. The server accepts 2 MB per request unless `BODY_LIMIT` is raised; a list with long descriptions or many comments can reach that before it reaches 2,000 rows.
- Tasks are created first, level by level, then comments and links are saved one at a time. The dialog must stay open until it shows the summary.

## What your team notices

Imported comments notify nobody and count as unread for nobody. Imported tasks have no watchers, so no "task created" notice goes out. People looking at the project see the tasks appear, and the project's activity log gets one "created" line per task. Imported tasks are created the normal way, so an automation or webhook that reacts to new tasks in that project may run once per task; that has not been tested.

## Importing again

Every imported task keeps its ClickUp task id. When you import into **An existing project** and tasks of the file are already in that project, the preview says how many and offers two choices:

- **Leave them as they are** (the default). Only the rows that are new are imported. A new subtask goes under its parent even when the parent was imported earlier.
- **Update them from the file.** The task's name, status, dates, assignees, priority, tags, description and custom fields take the file's value wherever the file has one. An empty cell leaves the task as it is, so an assignee or a date set here is not wiped by a blank in the file. Comments that are new in the file are added; a comment already brought in (same time and author) is not added twice. Checklists and attachment links are not touched. The update notifies nobody, and no automation or assignment rule runs because of it.

A status the file changed is saved the way a status you change by hand is: the task leaves its old place on the board, a task moved to a done status records you as the person who closed it, and the task's history gets a "changed status" line in your name. That line counts as work on the task, so undoing the import that created the task will stop and name it (see [Undo](#undo)). A status that is the same as the task's writes nothing. A status the project does not have is not applied: the task keeps the status it has, and the summary names the task and the status. Nothing else of an update writes a history line.

A task that was moved to the trash no longer counts as already here: importing its row again creates it anew.

A task counts as already here only in the project it was imported into, and the preview says so. The same file imported into another project creates its tasks again there.

## Undo

**Undo this import** moves every task that import created to the trash, where each can be restored. It is on the last screen of the import, and beside each import under **Recent imports**: in **Settings**, **Import & export** (owners and admins see every import), and in a project's **Import tasks…** dialog (the imports into that project: your own, or all of them for an owner or admin).

- The person who ran the import can undo it, and so can an owner or admin.
- If someone has worked on an imported task since (changed it, commented on it, or added a subtask), the undo stops and names those tasks. Choose **Undo, and keep those tasks** to trash the rest; a kept task keeps the tasks above it.
- Custom fields the import created are switched off when no task outside the trash still uses them, in any project the field belongs to. A field that has since been made a field of every project stays. Statuses and tags it added stay.
- Tasks the import only updated are not touched, and what an update changed is not rolled back.
- One undo covers one ClickUp list. The last screen of an import undoes all its lists at once.
- Nobody is notified.

An import made before this version carries no mark and cannot be undone this way; delete the project or the list it went into.
