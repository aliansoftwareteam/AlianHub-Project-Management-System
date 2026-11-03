# Templates

A template is a starting point you can reuse, so you do not set up the same thing twice. AlianHub has templates for whole projects, for single tasks, and for views. This page covers each kind: where to find them, how to make your own, how to use them, and what they leave out.

| Kind | What it brings | Where you use it |
|---|---|---|
| Project template | Statuses, task types, views, apps, custom fields, and optionally folders, lists and tasks | The **New project** window |
| Task template | A task's description, checklist, subtasks, type, priority, tags, estimate and more | The **New task** window, or **Apply template** on a task |
| View template | A view's group, sort, filters and columns | **Add View** in a project |

Rules and docs have their own starting points too. See [Rules](./rules) and [Docs and whiteboards](./docs-and-whiteboards).

## Project templates

### The built-in templates

When you create a project, the **New project** window lists templates on the left. Templates for the kind of work you chose when you set up the workspace come first; **All** shows the rest. Each one shows how many statuses and sample tasks it brings, and a preview on the right. Pick one, fill in the form and select **Create project**. Tick the box to include the sample tasks if you want them. See [Projects](./projects).

### Settings › Templates

Open **Settings**, then **Templates**, to see every project template. The tabs are the built-in categories, and the last tab is your workspace's own templates.

| Column | What it shows |
|---|---|
| **Template** | The name and description |
| **Contains** | How many statuses and task types it has |
| **Views** | The views it sets up |
| **Owner** | **Built-in**, or your workspace |

Select a row, or **View**, to see the template in full. The card at the bottom, **What a project template can carry**, lists what can come along: **Statuses**, **Task types**, **Custom fields**, **Views**, **Project statuses**, **Apps**, and **Agents & skills**. Members, comments and time logs are never copied.

### Make a template by hand

Owners and admins can make templates here.

1. In **Settings**, then **Templates**, select **New**.
2. Give it a **Template Name**, a description and, if you like, an image.
3. Set up the project statuses, the task statuses, the task types, the apps and the views it should carry. At least one view is needed.
4. Save it. It appears under your workspace's tab.

**From a description** asks AI to draft a template from a few sentences about your work. It first suggests existing templates that match; you can still choose to create one. Review it and **Request Changes** until it fits.

### Save a project as a template

The fastest way to make a template is from a project that already works well.

1. Open the project's menu (or the row's menu on the Projects page) and choose **Save as template**.
2. Give it a **Name of the template** and, optionally, a **Description**.
3. Under **Also keep**, choose what comes along:
   - **Tasks**: with subtasks, checklists and field values, each task back in its first status.
   - **Dates**: kept as days from the start of the project, so a new project gets them from its own start.
   - **Automations**: they arrive switched off in a project made from the template.
4. Tick **Available to everyone who can create projects**, or leave it off so only you, owners and admins see it.
5. Select **Save template**.

Folders, lists, statuses, views and custom fields are always kept. Comments, files and logged time never are. After saving, AlianHub tells you what it left out, such as private lists you are not on, automations (only owners and admins manage them), tasks below the third level, or people who are no longer in the workspace.

A saved project template shows in the **New project** window under "Saved from projects". Using it asks what to bring: **Include the tasks**, **Keep the assignees**, **Keep the dates, counted from the start date**, and **Include the automations, switched off**, with a **Start date**. You can **Edit** or **Delete** a saved template from the same list.

## Task templates

A task template fills in a task for you, so a recurring kind of task, such as a bug report or a client onboarding, always starts the same way.

### Save a task as a template

1. Open a task that looks the way you want.
2. Open **More actions** and choose **Save as template**.
3. Type a **Template name**.
4. Choose **Who can use it**: **This project**, or **Every project in the workspace**. Only owners and admins can save a template for the whole workspace.
5. Set the **Task name**. Use {title} for the name typed when creating, and {date} for the day the template is applied.
6. Under **Include**, tick the parts to keep:

| Part | Notes |
|---|---|
| **Description** | |
| **Checklist** | |
| **Subtasks** | And, separately, **Subtask assignees** |
| **Task type**, **Priority**, **Tags** | |
| **Estimate**, **Story points** | |
| **Custom fields** | The values of your fields |
| **Start and due dates** | Kept as days after the day the task was created, and counted from the day the template is applied |

7. Select **Save**.

### Use a task template

- **When creating**: pick it in **Template** in the **New task** window.
- **On an existing task**: open **More actions**, then **Apply template**. AlianHub checks what would change. Fields that are empty are simply filled. For fields that already have a value, tick the ones the template should replace. Select **Apply**.

If you cannot change some fields on that task, they are left as they were, and AlianHub says which.

### A project's default task template

On a project's **Project Details** tab, the **Default task template** card picks a template that is chosen for you whenever someone creates a task in that project. They can still change or clear it.

### Manage task templates

Open **Settings**, then **Task templates**, to see every task template, for one project or the whole workspace, with how many checklist items and subtasks each holds. **Rename** or **Delete** one there. Deleting is for good.

## View templates

A view template keeps a saved view's group, sort, filters and columns, so you can add a view like it to any project.

1. Save the view first. Unsaved changes are not included.
2. Open the view tab's three dots menu and choose **Save as template**. Name it and save.
3. In any project, select **Add View**. Templates are at the top, under **From a template**.

If the project lacks something the template uses, such as a custom field, the view is added without it, and a message says what was left out. Only an owner or admin can rename or delete a view template. See [Views, filters and saved views](./views/).

## Good to know

- A template is a copy at the time you save it. Changing the original project or task later does not change the template.
- Automations always arrive switched off.
- Private lists are kept only in a template that stays with you, and only if you are on them.

## Related

- [Projects](./projects)
- [Tasks](./tasks)
- [Rules (automations)](./rules)
- [Views, filters and saved views](./views/)
