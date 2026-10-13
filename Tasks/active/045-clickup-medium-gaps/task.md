# 045 — Medium gaps from the ClickUp re-check

## Goal
Close the medium (M, S–M, M–L) gaps from the build-645 re-check (`Tasks/active/034-end-to-end-qa-programme/findings/clickup-recheck-2026-09-30.md`) that need no owner decision. The owner asked for it on 2026-09-30: "also start the M gaps from the re-check". Task 044 covers the small ones. The slices run in waves so the machine is never overloaded.

## Scope (one slice and one PR each)
1. **Filter, group and sort by custom field** (re-check row 1).
   - Custom fields become filter fields, group-by options and sort keys in List, Board and Table.
   - Also sort by points, estimate and assignee.
   - Saved with the view.
2. **Docs: @mentions and image upload** (row 3).
   - In the block editor, `@` mentions people (notifying them) and links docs or tasks.
   - Images upload through the media storage path, not only by URL.
3. **Docs: comments** (row 3).
   - Comment on a doc, or on a selected block, with threads, resolve, mentions and notifications.
   - Built on the existing comment helpers and escaping.
4. **Subtasks in List rows** (row 4).
   - Subtask rows are inline-editable and selectable for bulk actions like any other row.
5. **One bulk bar** (row 5).
   - Retire the legacy `BulkActionBar`.
   - `ListBulkBar` gains move to another project and convert (task ↔ subtask), and is used by every view that selects rows.
6. **Automation templates** (row 8).
   - A rule template gallery (common recipes, built only from registry triggers and actions) and an "Automate" button in the project actions bar.
   - Opens the builder with the recipe filled in, for review.
7. **Command palette tidy-up** (rows 9 and 14).
   - Recents cover projects, docs and sprints as well as tasks.
   - The palette closes on a route change.
   - The legacy `GlobalSearchModal` is retired in favour of the palette.
8. **Home cards** (rows 9 and 20).
   - A Recents card.
   - "Manage cards" can add cards from the dashboard catalogue and reorder them, saved per person.
9. **Task types decide which fields show** (row 11).
   - A custom field can be limited to task types.
   - Task detail, forms and columns show it only for those types.
10. **Burndown, Velocity and Ask dashboard cards** (row 13).
    - These become cards in the dashboard catalogue, backed by the existing report endpoints and Ask.
11. **"Who can see this"** (row 16).
    - A plain-language explainer on projects, sprints and docs listing who can see the item and why (member, team, role, public link).
    - Computed from the same rules the server enforces.
12. **Workload by points or task count** (row 18).
    - Workload can measure capacity in hours, points or task count.
13. **`@agent` in chat and DMs** (row 19).
    - A named agent can be mentioned in a chat channel or messaged directly.
    - It answers in the thread under the same shared-output access rule as `@ai`.
14. **Gantt reschedules dependants** (lower-priority list).
    - Moving a blocker shifts its dependants, after a preview with undo, respecting working days.
15. **More AI field outputs** (lower-priority list).
    - AI fields can also fill number, date, labels and rating-style outputs, with validation of the model's answer.

## Out of scope
- New custom field types (row 2, L).
- Everything under "Waiting for an owner decision" in the re-check:
  - nested subtasks
  - multi-list tasks
  - subfolders
  - Everything view
  - view templates
  - Goals
  - chat threads
  - doc presence and version history
  - form logic
  - connectors
  - notetaker bot
  - hotkey app
  - web search
  - PWA

## Acceptance
- Failing-first tests per slice.
- Every string goes through i18n.
- Dark mode and 390 px checked for UI slices.
- Stored fields are declared in `utils/mongo-handler/schema.js`, with a migration where existing data needs it.
- Company-scoped reads.
- Socket events and cache clearing after writes.
- Nothing shows data the viewer cannot open.
- AI slices follow `aiAvailability`, record spend and respect caps.
