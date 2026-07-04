# AlianHub AI dev-agent (runner)

A lean, self-hosted runner that turns an **AlianHub task into a pull request** by
driving **Claude Code**. The "agent" is just this script + Claude Code — Claude
Code is the actual developer; the script fetches the task, runs it in your repo,
and reports the PR back.

It runs on **your machine** (where Claude Code, git and gh live) and talks to
AlianHub over its existing REST API with a Personal API Token — nothing special
is installed on the server.

```
fetch task → new branch → `claude -p` in the repo → commit → push → open PR → comment the PR link on the task
```

## Prerequisites (on this machine)

- **Node 18+**
- **Claude Code CLI** (`claude`) — installed and logged in
- **git**
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)
- A local **clone** of the project's repo

## Setup

1. Copy the config template and fill it in (or use env vars instead):
   ```bash
   cp config.example.json config.json
   ```
   | key | what |
   |-----|------|
   | `url` | your AlianHub URL, e.g. `http://localhost:4000` |
   | `pat` | a Personal API Token (`ahp_…`) — create one in AlianHub → Settings → API Tokens (needs **write** scope) |
   | `companyId` | your company id (the 24-hex in the app URL) |
   | `userId` | *(optional)* user id to attribute the PR comment to (later: the AI bot user) |

   Or set `ALIANHUB_URL`, `ALIANHUB_PAT`, `ALIANHUB_COMPANY_ID`, `ALIANHUB_USER_ID` as environment variables.

## Run

```bash
node dev-agent.js --task <taskId> --repo <path-to-local-clone> [--base <branch>]
```

- `--task` — the task's id (the 24-hex from the task URL/API)
- `--repo` — path to your local clone of that project's repo
- `--base` — base branch to branch off and target the PR (default `main`)

Example:
```bash
node dev-agent.js --task 665f… --repo "E:/repos/user-management" --base main
```

## What it does

1. Fetches the task from AlianHub (title + description = the spec).
2. Creates a fresh branch `ai/<task-key>` off the base.
3. Runs `claude -p "<task spec>"` in the repo — Claude Code writes the code and runs tests.
4. Commits the changes and pushes the branch.
5. Opens a PR with `gh`.
6. Posts the PR link back as a comment on the task.

## Safety

- Code execution happens **on your machine**, never on the AlianHub server.
- Every change lands as a **PR you review and merge** — the agent never merges.
- If Claude Code produces no changes, the runner stops without opening a PR.

## Roadmap

- **AI Bot user** — assign a task to a bot user in AlianHub instead of passing `--task` on the CLI.
- **Poll mode** — the runner watches for tasks assigned to the bot (and approved) and develops them automatically.
- **Repo binding** — store each project's repo location in AlianHub so `--repo` isn't needed.
