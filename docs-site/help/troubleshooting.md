# Troubleshooting

Something is not working the way you expect? Find the problem below, read what the message means, and try the fix. Most problems are a setting that you, your workspace admin, or the person who runs your server can change.

::: tip Running the server yourself?
Problems with installing, starting, mail delivery, storage or upgrades are covered in [Admin troubleshooting](/admin/troubleshooting).
:::

## I can't sign in

| What you see | What it means | What to do |
|---|---|---|
| "No account with that email." | No account uses that address on this server | Check the spelling. Use the address your invitation was sent to |
| "Log in to your workspace. No account yet? Ask your workspace admin to invite you." | This server is invitation-only | Ask an owner or admin of your workspace to invite you |
| Wrong password | | Select **Forgot password?**, enter your email and select **Send reset link** |
| "Too many attempts. Wait a few minutes, then try again." | Sign-in is paused for a short while after several failed tries | Wait a few minutes. Then reset your password if you are unsure of it |
| "Verify your email first" | You have not clicked the link in your verification email | Open that email and click the link. No email? Check spam, then **Resend email** |
| "Your password must be reset." | Your account needs a new password | Follow the reset link sent to your email |
| "That login link has expired or was already used." | A one-time login link works once, for 15 minutes, on the same device | Request a new one |
| "Login links aren't enabled on this server." | | Sign in with your password |
| "Google sign-in didn't load." | Your connection or an ad blocker stopped it | Reload, or sign in with your email |
| "Single sign-on didn't complete." | Your company sign-in failed or was cancelled | Try again, or use a password if you have one |
| "This account can't join this workspace through single sign-on." | Your email's domain is not set up for this workspace's SSO | Ask a workspace admin to invite you |

### Lost your two-factor phone

Sign in with your password, then enter one of your saved recovery codes instead of the app code. Each code works once. Out of codes? A workspace owner can turn two-factor authentication off for your account from **Members**, after confirming it is you. See [Your settings](/user-guide/settings#sign-in-security).

### Signed in, but in the wrong workspace

If you belong to several workspaces, AlianHub remembers the last one. Switch from the workspace menu at the top of the left bar, or from **Settings**, **Company**.

## I didn't get my invitation email

1. **Check spam and junk folders**, and any "Other" or "Promotions" tab.
2. **Check the address.** Ask the person who invited you which email they used.
3. **Ask for it again.** An owner or admin can select **Resend Invitation** in **Settings**, **Members**.
4. **Ask for an invite link instead.** An admin can share an invite link. Anyone with the link joins with the role on the invite.
5. **Still nothing?** The server may not be able to send email. The person who runs it should check its mail settings ([Mail](/admin/mail)). Password resets and notification emails will be missing too.

## My timer won't start

| What you see | Why | Fix |
|---|---|---|
| The **Time** part is missing on a task | The project's **Time Tracking** app is off | An owner or admin turns it on in **Settings**, **Projects**, **Apps** |
| **Start timer** is greyed out | The task is done | Reopen the task first |
| The timer won't start on a past day | That day is in an approved week | Ask an owner or admin to reopen the week |
| "Stopped the timer on" another task | You have one timer at a time | This is normal. The first timer was logged |
| Stop does nothing and the timer keeps running | The time could not be saved, often because the day is in an approved week | Nothing is lost. Ask an approver to reopen the week, then stop it again |
| The timer is gone on another computer | Timers live in the browser you started them in | Stop it in the browser where it is running |
| The desktop tracker says "Add estimated hours to start the tracker" | Your workspace limits the tracker to the task's estimate | Add an estimate to the task, or ask an admin |

More in [Time and timesheets](/user-guide/time) and [Desktop time tracker](/user-guide/time-tracker-app).

## I can't see a project

1. **Check the project tabs.** The projects list has **Open**, **Archived** and **Closed** tabs. A closed or archived project is not in **Open**.
2. **Search for it** by name or code on the projects list.
3. **You may not be a member.** A private project shows only to its members. Ask the project's lead or an admin to add you.
4. **Your role may not allow it.** What a role may see is set by an owner or admin under **Settings**, **Security & permissions**.
5. **A task in someone's personal list** is visible only to them.

If you can open the project but not a screen inside it, such as **Time** or a report, your role probably lacks that screen. Ask an owner or admin.

## My notifications are missing

| Missing | Check |
|---|---|
| Everything for one kind of event | **Settings**, **Notifications**: is **Inbox** or **Push** ticked for that line? |
| Updates on tasks you don't own | Under **Tasks**, **Notify for** may be set to **Assigned to me** |
| Updates from one project | That project's **Watchers** panel may be set to **Ignore** |
| Push alerts on this computer | **Browser notifications** must be on in this browser. If it says "Blocked in this browser", allow notifications for the site in the browser's settings and reload. Check your computer is not in a focus mode |
| Emails | **Email** is off by default; tick it for the events you want. Check spam. If no email arrives at all, the server's mail may not be set up |
| Agent alerts | **Agent activity** may be off |
| Timesheet decisions | These send no alerts. Check your timesheet |

See [Notifications](/user-guide/notifications).

## Ask AlianHub or an agent isn't answering

| What you see | What it means | Who fixes it |
|---|---|---|
| "AI is turned off" | AI is switched off for the server or for your workspace. Nothing is sent to an AI model | An owner or admin turns it on in **Settings**, **General**, or the server owner in the instance settings |
| "Set up an AI provider" or "AI is not available" | No AI model is set up on this server | The person who runs the server adds one; see [AI providers](/admin/ai-providers) |
| "Planning needs an AI key on this server, or your own AI connected to AlianHub." | The same, for planning | As above, or [connect your own AI app](/ai/connect) |
| "The model set up on this server has no price on file" | AlianHub cannot track the cost of that model, so it will not use it for this | The person who runs the server adds a price for the model |
| "Nothing in the projects you can open matches that." | Ask found nothing you may see | Name the project or task, or check you can open it |
| The answer stops halfway | The connection dropped or the model failed | Ask again |
| An agent does nothing | Agents may be paused, out of budget, or not allowed in that project | An owner or admin checks **Pause all agents** and the agent's settings; see [Limits and pause](/ai/limits-and-pause) |
| A workflow page says "The workflow engine is not running" | Workflows are switched off on this server | The person who runs the server switches them on |

## A page is slow or won't load

1. **Reload the page.** If AlianHub was open for a long time, a fresh load often helps.
2. **Check your connection.** Without one, AlianHub says "Your workspace needs a connection to load. This page reloads by itself when you're back online."
3. **Narrow big views.** A list or board with thousands of tasks loads slower. Add a filter, or use a saved view.
4. **Try another browser**, or a private window. A browser extension can slow pages or block parts of them.
5. **Check whether others see it too.** If everyone is slow, tell the person who runs the server. They can check the server's health in the instance console.

## Something else

| Problem | Try |
|---|---|
| A button I expected is missing | Your role or plan may not include it. Ask an owner or admin |
| "Please upgrade your plan" | Your workspace plan does not include this feature. The workspace owner can change the plan |
| I deleted something by mistake | Look in **Trash**, under **More**, **Workspace** |
| An AI change was wrong | Undo it from the Inbox; see [Undo a change](/ai/undo) |
| My import looks wrong | Undo it and try again; see [Import from ClickUp](/user-guide/import-from-clickup#undo-an-import) |

Still stuck? See [Getting help](./support).
