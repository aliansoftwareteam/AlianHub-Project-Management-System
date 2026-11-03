# Connect your AI app

Connect the AI app you already use, once, and it can work in AlianHub for you. This page shows how for Claude, ChatGPT and other tools, what AlianHub asks you before it lets an app in, and how to disconnect.

## Before you start: an account

You need an AlianHub account before your AI can connect. AlianHub has no page where a person makes their own account. You get one in one of two ways:

- An owner or admin of your workspace invites you. You open the link in the invitation and choose a password.
- You install AlianHub yourself. The install wizard makes the first workspace and your account as its owner.

If you have no account, ask your workspace admin to invite you. If your AI app opens AlianHub before you have an account, you only see the log-in page.

## Open the page

1. In AlianHub, open **AI** in the left menu.
2. Choose **Connect your AI**.

The first time you join a workspace, or finish the install wizard, this page comes last. It is called "One last step". You can choose **Skip for now** and connect later under **AI**, **Connect your AI**. The setup card on Home offers it again.

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

## The question AlianHub asks

You see "Allow (the app) to act for you?" and a list under "It asks to:". Then you choose the one workspace it may use. Choose **Approve** or **Deny**.

These come as one set:

- Read tasks you can see
- Create and change tasks for you
- Read projects you can see
- Read pages and documents you can see
- Read time logs you can see
- Log time for you

Then the screen says "It also asks for more. Tick only what you want it to do:". These start unticked:

| Name | On the screen |
|---|---|
| **Manage tasks** | Edit, assign, move, archive and close your tasks, several at a time |
| **Write docs** | Create docs and change the ones you can edit |
| **Read chat** | Read messages in channels you are in |

- A permission like these works only when the app asked for it, you ticked it, and an owner or admin approved it for that app. If an admin has not, the screen says "An owner or admin has not approved this for the workspace you chose."
- **Read chat** is offered only while your server has it switched on. It never reads direct messages. An app connected before it existed reads no chat until you connect it again and tick it.
- If your workspace has not approved the app yet, the screen shows **Ask an admin**, then "Waiting for your admin".
- The screen also says: "You can revoke this at any time under Accounts, Connected apps."

## Check that it works

The line at the top of the Connect your AI page changes by itself when your AI app makes its first call. It then says "Connected" and when the app was last seen. Only your own connection counts: someone else's never makes your page say Connected.

Under "Say this to it first" the page offers a first sentence: "Set up my project". It asks a few questions and shows you a plan. Nothing is made until you say yes.

Under "What your AI can do here" the page lists what your server allows. Under "Switched off on this install" it lists what your admin has not switched on.

## For owners and admins

Open **Settings**, then **Agent clients**. Each app that asked to connect is listed under "Waiting for approval", "Approved" or "Denied or revoked".

- Choose **Approve** or **Deny**.
- Under "Allow at most:" choose the permissions the app may get.
- "Wider permissions, given only if you tick them:" holds Manage tasks, Write docs and Read chat. Approving without ticking them never includes them.
- Later you can use **Change permissions** or **Revoke**. Revoke ends everyone's connection to that app in this workspace.

## Disconnect

- **You:** open **AI**, **Accounts**, then the tab **Connected apps**. Choose **Revoke** next to the app. **Withdraw** takes back one permission only and keeps the rest. It takes effect on the app's next call.
- **An owner or admin:** open **Settings**, then **Agent clients**, and choose **Revoke**. Everyone's connection to that app in this workspace ends now.
- **A token:** revoke it in **AI**, **Accounts**, **My account**. It stops on its next call.

## Related

- [What your AI can do](./what-it-can-do)
- [What your AI can see](./what-it-sees)
- [Your first hour: connect your AI app](/getting-started/first-hour/connect-ai)
