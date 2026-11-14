# Let Claude Code build your tasks

You hand a task to your own Claude Code from a task comment. Claude Code works on your computer: it reads the task, writes the code, opens a pull request and tells you on the task when it is done. Your own Claude subscription pays for the work. AlianHub holds no AI key for it, and the workspace pays nothing.

This page walks you through it from the start. It takes about 20 minutes the first time.

## How it works

1. You write a comment on a task: `@` and your own AI, then what to do.
2. AlianHub puts the task in your AI's queue.
3. You ask Claude Code on your computer to check your queue.
4. Claude Code takes the task, gets the code, makes the change, runs the tests and opens a pull request.
5. It posts the pull request link on the task and sets it to In review.
6. A person reviews the pull request and merges it. Claude Code never merges and never marks a task Done.

Each person's Claude Code works only on the tasks that person handed to it. You cannot hand a task to someone else's AI.

## Part 1: Once per project (owner or admin)

### Switch on the project manager

Your own AI is offered in a task's comment box only in a project whose project manager is on.

1. Open the project, then the **Details** tab.
2. Find the card **Project manager**.
3. Switch on **Look at this project every working day**. The level stays at **Suggest**: it proposes, and a person approves every change.

### Link the code repository

So that Claude Code knows where the code is, and so that the pull request shows on the task:

1. On the same **Details** tab, find the card **GitHub repositories**.
2. Choose **Add repository** and pick the project's repository. If it asks to connect GitHub first, an owner or admin connects it once for the workspace.

If you do not link a repository, write its address in the task's description, for example `Repo: github.com/your-company/website`.

### Protect the main branch on GitHub

On GitHub, open the repository, then **Settings**, **Branches**, and add a rule for the main branch with **Require a pull request before merging** and **Require approvals**. Then nothing reaches the main branch without a person's review.

### Allow personal accounts

Open **AI**, **Accounts**, tab **Modes**. **Personal CLI account** must be allowed in this workspace. If it shows **NOT PERMITTED**, an owner or admin ticks it under "Modes this workspace permits" and saves.

## Part 2: Once per person (on your own computer)

### Install the tools

| Tool | Where to get it | Why |
|---|---|---|
| Git | [git-scm.com](https://git-scm.com) | To get and save code |
| GitHub CLI | [cli.github.com](https://cli.github.com) | To open pull requests |
| Claude Code | [claude.com/claude-code](https://claude.com/claude-code) | Does the work |

Then sign in to both, in a command window (on Windows: press the Windows key, type `cmd`, press Enter; on a Mac: open Terminal):

```bash
gh auth login
```

Choose GitHub.com, HTTPS and "Login with a web browser".

```bash
claude
```

Inside Claude Code, type `/login` and choose your **Claude account (subscription)**, not an API key. Type `/exit` to leave.

### Create your token in AlianHub

1. Open **AI**, **Accounts**, tab **My account**.
2. In the card **Personal access token**, choose **New token**.
3. Fill it in like this:

| Field | Choose | Why |
|---|---|---|
| Token name | `claude-code-` and your name | So everyone can tell whose it is |
| Mode | **Personal CLI account** | Your own subscription pays |
| Provider | **Claude Code** | The tool you use |
| Project scope | **Every project you can already open** | So you can hand it tasks in any of your projects |
| Expires after | **30 days** or **90 days** | Your Inbox reminds you 3 days before it ends, and you choose **Renew** |
| Let this agent manage tasks | **Ticked** | So it can set a task to In review after the pull request |
| Let this agent write docs | Not ticked | Not needed for code work |
| Let this agent read chat | Not ticked | Not needed. Your `@` in a task comment still reaches it |

4. Choose **Create token**. The token is shown **once**. Do not close the box yet.

Never paste a token in a chat, an email or a shared file. Each person makes their own.

### Connect Claude Code to AlianHub

1. In the box with your new token, choose **Copy setup command**.
2. Open a **command window**, not Claude Code: on Windows `cmd` or PowerShell, on a Mac Terminal.
3. Paste the command and press Enter. It says the AlianHub server was added.
4. Check it:

```bash
claude mcp list
```

You should see `alianhub` and **Connected**.

The command ends with `--scope user`, so Claude Code reaches AlianHub from every folder. If it says the server **already exists**, remove the old one and paste the command again:

```bash
claude mcp remove alianhub -s local
```

```bash
claude mcp remove alianhub -s user
```

### Teach Claude Code the developer job

1. Make a folder for the agent's work, for example `F:\agent-work` on Windows or `~/agent-work` on a Mac.
2. In the token box, choose **Copy developer instructions**. The same text is below.
3. Open the file `CLAUDE.md` in your Claude folder, or create it: on Windows `C:\Users\<your name>\.claude\CLAUDE.md`, on a Mac `~/.claude/CLAUDE.md`. In Notepad, choose "Save as type: All files" so it does not become `CLAUDE.md.txt`.
4. Paste the text at the end of the file and save. Change the folder in step 4 of the text if you chose another one.

```markdown
## AlianHub developer work
When asked to check my AlianHub queue:
1. Use the alianhub tools: queue.list, then queue.claim only a task that a person handed to me. Skip findings such as a task with no owner or no estimate.
2. Read it with task.get, including all comments. The newest comment that mentions me is the instruction.
3. Find the repository: from the task description, or the project's GitHub repository.
4. Clone it into F:/agent-work/<repository> (or pull if it is already there). Make a branch named after the task key.
5. Implement, run the tests, commit, push, and open a pull request with gh.
6. Comment the pull request link and a short summary on the task. Set the status to In review, never Done.
7. queue.release with finished: true.
If anything is unclear, comment a question on the task and release it unfinished.
```

### Try it once

1. Open a task that is **not** Complete, in a project whose project manager is on.
2. In the comment box, type `@`. Under **Agents** you see your own AI, for example "My claude-code".
3. Write: `@` your AI, then `add a comment saying hello, then release it`. Send it.
4. In a command window, start Claude Code:

```bash
claude
```

5. Type `Check my AlianHub queue` and press Enter. Allow the AlianHub tools when it asks.
6. A "hello" comment from your AI appears on the task. It works.

## Part 3: Every day

1. Write the task clearly: what to change, where, and how you will check it.
2. Comment: `@` your AI and `please build this task`, with anything extra it should know.
3. Start Claude Code and type `Check my AlianHub queue`.
4. Follow it on the task: its comments, the In review status, the pull request link.
5. Review the pull request. Ask for changes or merge it. Then set the task to Done yourself.

To let it check by itself while you work, keep a Claude Code window open and type:

```text
/loop 15m check my AlianHub queue
```

It checks every 15 minutes while that window stays open. Nothing runs while your computer is off: the task waits in your queue.

## What it never does

- It never merges a pull request and never marks a task Done.
- It sees only what you can see, and every change it makes is shown as your AI, for you.
- It cannot take tasks someone else handed to their own AI.
- A change that needs approval waits in the Inbox, as for any agent. See [Approve in the Inbox](./approve-in-the-inbox).

## When something does not work

| What you see | What to do |
|---|---|
| "No User Found" after `@` | The task is Complete, the project manager is off, or your token cannot reach this project. Check Part 1 and your token's project scope |
| Your AI is not in the `@` list but other people are | You have not connected yet: Part 2 |
| Claude Code says the queue is empty | The comment named someone else, or the task was handed over already |
| "Insufficient scope", or it says the connection can only read | Claude Code used the **Alian Hub** connector from claude.ai, which may be read-only. Use Claude Code in a command window, or say "use only the alianhub MCP server" |
| "already exists in local config" | Remove the old server (see "Connect Claude Code to AlianHub") and paste the command again |
| It cannot push or open a pull request | Run `gh auth login` again and check that your GitHub account may push to the repository |
| It stops half way | You may have reached your Claude plan's usage limit. Wait until it resets |
| The token expired | AI, Accounts: choose **Renew** next to it, then run the new command |

## When someone leaves

Revoke their token under **AI**, **Accounts**. Their connection stops on its next call. Their own Claude subscription stays theirs.

## Related

- [Connect your AI app](./connect)
- [Limits, and pausing agents](./limits-and-pause)
- [Team packs and role agents](./team-packs)
- [MCP server reference](./mcp-server)
