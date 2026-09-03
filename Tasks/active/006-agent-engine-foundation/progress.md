# Progress: AI agent engine foundation + QA agent

## Checklist

- [x] Write the QA Review skill file
- [ ] Run it by hand against five completed AlianHub tasks; judge the findings before writing engine code
- [x] Skill loader (in-process registry; `AGENT_SKILLS` collection not needed yet)
- [x] Context assembler within a token budget
- [x] Toolbelt scoping on top of task 005's tool layer
- [x] 5-phase orchestrator
- [x] Verifier: evidence gate, dedup, volume cap (confidence floor not built — severity is used instead)
- [ ] Budgets enforced pre-call + usage accounting
- [x] `run_agent` action (synchronous, so `waitForResult` is implicit)
- [ ] Review inbox + `AGENT_REVIEW_ITEMS`
- [ ] Two-week trial on a real sprint

## Last step
QA agent working end to end: a real status change on T-3 filed 6 subtasks from a live audit
of khurat.com. Remaining: budgets, review inbox, and the two-week trial.

## Blockers
None. Task 005 landed, so the tool layer and run log were available.

## Log

### 2026-08-24
- Task created from the AlianHub Engine Blueprint (§06-§10) and ADR 002.
- Decision carried from the ADR: the agent engine is not a separate system — `run_agent` is one
  more automation action. That is what keeps two engines from becoming two products.
- Sequencing decision: write and hand-test the QA skill *first*. If the prompt is not producing
  findings worth acting on, no amount of engine fixes that, and it is an afternoon to find out.

### 2026-08-24 (build session — QA agent shipped)
Answered the user's question directly: "when a task is Done, run a QA process and file the
findings as subtasks" is **not pure automation**. The rule engine can trigger and write; the
*judgement* of what to check and what counts as a defect needs the agent. Built as ADR 002
specifies — `run_agent` is one more automation action, so both engines share one run log,
one audit trail and one permission model.

**Decisions taken with the user**
- *Fetch + LLM*, not a headless browser. Playwright would reproduce all eight of the manual
  findings but adds ~400MB and a second service, breaking the `app` + `mongo` compose promise.
  Fetch-only reproduces 6 of 8 against a server-rendered site; the two it cannot see are
  declared as blind spots in every report rather than silently omitted.
- *Subtasks + a summary comment*, not the review inbox. The blueprint argues for review-first
  and I still think it is right before this is enabled by default — recorded as open below.

**Built**
- `Modules/Agents/engine/pageAudit.js` — 14 deterministic HTML checks. This is the EVIDENCE
  layer: measured facts with locations, no opinions. Includes an SSRF guard, because a URL
  taken out of a task description is attacker-influenced input.
- `Modules/Agents/skills/qaReview.js` — the skill as a declaration: scopes, caps, prompt.
- `Modules/Agents/engine/orchestrator.js` — gather → ground → analyse → verify → emit. One
  model call, in `analyse`, only to prioritise and phrase facts already measured.
- `Modules/Automations/engine/actions/runAgent.js` + `createSubtask.js`, and a `createSubtask`
  tool.

**The evidence gate is the load-bearing part.** A finding must name a fact id that actually
FAILED. A finding about a check that passed, or about something never measured, is dropped and
counted. That is what stops the "ten confident wrong P1s in week one" failure the blueprint
warns about — verified by tests that feed it an invented `ssl_expired` finding.

**Verified live**
Moving T-3 ("Need to check khurat.com") to Complete in the UI fired the rule, which ran the
agent against khurat.com and filed **6 subtasks** — og:image, meta description length, image
dimensions, Product schema, empty hrefs, rel=noopener — plus a summary comment. 6.8s,
~1,200 tokens, gpt-4o. The findings match the manual QA done by hand earlier.

**Bug found and fixed by looking at the result**
First run filed all 7 subtasks with the PARENT's status, so the board showed
"Subtask 100% 7/7" above seven untouched defects. Subtasks now open in the project's first
status (`default_active`) — the board reads 0/6, which is the truth.

**Also fixed:** two of my own registry tests. One asserted exactly three actions; the other
asserted the manifest JSON does not contain the substring "run" — which only ever passed
because no action was yet named after what it does. It now asserts on shape.

Tests: 725/726 (the one failure is the long-standing `share-rules` staleness).

**Open / not built**
- Per-run and per-month LLM budgets are NOT enforced. `maxTokens` caps a single call; nothing
  stops a loop from running the agent hundreds of times. **This should land before the agent
  is enabled for anyone but us.**
- No review inbox — findings go straight to subtasks.
- One skill only. No skill authoring UI, no versioning, no golden-set evals.
- The two-week acceptance trial has not started.

### 2026-08-24 (session — finding memory / dedup)
The user proposed holding agent context on the Project Detail page and "storing into memory".
Before designing that, I tested the gap it would close: **running the agent twice on T-3 filed
6 more subtasks — 12 total.** Only 2 of the 6 repeats were string-identical; the other 4 were
the same defect re-worded by the model:

    run 1: "Shorten meta description to 160 characters"
    run 2: "Shorten meta description to avoid truncation"

That measurement decided the design. **Dedup must key on the stable `factId` the deterministic
audit produces, never on the finding title** — title matching would have caught a third of the
repeats and looked like it worked.

**Built — `Modules/Agents/engine/findingMemory.js` + `AGENT_FINDINGS` collection**
(registered through all five files; unique index on `{taskId, factId}` so a concurrent run
cannot race in a duplicate).

Three decisions per finding:
- **file** — never seen before
- **skip** — an open subtask already tracks it, or a human marked it `wontfix`
- **refile** — the subtask was closed or deleted and the defect is present again, filed with a
  "Regression:" note in the body

**Verified live against khurat.com**

    run A (memory empty) : found=6  filed=6  skipped=0  → 12 subtasks
    run B (memory warm)  : found=6  filed=0  skipped=6  → 12 subtasks
    run C (memory warm)  : found=6  filed=0  skipped=6  → 12 subtasks

Then closing the og:image subtask and marking `empty_links` as wontfix:

    run D : found=6  filed=1  skipped=5  refiled=1

— the closed one came back as a regression, the wontfix one stayed silent. Board and test
memory cleaned up afterwards; T-3 is back to its original 6 subtasks in To Do.

Tests: 9 new (`tests/agent-memory.test.js`), suite 734/735 — the one failure remains the
long-standing `share-rules` staleness.

**Design note for the Project Detail context field (not yet built)**
Keep the two things separate. *Project context* is human-authored input (base URL, staging
URL, platform, ignore-list, definition of done) and belongs on the project document as
`agentContext`. *Memory* is machine-written state and is what `AGENT_FINDINGS` now holds. The
`wontfix` status means the ignore-list largely learns itself rather than needing to be typed.
Recommend the context field stay mostly freeform prose with 2-3 typed fields — the same shape
as this repo's own CLAUDE.md, which works precisely because it is not 20 form fields.

