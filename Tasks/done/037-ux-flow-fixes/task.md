# 037 — UX flow fixes from the ClickUp flow comparison

## Goal
Make the everyday flows as short and dependable as ClickUp's, fixing the ranked friction in `Tasks/active/034-end-to-end-qa-programme/findings/ux-flows-alianhub-2026-09-24.md`. The owner asked on 2026-09-24 to build the top fixes.

## Scope (one slice and one PR each)
1. **List view filters and remembered views** (ranks 1, 8, 14). Search, "Me" and saved filters narrow List exactly as they narrow Board and Table. Group-by, "Me" and search are remembered per user per project; "Assignee" is a group option; the Add View menu shows translated labels.
2. **Create a task from anywhere** (ranks 4, 5). The palette's "New task", a new top-level entry in the rail and the `c` key open one create dialog: title focused, project defaulting to the current one (else the last used), status, assignee, due date and priority as one row, Enter creates, Cmd/Ctrl+Enter creates and opens. Commands rank above Ask AI when the query matches a command. The List add row stays open after Enter; the Home input keeps focus. A project's "+ New" also offers a task.
3. **Task panel: Esc, undo and one timer** (ranks 3, 7 for single changes, 11). Esc closes the innermost open thing (picker, date picker, add row) before the panel. Status, assignee, priority and due-date changes offer Undo in their toast. One start button; the desktop hand-off moves to the ⋯ menu; Home and Time read the same running timer.
4. **Bulk edit** (ranks 7 for bulk changes, 10). The bulk bar sits above the mobile tab bar at 390 px; shift-click selects a range of visible rows; "Updated n tasks" offers Undo.
5. **First run and the Getting started card** (ranks 2, 12, 13). The card never covers controls (hidden while a task panel, bulk bar or add row is open, or docked), and its dismissal is stored on the user. One checklist per role, with workspace steps hidden from members. A new project starts Blank unless a template is chosen, or the default is labelled as a starter with example tasks.
6. **Inbox keyboard triage and invites** (ranks 6, 9, 15). The first card has focus on load and focus moves to the next card after clear or snooze; opening a task shows it over the Inbox. When invite mail fails, the message is plain and offers the join link; the copied join link works; the role defaults to Member and designation is optional or pre-selected.

## Out of scope
Inline status and property cells on List rows, and hover row actions (candidates for a later slice); the bottom tray; ranks not listed above.

## Acceptance
- Failing-first tests for each slice (unit; integration where the API changes; an e2e check for the List filter, the create dialog and the 390 px bulk bar).
- i18n for every string (allowlist stays empty); dark mode and 390 px checked with screenshots; keyboard access and accessible names; no regression in the axe checks.
- Access rules unchanged: the create dialog only offers projects the user may create in; invite links follow the existing invitation rules.
