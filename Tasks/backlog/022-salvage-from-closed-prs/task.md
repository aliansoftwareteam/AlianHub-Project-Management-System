---
id: 022
title: Pieces worth porting from the closed pre-redesign PRs
status: backlog
priority: low
depends_on: []
created: 2026-09-10
---

# Pieces worth porting from the closed pre-redesign PRs

## Goal
Keep pointers to the work in the PRs closed on 2026-09-10 that has no equivalent on beta, so it
can be ported deliberately instead of rediscovered.

## Context
On 2026-09-10 the owner closed PRs 515–523, 442, 389, 220, 206 and 32. All targeted
main/staging/dev; everything lands on beta since 2026-09-05. The branches remain on the remote.
The owner chose to close these without filing feature tasks; this task only preserves the
pointers.

## Scope
Verified on 2026-09-10 to have NO equivalent on beta, each with its branch:

- **#442 `feat/automation-agents`** — `frontend/src/config/chunkRecovery.js` plus a 4-line
  `main.js` hook: reload once on `ChunkLoadError` / "Loading chunk … failed". Beta has no
  `router.onError` or `unhandledrejection` handling and ships content-hashed lazy chunks, so a
  tab left open across a deploy dead-ends. Small; worth doing first.
- **#523 `feat/gantt-deps-recurring-52b7`** — per-task due-date recurrence
  (`recurrence: {freq, spawnedTaskId}`, `maybeSpawnNextOnComplete`,
  `Modules/Tasks/helpers/taskMongo/recurrence.js`, `recurrenceRules.js`,
  `tests/task-recurrence-rules.test.js`) and the Gantt FS collision hint. Rebuild on beta's
  RecurringTasks and GanttView rather than merge.
- **#519 `feat/standup-project-update-1955`** — `Modules/Pages/helpers/pageStandup.js`
  `groupStandupActivity()`: windowed (24h/7d) completed / in progress / blocked / created /
  comments grouping, with tests. Could become a windowed option on the Reporter skill.
- **#520 `feat/ai-autofill-custom-fields-32f3`** — preview-then-apply autofill of empty custom
  fields. Kiln-styled UI, needs a re-skin; PR #522 holds a later revision.
- **#517 `feat/alian-mentions-6d61`** — @Alian in task comments with server-side question
  extraction and a cited reply. Beta equivalent: make the Project Guide mentionable from
  CommentInput.
- **#389** — `scripts/dev-agent/dev-agent.js`, a server-brokered pairing runner.
- **#220** — ~30 lines of Docker Hub credential auto-detect for the publish job.
- **#206** — Upwork proposal review via a Managed Agent.
- **#515 / #516** — Workspace Ask popover, "turn this page into tasks", clickable citation
  chips. Also preserved verbatim in beta history at 374c19a9 under `.tmp-pr515/`, which the
  2026-09-10 housekeeping PR deleted.

## Out of scope
- Merging any of the branches as-is; every item is a rebuild on beta.
- Deciding which items ship — a product call per item.

## Acceptance criteria
- [ ] Each item above is either ported, with its commit noted in the log, or explicitly declined there.

## Constraints & notes
- Branches for #442, #523, #519, #520 and #517 are named above; the rest are reachable from their
  PR pages.

## Resources
None.
