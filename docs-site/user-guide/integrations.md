# Integrations

Integrations connect AlianHub to the tools your team already uses. They are set up once for the workspace and run on their own. You can sign in with Google or GitHub, turn emails into tasks, see due dates in your calendar, send task events to Slack or Discord, link GitHub pull requests to tasks, and connect your own AI app.

Your own accounts, which AlianHub's AI reads from when you ask, are connectors, not integrations. They live under **AI**, **Customize**, **Connectors**. See [Connectors](./connectors).

This page lists every integration in AlianHub, where to set it up, and who can do it.

## At a glance

| Integration | What it does | Where | Who sets it up |
|---|---|---|---|
| Sign in with Google, GitHub or GitLab | Log in without a separate password | Log-in page | The person who runs your server |
| Company sign-in (SSO) and SCIM | Log in through your company's identity provider; add and remove members automatically | **Settings**, **Sign-in & SSO** and **SCIM** | Owners and admins |
| Email to Task | Mail sent to a project's address becomes a task | **Integrations**, **Email to Task** | Anyone who may create tasks in the project |
| Calendar feed | Your due dates in Google Calendar, Outlook or Apple Calendar | **Integrations**, **Calendar** | Anyone, for themselves |
| Slack slash commands | Run `/alianhub` commands from Slack | **Integrations**, **Slack** | Owners and admins |
| Outgoing webhooks | Send task events to Slack, Discord or any web address | **Settings**, **Integrations** | Members, for their own webhooks |
| GitHub pull requests | Link pull requests to tasks and move tasks on merge | **Integrations**, **GitHub** | Owners and admins |
| Embedded apps | Show an outside tool as a panel inside AlianHub | **Integrations**, **Apps** | Owners and admins |
| Google Drive and Dropbox | Attach files straight from your cloud storage | **AI**, **Customize**, **Connectors** | Anyone, for themselves |
| Your own accounts for AI | Google, Slack, Outlook, GitHub, Notion and more, read by AI when you ask | **AI**, **Customize**, **Connectors** | Anyone, for themselves |
| Your own AI app | Claude, ChatGPT or another AI app works in AlianHub for you | **AI**, **Customize**, **Connect your AI** | Anyone, for themselves |
| Importers | Bring work in from ClickUp, Jira, Trello, Asana, Monday.com or CSV | **Settings**, **Import & export** | Owners and admins |

**Integrations** opens from **More**, in the **Work** group. Its page is titled **Integrations & Automation**, with a list of categories on the left.

![The Integrations page](/screenshots/integrations.webp)
## Sign-in

### Google, GitHub and GitLab

The log-in page shows **Continue with Google**, **Continue with GitHub** or **Continue with GitLab** when the person who runs your server has set them up. You sign in with that account's email, so it must match the email your workspace invited.

### Company sign-in (SSO)

If your company uses an identity provider such as Okta or Azure AD, owners and admins can set up **Sign-in & SSO** with SAML 2.0 or OIDC. People then choose **Continue with company sign-in (SAML / OIDC)**. People on a verified domain can sign in with SSO; everyone else needs an invitation.

**SCIM** lets the identity provider create, update and deactivate members automatically. New members get the default role you choose.

Setup details are in [Sign-in: OAuth, SSO and SCIM](/admin/sso-oauth).

## Email to Task

Give a project its own email address. Anything sent to it becomes a task. It suits forwarded requests, bug reports or supplier emails.

1. Open **Integrations**, then **Email to Task**.
2. Under **Project**, pick a project.
3. Select **Create inbox**. AlianHub shows the **Inbox email address**.
4. Your mail provider must pass incoming mail to AlianHub. The person who looks after your mail adds a route for that address, pointing at the **Email provider callback address** shown on the card. Providers such as Mailgun, SendGrid, Amazon SES and Postmark support this.
5. Send a test email. A task appears in the project within seconds.

Good to know:

- Tasks land in the project's first list, created as the person who made the inbox.
- Each inbox shows how many emails it has received. **Pause** stops it filing tasks; **Resume** starts it again.
- Only the person who made the inbox, an owner or an admin can pause or delete it.
- If the person who made it can no longer open the project, the card warns that mail is not being filed.

## Calendar feed

Subscribe to a live, read-only calendar of task due dates.

1. Open **Integrations**, then **Calendar**.
2. Under **What to include**, choose **My tasks** or **A project's tasks**.
3. Select **Create feed**.
4. Copy the **Calendar subscription URL (iCal)** at once. For your security it is shown only once.
5. In Google Calendar, Outlook or Apple Calendar, choose "Add from URL" (or "Subscribe to calendar") and paste it.

The feed updates by itself. If the link leaks, select **Regenerate link**: calendars using the old link stop updating.

The feed only shares due dates. To let AlianHub's AI read and add events in your own Google Calendar, connect Google under [Connectors](./connectors).

## Slack slash commands

Owners and admins can let people run `/alianhub` commands from your Slack workspace.

1. Open **Integrations**, then **Slack**.
2. In your Slack app's settings, copy the verification token into **Slack verification token**, and optionally set a **Default channel**. Select **Connect Slack**.
3. In Slack, create a slash command `/alianhub` and paste the request address AlianHub shows.
4. In Slack, run `/alianhub help` to check it works.

The commands are `/alianhub help` and `/alianhub projects`.

## Outgoing webhooks

A webhook sends a message to another app when something happens to a task. Use it to post task updates to a Slack or Discord channel, or to feed your own tools.

1. Open **Settings**, then **Integrations**.
2. Select **Add a webhook**.
3. Pick a **Destination**: Slack, Discord, or any web address.
4. Give it a **Name** and paste the **Webhook URL**.
   - Slack: Apps, Incoming Webhooks, Add to a channel, then copy the URL.
   - Discord: the channel's Edit, Integrations, Webhooks, New Webhook, then copy the URL.
5. Under **Events**, choose **All task events**, or some of **Task created**, **Task updated**, **Task deleted**, **Task archived** and **Task restored**.
6. Select **Create webhook**.
7. AlianHub shows a signing secret once. Save it if your own tool checks that messages really come from AlianHub.

Each webhook shows whether it is **Active** or **Paused**, and **Logs** lists each delivery with its status and time. If a webhook says **Needs attention**, delete it and add it again.

## GitHub pull requests

Connect a GitHub repository so pull requests show up on the tasks they are about.

1. Open **Integrations**, then **GitHub**.
2. Select **Connect** and sign in to GitHub. If one-click GitHub is not set up on your server, use a personal access token instead.
3. Pick the repository it reads.
4. Select **Link projects** and choose the projects it feeds.

What happens then:

- When a pull request names a task key (such as `WEB-42`), the task gets a link to the pull request and a comment.
- When that pull request is merged, the task gets a comment and moves to its project's review status, if it has one and is not already finished.

Only owners and admins can connect, pause or disconnect apps. Each connection shows its last sync, its last error and the projects it feeds. Secrets are never shown.

This sync uses one GitHub account for the whole workspace. To let AlianHub's AI read pull requests and issues with your own GitHub account when you ask, connect GitHub under [Connectors](./connectors) as well.

## Embedded apps

Show an outside tool, such as a dashboard, a BI board or docs, as a panel inside AlianHub.

1. Open **Integrations**, then **Apps**.
2. Type an **App name** and an **Embed URL (https://…)**, and select **Add app**.
3. Select the app's tab to open it. The **✕** on the tab removes it.

Only owners and admins can add or remove an app. Only https addresses work, and the other site must allow being shown inside another page. Some sites block it.

## Google Drive and Dropbox

Attach files straight from your own cloud storage instead of uploading them.

1. Open **AI**, then **Customize**. On **Connectors**, connect Google with **Drive** ticked, or connect Dropbox. See [Connectors](./connectors).
2. When you attach a file to a task, choose the provider and pick the file in its own picker. Attach it as a link, or import a copy into the project.

Your connection is private to you. Nobody else in the workspace can see or use it, and uploading from your computer works as before. Google shows AlianHub only the files you pick. For Dropbox, attaching a link works without connecting; importing a copy uses your connection.

## Agents and Slack

Agents reach Slack through the Slack account of the person they work for, not through a workspace bot. Each person connects their own Slack under [Connectors](./connectors), and an agent can use it only when Slack is ticked on that agent.

Nothing is posted until that person approves the exact channel and text in their **Inbox**. Direct messages are never read. See [Agents in AlianHub](./agents#connected-apps).

## Your own AI app

Connect Claude, ChatGPT, Claude Code or any AI app that supports MCP, so it can find, add and update work for you. It sees and changes only what you can. See [Connect your AI](/ai/).

## Moving in from another tool

**Settings**, **Import & export** brings tasks in from ClickUp, Jira, Trello, Asana, Monday.com or a CSV file. See [Import from ClickUp](./import-from-clickup) for a full walk-through.

## Good to know

- The **Marketplace** in **Integrations** also lists Microsoft Teams, Zapier, GitLab and two-way Google Calendar sync. You can save their details, but they do not send or sync anything yet. Use outgoing webhooks for chat updates, and the calendar feed for due dates.
- Your own Google, Slack, Outlook or GitHub account for AI is a connector, not an integration. See [Connectors](./connectors).
- An agent can use a connected app only if that app is ticked on the agent. Connecting an app does not give agents access.
- The **Automations** category in **Integrations** holds simple bulk rules, such as "bump all low-priority tasks in a project to high". For full rules that run when something happens, see [Rules (automations)](./rules).

## Related

- [Connectors](./connectors)
- [Import from ClickUp](./import-from-clickup)
- [Connect your AI](/ai/)
- [Your settings](./settings)
- [Sign-in: OAuth, SSO and SCIM (admin)](/admin/sso-oauth)
