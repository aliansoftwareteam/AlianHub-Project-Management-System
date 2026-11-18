# Connectors

Connectors link your own accounts, such as your Google, Slack, Outlook or GitHub, to AlianHub's AI. When you ask, the AI reads from them with your account and proposes changes for you to approve. Only you can use a connection you make. Nobody else in the workspace, owners and admins included, can read through it.

Use a connector when you want the AI to answer from something outside AlianHub: "what is on my calendar tomorrow?", "what is the status of this pull request?", "draft a reply to the last email from the supplier".

## Connectors and integrations

AlianHub has two places for other apps. They do different jobs.

| | Connectors | Integrations |
|---|---|---|
| Whose account | Your own. Each person connects their own | One account for the whole workspace |
| What it does | The AI reads from it and proposes changes, when you ask | Runs on its own, for example linking pull requests to tasks or turning email into tasks |
| Who sets it up | Each person, for themselves | Usually an owner or admin, once |
| Where | **AI**, **Customize**, **Connectors** | **Integrations** |

Some apps appear in both. GitHub is one: the GitHub sync under [Integrations](./integrations#github-pull-requests) links pull requests to tasks for everyone, while the GitHub connector lets your AI read pull requests and issues with your own GitHub account.

## Open Connectors

Open **AI** in the left bar, then **Customize**. **Connectors** is the first tab. You can also find **Connectors** in the **More** menu, next to **Integrations**.

The page has two parts:

- **Your connectors**: the apps you have connected.
- **Browse**: every app your workspace offers. Search by name, or pick a **Category**.

::: info Switched on by your server
Connectors appear only when the person who runs your server has switched them on, and the apps you see depend on what they set up.
:::

## Connect an app

1. Under **Browse**, select the app.
2. If the app asks what AlianHub may use, tick what you want. For Google you choose **Calendar**, **Meet** and **Drive**.
3. Select **Continue to** and the app's name. You sign in on the app's own page and come straight back.
4. Some apps also take a **Personal token** instead. Make the token in the app's own settings, paste it, and select **Connect with this token**. AlianHub checks it once, keeps it safe and never shows it again.

The app moves to **Your connectors**. If a card says your admin needs to set the app up, an owner or admin has to give it an app first (see [For owners and admins](#for-owners-and-admins)).

## What each app can do

| App | What the AI can do with your account |
|---|---|
| Google | Read your calendar and add events, read and create Meet meetings, and read the Drive files you pick |
| Outlook | Search and read your mail, read your calendar, add events, and draft replies that you send yourself |
| Slack | List and read your channels, and post a message as you |
| GitHub | Read pull requests, their checks and issues, and comment as you |
| Notion | Search and read your pages, and draft new ones |
| Dropbox | Search and read your files |
| HubSpot | Search and read your CRM records |
| Canva | Search and read your designs |
| Supabase | Read your projects and their tables |
| Upwork | Read your contracts and look through jobs |
| Wispr Flow | Search and read your meeting notes |

The **Tools** list of each connection shows exactly what is available on your server. Your workspace may also have its own [custom apps](#custom-apps).

Anything that changes something in the app is a proposal. It waits in your **Inbox** until you approve exactly what goes out, and it is sent once. Nobody else can approve it for you.

## Manage a connection

Select **Manage** on a connected app to open its details:

- **Signed in with** shows whether you used the app's own sign-in or a personal token.
- **What AlianHub may use** lets you change what you ticked. Saving takes you to the app to agree to the change.
- **Tools** lists everything the AI may do with your account, marked **Read** or **Write**. Turn a tool off to stop the AI using it for you. It changes nothing for anyone else. A tool marked **Off for the workspace** was switched off for everyone.
- **Disconnect** ends the connection. AlianHub no longer uses your account until you connect again.

If a connection says **Needs attention** or **Reconnect needed**, select **Reconnect** and sign in again.

## Use a connector in Ask

In [Ask AlianHub](./ai-ask), point a question at an app:

- type `@` and pick the app from the **Connectors** group, or
- type the app's name as a word, such as "GitHub".

A chip for the app appears in the box. Remove it before sending if you did not mean it. Ask then reads from the app with your account and cites what it read in the answer.

If you ask for a change, such as "comment on that pull request", the answer says the change waits for your approval in the **Inbox**. Nothing is sent to the app until you approve it. If you have not connected the app, Ask tells you to connect it on **Connectors** first.

## Agents and connectors

An agent can use an app only if it is ticked on that agent. On the agent's **Connectors** tab, tick the apps, and the tools in each app, it may use. A new agent has none ticked.

An agent reads through the connection of the person each run works for: whoever started the run, or the owner of the rule or schedule that started it. It never uses the connection of the person who made the agent, and every change it proposes waits for that person's approval. See [Agents in AlianHub](./agents#connected-apps).

## Custom apps

Your team's own apps can be added by the address of their server, if they speak MCP, the standard AI apps use to reach tools.

To add one you need **Add custom apps** in your role. Owners and admins have it.

1. On **Connectors**, select **Add custom connector**.
2. Give the app a **Name** and its **Server address**, which starts with `https://`. Private and local addresses are not accepted.
3. Select **Add**. AlianHub reads how the app signs people in:
   - **Signs people in by itself**: members can connect straight away.
   - **Signs people in through your registered app**: register an app with it first, using the address AlianHub shows, then enter the **Client ID** and **Client secret** it gives you, and select **Save**.
   - **Each member pastes their own token**: each person makes a token in the app and pastes it.
4. Select **Tools**. Every tool stays off until you turn it on. For each one you want:
   - Choose **What it does**: **Only reads**, or **Changes things, and each use waits for approval**.
   - Check the **Name AI is shown** and the **Description AI is shown**. The AI never sees the app's own description, only the words you accept.
   - Turn on **On for AI** and select **Save**.

If the app later changes a tool, the tool shows **Changed since it was checked** and stops working until someone checks it again.

## For owners and admins

The **Workspace** tab, next to **Connectors**, holds the settings for the whole workspace:

| Section | What it is for |
|---|---|
| **Everyone's connections** | Who has connected what, and what each connection may do. You can end a member's connection, but never use it, and their account details stay private |
| **Tools to review** | Tools an app changed since they were checked. AlianHub stopped using them. **Approve** uses a tool as the app describes it now; **Keep off** leaves it off |
| **Company OAuth apps** | The app members sign in through for each connector: the one your server provides, or your company's own. Members reconnect when you switch |
| **Limits for connected apps** | How many reads each person and each agent may make per day, and how many changes each person may propose. Each day starts at midnight UTC |

When an app changes one of its tools, owners and admins are told in the Inbox.

Whether a role may connect apps at all is the **App connectors** row of **Security & permissions**. Guests cannot connect their own accounts.

## Good to know

- Slack direct messages and group messages are never listed, read or posted to.
- Outlook never sends mail. An approved reply is saved in your Drafts folder, and you send it from Outlook.
- Google Drive shows the AI only the files you pick.
- A read from an app is capped in size, and a run that read one makes no web request afterwards.
- Disconnecting ends the connection in AlianHub. To remove AlianHub from your account at the app as well, do it in that app's own settings.

## Related

- [Integrations](./integrations)
- [Ask AlianHub](./ai-ask)
- [Agents in AlianHub](./agents)
- [Approve in the Inbox](/ai/approve-in-the-inbox)
- [Connectors setup (admin)](/admin/connectors)
