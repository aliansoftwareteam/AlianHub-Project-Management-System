# Time: timers, timesheets and approval

You log the hours people spend on tasks. AlianHub adds them up on a weekly timesheet. A person sends the week in, and an owner or admin approves it. This page goes deeper than [Time](first-hour/07-time.md). It tells you each way to log time, how a week is approved, what billable means, who can see and do what, and what the product cannot do.

Time is always logged against a task. You cannot log time on a project or a list on its own.

## Where time lives

| Place | What you do there |
|---|---|
| A task, in its **Time** part | Start a timer. Add time by hand. See, edit and delete the entries on that task. |
| **Time** in the left bar | Open the timesheet screens (see "The timesheet screens" below). |
| **Log time** on **Mine** | Log hours on any task assigned to you. |
| **Approvals** | Owners and admins review submitted weeks here. |

The **Time** part of a task shows only when the project's **Time Tracking** app is on. It is chosen under **Apps** when you make a project, or in **Settings**, then **Projects**, then **Apps**.

Time is also tracked by a desktop tracker app. Its entries show on the same timesheet. Use the app to record work and screen captures. It is not covered further here.

## Start a timer

Open a task, find **Time**, and select **Start timer**. A clock appears with **Pause** and **Resume**. Select the stop button, named **Stop and log time**, to save the entry. A toast says "Time logged".

You can also start a timer from a task row on **Home**. There the buttons read **Start timer**, **Pause**, **Resume** and **Stop & log**. On **Mine**, a running timer shows in the top bar with a **Stop** link.

Good to know:

- You have one timer at a time. Starting a timer on another task stops the first one and logs it. A toast says "Stopped the timer on" and the task key.
- A timer that ran for less than a minute logs nothing. You see a note that nothing was logged.
- You cannot start a timer on a task that is done. The button is greyed out. Reopen the task first.
- You cannot start a timer on a day that is inside one of your approved weeks (see "Approve, send back, reopen").
- If a timer cannot be saved when you stop it, it keeps running and nothing is lost. If the day is in an approved week, the message says to ask an approver to reopen the week, then stop it again.
- The timer lives in the browser you started it in. It does not follow you to another device or another browser. Two browsers can each hold a timer.
- Timer entries are billable (see "Billable time"). You can change that afterwards on the timesheet.

### A timer left running

If a timer has run for 12 hours or more, the **Log time** form shows a box headed "Timer left running overnight". A desktop tracker session left open from an earlier day gets the same box. It gives two buttons:

- **Trim to 3h** saves the entry as 3 hours long.
- **Edit** puts the task and hours into the form so you can type the right time and log it.

## Log time by hand

### On a task

In the task's **Time** part, select **Add time**. Fill in:

| Field | What it takes |
|---|---|
| **Date** | The day the work happened. |
| **Start** | The time you started. |
| **Hours** | Whole hours, 0 to 23. |
| **Minutes** | Whole minutes, 0 to 59. |
| **Note** | What you did. Up to 500 characters. Blank becomes "Logged from the task". |
| **Billable** | A tick box. Ticked to start with. |

Select **Save time**, or **Cancel**. The entry has to end by midnight, so pick an earlier start if the hours do not fit. A toast says "Time saved".

The task's **Time** part also shows a bar of time logged against the estimate, and a line saying how much it is over. The list below it shows each entry with the person, the day and the note.

### On the Log time form

Open **Time** in the left bar, then **Mine**, then select **Log time**. A panel opens at the side. On a phone it opens as a page.

1. **Task**: pick from **Recent** (tasks on this week's timesheet) or **Assigned to you**. Search with "Search your tasks".
2. **Hours**: type 1:30, 1.5, 1h 30m or 90m. The buttons **+15m**, **+30m** and **+1h** add to it. **Round to 15** rounds what you typed to the nearest quarter hour.
3. **When**: **Today**, **Yesterday** or **Custom**. You cannot pick a day after today.
4. **Note** (optional) and **Billable**.
5. Select the button that reads **Log** and the hours, such as "Log 1:30".

The form says "Logged 1h 30m on" the task when it works. Under the title it shows what you have logged today.

The Log time form puts the entry on the day you chose. For today it ends now. For an earlier day it ends at 18:00.

You can also select a day's cell on a task row of the timesheet. That opens the same form with the task and day filled in.

### Edit or delete an entry

You do both from the task, in its **Time** part. The weekly timesheet is for reading and for adding time, not for changing entries.

- **Edit** opens the entry in the form. **Save time** keeps your change.
- The bin button, named **Delete time entry**, asks "Delete?" in place. Select it again to confirm.
- A lock beside an entry means it is in an approved week. It cannot be changed.
- A monitor beside an entry means it came from the desktop tracker. It has no **Edit** or delete.
- An entry that is still running shows "Running". It has no **Edit** or delete either.

Edits and deletes are written to the task's history.

## The timesheet screens

**Time** in the left bar opens one screen with up to five tabs.

| Tab | What it shows |
|---|---|
| **Mine** | One week of time, a row for each task. This is **My timesheet**. |
| **Project** | Time logged against projects. |
| **Workload** | How busy people are. See [Views, filters and saved views](views.md). It needs a wide screen. |
| **Tracker** | Recordings from the desktop time tracker. |
| **Approvals** | Submitted weeks, time off and agent proposals waiting for a decision. |

You see a tab only if your role has it. Each tab also needs a workspace plan that includes it. Without the plan, the screen offers an upgrade.

## My timesheet

**Mine** shows one week, Monday to Sunday. Each row is a task. Each column is a day. The last column is the task total, and the last row is the day total.

- The arrows beside the date range move between weeks. They are named **Previous week** and **Next week**.
- A drop-down reading **All projects** narrows the rows to one project. It only changes what you see. A submit still covers the whole week.
- Select a day's cell to add time to that task on that day. Days after today are greyed out. So is every cell when the week is approved.
- Days you do not work, and days of approved time off, are dimmed. The bottom row reads "Total · capacity 8h/day". The grid always counts 8 hours a day, minus time off.
- When a past working day is below capacity, a line under the grid says the day is under capacity. Select the button beside it, such as **Add 2h**, to open the form with that time filled in.
- **Export** downloads a CSV of the week. The columns are User, Project, Date, Description, Billable and Hours.
- A box on the grid reading "No time logged this week" appears when the week is empty. **Log time** is in it.
- A line at the bottom reads "Last week:" and shows how last week stands: not submitted, submitted, approved or rejected.

## Submit a week

A week has four states, shown as a chip beside the date range.

| State | Meaning |
|---|---|
| **Draft** | Not sent. This is every week to begin with. |
| **Submitted** | Sent, waiting for an owner or admin. |
| **Approved** | Accepted. The week is locked. |
| **Rejected** | Sent back with a reason. The chip shows the reason. |

To send a week, select **Submit week**. A toast says "Week submitted for approval." The button is only on in **Draft** and **Rejected**. After a rejection it reads **Resubmit week**.

Good to know:

- You submit a whole week, for all projects. You cannot submit one task, one day or one entry.
- A submitted week is not locked. You can still add, edit and delete time in it until it is approved. The reviewer sees the week as it stands when they open it.
- You can submit an empty week.
- Owners and admins can submit a week for someone else. They open that person's week and select **Submit week**.
- Nobody gets a notice when a week is submitted. The reviewer sees it in **Approvals**.

## Approve, send back, reopen

Owners and admins open **Time**, then the **Approvals** tab. It lists everything waiting. A number beside the title counts it. The buttons **All**, **Time**, **Leave** and **AI** filter the list. **Time** shows weeks. **Leave** shows time off requests. **AI** shows proposals from AI agents.

A week shows as "(name)'s timesheet" with the week, the total, the billable hours, the internal hours and, if there is any, the hours over capacity. "Internal" means not billable.

On one week:

- **Approve** accepts it. A toast says "Approved."
- **Detail** opens that person's week on **Mine**.
- **Reject** asks for a reason. It reads "Reason (the requester sees this)". Select **Confirm reject**, or **Cancel**. A reason is needed. The person sees it on their timesheet. A toast says "Rejected."

On many weeks, tick them, or tick **Select all timesheets on this page**. A bar shows how many are picked. Select **Approve**, or **Send back**. **Send back** asks for a note for everyone, up to 500 characters. The result says how many were approved, sent back or skipped, with the reason for each skip, such as "already reviewed".

After a week is approved:

- It is locked. Nobody can add, edit or delete time in it, or start, stop or trim a timer on its days. The task shows a lock beside its entries.
- An owner or admin can select **Reopen** beside the date range. A box asks "Reopen this week?". The week goes back to **Submitted**. Its time can be changed again, and it needs approving again. A note on the week says who reopened it and when.

After a rejection the week is not locked. The person fixes it and uses **Resubmit week**.

Owners and admins may approve their own week. The week then reads "Approved by (name) (own week)". In **Approvals** it carries a chip, **Your own week**, with the hint "If you approve it, the week shows that you approved your own."

The week's history keeps who approved it and who reopened it, and when.

## Billable time

Every entry has a billable flag. It is on to start with. An entry from before the flag existed counts as billable.

- On a task, tick or untick **Billable** when you add or edit time.
- On the **Log time** form, tick or untick **Billable**.
- A timer always logs as billable.
- On **Mine**, each task row has a small button that reads **Billable** or **Non-billable**. Select it to flip every entry on that row for the week. A row reads **Billable** only when none of its entries is non-billable.

You can flip the flag on an approved week. Approval does not lock the flag.

Where billable matters:

| Where | What it does |
|---|---|
| **Export** | A **Billable** column says Yes or No. |
| **Approvals** | Each week shows its billable and internal hours. |
| A project's **Billing** page | **Draft from this month**, and the **Generate** button for a month in the hourly view, count only billable time. The project needs a saved billing contract first. |

That is all it does. See "What it cannot do".

## Who can see and do what

Your role decides it. The tabs have one setting each under **Security & Permissions**, in the **Sheet Settings** group. For each tab a role can have **Own**, **Everyone** or nothing. **Own** means only their own time. In a new company, the Member role starts with **Mine** on **Own** and no other tab.

| | Owner or admin | Role with **Everyone** | Role with **Own** |
|---|---|---|---|
| See other people's time | All projects | Only in projects they can open | No |
| Pick another person on **Mine** | Yes | Yes | No |
| Log or run a timer on a task | Yes, on tasks they can open | Same | Same |
| Edit or delete another person's manual entry | Yes | Yes, in projects they can open | No |
| Submit a week | Their own, or anyone's | Their own | Their own |
| Approve, send back or reopen | Yes | No | No |
| Flip **Billable** on another person's entries | Yes | No | No |

More detail:

- **Everyone** is a view setting, but it also lets that role edit and delete other people's manual entries, in projects they can open.
- Time on a task in someone else's personal list is not shown to others. Owners and admins are no exception.
- Only owners and admins approve. A custom role cannot, and you cannot name an approver for a project or a person.
- An AI agent cannot submit a week, and cannot approve, send back or reopen one. A person has to do it in AlianHub, signed in. An agent also cannot delete a time entry.
- Putting time on another person's name is possible only for an owner or admin, and only in a project that person can open. The screens do not offer it.
- Your own manual entries are yours to change until the week is approved. After that they are locked, for everyone.

## Reminders

Owners and admins can turn on a daily email that nudges people who have not logged time that day. In company **Settings**, find the card **Daily "log your time" reminder**. Turn on **Enable daily reminder**, choose who it goes to under **Send to**, and select **Save recipients**. It is off to start with. If nobody is picked, no email goes out.

## Limits

| Limit | Value |
|---|---|
| One timer | One at a time, in each browser |
| Shortest timer that is logged | One minute |
| Longest single entry from the **Log time** form | 23 hours 59 minutes |
| Longest single entry on a task's **Add time** form | 23 hours 59 minutes, and it must end by midnight |
| **Log time** form days | Today or earlier |
| Note on a task's **Add time** form | 500 characters |
| Reason when rejecting a week | 500 characters |
| Note when sending back many weeks | 500 characters |
| The week | Monday to Sunday |
| Capacity shown on the grid | 8 hours a day |

Some things have no limit. Time is kept in whole minutes, and nothing rounds it further apart from the **Round to 15** button you press yourself. AlianHub does not cap the hours in a day or a week, and it does not check whether entries overlap. A timer has no longest run, but one that runs past 12 hours is flagged (see "A timer left running").

## What it cannot do

- **Approve one entry or one project.** A week is approved as a whole, for one person.
- **Lock a week on submit.** Only an approved week is locked. A submitted week can still change.
- **Name an approver.** Every owner and admin can approve every week. There is no delegate.
- **Send a notice about a submission or a decision.** No email or alert goes out. The reviewer must open **Approvals**.
- **Keep a timer across devices.** The timer lives in one browser.
- **Log time on a task you cannot open.** The task must be in a project you can see.
- **Log time from the Log time form on any task.** It lists tasks assigned to you, and recent ones from the week on screen. To log on another task, use that task's **Time** part.
- **Edit an entry on the timesheet grid.** Entries are changed from the task.
- **Change a desktop tracker entry or a running entry.** They have no **Edit** or delete.
- **Set an hourly rate for billing.** No screen sets rates today. A month invoice draws on rates stored for each person or project, so with none stored its lines are priced at zero.
- **Put a rate on an entry,** or round time to a unit such as 15 minutes by itself.

Back to [Guide index](README.md).
