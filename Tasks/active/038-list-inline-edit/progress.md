# 038 progress

- [x] List row status circle, inline cells, row actions, undo, 390 px (#965)

## Log
- 2026-09-24: owner chose inline editing on List rows; one slice started.
- 2026-09-24: #965 opened. Tests first (unit `listInlineEdit.spec.js`, e2e `list-inline-edit.spec.js`, List row controls added to `a11y.spec.js`), then the status circle with a grouped picker, assignee, due date and priority cells, row actions and menu, and Undo for each change, all through the task panel's update calls. Subtask rows stay read only apart from their done checkbox.
- 2026-09-24: merged as build 434 (#965); localhost updated.
