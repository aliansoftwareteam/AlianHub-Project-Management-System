# 044 — Quick gaps from the ClickUp re-check

## Goal
Close the small (S) gaps from the build-645 re-check (`Tasks/active/034-end-to-end-qa-programme/findings/clickup-recheck-2026-09-30.md`), rows 6, 7, 10 and 12. The owner asked for them on 2026-09-30: "start 044 with the quick ones now". The larger gaps (M/L) and the owner decisions come later.

## Scope (one slice and one PR each)
1. **Custom fields on Board cards.**
   - A board can show chosen custom fields on its cards, not only points, using the same "shown fields" choice List and Table use (`composables/viewColumns.js`).
   - The choice is saved with the view.
   - Values render read-only and compact, and empty values take no space.
2. **Form responses link to their task.**
   - In `FormsView/FormSubmissions.vue` the created task's key opens that task instead of showing as text.
   - A response whose task was deleted, or that the viewer cannot open, shows the key without a link and no error.
3. **Language settings follow the person.**
   - `localePreferences` is already saved to the server (#1148); now it is read back at sign-in or session load, so a new device or browser uses it.
   - The server copy wins at sign-in, and changes keep writing to both.
   - If the server has nothing, the local copy stays and is sent up once.
4. **Unblock stale agent templates.**
   - `field_filler` is blocked on AI fields, which shipped in #1166.
   - `prd_writer` is blocked on doc drafting; the `page.draft` action exists.
   - `wiki_upkeep` is blocked on pages; `pages.search` and `page.get` exist.
   - Each template gets real actions the registry knows, including an AI-field fill path for Field Filler if `task.update` cannot write AI fields. The `blockedBy` is removed only where the engine can keep the promise.
   - A test fails if a template names a blocker whose capability now exists, or an action the registry lacks.

## Out of scope
- The task tray following the person. It is per device by design and stays in localStorage.
- Custom fields on Gantt or Calendar items.
- New custom field types (row 2 in the re-check).
- Filter, group or sort by custom field (row 1).

## Acceptance
- Failing-first tests per slice.
- Every string goes through i18n.
- Dark mode and 390 px checked for the UI slices.
- Stored fields are declared in `utils/mongo-handler/schema.js`.
- Company-scoped reads.
- Nothing shows a task the viewer cannot open.
