# AlianHub AI dev-agent (runner)

The bridge between a task's **Development** chat in AlianHub and **Claude Code**
on your machine. Open a task → **Development** tab → chat instructions (like
talking to Claude). This runner picks them up, develops with Claude Code, opens
a PR, and replies in the same chat — then iterates on your follow-up messages.

The "agent" is just this script + Claude Code (the actual developer). It talks
to AlianHub over its REST API with a Personal API Token — nothing special runs
on the server. It runs on **your machine**, where Claude Code, git and gh live.

```
Development chat  ──►  runner (poll)  ──►  Claude Code develops  ──►  push + PR  ──►  reply in the chat
        ▲                                                                                    │
        └──────────────────────────── you review / test / ask for changes ◄─────────────────┘
```

## Prerequisites (on this machine)

- **Node 18+**
- **Claude Code CLI** (`claude`) — installed and logged in
- **git**
- **GitHub CLI** (`gh`) — authenticated (`gh auth login`)

You do NOT need the repo cloned in advance — the agent clones a git URL on
demand (or uses a local clone if you give it a path).

## Setup

1. Copy the config template and fill it in (or use env vars):
   ```bash
   cp config.example.json config.json
   ```
   > `config.json` holds your API token — it is git-ignored. Never commit it.

   | key | what |
   |-----|------|
   | `url` | your AlianHub URL, e.g. `http://localhost:4000` |
   | `pat` | a Personal API Token (`ahp_…`) — create one in AlianHub → Settings → **API Tokens** (needs **read + write** scope) |
   | `companyId` | your company id (the 24-hex in the app URL) |
   | `userId` | *(optional)* user id to attribute the agent's replies to |
   | `claudeBin` | *(optional)* full path to the `claude` CLI if it isn't on PATH, e.g. `C:/Users/you/AppData/Roaming/npm/claude.cmd` |
   | `workspace` | *(optional)* folder where git-URL clones are stored (default `./workspace`) |
   | `repos` | *(optional)* fallback repo per project — `{ "<projectId|projectCode>": { gitUrl?, localPath?, base? } }` |

   Env equivalents: `ALIANHUB_URL`, `ALIANHUB_PAT`, `ALIANHUB_COMPANY_ID`, `ALIANHUB_USER_ID`, `ALIANHUB_WORKSPACE`.

## Run

**Poll mode (recommended)** — start it once and leave it running; it watches
every task's Development chat:
```bash
node dev-agent.js --poll [--interval 5000]
```

**One-shot (testing)** — develop a single task once from the CLI:
```bash
node dev-agent.js --task <taskId> --git https://github.com/org/repo.git --base main
node dev-agent.js --task <taskId> --repo "E:/repos/my-project"
```

## How it works

1. **You** open a task → **Development** tab → set the repository (git URL or a
   local path + base branch) and type an instruction (e.g. "Implement this task").
2. The runner (poll) picks up the instruction, resolves the repo (clones the URL
   into the workspace, or uses your local clone), and creates/continues the
   branch `ai/<task-key>`.
3. It runs `claude -p "<task + your instruction>"` — Claude Code writes the code.
4. It commits, pushes, and opens a PR (follow-up messages update the same PR).
5. It replies in the Development chat: **✅ Done. PR: …**
6. You test, then type the next change — the agent iterates on the same branch.

## Shared task memory

The agent keeps a per-task log at **`.alianhub/tasks/<TaskKey>.md`** inside the
repo. Before each turn it reads that file for prior context; after each turn it
updates it (what was done, key decisions, what remains) and commits it with the
code. Because the memory lives in the repo, any developer who continues the task
later — on a **different machine or Claude account** — gets the full history from
a `git pull`/clone. No external store, no per-machine state. (For a local folder
with no remote, the file is written locally and becomes shared once you use a git
URL / add a remote.)

## Safety

- Code execution happens **on your machine**, never on the AlianHub server.
- Every change lands as a **PR you review and merge** — the agent never merges.
- The repository is chosen **per conversation** (temporary) — nothing is persisted.
- If Claude Code produces no changes, the runner says so and opens no PR.

## Troubleshooting

- **`Not logged in · Please run /login`** — the `claude` CLI the runner uses isn't
  authenticated (this is separate from the Claude desktop app). Run `claude` in a
  terminal once and `/login` — it uses your subscription, no API key needed. The
  runner's startup line shows which `claude` it found.
- **`claude: spawnSync claude ENOENT`** — the CLI isn't visible on the runner's
  PATH. The runner also looks next to `node.exe` and in `%APPDATA%\npm`; if it
  still can't find it, set the full path in config.json → `"claudeBin"`.
- **workspace not trusted** — handled by `--dangerously-skip-permissions`; if it
  ever still blocks, open that folder in Claude Code once and accept the trust dialog.

## Roadmap

- **Live updates** — the chat currently polls every few seconds; wire it to the
  existing Socket.io pipeline for instant replies.
- **AI Bot user** — assign a task to a bot user to auto-start a Development chat.
