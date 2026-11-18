# Notifications

AlianHub tells you when something needs you: a mention, a new assignment, a comment on your task, a due date coming up, an agent waiting for a decision. This page explains where those alerts arrive, how to choose which ones you get, and how to quiet a busy project.

## Where alerts arrive

| Channel | What it is | Starts |
|---|---|---|
| **Inbox** | A row in your Inbox, in the app. See [Chat and the Inbox](./chat-and-inbox#the-inbox) | On |
| **Push** | An alert on your computer or phone browser, even when AlianHub is in the background | On, once you allow it in the browser |
| **Email** | An email to your account address | Off |

Two things depend on how your server is set up:

- **Email** works only when the person who runs your server has set up outgoing mail. See [Mail](/admin/mail).
- **Push** works only when the server has a push service set up, and only in a browser where you allowed notifications.

Real-time updates are separate from alerts. Lists, boards and task panels refresh by themselves when someone else changes something, whatever your settings.

## Open your notification settings

Open **Settings**, then **Notifications** (in the **Personal** group). The page says "Defaults for everything you're watching. Any single task can override these."

The page is a grid. Each line is one kind of event. Each column is a channel: **Inbox**, **Email**, **Push** and **Chat**. Tick a box to turn it on. It saves at once.

### The groups

| Group | Example lines |
|---|---|
| **Tasks** | Task Create, Task Status, Task Assignee, Task Priority, Task Due Date, Task Attachments, Task Estimated Hours, Comments I'm @mentioned In, Replies to my comments, Comments assigned to me |
| **Project** | Project Create, Project Status Change, Project Assignee, Project Lead, Project dates, Project Milestone, Project Sprint Create, Project Close |
| **Docs** | Mentions in docs and docs shared with you |
| **Goals** | A goal or one of its targets reached |
| **Before** | Reminders before a due date |
| **Chat** | **Message Create** (new messages) and **Comments I'm @mentioned In** (mentions in chat) |

Extra choices on some groups:

- **Tasks** has **Notify for**: **All** tasks, or only those **Assigned to me**. It starts on **Assigned to me**.
- **Before** has **Notify when** on each line, from 10 minutes up to 3 days before.

### How the columns behave

- **Inbox** and **Push** work together. A row reaches your Inbox when either one is ticked. To stop rows for an event, untick both.
- A mention always reaches your Inbox, whatever you tick.
- **Message Create** never sends email and never makes an Inbox row. It only sends a push alert to people in the conversation.
- The **Chat** column has no effect today.

## Switches below the grid

| Setting | What it does | Starts |
|---|---|---|
| **Browser notifications** | "Get an alert on this device when something needs you, even with AlianHub in the background." Select **Turn on**, then allow it when the browser asks. | Off until you allow it |
| **Quiet hours** | "No push between" two times, with a box "Also respect my time off and Do not disturb". "Urgent @mentions still come through". | Off |
| **Agent activity** | "Approvals agents need from you and actions they took on their own. One switch for all agent noise." | On |
| **Daily digest instead** | "One email at 08:00 with everything non-urgent from the last day." | Off |

Owners and admins also see an AI alerts section here, when AI alerts are on for them.

::: warning Saved, but not applied yet
**Quiet hours** and **Daily digest instead** are saved, but AlianHub does not act on them yet. Turning them on does not hold back an alert and does not send a digest.
:::

If **Browser notifications** says "Blocked in this browser", allow notifications for the site in your browser's settings, then reload the page.

## Quiet a busy project

Each project has a **Watchers** panel. In it you choose how closely you follow that project:

| Choice | What you get |
|---|---|
| **All activity** | Updates on everything in the project you can see |
| **Participating and mentions** | Only what you are part of, and mentions. This is the default |
| **Ignore** | Nothing from the project's activity |

You can change only your own choice. The panel says "You can only change your own notifications."

## Other things that notify you

| Event | Where it shows |
|---|---|
| A reminder you set comes due | Inbox, under **Reminders** |
| Your time-off request is approved or declined | Inbox, and by email |
| An agent finishes a run or needs a decision | Inbox, controlled by **Agent activity**, and by **Notify me** under **AI agents** in **My settings** |
| A scheduled agent report is ready | The Inbox of the person it runs as, and email if the schedule asks for it |
| An AI change waits for approval | Inbox, **Needs your approval** |

Weekly timesheet submissions and decisions do not notify anyone. See [Approvals](./approvals).

## Troubleshooting

| Problem | What to check |
|---|---|
| No emails at all | Is **Email** ticked for that event? Has your admin set up outgoing mail? Check your spam folder. |
| No push alerts | Is **Push** ticked? Is **Browser notifications** on in this browser? Is your computer in a focus or do-not-disturb mode? |
| Too many alerts from one project | Set that project's watch level to **Participating and mentions** or **Ignore**. |
| Too many task alerts | Set **Notify for** under **Tasks** to **Assigned to me**. |

More in [Troubleshooting](/help/troubleshooting).

## Related

- [Chat and the Inbox](./chat-and-inbox)
- [Your settings](./settings)
- [Approvals](./approvals)
