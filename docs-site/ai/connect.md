# Connect your AI app

Connect the AI app you already use, once, and it can work in AlianHub for you. This page shows how for Claude, ChatGPT and other tools, what AlianHub asks you before it lets an app in, and how to disconnect.

## Before you start: an account

You need an AlianHub account before your AI can connect. AlianHub has no page where a person makes their own account. You get one in one of two ways:

- An owner or admin of your workspace invites you. You open the link in the invitation and choose a password.
- You install AlianHub yourself. The install wizard makes the first workspace and your account as its owner.

If you have no account, ask your workspace admin to invite you. If your AI app opens AlianHub before you have an account, you only see the log-in page.

## Open the page

1. In AlianHub, open **AI** in the left menu.
2. Choose **Customize**, then the **Connect your AI** tab.

The first time you join a workspace, or finish the install wizard, this page comes last. It is called "One last step". You can choose **Skip for now** and connect later under **AI**, **Customize**, **Connect your AI**. The setup card on Home offers it again.

Pick your app on the page and follow its steps. The page shows an address to paste. Copy it with the **Copy** button.

## Claude

1. In Claude, open Settings, then Connectors, and choose **Add custom connector**.
2. On the Connect your AI page, find "Paste this address:". Choose **Copy**.
3. Paste the address in Claude.
4. Claude opens AlianHub and asks what it may do. See "The question AlianHub asks" below.

## ChatGPT

1. In ChatGPT, open Settings, then Apps & Connectors.
2. Turn on Developer mode under Advanced settings, then create a connector. ChatGPT offers this on some plans only.
3. Paste the same address.
4. ChatGPT opens AlianHub and asks what it may do, the same way.

Your AI app reaches AlianHub over the internet. So the address must be reachable from outside your network.

::: info If connecting by address is switched off
If the page says connecting an app by its address is switched off, the person who runs your server can switch it on. Until then, use a token (see below).
:::

## Claude Code, Cursor and other tools

Tools that connect with a token rather than an address, such as Claude Code, use a token you make in AlianHub. Choose **Create a token** on the Connect your AI page. It opens **AI**, **Accounts**, on the tab **My account**.

1. Choose **New token**.
2. Give it a name.
3. Choose its "Project scope". "Every project you can already open" is one choice.
4. Choose how long it lasts ("Expires after"). Your admin may require an end date.
5. Tick what it may do: Read, Write, or both.
6. Optional: "Let this agent manage tasks", "Let this agent write docs", "Let this agent read chat".

The token is shown once. Copy it then, and paste it where your tool asks for it. The person who sets up the tool can find the exact command in the [MCP server reference](./mcp-server#creating-a-token).

To hand tasks to your own Claude Code so that it writes the code and opens a pull request, follow [Let Claude Code build your tasks](./claude-code-developer).

## The question AlianHub asks

You see "Allow (the app) to act for you?". Under **It will be able to read:** are the things it can always see once you connect it:

- Read tasks you can see
- Read projects you can see
- Read pages and documents you can see
- Read time logs you can see

Under **Choose what it may do — tick only what you want:** are the actions it takes only if you tick them. They start unticked:

| Name | On the screen |
|---|---|
| **Create and change tasks** | Create and change tasks for you |
| **Log time** | Log time for you |
| **Manage tasks** | Edit, assign, move, archive and close your tasks, several at a time |
| **Write docs** | Create docs and change the ones you can edit |
| **Read chat** | Read messages in channels you are in |

Then choose the one workspace it may use, and **Approve** or **Deny**.

- You grant these yourself, up to what your own role allows — a tool your role does not allow is still refused when the app tries it. No owner or admin approval is needed.
- **Manage tasks**, **Write docs** and **Read chat** appear only while your server has those tools switched on. **Read chat** never reads direct messages; an app connected before it existed reads no chat until you connect it again and tick it.
- You can change what a connection may do at any time, or revoke it, under **Accounts**, **Connected apps** (see Disconnect below).

If an owner has turned on **Require approval for AI apps** (Settings, Instance, Security), it works the older way instead: an owner or admin must first approve each app under **Agent clients** and set the most it may get; the screen then offers only what that approval allows, shows **Ask an admin** for a workspace where the app is not approved, and grants **Manage tasks**, **Write docs** and **Read chat** only when the admin approved them by name.

## Check that it works

The line at the top of the Connect your AI page changes by itself when your AI app makes its first call. It then says "Connected" and when the app was last seen. Only your own connection counts: someone else's never makes your page say Connected.

Under "Say this to it first" the page offers a first sentence: "Set up my project". It asks a few questions and shows you a plan. Nothing is made until you say yes.

Under "What your AI can do here" the page lists what your server allows. Under "Switched off on this install" it lists what your admin has not switched on.

## For owners and admins

By default anyone may connect their own AI app with no approval from you. Open **Settings**, then **Agent clients** to see every app connected in this workspace and **Revoke** any of them (that ends everyone's connection to it here).

To require your approval before an app can connect, turn on **Require approval for AI apps** under **Settings**, **Instance**, **Security**. Then each app that asks to connect is listed under "Waiting for approval", "Approved" or "Denied or revoked", and:

- Choose **Approve** or **Deny**.
- Under "Allow at most:" choose the permissions the app may get.
- "Wider permissions, given only if you tick them:" holds Manage tasks, Write docs and Read chat. Approving without ticking them never includes them.
- Later you can use **Change permissions** or **Revoke**.

## Disconnect

- **You:** open **AI**, **Accounts**, then the tab **Connected apps**. **Edit permissions** lets you tick or untick what a connection may do, up to your own role; **Revoke** ends it entirely. Either takes effect on the app's next call.
- **An owner or admin:** open **Settings**, then **Agent clients**, and choose **Revoke**. Everyone's connection to that app in this workspace ends now.
- **A token:** revoke it in **AI**, **Accounts**, **My account**. It stops on its next call.

## Related

- [What your AI can do](./what-it-can-do)
- [What your AI can see](./what-it-sees)
- [Your first hour: connect your AI app](/getting-started/first-hour/connect-ai)
