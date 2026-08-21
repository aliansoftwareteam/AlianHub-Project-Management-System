# Progress — 005 Project-scoped AI dev chat in a full-screen modal

## Checklist

- [ ] Backend: `listConversations` handler + route + index
- [ ] New `ProjectDevChat` organism (Sidebar-hosted full-screen shell, conversation rail)
- [ ] Header icon in `ProjectActionsBar.vue` (desktop `<li>` + mobile dropdown row)
- [ ] Wiring in `Projects.vue` + `ProjectBottomModals.vue`
- [ ] SVG asset + `en.js` strings
- [ ] ESLint on every touched file
- [ ] Adversarial review pass

## Log

### 2026-08-21 — design settled before any code

Surveyed the header, the overlay shells, the router, `DevelopmentChat.vue` and the DevAgent
backend, then ran three adversarial passes over the result (advocate / skeptic / cost).

Decisions, each grounded in a file rather than a preference:

- **Modal, not a project view.** Not on file count — the two are within a file or two of
  each other. `PROJECT_TAB_COMPONENTS` is seeded only at company import, so a registered
  view would be invisible to every existing company until someone inserts a DB record.
  The modal has no such failure mode. Three separate hand-maintained `activeTab !== '...'`
  blacklists in `Projects.vue` are the other half of the argument.
- **A conversation is a task thread.** `devMessages.taskId` is `required: true` on a
  `strict: true` schema. Task-less threads cost six backend files plus the runner and
  reintroduce the silent-field-drop failure mode this repo has already been burned by.
- **Host in `molecules/Sidebar/Sidebar.vue`.** The app's own pattern for a heavyweight
  surface — the task detail is a `Sidebar` at `width="1545px"`. Its default `zIndex` is 7,
  which renders *under* every overlay shipped recently (Pages, Epics, Burndown, the five
  importers all sit at 1000), it has no Escape handling, and its stylesheet is unscoped
  across 50 call sites. All three are handled in the wrapper, not in the shared shell.
- **No route coupling in v1.** Consistent with all fourteen existing project overlays.
  Rejected the task detail's history idiom as not copy-safe: its close path uses
  `router.push`, so Back re-opens what the user just closed.

Not shipped, and named as such: deep-linking, Socket.io streaming, and a completion
notification that does not depend on a client polling. All three are real, all three are
pre-existing, none is made worse by this change.

### 2026-08-21 — built

Backend (2 files + 1 index):
- `listConversations` in `Modules/DevAgent/controller.js`. Two steps rather than one aggregate,
  because only USER messages are guaranteed to carry `projectId` (the runner may reply without
  it): `distinct('taskId', {projectId, role:'user'})` establishes the project scope, then an
  aggregate grouped by `taskId` reads the thread summary including agent replies. Requires
  `req.uid`. Task names are looked up only for ids that pass `validateObjectId`, so a
  non-ObjectId thread id cannot throw a CastError.
- One route line, and a `{projectId: 1, role: 1}` index.

Frontend:
- New `components/organisms/ProjectDevChat/ProjectDevChat.vue`. Conversation rail + thread,
  `DevelopmentChat` reused verbatim and keyed on the thread so a switch remounts cleanly.
  Deviation from the plan, deliberately: hosted in its own `<Teleport to="body">` overlay
  following `AiTaskCreator.vue` rather than in `molecules/Sidebar`. Sidebar would have meant
  fighting its `.sidebar-body` scroll container from outside its scope, and every style stays
  in my own scoped block instead of near an unscoped sheet with 50 consumers. Same z-index
  band (1200) as the existing AI overlay, and the Teleport font-family trap is handled.
- Header icon + the matching three-dots row for < 768px, both gated
  `checkApps('AI',projectData) && checkPermission('artificial_intelligence', …) === true`.
- Mounted from `ProjectBottomModals.vue`, keyed on `projectData._id`.
- One-line fix in `DevelopmentChat.vue`: staged blob previews are revoked on unmount. The
  modal remounts that component per thread switch, so the pre-existing leak would have become
  the common case. Nothing else about the tab changes.

Verification:
- ESLint clean on all six touched frontend files.
- A structural suite (19 assertions): template balance, every template class has a rule,
  every `$t` key resolves inside its namespace, both surfaces gated, the `:key` present, the
  Escape listener added AND removed, no rule leaked into the shared Sidebar stylesheet,
  `taskId` still `required: true`.
- Ran the exact queries read-only against the live database: 5 projects, 19–51 threads each,
  every thread resolving its task name, key, status and sprint. No orphaned threads, no
  user message missing `projectId`, no non-ObjectId thread id. The pipeline is not theoretical.

### 2026-08-21 — rebuilt: a chat, not a task thread

The first cut got the scope wrong. It listed the project's **task threads**, which is not
what the window is for — the ask is Claude Desktop: give an instruction, it works on the
codebase, no ticket anywhere. Rebuilt for that.

**The scope model.** Every dev-agent message now carries exactly one of `taskId` (the task
tab, unchanged) or `conversationId` (a project chat). `taskId` is relaxed to
`required: false` and `conversationId` is **declared** — declared because the schema is
`strict: true` and silently drops undeclared fields, which works in-session and vanishes
after reload.

One `scopeOf()` in the controller resolves the scope, validates the id shape, and refuses
both-or-neither — that refusal is what replaces the schema-level guarantee that was given
up. `postMessage`, `listMessages`, `postReply`, `enqueueFollowup`, both attachment
endpoints and the no-runner failure reply all route through it. The task-comment write-back
is gated on `scope.isTask`: a chat has no task to comment on.

**`listConversations`** now groups by `conversationId` and titles each chat by its **first
instruction**, the way a desktop client does — no `dev_conversations` collection, nothing
to seed, no rename UI. Ids are shape-filtered rather than `$ne: ''`-filtered, because a
`$ne` also matches every task-tab document written before the field existed.

**The runner** stops assuming a task: no `fetchTask`, no task comments. A chat gets a
stable branch scope `chat-<short id>` (lowercase-kebab, so it passes the branch-name CI
check), its own memory file under `.alianhub/chats/`, and a PR body that quotes the
instruction instead of naming a ticket. Successive turns in one chat reuse the same branch
and PR, which is what makes it feel continuous.

**`DevelopmentChat.vue`** gained a `conversationId` prop and one `scope` computed that every
request goes through. Same component, two surfaces — the task tab passes exactly what it
always did.

Fixed on the way past, because it was the line being changed: the attachment storage key
interpolated the raw scope id, so a crafted id could place an object outside this module's
prefix — in another company's tree, given the bucket is the company. Now sanitised.

**Verification** — 49 structural assertions plus 30 behavioural ones. The behavioural set
is the one that matters: it constructs a real mongoose document to prove `conversationId`
survives `strict: true` (and separately proves strict is genuinely ON, so that first pass
is not vacuous), exercises `scopeOf` against both-scopes / neither / traversal-shaped /
too-short / too-long / whitespace ids, and checks the attachment segment and chat branch
key against path-shaped input. Two of my own checkers reported false positives (matching
the scope helper itself, and a comment explaining why `$ne` is avoided) and one test
imported `schema.js` wrongly — all three were test bugs, found and fixed rather than
explained away.

ESLint clean; backend loads; runner parses; line endings consistent.

### 2026-08-21 — the header icon, done properly

The first icon was wrong twice over: a chat bubble (which says nothing about
development) drawn as a hollow outline inside a bordered box, sitting next to a bare
solid paperclip and mic. It read as bolted on, because it was.

Read the actual house convention first: `Fileslinks.svg` and `Voice_Record.svg` are both
`fill="#818181" stroke="#818181" stroke-width="0.3"` — a filled path fattened by a
hairline of the same colour — and the paperclip and mic carry no border box (only the
eye does, because of its count badge).

Then stopped guessing and measured. Rasterised four candidates with sharp and looked at
them beside the real icons at 1x and 6x: `</>` code brackets, a terminal window, a
bubble-with-prompt, and a git branch. The bubble muddied at any size; the terminal read
as a heavy filled box against three linear glyphs; `</>` was the most legible
"development" mark at 16px and matched their linear character.

Weight was still off, so it was matched numerically rather than by eye: render each
glyph alone, measure ink coverage inside its own bounding box, and sweep the stroke
width. The paperclip sits at 0.1856 and the mic at 0.1670, so the target is 0.1763.
Stroke width 1.7 lands at 0.1712 — within 3%. 1.9 (the original) was 0.1926, i.e.
visibly heavier than either neighbour, which is exactly how it looked.

Markup fixed too: a bare `<img>` with the same `cursor-pointer` treatment as the
paperclip, no `.open__watcher` border.

Four assertions added to the suite so this cannot drift back: house grey only, sized for
the row, no backing plate, and not wrapped in the eye's border box.

### 2026-08-21 — private per user, and deletable

Answered the "will a colleague see my chat?" question from the code first, because the
answer decided the work: yes, they would have. `listConversations` filtered only by
`projectId`, and `listMessages` only by `conversationId`, so every chat in a project was
visible to everyone in it — and to any signed-in colleague in the company, since no
dev-agent endpoint has ever checked project membership. Cross-*company* was and is blocked
(`verifyJWTTokenWithCV2` + `isCompanyInAudience`); it was the intra-company boundary that
did not exist.

**Ownership.** A chat belongs to whoever started it. There is no conversation record to
hold an owner, so ownership *is* the first user message's `userId` — a field every message
has carried since the feature existed, which is why this applies retroactively rather than
orphaning the chats already stored (verified against the live data: the existing chat's
messages carry a real `userId`, so it stays visible to its author).

`denyIfNotOwner` gates listMessages, postMessage, and both attachment endpoints. The runner
is exempt via `req.apiToken` — it authenticates with a PAT and acts on a job, not as a
person, and without the exemption it could not reply into the chat it was asked to work on.
An unstarted chat has no owner, so minting an id in your own browser and sending the first
message is never refused.

**Project access.** Starting a chat against a project you cannot see would have let a
non-member point the agent at that project's repository. Now checked with
`resolveVisibleProjectFilter` — exported from `Modules/UserDashboard/controller.js` rather
than re-deriving the roleType / team / `public_projects` rule a second time, since a second
interpretation is how the two drift apart. Fails closed on a lookup error. The task tab path
is deliberately untouched by it.

**Delete.** `POST /api/v2/dev-agent/conversation/delete`, owner-only. Removes every message
in the chat *and* the files those messages carried — `removeStoredFile` added to
`common-storage/putLocalFile.js` as the counterpart of `putLocalFile`, with a
`deleteObjectByKey` on the wasabi driver behind it. Files go first: if that half-fails the
messages remain and the user can retry, whereas the other order would orphan objects with
no record pointing at them.

Refused while a job is in flight, with the reason ("Stop the job first") rather than a
generic failure — deleting under a working runner leaves it developing against a thread
that no longer exists. In the rail, delete is a hover action per row with the shared
`ConfirmDelete` modal; an unsent chat is dropped locally with no confirm, since there is
nothing stored to delete. Escape belongs to the confirm while it is open, so one press
closes the dialog rather than the whole window behind it.

**Verification** — 26 new tests drive the real handlers with the data layer, storage layer
and dashboard helper stubbed: reading/writing/attaching/deleting someone else's chat all
refused; owner allowed; PAT allowed; unstarted chat allowed; hidden project refused; task
path unaffected; delete blocked mid-run and deleting nothing when blocked; a clean delete
removing both messages and files and reporting the counts; already-gone, malformed-id and
anonymous cases all refused. Plus the earlier suites still green (49 structural, 30
behavioural, 9 protocol) and ESLint clean.

### 2026-08-21 — "The AI is still working in this chat" on a chat that wasn't

Reported as an error to handle; it was two bugs of mine, and the refusal message was
itself misleading — it told the user to stop a job they had already stopped.

**`cancelling` was a dead-end state.** `cancelJob` sets `working` → `cancelling` and then
relies on the runner noticing on its next heartbeat (every 5s) and posting `cancelled`
— which happens in exactly one place, `dev-agent.js:884`, inside the catch of the runner
that owns the job. If that runner died, restarted, or never really had the job (which is
what happened here: the old runner 404'd on the chat job), nothing else would ever move
the row. `failStalePendingIfNoRunner` only ever rescued `pending`, and `listPending`
re-offers a stale `working` for re-claim, so `working` self-heals — `cancelling` alone had
no recovery path and spun as "stopping…" indefinitely.

Fixed with `finalizeStrandedCancels`, run from `listMessages` beside the existing rescue:
a `cancelling` row untouched for 60s becomes `cancelled` with one reply explaining that
the computer stopped reporting. 60s because a live runner reacts within 5s, so a minute of
silence means nothing is coming. The update matches on the status, so a runner finalising
the same row concurrently just loses the race harmlessly.

**Delete refused on a state that could never clear**, which made the chat permanently
undeletable. The guard treated the whole of `ACTIVE_STATUSES` as busy, with no regard for
whether anything was actually running. Now it refuses only a *runner-owned* state
(`pending`, `pending_pr`, `working`, `working_pr`, `cancelling`) whose `updatedAt` is
within the 4-minute stale window, and it distinguishes stopping from working in the
message. Two deliberate non-blocks: `awaiting_approval` / `awaiting_pr` wait on a human, so
deleting a chat you were asked to approve is a valid answer rather than an error; and a
stale runner-owned state is deletable, because refusing would recreate exactly this trap.

**Tests.** The three existing delete tests failed at first because the fixture omitted
`updatedAt` — a test bug (`timestamps: true` means every real document has it), but it
pointed straight at the boundary worth covering. Eight more added: stale `working`
deletable, live `cancelling` held with the stopping message, stranded `cancelling`
deletable (the reported case), both `awaiting_*` states deletable, and the finaliser
itself — flips to `cancelled`, posts exactly one scoped reply, and leaves a fresh cancel
alone for the runner to finish. One assertion also had to change because it was still
matching my old, misleading copy.

Suites: 57 structural, 30 behavioural, 9 protocol, 34 privacy/delete. All green.

### 2026-08-21 — Desktop parity: the four structural changes

Stepped back and asked what actually separated this from Claude Desktop. The answer was
not polish; it was that the runner is a **PR factory** and Desktop is a **pair programmer**.

**1. A chat is now one Claude Code session.** Verified the installed CLI (2.1.201) supports
`--session-id`, `-r/--resume` and `--include-partial-messages` before designing anything.
The session id is *derived* from the conversation id (sha256 → v4-shaped UUID) rather than
stored: identical on every turn with no round trip, survives a runner restart, and needs no
new field in a strict schema. Sessions are per-machine, so a resume can legitimately fail
(first turn, another machine, pruned history) — `runClaudeInSession` detects that from
stderr and starts the session under the same id instead, and only then does the prompt
carry the conversation as text. Before this, every turn was a fresh process that re-read the
repository and was handed a truncated transcript.

**2. A chat turn works in the developer's own tree.** The old path, for every message:
refuse if `git status --porcelain` is non-empty, `checkout -B` a branch, auto-commit, run a
self-review pass, gate a PR. So a dirty working tree — the normal state of a repo you are
working in — rejected every message, and asking a question moved your branch. Now a chat
runs Claude in the folder and stops, then reports what it touched by diffing the porcelain
before and after, so the developer's own pre-existing edits are not claimed as the agent's.
No branch, no commit, no PR: Desktop edits your files and you decide. The task Development
tab keeps the full pipeline, because for ticketed work that pipeline *is* the feature.

**3. The chat prompt is a collaborator brief.** The task prompt tells Claude it is
implementing a ticket, to maintain a cumulative memory file, and that the runner owns git.
All true for a task, all wrong in a chat — and presuming the developer wants an
implementation is what made a simple question produce ticket-shaped behaviour.

**4. Prose streams, and reads as prose.** Assistant text was previously flattened into the
same bullet list as tool calls and truncated to 120 characters — the agent's actual answer
was the one thing you could not read. Now `classifyEvent` splits prose from steps; prose
leads the live message and the tool trail sits under it behind a marker the frontend splits
on. Token deltas come from `--include-partial-messages` when available, with complete
assistant messages as the fallback, because that envelope is not a shape this runner
controls. Rewrite throttle 2000ms → 700ms, and the thread's poll drops to 1s while a job
runs, so it reads as typing rather than paging.

Also: replies render as **markdown** (`markdown-it` was already a dependency) with
scrollable code blocks. `html: false`, deliberately unlike the four existing call sites in
this app that pass `html: true` — this text is written by an agent that has just read the
repository, so markup in a file can end up quoted in a reply, and with raw HTML enabled it
would execute in the reader's session.

Runner protocol 2 → 3. Protocol 2 understood chat jobs but ran them through the task
pipeline, which is the behaviour this surface exists to not have, so the server withholds
chat jobs from it and says to reconnect. Protocol 2 still receives task jobs, so nothing
regresses for the tab.

**Verification** — a 47-assertion parity suite alongside the existing four. It executes the
extracted `sessionUuidFor` (valid v4, stable per chat, distinct across chats),
`classifyEvent` (delta → prose, non-delta stream event → ignored, tool_use → step, complete
text → prose, result → neither, null → safe) and `splitTrail`, and asserts the chat branch
of `developTurn` contains no checkout/commit/PR while the task branch still contains all
three. One harness bug found and fixed: it compared escaped source text against real
characters when checking the shared marker.

All five suites green (57 structural, 30 behavioural, 11 protocol, 34 privacy, 47 parity).
ESLint clean. The installed runner at ~/.alianhub was re-synced.

### 2026-08-21 — audit triage and the real bugs it found

Ran a 45-agent read-only audit against Desktop behaviour: 33 findings, all verified. It
started before the parity work landed, so a third were already fixed by it (the forced git
pipeline, the dirty-tree refusal, plain-text rendering, the 120-char prose chop, cold
processes). Each of the rest was checked against the CURRENT code rather than taken on
trust — two did not survive that.

**Refuted.** `safeName` "mangles filenames to an extensionless run of letters": the
verifier read `[ -<>:"|?*]` as an ASCII range covering digits and dots. Executed it —
`screenshot-2026-08-21.png` survives intact. The file stores literal control bytes rather
than escapes, so it is `[\x00-\x1f<>:"|?*]`, which is correct. Rewrote the bytes as escapes
anyway (behaviour proven identical by test): the file no longer reads as binary to grep,
and a whitespace-normalising tool can no longer silently change what it matches.

**Fixed — execution privacy.** `/pending` was company-wide with no user condition, so with
two developers paired, whichever runner polled first took the work: your private chat would
run on a colleague's laptop, under their Claude account, against their checkout, with your
attachments landing in their folder. Chat jobs are now filtered to the PAT owner. Task jobs
stay company-wide on purpose — assigning the AI Bot is a team action.

That fix exposed a second one. Runner presence was company-wide, so a colleague's runner
being online counted as "a runner is online" for *your* abandoned turn — which would then
never be re-offered (it is yours) and never failed. Presence is now tracked per developer
as well, and a chat row asks the per-developer question.

**Fixed — one turn at a time.** Nothing stopped a second message in a busy thread, and two
pending rows became two headless agents in the same working folder overwriting each other.
Refused server-side with the reason, the composer disabled with that reason shown, and the
runner now serialises per working folder — different repos still run in parallel, the same
folder queues.

**Fixed — nothing spins forever.** A claimed job whose runner died stayed `working`
indefinitely across reloads. Extended the stray-finaliser to `working`/`working_pr`, only
when that developer's runner is absent, so a live runner's stale claim is still left for
re-claim rather than killed.

**Fixed — the task path stopped throwing away Claude's answer.** `note: ''` on every exit
that committed anything, so the one exit returning the prose was "no changes were needed".
The developer got a branch name and a lint tick. Claude's account now leads the reply, with
the branch and verify report under it.

**Fixed — the memory file was read from the wrong end.** It is appended to each turn, and
`readContext` sliced `0..12000`, so once it outgrew the cap the agent read its oldest notes
and none of its recent ones.

**Fixed — thread UI.** The rail auto-selected the newest chat on every 10s poll, so going
back to the list or holding the blank pane undid itself; now first-load only. Streaming made
the thread re-scroll several times a second, so history could not be read mid-turn; now
sticky-to-bottom only when already at the bottom. A failed poll blanked the whole
conversation. A refused action (`{status:false}` resolves, it does not throw) left the
button looking dead. The composer was a fixed two-row box that swallowed Enter mid-IME
composition — now autosizing, and Enter is ignored while composing. A chat opened with only
a file was titled "New chat" forever; it falls back to the filename.

**Two bugs in my own fixes, caught by my own tests.** The memory-file trim cut to the first
newline in the window — with a long unbroken block that discarded nearly everything, and
the "under the cap" assertion still passed at 38 characters. Tightened the test to require a
full window. And `runSerialised` chained `.finally()` onto the job promise, building a second
promise from the same rejection with nothing handling it: one failing job would have taken
the runner down.

Suites: 57 structural, 30 behavioural, 11 protocol, 34 privacy, 47 parity, 13 execution,
18 runner-batch. All green. ESLint clean. Runner re-synced.
