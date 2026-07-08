# Design Spike — De-risking the Shared Default Sprint for MainChats (P1-1)

**Type:** Design spike (analysis only — no code changes in this document).
**Ticket:** PRD **P1-1** ("shared-Sprint hot-document risk").
**Related:** PRD **P0-1** (already merged — removed the *correctness* dependency on the shared Sprint's task count), [`.claude/SOCKET-PERFORMANCE-PLAN.md`](.claude/SOCKET-PERFORMANCE-PLAN.md) (#9 sprint-count caching, #6/#13 pool tuning).

> **Note on location:** Lives under `.claude/` alongside the repo's other design docs (e.g. `SOCKET-PERFORMANCE-PLAN.md`).

> **TL;DR** — Every 1:1 conversation in a company is stored as a `Task` (`mainChat: true`) that all share **one** default Sprint document. Every DM created anywhere in the company fires an `$inc: { tasks: 1 }` against that single Sprint doc, and drift-recovery recomputes its count by scanning *all* DM tasks in the company. That makes the Sprint doc a per-tenant write hot-spot. **P0-1 already removed the only correctness-critical dependency** (the plan-gate no longer reads that count for chats), so this is a **scaling / cleanliness follow-up, not an urgent correctness fix.** Recommendation: a two-step path — a near-zero-risk guard change now (Option C) to kill the counter contention immediately, then migrate chats to a **dedicated conversation collection (Option A)** as the end-state when chat is next invested in. Option B (per-user/pair chat sprints) is not recommended as an end-state.

---

## 1. Current Architecture (verified against code)

### 1.1 Multi-tenancy
AlianHub is **database-per-company**: `utils/mongo-handler/mongoConnector.js` opens a distinct Mongo connection per `companyId` (`.../<db>`), each with its own `tasks`, `sprints`, `comments`, `main_chats`, `userId` collections and a `maxPoolSize` of 10. **Consequence:** the "hot document" is hot *within a single company's database*, not across tenants. Severity therefore scales with a single company's user count and DM volume — negligible for a 10-person company, material for a 500+-user company where the number of active 1:1 threads runs into the thousands.

### 1.2 How a 1:1 chat is stored today
- Each company has a **default project** (`project.default === true`) that backs 1:1 chat. `frontend/src/views/Chat/Chat.vue` picks it and uses its **first sprint** as the shared container: `dispatchChats(defaultProject._id, Object.keys(defaultProject.sprintsObj)[0])`.
- Each **1:1 conversation** is a single **`Task`** document with:
  - `mainChat: true`
  - `AssigneeUserId: [userA, userB]` (the two participants)
  - `sprintId` = the **shared default Sprint** (identical for every DM in the company)
  - `ProjectID` = the default project
  - stored in the **`tasks`** collection (`HandleTask` → `SCHEMA_TYPE.TASKS`, `Modules/Tasks/helpers/mongo_helper.js`).
- **Messages** are `comments` documents keyed by `taskId` (the conversation's Task `_id`), read via `Comments.vue` with `taskId = selectedChat.id`, `sprintId = selectedChat.sprintId`.
- The **`main_chats`** collection already exists (`SCHEMA_TYPE.MAIN_CHATS`) but today it holds the chat **project/channel container** docs surfaced in the sidebar (`getChats` in `Modules/MainChats/controller.js`), **not** the per-conversation records. The conversations themselves live in `tasks`.

### 1.3 The write path that makes the Sprint hot
`Modules/Tasks/helpers/taskMongo/create.js` `create()` runs for **every** task create, including chats:

```js
// create.js:54 — runs even when data.mainChat === true
updateSprintFun({ body: { ...updateObject: { $inc: { tasks: 1 } } },
                  params: { id: data.sprintId } })   // data.sprintId === shared default sprint
```

So each new DM anywhere in the company issues an `$inc` against the **same** Sprint document. Under WiredTiger, concurrent single-document writes serialize and retry on write-conflict, so this counter is the classic hot-counter.

### 1.4 Everything else coupled to that one Sprint doc
| Touch point | File | Effect on the shared Sprint |
|---|---|---|
| Task-count `$inc` on every DM create | `taskMongo/create.js:54` | Write contention on one doc (primary hotspot) |
| Count drift recovery | `taskMongo/reconcileTaskCount.js` (`computeLiveTaskCount`) | `$match { sprintId }` aggregate scans **all** DM tasks in the company, then `$set` back on the hot doc |
| Plan-gate count (historical) | `mongo_helper.js` `getTotalSprintCount` → `getTaskCount` | Aggregate `$count` over the shared sprint. **Now bypassed for chats** via `object.mainChat ? true : …` (P0-1), and cached 30s (SOCKET-PERFORMANCE-PLAN #9) |
| Embedded `sprintArray` | task docs | Every DM task carries a denormalized copy of the sprint object; sprint edits must fan out |
| Per-sprint comment-count fields | `mongo_helper.js` `removeCommentCount`, `userId` collection | Fields namespaced `sprint_<proj>_<sprint>_comments` all key off the one shared sprint |
| Private-channel assignee edits | `Chat.vue changeAssignee` → `updateSprintFun` | `findOneAndUpdate` on the sprint doc (channels, not 1:1 — lower volume) |

**Not** coupled: the **socket fan-out** is keyed by `chat_<projectId>_<userId>` per participant (`socket/controller/chatSocket.js`), *not* by sprint — so real-time delivery does **not** get hotter as the shared sprint grows. The hotness is purely a **MongoDB document-contention** problem, not a socket-broadcast problem.

### 1.5 Why P0-1 matters here
Before P0-1, chat creation flowed through the plan-gate, which read the shared sprint's task count and compared it to `maxTaskPerSprint`. As the shared sprint accumulated every DM in the company, two failures loomed: (1) the count query got slower, and (2) — the correctness bug — once the count crossed the plan cap, **new DMs could be wrongly blocked** ("Upgrade your plan"). P0-1 introduced the `object.mainChat ? true` bypass, so chats no longer read or depend on that count for correctness. **What remains is only the write-side contention and cleanup cost** — a scaling/cleanliness issue, hence P1 not P0.

---

## 2. Options

Evaluation axes (per acceptance criteria): **migration complexity/cost**, **read/write hot-path impact**, **blast radius on existing chat/task code**, **interaction with the now-removed plan-gate dependency**.

### Option A — Dedicated MainChat conversation collection (stop overloading `Task`)

Give conversations a first-class home instead of shoehorning them into `Task`/`Sprint`. A conversation document is small and self-describing — `{ _id, projectId, participants: [a, b], lastMessage, lastMessageAt, unreadCounts, pinned, private }` — living in its own collection (repurpose `main_chats` or a new `chat_threads`). No sprint, no denormalized `tasks` counter, no plan-gate, no reconciliation. Messages stay in `comments`.

- **Migration complexity/cost — High.** A per-tenant backfill of existing DM tasks → conversation docs, plus rewrites of the read paths (`setChats`/`getChats`), `Comments.vue` query params, the socket handler's `mainChat` filter, the `FileAndLinks`/audio path builders, the `HandleTask`/`create.js` branches, and history's `sprintId` references. **Key mitigation:** keep `conversation._id === old task _id` during backfill so `comments`, attachments, and history — all keyed by `taskId` — need **no** rekeying. That collapses the biggest blast-radius item.
- **Read/write hot-path — Best.** Eliminates the shared sprint from chat entirely. Writes land on **per-conversation** documents, which are naturally partitioned by pair → effectively zero counter contention. Reconciliation and count-scan work disappear for chat.
- **Blast radius — Largest (code), but cleanest (semantics).** Touches `tasks`, `sprints`, `comments`, socket, and several frontend components. In exchange it **deletes** the `mainChat` ternaries scattered through task code (`create.js`, `mongo_helper.js`, `Comments.vue`) and stops chat from polluting task/sprint features and reports.
- **Plan-gate interaction — Fully decoupled (best).** Chats never touch `getTotalSprintCount` or any sprint count again. This is the natural completion of the direction **P0-1** started: P0-1 severed the *read* dependency; Option A severs the *entity* dependency.

### Option B — Partition chat "sprints" per user or per pair

Keep the Task-as-chat model but replace the single default Sprint with many: either one Sprint per **user** (their DM inbox) or one per **conversation pair**. Writes then spread across many sprint docs.

- **Migration complexity/cost — Medium.** Create N sprints (per user, or lazily per pair), reassign every existing DM task's `sprintId` **and** embedded `sprintArray`, migrate the `sprint_<proj>_<sprint>_comments` counter namespaces, and update the frontend's "pick the first sprint" logic in `Chat.vue`.
- **Read/write hot-path — Improved, not eliminated.** *Per-pair* sprints → no contention (each pair writes its own doc). *Per-user* sprints → still shared across a user's many DMs, but vastly less contended than one global doc. Reconciliation scans shrink to a partition.
- **Blast radius — Smaller code change, but preserves the coupling.** Keeps the Task model, socket handler, and `taskId`-keyed comments untouched — so the diff is smaller. But it **keeps every `mainChat` branch** in task code and keeps chat coupled to sprint/task semantics. New failure mode: a proliferation of chat sprint docs that can leak into sprint-based task queries, burndown, and reports unless every such query is taught to exclude them.
- **Plan-gate interaction — Preserves the coupling P0-1 papered over.** Chats still flow through the sprint entity, so the `mainChat` plan-gate bypass must live **forever**; and each per-user/pair sprint now carries a count that would re-interact with `maxTaskPerSprint` if that bypass ever regressed. It shards the symptom without removing the dependency.

### Option C — Guard change: drop the counter/reconcile/plan work for chats (recommended first step)

The narrowest fix: chats don't need a sprint task count, burndown, or plan cap, so simply **stop doing that work** for `mainChat` tasks — guard `updateSprintFun($inc)`, reconciliation scheduling, the plan-gate call, and the per-sprint comment-count writes with `if (!data.mainChat)`. The shared sprint doc still exists and is still referenced, but the **hot field stops being written**.

- **Migration complexity/cost — Very low.** A handful of guards in `create.js` and `mongo_helper.js`. **No data migration.**
- **Read/write hot-path — Removes the primary hotspot immediately.** The `$inc` contention (the actual pain) is gone the moment it ships. The doc is still shared for `sprintArray` reads, but those are cached and read-mostly.
- **Blast radius — Tiny.** Localized to the create/count helpers; no schema, socket, or frontend change.
- **Plan-gate interaction — Reinforces P0-1.** Removes the last count *writes/reads* tied to chats, hardening the decoupling P0-1 began.
- **Downside — Doesn't fix the conceptual overload.** The `mainChat` branches remain and the sprint doc is still referenced by every DM task. It's a stepping-stone, not an end-state.

---

## 3. Comparison Summary

| Axis | A — Dedicated collection | B — Partitioned chat sprints | C — Guard change (interim) |
|---|---|---|---|
| Migration cost | High (per-tenant backfill; mitigated by reusing task `_id`) | Medium (reassign sprintId + sprintArray + counter namespaces) | Very low (guards only, no migration) |
| Write hot-path | **Eliminated** (per-conversation docs) | Improved (per-pair ≈ eliminated; per-user reduced) | **Contention removed** (doc remains, hot field un-written) |
| Read hot-path (reconcile/count scans) | Eliminated for chat | Reduced to partition size | Eliminated for chat |
| Blast radius (code) | Largest, but **removes** `mainChat` branches | Smaller, but **keeps** `mainChat` branches + new sprint-leak risk | Smallest |
| Plan-gate coupling | **Fully decoupled** (completes P0-1) | Preserved (bypass must live forever) | Decoupling hardened |
| End-state quality | Clean separation of chat vs task | Symptom sharded, coupling retained | Interim only |

---

## 4. Recommendation

**Adopt Option A (dedicated conversation collection) as the target end-state, reached via Option C as an immediate, opportunistic de-risking step.** Do **not** pursue Option B as an end-state.

**Rationale**
1. **A is the only option that removes the conceptual overload.** It deletes the `mainChat` special-cases threaded through task-creation, counting, reconciliation, and comment logic, and it stops chat data from polluting sprint/task features and reports. It is also the natural completion of **P0-1**: P0-1 cut the correctness *read*, A cuts the *entity* dependency.
2. **A gives the best hot-path outcome** — per-conversation documents are partitioned by pair by construction, so there is no counter to contend on and nothing to reconcile.
3. **B shards the symptom but keeps the disease.** It preserves every `mainChat` branch, forces the plan-gate bypass to live forever, and introduces a fresh hazard (chat sprint docs leaking into task queries/reports). Its one real advantage — a smaller diff — is *largely captured by Option C at a fraction of the cost and risk*, which makes B the weakest choice on the effort/benefit frontier.
4. **C buys time cheaply.** Because P0-1 already removed the correctness dependency, there is no fire to fight. C removes the actual contention in a few lines with no migration, letting A be scheduled deliberately (when chat is next touched for features) rather than rushed.

**Sequencing (explicitly non-urgent):**
- **Now / opportunistic:** ship **Option C** guards — kills the `$inc` contention with near-zero risk.
- **Later / when chat is next invested in:** execute **Option A**'s migration to fully decouple chat from Task/Sprint.

---

## 5. Rough Migration Outline (Option A) — *no implementation here*

> Design intent only. Each phase is independently shippable and reversible.

**Phase 0 — Interim guards (Option C).** In `taskMongo/create.js` and `taskMongo/mongo_helper.js`, skip the sprint `$inc`, reconciliation scheduling, plan-gate call, and per-sprint comment-count writes when `data.mainChat === true`. No data migration; immediately removes counter contention.

**Phase 1 — Define the conversation entity.** Formalize a `conversations` schema (reuse/rename `main_chats` or add `chat_threads`): `{ _id, projectId, participants:[a,b], private, lastMessage, lastMessageAt, unreadCounts, pinned, fileRefs }`. Begin **dual-writing** conversation docs on new DM creation alongside the existing Task, so no reads change yet.

**Phase 2 — Backfill (per tenant, idempotent, off-peak).** For each company DB, project existing `mainChat` Task docs into conversation docs. **Preserve `_id`** (`conversation._id = task._id`) so `comments`, attachments, and history — all keyed by `taskId` — require no rekeying. Point `setChats`/`getChats` at the new collection behind a per-tenant feature flag; verify parity against the Task-backed path before flipping.

**Phase 3 — Repoint the edges.** Update the socket handler (the `changeData.data.mainChat === true` branch in `chatSocket.js`) to emit from conversation events; update `Comments.vue` query params and the `FileAndLinks`/audio path builders to use conversation identifiers (unchanged if `_id` was preserved); update history's `sprintId` references for chat.

**Phase 4 — Decommission the overload.** Remove the `mainChat` branches from `create.js`/`mongo_helper.js`, stop referencing the shared default Sprint for chat, and retire the default-project-sprint container for 1:1 chat. Leave channels (non-`default` chat projects) on their existing model or fold them in as a follow-up.

**Rollback:** Phases 1–2 are additive (dual-write + shadow reads); a flag flip reverts to the Task-backed path at any point before Phase 4.

---

## 6. Acceptance-criteria mapping

- **Compares A and B (and C) on migration cost, read/write hot-path, blast radius, plan-gate interaction** — §2, §3.
- **Recommendation with rationale + rough migration outline** — §4, §5.
- **P0-1 already removed the correctness dependency; scoped as scaling/cleanliness, not urgent** — §1.5, callout in TL;DR, and §4 sequencing.
- **Delivered as a committed markdown doc alongside `SOCKET-PERFORMANCE-PLAN.md`** — this file (committed at repo root pending relocation to `.claude/`; see the location note at the top).

---

**Author:** Design spike prepared for PRD P1-1.
**Status:** Draft for review — no code changes proposed in this document.
