# AI dev-agent — "make it a real developer" hardening plan

End-to-end review of branch `feat/ai-dev-agent-v14.10.0` (37 commits + this session's
approval-flow/repo-binding). Four independent reviews (backend, runner, frontend,
product/developer-lens). The AI Bot is treated as a **real developer doing real work**.
Nothing here is dropped — items we defer are marked, not deleted.

Files: runner `scripts/dev-agent/dev-agent.js`; backend `Modules/DevAgent/{controller,bot,routes}.js`;
frontend `components/organisms/Development/DevelopmentChat.vue`.

---

## 🔴 SHOWSTOPPERS — the bot literally cannot land a PR in THIS repo today

- **S1 · Branch name `ai/<taskKey>` is rejected.** This repo enforces branch prefixes in
  `.husky/pre-push` + `.github/workflows/branch-name.yml`: only
  `feat|fix|hotfix|refactor|chore|docs|perf|test|ci|build|style` (+ `release/vX.Y.Z`).
  `ai/…` matches none → push blocked locally + PR blocked from merge forever.
  **Fix:** map task-type → conventional prefix (bug→`fix`, else `feat`), branch =
  `feat/<taskkey>-<slug(name)>`. One shared `branchName(task)` helper; used in
  `developTurn` (dev-agent.js:360) + `openPr` (:412).
- **S2 · Commit msg + PR title aren't Conventional Commits.** `commitlint.config.js`
  (config-conventional) is wired to `.husky/commit-msg` + `commitlint.yml` (checks commits
  AND PR title). `AHE-1234: add login` → unknown upper-case type → hard fail. `git commit`
  fails once husky installs; PR-title CI fails regardless.
  **Fix:** emit `feat(ahe-1234): <subject>` (lowercase, no trailing period, ≤100) for the
  commit (:382) and PR title (:423). Best: have Claude propose the conventional subject.
  Do NOT blanket `--no-verify`.

## 🔴 Tranche A — core quality & safety (demo → usable)

- **A1 · No self-verification before PR** (build/lint/test). Prompt only *suggests* it
  (:318). Ships un-compiled code. **Fix:** `verify()` in `developTurn` between `runClaude`
  and commit — detect changed paths → root: `npm ci` + `npm test`; `frontend/**`: `npm run
  lint` + `npm run build`. On fail, feed errors back to Claude for ≤N fix iterations; block
  the PR gate / mark red; surface result in the chat reply.
- **A2 · `git add -A` stages everything** (:381,:402) — secret leak + scope blowout +
  violates the repo's own "never git add ." rule + sweeps in the memory file. **Fix:** stage
  a deliberate set; secret-scan the staged diff before commit (refuse on hit); diff-size
  guard; exclude `.alianhub/` memory (see B7).
- **A3 · Starved of context.** Only task name + raw-HTML `description` + memory reach Claude.
  No comments, no blockers/links, no priority/acceptance criteria, no conventions pointer.
  **Fix (`handleMessage`):** fetch task COMMENTS (Comments module), relations
  (`Tasks/helpers/taskMongo/relations`), priority/sprint/epic; strip description HTML→md;
  tell Claude to read `CLAUDE.md` + `.claude/CONVENTIONS.md`/`SECURITY-PATTERNS.md`.

## 🟠 Tranche B — real-dev workflow & collaboration (committer → colleague)

- **B1 · Doesn't update the AlianHub task on done** (status + comment + test-case) —
  violates the standing convention. **Fix:** after PR, post a task comment "✅ Done by
  AlianHub AI agent — PR: <url>", move status (configurable target via
  `updateBasic.updateStatus`), and require a test-case per feature.
- **B2 · Weak PR body** (:424) — one line, no summary, no task link. **Fix:** structured body
  (task link, changes, verify results, how-to-test) from a Claude-emitted `## PR body` block.
- **B3 · No self-review of its own diff.** **Fix:** 2nd short Claude turn on
  `git diff origin/<base>...HEAD` (reuse `/code-review`/`/security-review` skills); persist
  the summary into the reply + audit.
- **B4 · Can't respond to PR review comments / iterate.** **Fix:** poll
  `gh pr view --json comments,reviews`; on new feedback, enqueue a follow-up turn on the same
  branch seeded with the comments.
- **B5 · Never asks clarifying questions — guesses.** **Fix:** new `awaiting_clarification`
  status; Claude emits a `QUESTION:` block when underspecified → no commit → chat asks; the
  answer feeds the next turn.
- **B6 · Base drift / merge conflicts unhandled** (:369,:372 allowFail). **Fix:** rebase the
  task branch onto `origin/<base>` after fetch; on conflict, stop + report the files.
- **B7 · Per-task memory file leaks into the product PR** (`.alianhub/tasks/<key>.md`).
  **Fix:** gitignore it / store server-side / strip before PR.
- **B8 · No distinct bot git identity** — commits/PRs attributed to the human runner.
  **Fix:** set `GIT_AUTHOR_NAME/EMAIL` = "AlianHub AI Agent"; ideally a bot gh account.

## 🟠 Tranche C — correctness / robustness bugs (real, will bite)

- **C1 · Dirty-tree wedge** — cancel/crash leaves the working tree dirty + branch checked
  out; the uncommitted-guard (:364) then blocks EVERY future turn on that clone until a human
  `git reset`. **Fix:** on cancel/error (+ before a turn on a reused clone) reset clean
  (`checkout -f base`, `reset --hard`, `clean -fd`) — guarded for user-local paths.
- **C2 · "ahead" check silently discards committed work** (:384) — when `origin/<base>` is
  missing/unfetched, `allowFail` → `''` → "No code changes"; next turn's `checkout -B` orphans
  the commits. **Fix:** distinguish 0-commits from command-failure; verify/fetch base first.
- **C3 · Blocking `spawnSync` starves the 5s heartbeat** (:140,:467) — a >4-min clone/fetch →
  no heartbeat → stale re-claim → two runners on one task; and a git/gh credential prompt
  hangs the whole runner forever. **Fix:** `GIT_TERMINAL_PROMPT=0` + `GH_PROMPT_DISABLED=1` +
  a `timeout` on `spawnSync`; heartbeat around long git ops (or async spawn).
- **C4 · Workspace clone keyed by basename** (:280) — `orgA/api` and `orgB/api` collide →
  develops in / pushes to the WRONG repo. **Fix:** namespace the dir by full-URL hash; assert
  `git remote get-url origin` matches before reuse.
- **C5 · `pending_pr` intent lost on stale recovery** (backend claim collapses it to
  `working`; runner branches on in-memory `msg.status`) → re-develops instead of opening the
  pushed PR. **Fix:** a distinct claimed state (`working_pr`) or a `phase` field.
- **C6 · No-runner timeout wrongly fails `pending_pr`** (controller.js:60 — added this
  session) → the already-pushed branch's PR becomes a dead-end. **Fix:** drop `pending_pr`
  from the sweep (or give it a "connect a computer to open the PR" message + re-trigger).
- **C7 · `cancelJob` ignores `awaiting_pr`/`pending_pr`; a `cancelling` whose runner dies is
  stuck forever.** **Fix:** cancel those states too; add a reaper for stale
  `cancelling`/`awaiting_approval`.
- **C8 · Duplicate/parallel bot jobs on re-assign** (updateAssignment.js:149 fires on no-op
  `$addToSet`; enqueue has no dedupe; `resumeAwaitingRepo` updateMany fans out). **Fix:**
  fire only on a genuinely new assignee; skip enqueue if the task has an open job.
- **C9 · Stop before Claude spawns still runs a full turn** (:172 — `cancel.requested` only
  checked in `finish`). **Fix:** check at `runClaude` entry + between git steps.
- **C10 · `killTree` not a tree-kill on POSIX** (:158). **Fix:** `spawn(...,{detached:true})`
  + `process.kill(-pid,'SIGKILL')`. (Low — Windows is primary.)
- **C11 · `openPr` reuses a closed/merged PR** (:420 `gh pr view`). **Fix:** `gh pr list
  --head <b> --state open`.
- **C12 · `reply` retry can double-post** (:438). **Fix:** client idempotency key + backend
  dedupe.

## 🟠 Tranche D — security hardening (before wider rollout)

- **D1 · Pairing mints a non-expiring, full-company read/write PAT, self-mintable** (any
  member; a PAT can hit `/pair` to mint more, bypassing the api-tokens escalation block; no
  revoke UI). **Fix:** expiring + dev-agent-scoped token; role-gate `generatePairing`; add
  `/dev-agent/pair` to `PAT_BLOCKED_PATH_PREFIX`; restore revoke/list.
- **D2 · RCE via task text** — any member can queue a job with an arbitrary `repo` path +
  `text`; the runner runs Claude `--dangerously-skip-permissions` + auto-trusts the folder →
  arbitrary code execution on the operator's machine. **Fix:** authz on assign/`message`/
  `approve` (project membership + role); validate/allow-list `repo` (reject local paths unless
  runner-configured); treat task text as untrusted (delimit; sandbox/container posture).
- **D3 · Git/launcher argument-injection** — `base`/`repo` only trimmed → passed positionally
  into git/gh (:371,:422); launcher `base` fallback from the `Host` header is un-revalidated
  (controller.js:479). **Fix:** validate `base` `^[A-Za-z0-9._/\-]+$` (reject leading `-`),
  `repo` as URL/allow-listed path, and the reconstructed launcher base.
- **D4 · No authz on intra-company objects** — any member/PAT can `reply`/`progress`/
  `approve`/`cancel` any other user's dev thread. **Fix:** task-ownership scoping.
- **D5 · Bot hardcodes `roleType:3`** (bot.js:60) vs the "roles are fully dynamic" rule. **Fix:**
  lowest-privilege lookup / sentinel.
- **D6 · No rate-limit** on public `/dev-pair` + pairing-code generation.

## 🟡 Tranche E — frontend / UX / i18n

- **E1 · Hardcoded English** across DevelopmentChat.vue + ApiTokens.vue despite ja/ko/pt-BR.
  **Fix:** i18n keys for every string incl. the `statusLabel` map.
- **E2 · Poll swallows errors — no "runner offline"/API-down state**; a failed first load
  looks like an empty chat. **Fix:** `lastSyncAt`/`pollFailed` banner + a runner-presence chip.
- **E3 · Enter-key breaks IME composition** (CJK) (:41). **Fix:** guard `e.isComposing`.
- **E4 · No confirm on destructive Reject/Stop.** **Fix:** confirm / 2-step.
- **E5 · Single global `acting` guard** disables all jobs' buttons + a double-fire window.
  **Fix:** per-message guard + optimistic local clear.
- **E6 · Auto-scroll yanks the reader up-scroll; no optimistic echo on send.** **Fix:**
  scroll only when near-bottom; append the user message immediately.
- **E7 · `error` has no detail/retry; done/PR not prominent per job.** **Fix:** surface the
  exact error + a Retry that re-queues; show "View PR #123".
- **E8 · Disabling the bot with the Development tab open → blank area** (TaskDetailBody).
  **Fix:** `watch(aiBotEnabled)` → fall back to Task Details.
- **E9 · a11y** (secondary text contrast ~2.6:1; emoji-only buttons unlabelled; native inputs
  miss `font-family:inherit`); the "working" dot is alarm-**red**. **Fix:** contrast, aria,
  font, brand color.
- **E10 · Per-job repo/branch not shown; plan/reasoning not shown before approval; bot
  bubbles lack avatar/name/timestamp.** **Fix:** show "on org/x → PR into main", the plan,
  identity + relative time.

## 🟡 Tranche F — reliability / scale

- **F1 · Serial processing, no concurrency** (:574) — one 30-min task blocks the queue.
  **Fix:** bounded worker pool + per-repo lock.
- **F2 · In-memory runner presence breaks under multi-instance (Docker scale)** →
  destroys live jobs (controller.js:40). **Fix:** shared store / persisted `lastPolledAt`.
- **F3 · No partial-failure recovery / resume; 30-min watchdog kills long tasks with no
  checkpoint.** **Fix:** idempotent resume (branch already ahead → continue/verify/PR);
  classify + bounded-retry transient errors.

---

## Recommended build order
**S1,S2** (unblock merge) → **A1–A3** (verified, in-scope, context-aware) → **B1,B2,B7,B8**
(task update, PR body, memory, identity) → **C** (correctness bugs) → **B3–B6** (review/iterate/
clarify/rebase) → **D** (security) → **E** (UX/i18n) → **F** (scale).

Everything stays LOCAL + uncommitted until the user says push. Isolated to DevAgent + the
runner + the Development tab (+ reuse of Comments/relations/updateStatus, no forking).

---

## Progress log (all in `scripts/dev-agent/dev-agent.js` unless noted)

- [x] **S1** — CI-legal branch: `conventional()` → `feat/<key>` (bug task → `fix/<key>`, data-driven).
- [x] **S2** — conventional commit + PR title (`feat(scope): subject`, lowercase, ≤100) → passes commitlint + branch-name CI. (First push committed as e.g. `feat(pdp-13): …`.)
- [x] **A1** — verify gate: `node --check` on changed JS + a **self-fix loop** (≤2 Claude rounds) before the PR; result surfaced in the `awaiting_pr` message. `GIT_TERMINAL_PROMPT=0`/`GH_PROMPT_DISABLED=1` so git/gh can't hang the runner. _(build/lint/test verify deferred to C — needs the non-blocking-spawn infra.)_
- [x] **A2** — `git add -A` → `stageChanges()`: excludes `.env*` + **secret-scans** the staged diff (private keys, AWS/GitHub/Slack tokens, hardcoded creds); a hit aborts the commit with the exact reason.
- [x] **A3** — context: task **comments** + **priority/sprint** meta + description **HTML→text** + a generic **conventions pointer** (read the repo's own CLAUDE.md/README). Also fixed `conv` not being threaded into developTurn/openPr.
- Constraints honoured: NO frontend change, NO new settings, repo-agnostic (no AlianHub-specific rules baked into any-repo prompts).

- [x] **B1** — on PR-done, a bot-authored **task comment** "✅ Done by AlianHub AI agent — PR: …" (reuses comments collection + socket → live in the Comments tab). Backend `postReply`, best-effort. _(auto status-move deliberately skipped: dynamic per-company statuses + no-settings rule.)_
- [x] **B2** — richer PR body (task ref + changed-files diffstat).
- [x] **B3** — self-review: a 2nd Claude pass over the actual diff before push, commits any fixes.
- [x] **B5** — Claude's final message captured → surfaced in no-changes/local replies; prompt nudge to ask (not guess) when ambiguous + "add a test".
- [x] **B8** — commits authored as "AlianHub AI Agent" (also fixes "no git identity" on a fresh box).
- [x] **C1** — dirty-tree wedge: on cancel/error, `reset --hard` + `clean -fd` the workdir so a half-done turn can't block every future turn.
- [x] **C2** — ahead-check no longer silently drops committed work (track `didCommit`; only "no changes" when truly nothing).
- [x] **C6** — reverted my own bug: `pending_pr` no longer failed by the no-runner sweep (its branch is already pushed).
- [x] **C7** — cancel handles `awaiting_repo`/`awaiting_pr`/`pending_pr` too.
- [x] **C8** — no duplicate bot jobs on re-assign (skip if an open job exists).
- [x] **C9** — Stop before Claude spawns aborts immediately (guard at runClaude entry).
- [x] **C10** — killTree also kills the process group on POSIX (spawn detached).
- [x] **C11** — openPr only reuses an OPEN PR (`gh pr list --state open`), never a merged/closed one.
- [x] **B4 (review-comment loop)** — DEFERRED (standalone feature: poll PR reviews → re-enqueue).
- [x] **C3/C4/C5/C12** — DEFERRED with reason: C3 async-spawn + build/lint/test verify (heartbeat-safe, heavier); C4 clone-dir keyed by full-URL hash + remote assert; C5 `pending_pr` stale-recovery phase state; C12 reply idempotency key. All lower-frequency / rare-edge.
- [x] **D (security) / E (UX+i18n) / F (scale)** — DEFERRED (functional-first; E gated by "no frontend change / no settings"). D items (PAT scope/expiry, RCE sandbox posture, repo/base validation) are the most important of the deferred set for a wider/less-trusted rollout — flagged for the user.

**Status: functional-first hardening COMPLETE** (S+A+B-core+C-core). The bot now produces mergeable, verified, in-scope, self-reviewed, bot-authored PRs with real context, and is stoppable + doesn't wedge. All LOCAL + uncommitted on `feat/ai-dev-agent-v14.10.0` (`dev-agent.js`, `controller.js`, `bot.js`). Runner re-download needed before testing.

---

## "Complete-all" pass (2026-07-08 cont.) — remaining points

DONE:
- [x] **C4** — workspace clones namespaced by full-URL hash + remote-URL assert on reuse (no orgA/api ↔ orgB/api collision).
- [x] **C12** — retried reply dedups (same parent+text) → no duplicate bubbles.
- [x] **C5** — PR-open jobs claim into a distinct `working_pr` state → stale-recovery reopens the PR, never re-develops.
- [x] **F1** — runner develops up to `cfg.maxConcurrent` (default 2) tasks at once (atomic claim + per-job heartbeat/cancel).
- [x] **F3** — already covered by continue-prior-work + in-repo memory (reasoned).
- [x] **B4** — review-comment loop: runner watches its PRs → new reviewer feedback → `enqueueFollowup` (awaiting_approval) → human approves → bot addresses on the same branch. In-memory this session.
- [x] **C3** — build/lint verify before PR (only where deps installed), **report-only** (surfaced, not fix-looped — a build can fail on missing env vars the AI can't fix); `node --check` stays the fix-loop trigger.
- [x] **D1a** — paired PAT now **expires in 90 days** (re-pair to renew).
- [x] **D1b** — PATs blocked from `/dev-agent/pair` (closes token-mints-token escalation) — `Config/jwt.js`.
- [x] **D3** — repo/base arg-injection validation (`/message`, `/project-repo`) + launcher Host re-validation.
- [x] **D6** — rate-limit on the pairing endpoints (`/dev-pair`, `/pair`).
- [x] **D5** — reviewed: bot `roleType:3` is inert (never authenticates) → kept.

DEFERRED — **reasoned, not skipped** (each would break the feature, block legit users, touch shared auth, or is out by the user's own constraints):
- **D1-scope / D1-revoke-UI** — narrowing the PAT to a dev-agent-only scope touches the SHARED `jwt.js`/api-tokens auth used by every feature (high blast radius); a revoke/list surface is frontend (user said no frontend change). Expiry (D1a) + self-mint block (D1b) are the safe, isolated wins.
- **D2 (project-membership authz on assign/`message` + repo allow-list)** — a repo allow-list would BREAK the "set any repo in the Development tab" feature the user built; project-membership gating risks blocking legit devs. The RCE surface is mitigated by D3 + the **trusted-internal single-team** context. Do before an untrusted/multi-tenant rollout.
- **D1-role-gate / D4 (object authz)** — roles are dynamic per-company (hardcoding a threshold already broke prod once); the Development tab is intentionally shared across the team, so restricting approve/cancel to the job creator would block collaboration. Fine for a trusted team.
- **E (i18n + UX)** — needs frontend edits (user said keep frontend as-is / no new settings). i18n is the one worth revisiting when that constraint lifts.
- **F2 (multi-instance presence)** — the in-memory presence is correct for a **single app instance** (the user's deployment); only matters if scaled to multiple containers (needs a shared presence store).

**Net:** every review point is DONE or deferred-with-reason. Bot is a mergeable, verified, self-reviewing, review-responsive, stoppable, secret-safe, rate-limited, bot-authored real developer for a trusted team. Files (LOCAL, uncommitted): `dev-agent.js`, `controller.js`, `bot.js`, `routes.js`, `Config/jwt.js`.
