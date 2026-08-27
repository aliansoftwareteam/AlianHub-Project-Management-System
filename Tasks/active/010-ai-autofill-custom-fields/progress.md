# Progress: AI Autofill on custom fields

## Checklist
- [ ] Map custom-field kinds and empty/skip-filled rules
- [ ] Preview + apply helper on llmProvider, with S3.2 apply hook
- [ ] POST /api/v2/tasks/ai-autofill
- [ ] Kiln Autofill control on the task custom-field block
- [ ] Tests: skip-filled, invented people/tags dropped, permission gate
- [ ] Draft stacked PR

## Last step
Task created. Investigating existing custom-field schema, task modal, and Write-with-AI.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Decision: dedicated `/api/v2/tasks/ai-autofill` (preview + apply). Write-with-AI is description-only; pages compose is the wrong surface. Reuse `llmProvider`.
- Field map: text/textarea → summary, date → date, dropdown → tag, owner-titled dropdown + empty native assignee → owner.
