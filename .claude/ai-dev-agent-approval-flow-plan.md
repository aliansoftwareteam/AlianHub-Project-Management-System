# AI Dev-Agent — Approval-gated, stoppable, dependency-aware pipeline

Design for 4 requirements on the AI Bot dev flow. Turns the current
fire-and-forget bot into a **human-gated, stoppable, pre-checked** pipeline.

## Requirements
1. **Approve before start** — bot must ask for approval before developing.
2. **Approve before PR** — after dev completes, gate PR creation; user creates the
   PR later (an Approve/Create-PR button OR a "create pr" chat message). Manual PR
   also fine.
3. **Stop a running process** — emergency cancel of a running/queued job.
4. **Pre-flight checks** — before developing, check task dependencies / links /
   other criteria; surface them in the approval prompt.

## Principles (per user)
- **Isolated:** only the `Modules/DevAgent` module + the Development tab + the runner
  script are touched. No other module/functionality affected.
- **Not hardcoded:** statuses + actions are named constants; the pre-flight criteria
  are a small extensible list; behaviour is easy to toggle later.
- **Easy UX:** clear buttons (Approve · Reject · Stop · Create PR) + readable status
  pills in the Development tab.

## State machine (DEV_MESSAGES.status — additive string values, NO schema change)
```
bot assign        -> awaiting_approval --Approve--> pending --runner claims--> working --> done | error
                                        --Reject---> cancelled
direct chat send  -> pending           (an explicit user action = already "approved")
working           --Stop--> cancelling --runner aborts--> cancelled
working -> done   --(PR gate)--> awaiting_pr --Approve/"create pr"--> pending(pr) -> pr done
```
`status` is a free string on DEV_MESSAGES, so new values need no migration and
cannot affect any other module. The runner's `/pending` only ever selects
`status: 'pending'` (+ stale `working`), so `awaiting_approval` / `cancelled` /
`awaiting_pr` are naturally ignored by it. The no-runner timeout only touches
`pending`, so it never fires on an approval-waiting job.

## New actions (all in DevAgent — isolated)
- `POST /api/v2/dev-agent/approve {messageId}` — `awaiting_approval` → `pending`
  (start); later, `awaiting_pr` → trigger the PR step.
- `POST /api/v2/dev-agent/cancel  {messageId}` — `awaiting_approval`/`pending` →
  `cancelled`; `working` → `cancelling` (runner then aborts + kills the Claude child).

## Per-point design
1. **Approve-start:** `bot.enqueueForTask` writes the develop job as
   `awaiting_approval` (not `pending`). Frontend shows Approve / Reject on it.
   Approve → `pending` → runner develops. (Direct chat send stays `pending`.)
2. **PR gate:** runner splits `developTurn` — develop + commit (+ push the branch),
   then reply `awaiting_pr` instead of `gh pr create`. A Create-PR action (or a
   "create pr" message) runs a PR-only job that pushes + opens the PR. Manual PR works too.
3. **Stop:** the cancel endpoint sets `cancelling`; the runner checks the flag on each
   heartbeat, kills the running Claude Code child process, cleans up, replies `cancelled`.
4. **Pre-flight (at assign):** read the task's links/dependencies (`blocked_by`) +
   statuses; if blocked by unfinished tasks, warn in the approval prompt
   ("⚠ blocked by AHE-X"). Criteria list is extensible (description present,
   acceptance criteria, estimate, assignee — TBD which).

## Build order
**Point 1 (approve-start)** → Point 4 (pre-flight, folded into the approval prompt) →
Point 3 (stop) → Point 2 (PR gate).

## Open question
Point 4 "other important criteria" — beyond dependencies/links, which checks?
(description present · acceptance criteria · estimate set · assignee?) — starting with
deps + links, kept extensible.

## Status
- [x] 1 · approve before start — bot job = `awaiting_approval`; `/approve` + `/cancel` endpoints; Approve/Reject buttons in the tab.
- [x] 4 · pre-flight checks — `bot.runPreflight` (best-effort, lazy require of Tasks' read-only getOpenBlockers): warns on open blockers + missing description via a "⚠️ Pre-flight" heads-up note before the approval job. Extensible (add checks in runPreflight).
- [x] 3 · stop running process — Stop button on pending/working jobs → `/cancel` (pending→cancelled, working→cancelling); the heartbeat doubles as a 5s cancel poll → runner kills the Claude child → replies `cancelled`. **Two follow-up fixes (2026-07-08, after the user found Stop didn't actually stop):** (a) the **local-folder** `runClaude` call was missing the `cancel` arg → the child was never registered → nothing to kill (the user's exact case); now passes `cancel`. (b) on Windows `child.kill()` only kills the `cmd.exe` wrapper, orphaning the real `claude`/node process → added `killTree()` (`taskkill /pid <pid> /t /f` on win32, `SIGKILL` on POSIX) used by both the Stop path and the 30-min watchdog. (Runner script changed → existing runners MUST re-download.)
- [x] 2 · approve before PR — runner splits `developTurn`: develop + commit + **push** the branch, then reply `awaiting_pr` (no auto `gh pr create`). A **Create PR** button → `/approve` (`awaiting_pr` → `pending_pr`) → the runner runs `openPr` only (no Claude) → `done` + PR URL. Branch is pushed either way, so a manual PR works too. `pending_pr` is a free status → `/pending` + `/claim` + no-runner timeout extended to it; no schema change.

## ✅ All four complete (local, uncommitted on `feat/ai-dev-agent-v14.10.0`)
Full state machine live:
```
bot assign → awaiting_approval → [Approve] → pending → working → develop+push
    → awaiting_pr → [Create PR] → pending_pr → working → openPr → done
direct send → pending → … (same from develop onward)
any pending/working → [Stop] → cancelling/cancelled
```
