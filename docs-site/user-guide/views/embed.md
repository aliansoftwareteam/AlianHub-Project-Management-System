# Embed and other views

Beyond List, Board, Table, Calendar, Gantt and Workload, a project can show more kinds of tab. The **Embed** view puts another website inside the project, such as a Google Sheet, a Google Doc, a Figma design or a YouTube video, so the team does not have to switch tools. Other views hold the project's docs, forms, discussion, activity and reports. This page covers each one.

All of them are added the same way: select **Add View** at the end of the project's tabs, and pick one from the menu. The menu groups them under **Popular**, **Integrations** and **More views**. You can type to search it. Tick **Private view** to keep the tab to yourself, and **Pin View** to put it first. See [Views, filters and saved views](./).

## Embed

The Embed view shows a web page, or a piece of HTML, inside a tab of the project.

### Add an Embed view

1. Select **Add View**, then **Embed** (under **Integrations**).
2. Pick what you are embedding:

| Choice | Paste |
|---|---|
| **Anything** | Any web address, or a piece of HTML |
| **Sheets** | The address of a Google Sheet |
| **Docs** | The address of a Google Doc |
| **Youtube** | The address of a YouTube video or playlist |
| **Figma** | The address of a Figma file or prototype |

3. Type a **View Name** of at least 3 characters. It is the tab's name.
4. Choose **Embed URL** and paste the address. With **Anything**, you can choose **Embed HTML** instead and paste the code, such as the embed code a website gives you.
5. Tick **Private view** to keep it to yourself, or **Pin View** to pin it.
6. Select **Add View**.

With **Anything**, AlianHub recognises a Sheets, Docs, YouTube or Figma address on its own. A YouTube playlist address is turned into the right embed address for you.

### What it checks

| Message | Why |
|---|---|
| "The name is required" / "The name should be at least 3 characters long" | The name is missing or too short |
| "This name already exists" | Another tab in the project has that name |
| "The url is required" / "Please enter valid url" | The address is missing, or does not match the kind you picked |
| "URL already exists" | The project already embeds that address |
| "The Html code is required" | **Embed HTML** was chosen with nothing pasted |

### Limits

- The page you embed decides whether it can be shown. Many sites refuse to be shown inside another site, and some need you to be signed in to them, or the file to be shared, before it shows.
- What you see inside the tab is the other site. AlianHub does not read or store its content.
- Your plan must include it, or the tab says "To Unlock Embed View".

## Project Details

The project's own information rather than its tasks: a description, a checklist, attachments, milestones, and the project's fields such as type, currency, dates and lead. See [Projects](../projects) and [Milestones](../milestones).

## Docs

The project's docs as a page tree on the left, with the doc you are editing on the right. **New page** adds a doc, **Find a page…** searches them, and the plus on a row (**Add a nested page**) puts a page under another. See [Docs and whiteboards](../docs-and-whiteboards).

## Forms

Collect requests through a form you share. Every answer can arrive as a task in the list you choose.

1. Add the **Forms** view and select **New form**.
2. Give the form a title. Under **Build**, select **Add question** for each question. Each question **Fills** a task field or a custom field. One question must fill the **Task Name**.
3. Mark questions **Required**, add a description, choose a **Width**, and reorder by dragging.
4. Optionally add logic: **Show this question when…** shows a question only for certain earlier answers, with **all of these are true** or **any of these is true**.
5. Choose where answers go: **Submissions go to** a list, and **Create tasks as** a task type.
6. Turn off **Create a task for each submission** to only collect responses. Answers are always saved in the submissions table.
7. Adjust **Colors**, **Title alignment**, **Background** and **Buttons color**. **Preview** shows the form as visitors see it.
8. Select **Publish**. Share the link.

**View Submissions** lists every answer. Search them, open the task an answer made, and **Export to Excel**. A published form must be unpublished before it can be deleted. Deleting a form keeps the tasks it already made. Rules can act on form answers too: see [Rules](../rules).

## Comments

A project-wide discussion, for talk about the project as a whole rather than one task. Everyone who can open the project can read it and reply.

## Activity

A feed of everything that happened in the project: tasks created, changed, moved and closed, with who did it and when. Filter it by people and by kind of change.

## Dashboard

A project overview at a glance: task totals, how much is complete, and estimated against remaining hours. What it shows follows your role.

## Reports

Charts for the project: burn-down, velocity and cumulative flow. They can be exported as PDF files. See [Reports and dashboards](../reports).

## Recurring Tasks

Every repeat rule in the project, in one place. A rule makes a task on a schedule.

1. Select **Rule**.
2. Give it a **Rule name** and the task title, "Task created each time".
3. Set **Every** so many **days**, **weeks** or **months**, **on** which day, **at** what time, and **assign** whom (or **nobody**).
4. Set when it **ends** (or **never**).
5. Under **IF THE LAST ONE ISN'T DONE**, choose **Skip and note it**, **Create anyway**, or **Roll the date forward**.
6. Tick **Copy the checklist and description each time** if the task should carry them.
7. Select **Create rule**.

Each rule shows its **NEXT OCCURRENCES**. You can pause a rule, **Run now** to make the next task at once, or **Delete rule**. Repeats set on a single task (its **Repeat** setting) show here too. See [Tasks](../tasks).

## Timeline

Scheduled tasks laid out on a shared date axis, to spot overlaps and gaps. A task needs a start date and a due date to show. Tasks without dates wait in the **Unscheduled** tray. The Timeline has no dependencies; for those, use the [Gantt](./gantt).

## Mind Map

The project as a mind map: parent tasks branching into their subtasks. Expand and collapse branches to see the structure. The top shows how many nodes there are.

## Whiteboard

A board where every task of a list sits as a card you can drag anywhere, with notes and text beside them. Everyone who opens the list sees the same board. See [Docs and whiteboards](../docs-and-whiteboards).

## Canvas

A small dashboard of widgets for the project: a summary with how much is complete, tasks by status and by priority, what is overdue and open, and what is due in the next 7 days. You choose which widgets show. Your choice is kept in your browser only.

## Map

Pin tasks onto a world map to see where your work happens.

1. In the **To place** list, select **Place** on a task.
2. Click anywhere on the map to put it there.
3. Select a pin and choose **Remove from map** to take it off. **Clear all** removes every pin.

::: warning Kept on this device
Map pins are saved in your browser only. Other people do not see your pins, and you do not see them on another computer.
:::

## Related

- [Views, filters and saved views](./)
- [Docs and whiteboards](../docs-and-whiteboards)
- [Projects](../projects)
- [Rules (automations)](../rules)
