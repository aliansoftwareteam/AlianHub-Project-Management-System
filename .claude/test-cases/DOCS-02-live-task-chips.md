# Test Cases — DOCS-02 Live task chips in docs (AHE-3751)

Embed a **live task-status chip** inside a Page (doc): reference a task, and when the page is
viewed the chip shows that task's **current** status. Built **additively** and **frontend-only** —
Pages store content as a single HTML string (VueEditor/Quill), so a task reference is a plain-text
token `{{task:<taskId>|<TASKKEY>}}` that survives Quill; an Edit/Preview toggle hydrates each token
into a live status chip on view. No backend or schema change, no new dependency.

## Architecture
- **`PagesPanel.vue` (additive):** Edit/Preview toggle in the header; an **"Insert task chip"** button (edit mode) opens a task picker; Preview renders the page HTML with each token replaced by a live chip.
- **`TaskChipPicker.vue` (new):** debounced task search scoped to the current project, reusing the existing `POST /api/v1/task/find` pattern (from `LinkedTasks.vue`) matched on TaskName/TaskKey.
- **Token:** `{{task:<24-hex id>|<TASKKEY>}}` inserted at the Quill cursor (append fallback). Plain text → round-trips through edit/save unchanged (`savePage` still sends `contentHtml` verbatim).
- **Live chip:** on entering Preview, each unique referenced task is fetched once via `GET /api/v1/task/:id`; `statusKey` → `getTaskStatus()` composable → `{ name, bgColor, textColor }`; the token is replaced by an HTML-escaped `<span class="ah-task-chip">KEY: Status</span>` matching the app's status-pill look. Re-fetched every time Preview opens ("live").

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Insert a chip | open a project Page → **Insert task chip** → search → pick a task | a `{{task:…}}` token is inserted at the cursor in the editor |
| M2 | Preview shows live status | switch to **Preview** | the token renders as a colored status chip ("KEY: Status") matching the task's current status + colors |
| M3 | **Live / updating** | change that task's status elsewhere → return to the Page → **Preview** again | the chip reflects the **new** status (re-fetched on each preview) |
| M4 | Save round-trip | insert a chip → **Save** → reopen the page | the token persists; Preview still renders the live chip |
| M5 | Multiple chips | insert several task chips | each renders its own live status; each task fetched once |
| M6 | Edit mode unchanged | stay in **Edit** | normal VueEditor behaviour; the raw token text is visible/editable |
| M7 | Deleted / unknown task | reference a task, then delete it → Preview | a neutral "—" fallback chip renders; no crash |
| M8 | Search by key/name | type a task key or part of a name in the picker | matching project tasks listed; empty state when none |
| M9 | Page CRUD intact | create / rename / save / delete / restore version | all behave exactly as before (only the editor view is toggled) |

## Guards / non-regression
- **Additive / frontend-only** — page create/open/save/delete/version logic and the `VueEditor` `v-model="contentHtml"` binding are unchanged; the editor is simply gated to edit mode and a read-only preview is added. No backend, schema, or dependency change.
- The token is plain text, so Quill preserves it across edit/save; the stored HTML is unchanged except for the token text.
- Chip values are **HTML-escaped** (no injection); a missing/errored task degrades to a neutral chip.
- Frontend **build clean (0 errors)**.
- MVP scope: "live" = re-fetch on each Preview open (no socket subscription); colors resolve from the current project's status set.
