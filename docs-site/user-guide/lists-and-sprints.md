# Folders, lists and sprints

Inside a project, tasks sit in **lists**. Lists can be grouped in **folders**, and any list can run as a **sprint**: a fixed stretch of time with a start, an end and a goal. This page shows how to make, rename, move, archive and delete each one, how to run a sprint from start to finish, and how tasks belong to lists.

## How it fits together

| Thing | Holds | Notes |
|---|---|---|
| Project | Folders and lists | A new project starts with one list called "List" |
| Folder | Lists, and subfolders | Optional. A folder can hold one level of subfolders. |
| List | Tasks | Every task lives in exactly one list, its home |
| Sprint | Tasks | A list with dates and a goal. You start it and complete it. |

You see the folders and lists in the **project tree** on the left of the project. Select a list to show its tasks in the current view. Each row shows how many tasks the list holds.

## Lists

### Make a list

1. Open the project.
2. Select **New**, then **New list**.
3. Type a name of at least 3 characters and save.

To make a list inside a folder, open the folder's menu and choose **New list**. The list is made in that folder.

### The list menu

Point at a list in the tree, or at a list's header in the List view, and open its three dots menu. You see only the items your role allows.

| Item | What it does |
|---|---|
| **Rename** | Type the new name. Press Enter to save, Esc to cancel. At least 3 characters. |
| **Copy link** | Copies a link that opens this list |
| **Move to folder…** | Choose where the list goes: a folder, or **Top level of the project** |
| **Count toward a goal…** | Links the list to one of your goals |
| **Make it a sprint** | Gives the list a start, an end and a goal. See "Sprints" below. |
| **Start sprint**, **Complete sprint**, **Sprint settings**, **Make it a plain list** | Shown once the list is a sprint |
| **Archive** | Hides the list and its tasks |
| **Restore** | Brings back an archived list |
| **Delete** | Moves the list and its tasks to the Trash |

### The list header

In the List view, each list has a header with its name and three totals for the whole list, subtasks included:

| Total | What it counts |
|---|---|
| **Planned** | Hours planned across every task in the list |
| **Logged** | Hours logged across every task in the list |
| **Overdue** | How far the list is on course to run past its plan. Finished tasks count what they actually logged; unfinished ones count their plan, or the time already spent if that is more. |

### Archive, restore and delete a list

- **Archive**: "Its tasks are archived with it." To get it back, open **More** in the project, choose **Show Archive**, and select **Restore** on the list.
- **Delete**: "The list and its tasks move to the trash." Restore it from **More**, then **Trash**, on the **Lists** tab.

### Private lists

A list can be shared with **Everyone** on the project, or be **Private** to the people and teams you pick, even inside a public project. Use **Share With** on the list's header. See [People and roles](./people-and-roles) for who can do this and what it hides.

## Folders

### Make a folder

1. Select **New**, then **New folder**.
2. Type a name of at least 3 characters and save.

To make a subfolder, open a folder's menu and choose **New subfolder**. A subfolder cannot hold another subfolder.

### The folder menu

| Item | What it does |
|---|---|
| **New list** | Makes a list in this folder |
| **New subfolder** | Makes a folder inside this one (one level only) |
| **Rename** | Changes the name |
| **Move folder** | Choose where the folder goes, such as **Top level of the project** |
| **Archive** | Archives the folder with its subfolders, lists and their tasks |
| **Delete** | Moves the folder with its subfolders, lists and their tasks to the Trash |

Before you archive or delete, the window tells you what goes with the folder, such as "2 lists and their tasks will be archived with it." You can restore the folder later: an archived one from the archived items, a deleted one from the Trash.

## Sprints

A sprint is a list run for a fixed time. It has a goal, a start date and an end date. You start it when the work begins, and complete it when the time is up. Unfinished work then moves on.

### Make a list a sprint

1. Open the list's menu and choose **Make it a sprint**.
2. Turn on **Run this list as a sprint**.
3. Type a **Sprint goal**: what the sprint is for.
4. Pick a **Start date**.
5. Choose a **Duration**: **1 week**, **2 weeks**, **3 weeks**, **4 weeks**, or **Custom** to pick your own **End date**.
6. Select **Save**.

A sprint needs both a start date and an end date, and the end must be after the start. **Sprint settings** in the same menu changes them later. While a sprint has not started, **Make it a plain list** clears its sprint dates. Its tasks stay where they are.

### What state a sprint is in

| State | Meaning |
|---|---|
| **Planned** | Made, not yet started |
| **Active** | Started, and the end date has not passed. Shows the days left. |
| **Overdue** | Started, and past its end date. Shows the days over. |
| **Closed** | Completed |

### Start a sprint

Open the list's menu and choose **Start sprint**. The tasks in it at that moment are its commitment. Tasks added later count as "Added after start" in the sprint report.

### Complete a sprint

1. Open the list's menu and choose **Complete sprint**.
2. The window shows the tasks that are **Completed**, **Not completed** and **Added after start**.
3. Under **Where should the unfinished work go?**, choose:
   - the next sprint, by name,
   - **A new sprint**, which runs for the dates shown, or
   - **The backlog**.
4. Confirm. The sprint closes.

If everything is done, the window says "Everything in this sprint is done. Nothing needs moving."

Good to know:

- Subtasks move with their parent task.
- An unfinished subtask whose parent is already done stays in the sprint. Finish it, or reopen the parent, before completing the sprint.
- A closed sprint cannot be started again or turned back into a plain list.

### Sprint reports

Open **More**, then **Reports**, then the **Sprint** tab, and choose a sprint. It shows what was **Committed**, **Completed**, **Unfinished** and **Scope added**, in points or tasks. A sprint that was never started has no commitment to measure against. The **Burn-down** under the project's **More** menu shows the same list over time. See [Reports and dashboards](./reports).

## How tasks belong to lists

- A task lives in one list, its **home**. Its home decides who can see it.
- A top-level task can also be **added to another list**, up to 10 other lists, even in another project. Open the task, find **Lists** in its details, and choose **Add to another list**. The task stays where it lives. Only people who can open its own project see it in the other list.
- To move a task to another list for good, use **Move** in the task's menu, or the **List** button on the bulk bar (see [Tasks](./tasks)).
- A subtask always shows under its parent. It cannot be added to another list on its own.
- A task cannot be added as an extra to a sprint, a backlog, a personal list, or a list in a closed or archived project.

## Related

- [Projects](./projects)
- [Tasks](./tasks)
- [Views, filters and saved views](./views/)
- [Reports and dashboards](./reports)
