# Connect your own AI to AlianHub

This guide is for you if you use Claude or ChatGPT and want it to work inside AlianHub for you. It uses plain words. The technical list of every tool is in `docs/MCP-AGENT-GUIDE.md`.

Where this guide is not sure, it says `to check`.

## What connecting means

You connect the AI app you already use. After that, you can ask it in everyday words to find, add and change work in AlianHub.

- It works as you. It sees what you can open. It changes only what your role lets you change.
- It works only while its app is open, or while it runs on a schedule you set up in that app.
- Every change it makes is written in the Audit log under its name and yours.
- Some changes happen at once and you can undo them. Some wait until you approve them.

## What it can do

- Find and read your tasks, projects, lists, docs, comments and time entries.
- Add tasks and subtasks, comment, attach links and log time.
- Change a task's status to In progress or In review.
- Show you where something is, with a link.

With the extra permissions on the consent screen, and unless your admin has switched the matching tools off, it can also:

- Change, assign, move, archive and close tasks, several at a time, and write docs.
- Read chat messages in the channels you are in.
- Work with tags, links between tasks, lists, comments on docs and goals.
- Ask for new fields, saved views, project setups, new projects and automation rules. These always wait for approval.

## What it cannot do

- It cannot delete a task, a doc, a comment or a project.
- It cannot remove people, change who may do what, or touch billing.
- It cannot read your direct messages.
- It cannot close a task on its own authority. A close follows your project's rule (see "What waits for your approval").
- It cannot do more than you can. If you cannot open a project, neither can it.
- It does nothing while its app is closed.
- It cannot change or switch off an automation rule that already exists.

## Steps

### On the Connect your AI page

1. In AlianHub, open AI in the left menu, then **Connect your AI**. When you sign up for the first time, this is the last step, called "One last step". You can choose **Skip for now** and come back later.
2. Pick your app and follow its steps. The page shows an address to paste. Copy it with the **Copy** button.
   - Connecting by address is on for a new server, and an owner can switch it on under Settings, Instance, AI on a server set up earlier. If the page says it is off, ask them to switch it on, and use a token (below) until then.
3. The line at the top of the page changes by itself when your AI app makes its first call. It then says "Connected" and when the app was last seen.
4. A first sentence appears: "Set up my project". It asks you a few questions and shows a plan. Nothing is made until you say yes.
5. Under "What your AI can do here", the page lists what this server allows. Under "Switched off on this install" it names what your admin has switched off.

### In Claude

1. Open Settings, then Connectors, and choose **Add custom connector**.
2. Paste the address from the Connect your AI page.
3. Claude opens AlianHub and asks what it may do. See "The consent screen" below.

### In ChatGPT

1. Open Settings, then Apps & Connectors.
2. Turn on Developer mode under Advanced settings, then create a connector. ChatGPT offers this on some plans only.
3. Paste the address. ChatGPT opens AlianHub and asks what it may do, the same way.

### With Claude Code or another tool

Choose **Create a token** on the Connect your AI page. That opens AI, Accounts, My account. Choose **New token**, name it, choose the projects it may use, and tick what it may do. The token is shown once. Copy it then. Your admin may require an expiry date.

Your address must be reachable from outside your network, because your AI app reaches AlianHub over the internet.

## The consent screen

When your AI app opens AlianHub, you see "Allow (the app) to act for you?" and a list under "It asks to:". Then you choose the one workspace it may use and select **Approve** or **Deny**. If your workspace has not approved the app yet, the screen shows **Ask an admin**, then "Waiting for your admin".

Each permission, in the words on the screen:

| Permission | On the screen |
|---|---|
| `tasks:read` | Read tasks you can see |
| `tasks:write` | Create and change tasks for you |
| `projects:read` | Read projects you can see |
| `docs:read` | Read pages and documents you can see |
| `time:read` | Read time logs you can see |
| `time:write` | Log time for you |

These six are granted together when you approve.

The next two are different. They start unticked. The screen says "It also asks for more. Tick only what you want it to do:".

| Permission | Name | On the screen |
|---|---|---|
| `tasks:manage` | Manage tasks | Edit, assign, move, archive and close your tasks, several at a time |
| `docs:manage` | Write docs | Create docs and change the ones you can edit |

Reading chat has its own separate permission. It is never part of the others, and it also starts unticked.

| Permission | Name | On the screen |
|---|---|---|
| `chat:read` | Read chat | Read messages in channels you are in |

It is offered only while your server has the data tools switched on (`MCP_TOOLS_DATA`). It never reads direct messages. An app connected before this existed reads no chat until you connect it again and tick it.

A manage or chat permission works only when three things are true: the app asked for it, you ticked it, and an owner or admin approved it for that app. If an admin has not approved it, the screen says "An owner or admin has not approved this for the workspace you chose."

The screen also says: "You can revoke this at any time under Accounts, Connected apps."

### For owners and admins

Under Settings, Agent clients, you see each app that asked to connect, under "Waiting for approval", "Approved" and "Denied or revoked". Choose **Approve** or **Deny**. Under "Allow at most:" you choose the permissions the app may be given, and "Wider permissions, given only if you tick them:" holds the manage and chat permissions. Approving without choosing any never includes them. You can **Change permissions** or **Revoke** later.

## What waits for your approval

Changes that only touch one task are made at once, and you can undo them. Anything wider, or anything everyone on a project would see, waits for a person.

These always wait:

- New custom fields, saved views, project setups and new projects.
- An automation rule. Only an owner or admin can ask for one, and only an owner or admin can approve it.
- A batch of changes that names more than one task. It waits as one request.
- Closing a task, when the project's rule is "With approval". This is the default. The project's "Agents and Done" rule has three choices: "Never" (a person closes), "With approval" and "Yes, marked unchecked". If your workspace has a person check an agent's work before Done, a person always closes the task.

- A change by an app connected by address that reaches past one task, such as a new task, a move or a link. It waits when you gave the app the matching extra permission, and is refused when you did not. This is on by default (the server setting `AGENT_TAINT_ROUTING`); the person who runs your server can switch it off.

Your admin can make more things wait:

- A project set to "Propose everything" holds every change a connected AI makes there.
- With `MCP_TOOLS_V2` on, a change that cannot be undone, such as moving a task to another list, waits.

Where you approve: open AI, then **AI Inbox**. Each waiting change shows exactly what will be made. Choose **Approve** or **Decline**. Whoever approves must be able to open the same task and hold the same permission. When you decline, the AI is told and does not try another way.

A doc the AI creates is marked as its draft until a person approves it. `to check`: the exact screen where that approval is given.

## How to undo

- Open AI, then **Audit log**. Choose the tab "Outside agents" to see only connected apps. Each change that can be undone has **Undo** and "Undo until (time)". The window is 24 hours unless your admin changed it.
- Right after you approve a waiting change, the AI Inbox shows **Undo** for 15 minutes.
- Some changes cannot be undone. Moving a task to another list is one. A change that has passed its undo time is another.
- Nothing is deleted for good. A project the AI made moves to the Trash when you undo it, unless it already holds a task or a doc.

## How to pause all agents in a project

An owner or admin does this.

1. Open the project and its detail screen.
2. Find "Agents working at the same time".
3. Choose **Pause all agents**.

From that moment no agent takes work or changes anything in that project. People carry on as usual. Choose **Resume agents** to let them work again. On the same screen you can set how many agents work at once.

The left menu under AI also has a **Pause all agents** button. `to check`: whether it also stops apps you connected yourself.

## How to disconnect

- You: open AI, then Accounts, then the tab **Connected apps**. Choose **Revoke** next to the app. You can also **Withdraw** one permission and keep the rest. It takes effect on the app's next call.
- An owner or admin: open Settings, then Agent clients, and choose **Revoke**. Everyone's connection to that app in this workspace ends now.
- A token: open AI, then Accounts, then My account, and revoke it there. It stops on its next call.

## Things to say

These are 15 sentences taken from the AI benchmark sheet (`Tasks/active/047-ai-run/ai-benchmark.md`). Each one works with the code as it is today. Open the screen you mean in AlianHub first, because "here" and "this list" mean the screen you last opened.

"Applied at once with Undo" and "waits for approval" assume a connection by token and the default settings: a project on "Act on single tasks, propose anything wider", and `MCP_TOOLS_V2` off. An app connected by address also waits, or is refused, on a change that reaches past one task (see "What waits for your approval").

| # | Say this | What happens |
|---|---|---|
| 1 | Move "Design" to In Progress. | Applied at once, with Undo. |
| 2 | Add a task "Call supplier" to the Launch list. | Applied at once, with Undo. |
| 3 | Open the task about the supplier, and open the doc about the launch. | Nothing changes. You get two links. |
| 4 | Show me each person's workload in QA Sandbox for this week, counted in tasks. | Nothing changes. You get a link to the Workload view, which opens on this week. You choose the unit on the screen. |
| 5 | Show me all my tasks across every project. | Nothing changes. You get a link to the Everything screen, opened on your own tasks, or the list in the chat. |
| 6 | Set "bulk 01" to "bulk 20" to high priority and assign them all to Priya. | Waits for approval, as one request, because it names many tasks. Needs the Manage tasks permission. |
| 7 | Add a task "Write release note" for me, due tomorrow, high priority. | Applied at once, with Undo. Needs the Manage tasks permission to set the person and the date. Without it the task has a title and priority only. |
| 8 | Start a timer on this task and stop it, then log 1 hour 30 minutes on it for today. | Applied at once, with Undo. `to check`: whether a timer stopped within a minute leaves an entry, and which day a manual entry counts for near midnight. |
| 9 | Make "Build" wait on "Design", then move Design two working days later. | The link is applied at once, with Undo. The new date is applied at once, with Undo, and needs Manage tasks. `to check`: whether Build moves by itself. |
| 10 | Show me this list grouped by Stage. | Waits for approval. It saves a view that everyone on the project sees. |
| 11 | Add fields to this project: a text field Note, a number field Cost, a dropdown Stage with Alpha and Beta, a date field Review date and a people field Reviewer. On "Write release note" set them to: ok, 120, Beta, tomorrow, me. | Waits for approval, once. The fields and their first values are in one request. Setting the values needs Manage tasks. |
| 12 | Create a doc "Launch notes" in QA Sandbox with the line "First draft", and tell me who can see it. | The doc is made at once, with Undo, and marked as the AI's draft. Needs the Write docs permission. The people on the project can see it. |
| 13 | Show my tasks due this week and save it as a view called "Mine this week". | Waits for approval. |
| 14 | Make a task in the Launch list from the last message in the scratch channel. | Applied at once, with Undo. Needs the Read chat and Manage tasks permissions. |
| 15 | When a task's status changes to Done, send the assignees the notice "Done notice". | Waits for an owner or admin. The rule is saved switched off unless you ask for it to be on. |

## More ready-made asks

Your AI app can also offer these by name: Set up my project, Plan my day, What is at risk, Write the status report and Triage what is new. All of them show you a result first. They change something only after you say yes.
