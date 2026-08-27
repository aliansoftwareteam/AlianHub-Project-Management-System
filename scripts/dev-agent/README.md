# AlianHub AI dev-agent

Turns a task's **Development** chat into real code. You describe what to build in
the task's **Development** tab (or assign the **AI Bot**); the dev-agent running
on a connected computer develops it with **Claude Code**, opens a PR, and replies
in the chat — then iterates on your follow-ups.

Everything is configured **in the app** — Settings → **AI Developer** and the
task's **Development** tab. There are no token files or CLI flags to set by hand
in the normal flow.

```
Development chat  ──►  connected computer (dev-agent + Claude Code)  ──►  push + PR  ──►  reply in the chat
        ▲                                                                                       │
        └────────────────────────────── you review / test / ask for changes ◄──────────────────┘
```

## One-time setup (in the app)

### 1. Connect a computer
The agent runs on a real machine — where Claude Code, git and `gh` live — **not**
on the AlianHub server. In AlianHub go to **Settings → AI Developer → Connect
this computer** and click **Connect Computer**, then **open the file it
downloads**. The dev-agent installs and starts itself and keeps running in the
background, ready to develop the tasks you chat or assign. (Direct **Windows /
macOS / Linux** downloads are on the same card.)

Do this once per machine — the download self-configures (pairs to your account)
and remembers itself. That machine needs:

- **Node 18+**
- the **`claude` CLI**, logged in (run `claude` once → `/login`; uses your subscription, no API key)
- **`gh`** (GitHub CLI), authenticated (`gh auth login`) — used to open PRs

### 2. (Optional) Enable the AI Bot
**Settings → AI Developer → Enable AI Bot** turns on an assignable **"AI Bot"**
user. It shows up only in **your** assignee picker — other members don't see it,
and it never appears in the Members list.

## Using it

### Set the repository (once per project)
Open a task → **Development** tab → at the top set the **repository** (a local
folder path *or* a git URL) and the **base branch**. It's **saved for the whole
project** — every task in that project, and the AI Bot, reuses it automatically.
The branch is what the AI branches from and opens its PR against (git repos only).

### Chat to build
Type an instruction in the Development tab (e.g. "Implement this task"). The
connected computer develops it with Claude Code, opens a PR, and replies
**✅ Done. PR: …**. Review/test, then chat the next change — it iterates on the
same branch.

### Or assign the AI Bot (auto-develop)
Assign the **AI Bot** user to a task. It proposes a job — the task's title +
description become the instruction — shown with a **needs approval** badge and
**Approve & start** / **Reject** buttons. Approve it and the agent develops
exactly like a chat turn, using the repository set in that task's Development tab.

## How it works

1. You set the repo + send an instruction (or assign the AI Bot and approve it).
2. The connected computer's dev-agent resolves the repo (clones the git URL into
   its workspace, or uses the local folder) and creates/continues branch `ai/<task-key>`.
3. It runs Claude Code on the task + your instruction — Claude writes the code.
4. It commits, pushes, and opens/updates a PR.
5. It replies in the Development chat with the PR link.
6. You test; the next message iterates on the same branch.

## Shared task memory

The agent keeps a per-task log at **`.alianhub/tasks/<TaskKey>.md`** inside the
repo. Before each turn it reads that file for prior context; after each turn it
updates it (what was done, key decisions, what remains) and commits it with the
code. Because the memory lives in the repo, whoever continues the task later — on
a **different machine or Claude account** — gets the full history from a
`git pull`/clone. No external store, no per-machine state. (For a local folder
with no remote, it's written locally and becomes shared once you add a git remote.)

## Safety

- Code runs **on the connected computer**, never on the AlianHub server.
- Every change lands as a **PR you review and merge** — the agent never merges.
- **AI Bot jobs need your approval** (Approve & start) before any code runs.
- The repository is chosen **per project in the UI** — the agent never invents a target.
- If Claude Code produces no changes, the runner says so and opens no PR.

## Troubleshooting

- **"Set the repository above to start"** — set the repo + base branch at the top of the Development tab first.
- **"First time? Connect your computer…"** — do the one-time **Connect Computer** step in Settings → AI Developer.
- **Nothing happens after you send / approve** — check the connected computer is still running the agent, that `claude` is logged in there (`/login`), and that `gh` is authenticated.
- **`claude … ENOENT` / not found** on the connected machine — the `claude` CLI isn't on that machine's PATH; install it / make sure `claude` runs in a terminal there.
