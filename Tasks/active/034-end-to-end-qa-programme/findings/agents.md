# Findings: AI agents (Agents, AICore)

Swept 2026-09-11 on the local server (build `14.36.0-beta.68`, commit `bd086bea`), company Local360, with the demo team and the four demo agents. Finding prefix `AGT`.

## Coverage

AICore registers no routes; it is the library behind the model calls, spend meter and replay records, and it was exercised through the agent runs. All routes below come from `Modules/Agents/routes.js`.

| | Owner | Admin (Rahul) | Member (Priya, Sara) | Guest (Kabir) |
|---|---|---|---|---|
| Routes exercised (50 total) | 43 | 48 | 45 | 44 |
| Screens opened (11 total) | 11 | – | – | – |

Routes not exercised live, and why:
- `POST /api/v2/agents/pause-all`, for every role. It pauses every agent in Local360, including agents that are not demo agents. It is covered against the throwaway database instead (AGT-03).
- `POST /api/v2/agents/proposals/:id/approve|decline`, as member or guest. Area rule: only Rahul decides proposals. The owner was not used either. Covered in the integration suite.
- Owner: `PUT/DELETE /api/v2/agents/account` (the owner's real account link was left alone), `POST /api/v2/agents/proposals`, `DELETE /api/v2/agents/skills/:key` (one sweep skill only).
- Admin: `POST /api/v2/agents/runs/:id/stop` (both admin runs had already finished or were stopped by the guest). Member: `POST /api/v2/agents/:id/resume`. Guest: `POST /api/v2/agents/:id/pause`, `PUT /api/v2/agents/skills/:key`, `POST /api/v2/agents/:id/revisions`. Each has the same guard as its counterpart that was exercised.

Screens opened as the owner, each without console errors: `/ai`, `/ai/inbox`, `/ai/skills`, `/ai/agent/:id` (PR Summarizer), `/ai/teammates`, `/ai/routing`, `/ai/ask`, `/ai/pipeline`, `/ai/release`, `/ai/accounts`, `/team`.

Real agent runs: 3 of the 5 allowed, all at L1 on demo agents.
- Intake Bot on QAS-4, started by Rahul. It made one model call ($0.0027).
- Standup Reporter on QAS-1, started by Priya and stopped by Kabir.
- PR Summarizer on QAS-12, started by Kabir. It was skipped because the task has no PR link.

Beta status of the extra checks:
- **Replay:** on the build, and checked.
- **Revisions:** on the build, and checked.
- **Undo and revert:** on the build, and checked.
- **Run trace:** not on the running build. `trace` and `traceId` land with #591 (`302b2158`, `b8b182e8`), after `bd086bea`.
- **Agent metrics and Health:** no route or screen on beta.

## Findings

### AGT-01 — Members and guests can create agents

- **Severity:** high
- **Role:** member, guest
- **Request:** `POST /api/v2/agents`
- **Expected:** 403 for anyone but an owner or admin. Agent settings, revisions and memory edits are already owner/admin only, and an agent spends the workspace's model budget.
- **Actual:** 200 `Agent created.` for Priya and for Kabir. The new agent has the caller as `ownerId`, autonomy up to L3 (the validator allows 0–3) and any spend cap. The hub also shows **New agent** to a guest.
- **Reproduction:** as `kabir.intern@demo.test`, `POST /api/v2/agents {"name":"[QA agents] x","autonomy":1,"spendCapUsd":1}`.
- **Suspected cause:** `Modules/Agents/controller.js:123` checks only that the caller is a human. It needs the `privileged(companyId, actor.userId)` check that `revisionAccess` uses (line 199). The frontend button in `frontend/src/views/Ai/AiHub.vue:8` should hide on the same rule.
- **Regression tests:** `AGT-01 refuses a member creating an agent`, `AGT-01 refuses a guest creating an agent`, and Playwright `AGT-01 the hub does not offer New agent to a guest`.

### AGT-02 — Members and guests can edit any agent, including its autonomy and spend cap

- **Severity:** high
- **Role:** member, guest
- **Request:** `PUT /api/v2/agents/:id`
- **Expected:** 403 unless the caller is an owner or admin. Revisions of the same fields are owner/admin only.
- **Actual:** 200 `Agent updated.` Live, Priya and then Kabir rewrote the description of an agent Rahul created. In the throwaway database a member raised an owner's agent to autonomy 3 with a $500 cap, and the change went live. A revision is recorded under the member's name, so the owner/admin gate on revisions is bypassed.
- **Reproduction:** as a member, `PUT /api/v2/agents/<agent id> {"autonomy":3,"spendCapUsd":500}`.
- **Suspected cause:** `Modules/Agents/controller.js:142` has the same human-only check. Gate it like `revisionAccess` at line 195.
- **Regression test:** `AGT-02 refuses a member raising an agent to L3`.

### AGT-03 — Members and guests can pause and resume any agent, and pause every agent at once

- **Severity:** high
- **Role:** member, guest
- **Requests:** `POST /api/v2/agents/:id/pause`, `POST /api/v2/agents/:id/resume`, `POST /api/v2/agents/pause-all`
- **Expected:** the kill switch is owner/admin, or the agent's owner.
- **Actual:**
  - Live, Priya paused Rahul's `[QA agents]` agent and Kabir resumed it (200). Pausing also stops the agent's open runs.
  - In the throwaway database a guest's `pause-all` returned 200 and paused every agent in the company.
- **Reproduction:** as a guest, `POST /api/v2/agents/pause-all`.
- **Suspected cause:** `Modules/Agents/controller.js:161` (`setPaused`) and `:298` (`pauseAll`) check only for a human.
- **Regression tests:** `AGT-03 refuses a guest pausing an agent`, `AGT-03 refuses a guest pausing every agent in the company`.

### AGT-04 — Any member or guest can stop a run someone else started

- **Severity:** high
- **Role:** member, guest
- **Request:** `POST /api/v2/agents/runs/:id/stop`
- **Expected:** the same rule as revert. Only an owner, an admin or the person who started the run may stop it.
- **Actual:** Kabir stopped the Standup Reporter run Priya had just started: 200 `Run stopped.`, with outcome `stopped by <Kabir's id>`. Revert on the same run correctly refused him with 403 `not_permitted`.
- **Reproduction:** as a member, start a run; as the guest, immediately `POST /api/v2/agents/runs/<run id>/stop`.
- **Suspected cause:** `Modules/Agents/controller.js:446`. `stopRun` checks only for a human; it needs the `revertCheck` ownership rule from `Modules/Agents/revert.js:37`. Check permission before the run's status, so a finished run also answers 403.
- **Regression test:** `AGT-04 refuses a guest stopping a run the owner started`. It asserts 403 on a finished run, because a run cannot be kept open without a model in CI.

### AGT-05 — Any member or guest can file a proposal in an agent's name

- **Severity:** high
- **Role:** member, guest
- **Request:** `POST /api/v2/agents/proposals`
- **Expected:** only an agent actor, or a run filing on its own behalf, can file a proposal. A person calling the route directly should get 403.
- **Actual:** 200 `Proposal filed.` for Priya and Kabir with `agentId` = Intake Bot. The proposal appears in the AI Inbox as "Intake Bot" with the caller's text and changes, and nothing records that a person wrote it. An approver who trusts the agent then applies the change as the agent. Both forged proposals were declined by Rahul.
- **Reproduction:** as a guest, `POST /api/v2/agents/proposals {"agentId":"<Intake Bot>","taskId":"<QAS-12>","what":"...","changes":[{"action":"task.comment","params":{"taskId":"<QAS-12>","body":"..."}}]}`.
- **Suspected cause:** `Modules/Agents/controller.js:511-517` takes `agentId` from the body whenever the actor is a human. Refuse when `!isAgent(actor)`, or use the actor's own `agentId`.
- **Regression test:** `AGT-05 refuses a member filing a proposal in an agent's name`.

### AGT-06 — A guest can undo an approval another person made

- **Severity:** medium
- **Role:** guest (and member)
- **Request:** `POST /api/v2/agents/proposals/:id/undo`
- **Expected:** undo is limited to the person who decided, or an owner/admin. This matches `revertRun`, which is limited to the starter or an owner/admin.
- **Actual:** Rahul approved a `[QA agents]` proposal; Kabir's undo returned 200 and reverted the applied comment. Rahul's own undo then answered 409 `Nothing to undo`. The only check is that the caller can see the project.
- **Reproduction:** as admin, approve a proposal; as a guest, `POST /api/v2/agents/proposals/<id>/undo`.
- **Suspected cause:** `Modules/Agents/proposals.js:245-252`.
- **Regression test:** `AGT-06 refuses a guest undoing an approval someone else made`.

### AGT-07 — Runs, run detail and proposals ignore project visibility

- **Severity:** high
- **Role:** member, guest
- **Requests:** `GET /api/v2/agents/proposals`, `GET /api/v2/agents/runs`, `GET /api/v2/agents/runs/:id`
- **Expected:** a person sees only runs and proposals of projects they can open, as Ask, routing and memory already do through `Agents/scope.visibleProjectIds`.
- **Actual:** all three return every row in the company.
  - In the throwaway database, a member's inbox listed a proposal filed on an owner-only private project, including its `what`, `why` and the proposed comment text.
  - Live, Kabir's `GET /runs/:id` on a run from Sweep Project W2 returned the run with its five audit rows.
  - Every Local360 project is currently public, so the live leak is limited to what those roles can already open. The code applies no project filter at all.
- **Reproduction:** as owner, create a private project with a task and file a proposal on it; as a member, `GET /api/v2/agents/proposals?status=all`.
- **Suspected cause:** no project filter in:
  - `Modules/Agents/controller.js:330` (`listRuns`), `:353` (`getRun`) and `:497` (`listProposals`);
  - `Modules/Agents/proposals.js:131` (`list`);
  - `runs.list`.
  Filter by `projectId: { $in: visibleProjectIds }` for anyone who is not privileged.
- **Regression test:** `AGT-07 keeps proposals of a private project out of a member's inbox`.

### AGT-08 — Validation errors answer HTTP 200

- **Severity:** low
- **Role:** all
- **Requests:** `POST /api/v2/agents` without a name; `PUT /api/v2/agents/:id` with nothing to update or a malformed id; `PUT /api/v2/agents/policy` with unknown modes; `PUT /api/v2/agents/account` with an unknown mode; `POST /api/v2/agents/runs` without an agent or task; `GET /api/v2/agents/runs/nope`; `POST /api/v2/agents/proposals/nope/approve`.
- **Expected:** 400.
- **Actual:** 200 with `status: false`. Other validation in the same controller answers 400 (autonomy, spend cap, idempotency key, skills).
- **Suspected cause:** `Modules/Agents/controller.js:32` defaults `fail()` to 200. The call sites at lines 111, 122, 125, 141, 144, 411, 427, 526 and 586, and `accounts.setPolicy`/`accounts.link`, pass no code.
- **Regression test:** `AGT-08 answers a missing agent name with HTTP 400`.

### AGT-09 — Stopping a run that does not exist answers 409

- **Severity:** low
- **Role:** all
- **Request:** `POST /api/v2/agents/runs/<unknown id>/stop`
- **Expected:** 404 `Run not found.`
- **Actual:** 409 `Run not found.`
- **Suspected cause:** `Modules/Agents/controller.js:448` maps every `runs.stop` error to 409. `Modules/Agents/runs.js:192` should return `status: 404`.
- **Regression test:** `AGT-09 answers stopping a missing run with 404`.

### AGT-10 — A proposal without a summary is saved as "undefined"

- **Severity:** low
- **Role:** all
- **Request:** `POST /api/v2/agents/proposals` without `what`
- **Expected:** 400 `what is required`.
- **Actual:** 200, stored with `what: "undefined"`, and the AI Inbox shows the literal text "undefined".
- **Suspected cause:** `Modules/Agents/proposals.js:116`, `String(what)`.
- **Regression test:** `AGT-10 refuses a proposal without a summary`.

### AGT-11 — Most successful responses omit statusText

- **Severity:** low
- **Role:** all
- **Requests:** 22 of the 24 GET routes, including `/api/v2/agents`, `/registry`, `/runs`, `/proposals` and `/skills`. Also `POST /api/v2/agents/skills` (201) and `PUT`/`DELETE /skills/:key`.
- **Expected:** `{ status, statusText, data }` (CLAUDE.md response format).
- **Actual:** `{ status, data }`. Only the memory and preferences routes and the mutations in `controller.js` include `statusText`.
- **Suspected cause:** `Modules/Agents/controller.js` (for example lines 105 and 113) and `Modules/Agents/skillsController.js:27-80`.
- **Regression test:** `AGT-11 includes statusText on a successful list`.

## Side effects to know about

- The same-value settings and policy writes as owner and admin changed nothing.
- `DELETE /api/v2/agents/account` as Rahul answered `revokedTokens: 1`. Rahul had no linked account, but unlink revokes every agent token the person holds (`Modules/Agents/accounts.js:55-61`). If another QA area created an agent token for Rahul, it is now inactive.

## Checks that passed

- Every route refuses a request without a token, and a foreign `companyid` header, with 401.
- Owner/admin gates hold for members and guests on these routes:
  - `PUT /settings` and `PUT /policy`;
  - revisions (list, get, create, promote, rollback);
  - skill create, update and retire;
  - memory add and update;
  - run replay (403).
- Agent delete is limited to an owner, an admin or the agent's owner. The member and the guest each deleted only the agent they owned.
- Revert is limited to the starter or an owner/admin (403 `not_permitted`), refuses a second revert (409), and refuses a run with no reversible changes (409).
- Validation rejects each bad input with a clear error:
  - autonomy outside 0–3, a spend cap of 0 or less, an idempotency key over 200 characters;
  - an unknown or retired skill on an agent;
  - never-listed actions, in skills and in proposals;
  - skill validator errors, per field;
  - memory text addressed to the AI;
  - duplicate memory (409);
  - an invalid `undoHours`, tone or memory status.
- Scope: a run on a task outside the agent's projects answers 403. A paused agent refuses a run with 409 until it is resumed.
- Idempotency: the same `Idempotency-Key` returns the first run with `Run already started.`
- A real L1 run (Intake Bot) parked a proposal. Rahul approved it edited down to the comment, the run closed as `edited by a person — 1 of 1 change(s) applied`, and admin revert reverted 1 action. Spend was booked ($0.0027) and the pinned agent revision was reported.
- Replay: one record per model call, with prompt hash, messages, response, cost and trace fields, and owner/admin only.
- Revisions on PR Summarizer: a candidate was promoted live, rollback to 1 created revision 3 and restored the description exactly, and promoting a live revision is a no-op.
- Skills: `[QA agents] Sweep skill` was created, then refused as a duplicate, updated, rejected an invalid update, and was retired. A retired skill is hidden from the active list and refused on an agent.
- Memory on QA Sandbox: a decision and a constraint were added, members can read them with `canEdit: false`, the decision was reworded, both were retired, and a private project's memory answers 404 to a member.
- Proposals: approving or declining twice answers 409, an unknown id answers 404, and a decline reason is stored.
- All eleven screens render as the owner without console errors.

Cleanup: every `[QA agents]` agent was deleted (three live, one owner-made), the sweep skill and all four memory rows are retired, forged proposals were declined, and the applied comments were undone or reverted. PR Summarizer is back on its original snapshot as revision 3, and Standup Reporter is resumed.
