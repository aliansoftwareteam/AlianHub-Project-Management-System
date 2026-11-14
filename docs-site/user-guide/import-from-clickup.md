# Import from ClickUp

Moving your team from ClickUp? You can bring your tasks across in a few minutes. You export a file from ClickUp, upload it to AlianHub, check a preview, and confirm. Nothing is written until you confirm, and you can undo the import afterwards.

The same screen also imports from Jira, Trello, Asana, Monday.com and CSV files. This page covers ClickUp.

::: tip Treat your first import as a trial
Try one list first. Check the result, undo it if something looks wrong, and then import the rest.
:::

## Before you start

1. **Invite your team first**, using the same email addresses they use in ClickUp. AlianHub matches people by email. Anyone who is not a member yet is left unassigned; the import does not invite anyone.
2. **Have an owner or admin run the import.** Then each comment stays under the name of the person who wrote it. If anyone else imports, colleagues' comments are stored under the importer's name, with the author's name written in front.
3. **Keep each file under 2,000 rows.** A bigger file is refused. Export one list or one folder at a time.

## Step 1: Export from ClickUp

ClickUp has two kinds of export, and they carry different things:

| Export | Where in ClickUp | What it carries |
|---|---|---|
| View export | Open a Space, Folder or List in List view, choose **Export view**, pick CSV or Excel, and include all columns and subtasks | Tasks, subtasks, statuses, assignees, dates, priorities, tags and **custom fields** |
| Workspace export | Workspace settings, **Imports / Exports** | The same, plus **comments, checklists and attachments** |

ClickUp's menus may change; these steps were written in October 2026.

**Want everything?** Import twice into the same project: first the workspace export, then the view export of the same lists, choosing **Update them from the file** when the preview asks. The second import finds each task again and adds its custom fields. Do it in this order. The other way round, checklists and attachment links are lost.

## Step 2: Import into AlianHub

1. Open **Settings**, then **Import & export**, and select **Start an import**. (Owners and admins.)

   Or, inside a project, open **More** in the project toolbar and choose **Import tasks…**. Anyone who may create tasks in that project can do this.
2. Choose **ClickUp**.
3. Under **ClickUp export (CSV or Excel)**, pick your file. CSV and Excel files work; only the first sheet is read.
4. Answer **Where should the tasks go?**
   - **A new project for each ClickUp list**: each list becomes a project with the same name. You need permission to create projects.
   - **An existing project**: choose the **Project** and the **List**. Every task in the file goes into that list. Leave **Add missing statuses and tags to the project** ticked.

   If you started from inside a project, the tasks go into that project and you only pick the list.
5. Select **Next** and read the preview.
6. Select **Import** and the number of tasks. A progress bar moves one ClickUp list at a time. Keep the window open until it finishes.
7. Read the summary, then select **Done**. **Undo this import** is on the same screen.

### What the preview shows

- How many tasks and subtasks each ClickUp list has.
- New statuses and tags that will be added.
- Custom fields that will be created.
- Who will be assigned, and who is "not in this workspace".
- Rows that will be skipped, and dates that could not be read.
- Columns that are not imported, and columns that are not recognised.
- If some tasks from the file are already in the project, how many, and what to do with them.

## What comes across

| From ClickUp | In AlianHub |
|---|---|
| Task name | The task name, including letters from any language |
| Subtasks | Kept, up to three levels: task, subtask, and subtask of a subtask |
| Status | A status with the same name. Done-like statuses (complete, closed, done, resolved) become the project's first done status; open-like ones (to do, open, backlog, new) its first open status. Others are added |
| Assignees | Members matched by email who can open the project. Several assignees are kept |
| Due and start dates | Kept, to the minute |
| Time estimate | Kept |
| Priority | High and low are kept. Normal becomes Medium. Urgent becomes High |
| Tags | Kept. A tag the project already has is reused |
| Checklists | Kept, with what was ticked |
| Comments | Text, author and time |
| Custom fields | Created on the project and filled in: text, number, currency, date, drop-down, labels, checkbox, email, phone, website, people, rating and progress |
| Description | Kept, with headings, lists and links |

## What changes shape

| From ClickUp | What you get |
|---|---|
| Spaces and folders | Not created. The preview shows them beside each list name |
| Lists | One project per list, or all lists in one list of an existing project |
| A subtask four or more levels deep | Moved up to the third level. The summary names each one |
| A subtask whose parent is not in the file | Becomes a normal task. The summary names each one |
| Attachments | A link on the task to where ClickUp keeps the file. The file is not copied, so the link stops working if ClickUp stops serving it |
| A comment by someone who is not a member | Stored under the importer, as "Their Name: the comment" |
| A custom field type AlianHub does not have (such as location or formula) | A text field holding the value as written |
| Drop-down options | Made from the values in the file. Colours and unused options are not carried |
| Dates written as numbers, such as 05/12/2025 | Read day first if any date in that column has a day past the 12th; otherwise month first. Check a few afterwards |
| Task IDs | Every task gets a new key in its project |
| Creator and created date | The person importing, at the time of the import |

## What does not come across

- Rows with no task name. They are skipped and listed.
- Dates the importer cannot read, such as "next sprint". The task arrives without that date, and the summary names it.
- Values that do not fit their field, such as "lots" in a currency field. Left empty and counted.
- Assignees who are not members, or cannot open the project. Left off and listed.
- Time tracked, dependencies, linked tasks, task types, watchers, points and custom IDs. Every task arrives as a plain task.
- Attachment files, Docs, views, automations, goals, dashboards, recurring schedules, reminders, guests and permissions. They are not in the export file.

## Check afterwards

1. **Count.** The number of tasks created should match ClickUp's count for those lists, minus the skipped rows.
2. **Subtasks.** Open a task that has subtasks, and each task the summary says was moved.
3. **People.** Read **Left unassigned**. Invite those people, then assign their tasks by hand. The import will not do it later.
4. **Dates.** Set the dates that could not be read. Open five tasks that had a due date in ClickUp and check day and month are the right way round.
5. **Fields and statuses.** Open a task that uses each custom field, and look at the board. Added statuses sit at the end of the project's status list.

## What your team notices

Imported comments notify nobody and count as unread for nobody. Imported tasks have no watchers, so no "task created" alerts go out. People looking at the project see the tasks appear. If the project has rules that react to new tasks, they may run once for each imported task.

## Importing again

Each imported task remembers its ClickUp task. When you import into an existing project and some tasks from the file are already there, the preview asks what to do:

- **Leave them as they are** (the default). Only new rows are imported.
- **Update them from the file.** Name, status, dates, assignees, priority, tags, description and custom fields take the file's value wherever the file has one. An empty cell leaves the task as it is. New comments are added; comments already imported are not added twice. Checklists and attachment links are not touched. Nobody is notified.

This only works in the same project. Importing the same file into a different project, or as new projects, creates the tasks again. A task moved to the trash no longer counts, so importing its row again creates it anew.

## Undo an import

**Undo this import** moves every task that import created to the trash, where each can still be restored. You find it on the last screen of the import, and beside each import under **Recent imports** (in **Settings**, **Import & export**, or in a project's **Import tasks…** dialog).

- The person who ran the import can undo it, and so can an owner or admin.
- If someone has worked on an imported task since (changed it, commented on it, or added a subtask), the undo stops and names those tasks. Choose **Undo, and keep those tasks** to trash the rest.
- Custom fields the import created are switched off when no task still uses them. Statuses and tags it added stay.
- Tasks the import only updated are not changed back.
- Nobody is notified.

## Limits

| Limit | Value |
|---|---|
| Rows per file | 2,000 |
| Sheets read in an Excel file | The first one |
| Subtask levels | 3 |
| Files copied | None; attachments arrive as links |

A list with very long descriptions or many comments can be too large to send in one go, even under 2,000 rows. Split it into smaller exports, or ask whoever runs your server to raise the upload limit.

## Related

- [Projects](./projects)
- [Custom fields](./custom-fields)
- [Folders, lists and sprints](./lists-and-sprints)
- [Integrations](./integrations)
