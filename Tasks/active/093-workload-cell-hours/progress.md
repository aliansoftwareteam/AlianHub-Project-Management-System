# Progress: 093 — Workload: cells show the hours

## Checklist

- [x] `workloadBuckets.js`: `hoursLabel` (never "0h" for a few minutes: "<0.1h"), `fillPercent`; `tasksOf` rows
      keep their estimates (`chips`) so a row moves as a whole.
- [x] `WorkloadTimesheet.vue`: cells drop the task chips and "+N"; the hours sit on their own pill over the
      bar (readable at any height); the bar has a 4px minimum; empty days stay blank.
- [x] Drag moved to the side panel (owner's choice): in day columns and Estimated mode, panel rows drag onto
      any cell; the panel fades and lets drops through while dragging; a row with several estimates moves
      each one; the grid reloads after a move (also after a failed one).
- [x] Legend hint replaced (`Time.workload_cell_hint_panel`), panel hint `Time.drag_to_move`; backfill dropped
      the old key from every locale.
- [x] Tests: `tests/workload-cell-buckets.test.js`; `frontend/tests/unit/workloadCellHours.spec.js`;
      `workloadTaskNotOpen.spec.js` checks the panel instead of chips.
- [x] `i18n:check`, `style:check`, ESLint.
- [x] Check in the running app (demo, TechNova).
- [x] Own branch `feat/workload-cell-hours` on `origin/staging`; PR into `staging`.

## Last step

PR into `staging` opened.

## Blockers

None.

## Log

### 2026-11-12
- Task created from the owner's request (screenshot: Workload cells where chips hide the hours, and a 30-minute
  bar too short for its number).
- Decision (owner): drag-to-rebalance moves to the side panel's task rows; Balance unchanged.
- `uiSweepThirdPass.spec.js` fails here on a `\n`-joined search in `tokens.css` (untouched; CRLF checkout), a
  known base failure on this machine.
- Running-app check on :4000 (demo, TechNova). No demo company has any estimates or logged time, so the
  grid's `workload-grid` and `workload-move` requests were answered in the page with sample data (nothing
  written to the demo DB). Light and dark: 9h over capacity red, 0.5h / 0.3h / <0.1h readable with a thin
  bar, empty days blank. Dragging a panel row onto another person's day sent the right move and reloaded
  (9h → 8h, panel 3 → 2 tasks); a drop on a cell behind the panel also landed.
