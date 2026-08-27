# Progress: Triggered agent write-back from status / page / comment

## Checklist
- [x] Pure event gate, skip-filled, invented-id, permission helpers
- [x] IO runner reusing applyAutofillWrites + Alian comments + page briefing
- [x] Hooks on status / page save / comment (loop-safe)
- [x] Project toggle API + kiln UI (automations hub + page briefing strip)
- [x] Tests: event gate, skip-filled, invented ids, permission
- [ ] Draft stacked PR

## Last step
Implementation and unit tests in place. Opening stacked draft PR.

## Blockers
None.

## Log

### 2026-08-27
- Task created.
- Decision: do not turn AUTO-03 `set_priority` into a live event engine (that was deferred on purpose). Reuse 007's fire-and-forget after the mutation, S3.1 `applyAutofillWrites` for empty fields, and a dedicated `briefing` field so page body is never replaced.
- Default on per project; `aiWritebackEnabled: false` turns the trigger off.
- Skip Alian-authored comments and `@Alian` mentions (007 handles those).
- Tests: 57 passing on write-back + autofill + mentions + standup + automation-rules; stacked page tests 52 passing.
