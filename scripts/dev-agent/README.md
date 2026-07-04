# AlianHub AI dev-agent (runner)

A lean, self-hosted runner that turns an **AlianHub task into a pull request** by
driving **Claude Code**. The "agent" is just this script + Claude Code — Claude
Code is the actual developer; the script fetches the task, runs it in the repo,
and reports the PR back.

It runs on **your machine** (where Claude Code, git and gh live) and talks to
AlianHub over its existing REST API with a Personal API Token — nothing special
is installed on the server.

```
fetch task → resolve repo → branch → `claude -p` in the repo → commit → push → open PR → comment the PR link on the task
```

## Prerequisites (on this machine)

- **Node 18+**
- **Claude Code CLI** (`claude`) — installed and logged in
- **git**
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)
- The project's repo — **either** an existing local clone **or** a git URL the
  agent can clone (see below). You don't have to clone it yourself.

## Setup

1. Copy the config template and fill it in (or use env vars instead):
   ```bash
   cp config.example.json config.json
   ```
   > `config.json` holds your API token — it is git-ignored. Never commit it.

   | key | what |
   |-----|------|
   | `url` | your AlianHub URL, e.g. `http://localhost:4000` |
   | `pat` | a Personal API Token (`ahp_…`) — create one in AlianHub → Settings → **API Tokens** (needs **write** scope) |
   | `companyId` | your company id (the 24-hex in the app URL) |
   | `userId` | *(optional)* user id to attribute the PR comment to (later: the AI bot user) |
   | `workspace` | *(optional)* folder where URL clones are stored (default `./workspace`) |
   | `repos` | *(optional)* per-project repo map — see **Repo location** |

   Or set `ALIANHUB_URL`, `ALIANHUB_PAT`, `ALIANHUB_COMPANY_ID`, `ALIANHUB_USER_ID`, `ALIANHUB_WORKSPACE` as environment variables.

## Repo location (dynamic)

You don't need the repo cloned in advance. The agent resolves it in this order:

1. **Existing local clone** — if a `localPath` is given (and it's a git repo), it's used as-is.
2. **Clone from URL** — otherwise a `gitUrl` is cloned into the `workspace`
   (and reused + pulled on later runs).

Configure it **once per project** in `config.json` `"repos"`, keyed by the
project code (e.g. `UMM`) or the project id:

```json
"repos": {
  "UMM":  { "gitUrl": "https://github.com/your-org/user-management.git", "base": "main" },
  "PORTAL": { "localPath": "E:/repos/portal", "base": "staging" }
}
```

Then you just run `--task <id>` and the agent picks the right repo. You can also
override per-run on the CLI with `--repo` / `--git`.

## Run

```bash
# project already configured in "repos":
node dev-agent.js --task <taskId>

# or supply the repo directly for a one-off:
node dev-agent.js --task <taskId> --repo "E:/repos/user-management"      # existing clone
node dev-agent.js --task <taskId> --git  https://github.com/org/repo.git  # clone-from URL
```

- `--task` — the task's id (the 24-hex from the task URL/API)
- `--repo` — path to an existing local clone (overrides config)
- `--git` — a git URL to clone (overrides config)
- `--base` — base branch to branch off and target the PR (default `main`)

## What it does

1. Fetches the task from AlianHub (title + description = the spec).
2. Resolves the repo — existing local clone, or clone-from-URL into the workspace.
3. Creates a fresh branch `ai/<task-key>` off the base.
4. Runs `claude -p "<task spec>"` in the repo — Claude Code writes the code and runs tests.
5. Commits the changes and pushes the branch.
6. Opens a PR with `gh`.
7. Posts the PR link back as a comment on the task.

## Safety

- Code execution happens **on your machine**, never on the AlianHub server.
- Every change lands as a **PR you review and merge** — the agent never merges.
- If Claude Code produces no changes, the runner stops without opening a PR.

## Roadmap

- **AI Bot user** — assign a task to a bot user in AlianHub instead of passing `--task` on the CLI.
- **Poll mode** — the runner watches for tasks assigned to the bot (and approved) and develops them automatically.
- **Repo binding in AlianHub** — store each project's repo (local path or URL) in the app UI, so config isn't hand-edited.
