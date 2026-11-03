# Your settings

Settings is where you change your own profile, sign-in, look and alerts. Owners and admins also run the workspace from here: members, roles, projects, templates and more. This page walks through your personal settings and then gives a short map of the workspace settings.

Open **More**, then **Settings** (in the **Workspace** group). The menu on the left has up to three groups:

| Group | Who sees it |
|---|---|
| **Personal** | Everyone |
| **Workspace** | Everyone, but most pages only show to owners and admins, or to roles given that permission |
| **Instance** | Only the account that set up this AlianHub server |

## Personal settings

### My settings

**My settings** holds your profile and how AlianHub looks and behaves for you.

| Section | What you can change |
|---|---|
| Profile | **Change photo**, first and last name. Your email is shown but is your sign-in, so you cannot change it here. **Job title** is "Set by an admin in Members". |
| Language and time | Your language, **Timezone** and **Time Format** (12 or 24 hours). |
| **Working hours** | The days and hours you work. "Used by Planner, Workload and agent nudges". |
| **Workload capacity** | What Workload counts as a full load when it measures points or tasks, per day or per week. Set for this workspace only. |
| **Theme** | **Light**, **Dark** or **System**. "System follows your device setting." |
| **Contrast** | **Standard**, **High** or **Match system**. High contrast darkens text and borders and draws a thick focus ring. |
| **Accent colour** | The colour of buttons, links and selected items. Kept on this browser only. |
| **How much to show** | **Simple** shows five places on the menu (Home, My work, Projects, Inbox and Ask). **Full** shows every place. Every page stays reachable either way. |
| **Keyboard** | Turn **Single-key shortcuts** (like `c` and `/`) off if they get in the way of speech input or other tools. **Show keyboard shortcuts** lists them all. |
| **AI agents** | How agents write for you (**Tone**), how much they ask you to check (**Review**), and **Notify me** when an agent finishes or needs a decision. |
| **AI memory** | Your nickname, role, preferences and things to remember. Ask AlianHub and the agents you start use them. Only you can see them. |
| **Active sessions** | Every device signed in to your account, with **Sign out** for each. |

Select **Save changes** after editing your profile. Most other switches save at once.

### Notifications

Which events alert you, and how: in the Inbox, by email or by push. See [Notifications](./notifications).

### Sign-in & security

**Sign-in & security** has two parts.

**Change password.** Type your current password, the new one, and the new one again, then save.

Forgot your password? Sign out, select **Forgot password?** on the log-in page, enter your email and select **Send reset link**.

**Two-factor authentication.** A second code from your phone each time you sign in with a password.

1. Select **Set up 2FA** (or **Turn on 2FA**).
2. "Scan with any authenticator app", or "Or enter this key by hand".
3. Enter the 6-digit code to confirm.
4. Save your recovery codes with **Copy codes** or **Download codes**, then select **I've saved them**. Each code works once, and you will not see them again.

To turn it off, select **Turn off 2FA** and enter a current code or a recovery code.

::: tip If you lose your phone
Sign in with your password, then use a recovery code instead of the app code. Out of codes? A workspace owner can turn 2FA off for your account from **Members**, after confirming it is you.
:::

### Company

**Company** lists every workspace (company) you belong to. Select one to switch to it. You can also switch from the workspace menu at the top of the left bar.

To start a new workspace of your own, use **Create a new workspace** on the log-in page.

### Your own connections

A few connections belong to you alone, not to the workspace:

| Where | What |
|---|---|
| **Settings**, **Integrations** | Cloud storage for attachments: connect your own Google Drive or Dropbox to attach files from there. Nobody else can see or use your connection. |
| **AI**, **Connections** | **My connections**: connect your own Google account. Only you can use it. |
| **AI**, **Connect your AI** and **Accounts** | Connect Claude, ChatGPT or another AI app to AlianHub, and see or end its access. See [Connect your AI app](/ai/connect). |

## Workspace settings (owners and admins)

This is a short map. What you see depends on your role and your plan. Most pages are for owners and admins; a custom role can be given some of them under **Security & permissions**.

| Page | What it is for |
|---|---|
| **General** | Company details, task priorities, allowed file types, milestone statuses, working days, the daily "log your time" reminder, the tracker's estimate limit, auto-closing idle projects, and switching AI on or off for the workspace |
| **Members** | Invite people, change a member's role or job title, resend an invitation, remove a member. See [People and roles](./people-and-roles) |
| **Teams** | Groups of people you can assign or share with at once |
| **Projects** | Every project, with its apps (such as **Time Tracking**) and settings. See [Projects](./projects) |
| **Custom Field Manager** | Fields you can add to tasks in any project. See [Custom fields](./custom-fields) |
| **Language & Region** | The workspace's default language, date format, week start, numbers and currency. Each person can still pick their own |
| **Security & permissions** | Roles and what each may do, including the timesheet screens |
| **Routing policy** | Rules for which AI model handles which kind of work |
| **Sign-in & SSO** and **SCIM** | Company sign-in (SAML or OIDC) and automatic member provisioning. See [Sign-in: OAuth, SSO and SCIM](/admin/sso-oauth) |
| **Agent clients** | AI apps allowed to connect to this workspace |
| **Integrations** | Outgoing webhooks to Slack, Discord or any web address. See [Integrations](./integrations) |
| **Templates** and **Task templates** | Project and task templates. See [Templates](./templates) |
| **Time Off** | Request time off, and (for owners and admins) approve the team's requests. See [Approvals](./approvals#time-off) |
| **Time Tracking** | Download the desktop tracker. See [Desktop time tracker](./time-tracker-app) |
| **Audit Log** | A record of sensitive actions, such as role and SSO changes |
| **Import & export** | Bring work in from ClickUp, Jira, Trello, Asana, Monday.com or CSV, and export the workspace. See [Import from ClickUp](./import-from-clickup) |
| **Billing** or **Plan & usage** | Your plan, when your server uses paid plans. Only the owner sees **Billing** |

### Instance settings

The **Instance** group (**Health**, **Settings**, **Backups**, **Upgrade**, **Logs**, **AI providers** and **Stats**) runs the whole AlianHub server, not one workspace. It shows only to the account that set the server up. See [The Instance console](/admin/instance-console).

## Related

- [Notifications](./notifications)
- [People and roles](./people-and-roles)
- [Integrations](./integrations)
- [Admin guide](/admin/)
