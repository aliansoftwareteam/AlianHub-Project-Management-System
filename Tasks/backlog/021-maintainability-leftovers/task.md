---
id: 021
title: Maintainability leftovers verified 2026-09-10
status: backlog
priority: medium
depends_on: []
created: 2026-09-10
---

# Maintainability leftovers verified 2026-09-10

## Goal
Close the loose ends the 2026-09-10 audit of tasks 001–013 left behind, so nothing that is
verified open lives only in a closed task's log or on a comment.

## Scope
Verified open against origin/beta (64f4f507) on 2026-09-10. The checklist in `progress.md`
mirrors this list; tick each box there with the commit that closed it.

- Dead `Modules/notification/routes.js` — requires a non-existent `./controller` and is never
  registered. Delete.
- `Modules/Sprints/controller.js:172/233` — `HandleHistory` calls raise "UserId required" during
  the demo seed.
- `docker-compose.yml:24/61/102` — hard-coded `container_name` values. Parameterise or document.
- Instance restore leaves the databases of companies created after the backup orphaned.
- Wasabi "Some uploads failed" with empty detail.
- `.claude/MIGRATION-task-type-icons-and-keys.md` documents the deleted
  `scripts/migrate-task-type-icons.js`, and the migrations runner has no dry-run/verify mode
  (both lost from task 002 when 0c0234f1 moved the logic under the runner).
- ADR 002 amendment for Agenda-on-global (`docs/adr/002-automation-and-agent-engines.md:75`)
  never written (task 005).
- `--kiln-*` aliases in `tokens.css:384-389` and the legacy Header kiln classes — delete once
  `ah.legacyNav` goes (task 006-ai-native-pages-shell).
- Stale `.wizard-step-fill` comment in `TemplateSelectForm.vue:189` and the inert
  `.tsf-fill-list` classes (tasks 001 and 004).
- 007 follow-ups: a run-history drawer for `GET /api/v2/automations/:id/runs`, and a "test on a
  real task" dry-run endpoint.
- Trash the sample/fixture rows in the "AlianHub Redesign" dogfood project (task 012).

## Out of scope
- 013's own remaining items (B.2 `main.yml` trigger, B.4 tenant helper adoption, G10 permission
  descriptions) — those stay on 013.
- The Ghost User comment author (task 020) and the provenance filter (task 010).

## Acceptance criteria
- [ ] Every box in `progress.md` is ticked with the commit that closed it.

## Constraints & notes
- The first five items were filed on AR-58 as "not in scope" during 013's integration
  (`progress-integration.md`, 2026-09-04); they are collected here rather than left on a comment.
- Each item is independent; land them as separate small commits or PRs.

## Resources
None.
