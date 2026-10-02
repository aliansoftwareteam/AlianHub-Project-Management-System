# What your AI can do

Your AI can do three kinds of things. Some happen at once. Some wait for you. Some it can never do.

What it can do also depends on the permissions you ticked (see [Connect your AI app](01-connect.md)) and on what your server has switched on.

## It can read

It can read what you can open: tasks, projects, lists, statuses, comments, docs and time entries. It can show you where something is, with a link. Chat is read only if you ticked **Read chat**. See [What your AI can see](06-what-it-sees.md).

Reading changes nothing.

## It does at once

These changes happen at once when the project uses the rule "Act on single tasks, propose anything wider". That is the default. Each one can be undone. See [Undo a change](04-undo.md).

- Comment on a task.
- Set a task to In progress or In review. Those are the only statuses it can set without the Manage tasks permission.
- Attach a link, such as a PR, a branch or a doc.
- Add a task or a subtask. Without Manage tasks, a new task gets the project's first status and nobody is assigned.
- Start and stop a timer, and log your own time.

With the **Manage tasks** permission it can also, at once and one task at a time:

- Edit a task's title, description, priority, dates or estimate.
- Set or change the people on a task, and set a custom field.
- Archive a task, and bring it back.

With the right extras switched on, it can also add or remove a tag or a link between two tasks, and make or rename a list. With **Write docs** it can create and change docs. A doc it creates is marked as its draft.

Your server can make more changes wait. If a card in the AI Inbox says so, approve it there.

## It waits for you

A change that waits shows up in the **AI Inbox**. See [Approve, decline or edit in the Inbox](03-approve-in-the-inbox.md).

These always wait:

- New custom fields on a project.
- A new saved view.
- A project set up from one plan, and a new project.
- A new folder.
- An automation rule. Only an owner or admin can ask for one, and only an owner or admin can approve it. The rule is saved switched off unless the AI says to switch it on.
- A message to Slack, if your workspace uses that link. Only an owner or admin can approve it.

These wait in some cases:

- **Closing a task.** The project's "Agents and Done" rule decides. "With approval" is the default: the close waits for a person. "Never" means a person closes it. "Yes, marked unchecked" lets the agent close it at once. If your workspace has "A person checks an agent's work before a task is closed" turned on, a person always closes it. An agent needs the Manage tasks permission to close at all.
- **Changes to more than one task in one batch.** They wait together, as one request.
- **A project set to "Propose everything".** Every change a connected agent makes there waits.
- **Too many tasks too fast.** In each project an agent changes only a set number of different tasks in 10 minutes without asking. The default is 10. Its change to one more task waits. New tasks and docs count too. See [Limits, and pausing agents](05-limits-and-pause.md).

## It can never do

- Delete a task, a project, a doc or a comment. It has no way to.
- Remove people from the workspace, change who may do what, or touch billing.
- Read your direct messages.
- Approve, decline or undo a change. Only a person who is signed in to AlianHub does that.
- Change or switch off an automation rule that already exists.
- Do more than you can. If you cannot open a project, neither can it.
- Close a task on its own authority. A close follows the project's rule.
