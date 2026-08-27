# Progress: AI Autofill on custom fields

## Checklist
- [x] Map custom-field kinds and empty/skip-filled rules
- [x] Preview + apply helper on llmProvider, with S3.2 apply hook
- [x] POST /api/v2/tasks/ai-autofill
- [x] Kiln Autofill control on the task custom-field block
- [x] Tests: skip-filled, invented people/tags dropped, permission gate
- [x] Draft stacked PR

## Last step
Tests 77 passing; frontend build complete. Draft PR 520 stacked on 519.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Decision: dedicated `/api/v2/tasks/ai-autofill` (preview + apply). Write-with-AI is description-only; pages compose is the wrong surface. Reuse `llmProvider`.
- Field map: text/textarea → summary, date → date, dropdown → tag, owner-titled dropdown + empty native assignee → owner.
- Tests: skip-filled, invented people/tags dropped, permission gate — 77 passing with stacked page tests. Frontend `npm run build` succeeded.
- Live Local Smoke path not exercised (no MongoDB + seeded project in this environment).
