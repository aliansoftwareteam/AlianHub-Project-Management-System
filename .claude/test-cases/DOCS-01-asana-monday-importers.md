# Test Cases — DOCS-01 Asana / Monday importers (AHE-3750)

One-click importers for **Asana** (JSON export) and **Monday.com** (CSV/XLSX export) that turn an
export into AlianHub tasks in a chosen project + sprint. Built **additively** by mirroring the
existing Jira / Trello / CSV importers — same `Modules/Importers` adapter pattern, same shared
`finishImport()` → `taskMongo.createMultipleTasks()` pipeline, same per-source modal in the project
toolbar. No new dependency (reuses `XLSX` + native `JSON.parse`); no existing importer touched.

## Architecture
- **Backend (new adapters):** `Modules/Importers/helpers/asanaRules.js` (`validateAsanaInput`, `parseAsanaExport`) and `mondayRules.js` (`validateMondayInput`, `parseMondayExport`). Each returns `{ tasks, skipped }` in the shared task shape and is dispatched by a new controller endpoint.
- **Backend (additive):** `controller.js` — `importFromAsana` / `importFromMonday` (structured identically to `importFromTrello`: validate → `loadImportContext` → parse → `finishImport(..., source)`). `routes.js` — `POST /api/v2/imports/asana`, `POST /api/v2/imports/monday`.
- **Frontend (new):** `ImportAsana/ImportAsanaModal.vue` (JSON upload, cloned from ImportTrello) and `ImportMonday/ImportMondayModal.vue` (CSV/XLSX + column mapping, cloned from ImportCsv).
- **Frontend (additive):** `ProjectFiltersToolbar.vue` — 2 dropdown entries + 2 modal mounts; `locales/{en,ja,ko,ptBr}.js` — `import_asana` / `import_monday` (+ hint/preview keys in en).

### Field mapping (both → shared task shape)
| AlianHub | Asana (JSON) | Monday (CSV/XLSX columns) |
|---|---|---|
| TaskName | `name` | Name / Item / Title (required) |
| status | section name (`memberships[].section.name`); `completed`→Done→Completed | Status / State |
| Task_Priority | "Priority" custom field → Jira priority map | Priority → Jira priority map |
| DueDate | `due_on` / `due_at` | Due Date / Date / Timeline / Due |
| rawDescription | `notes` | Notes / Text / Long Text / Description |
| assignee | `assignee.email` → resolved via existing `enrichImportTasks` | (skipped unless email column) |

Status matched case-insensitively against the project's statuses (with the "Done"→"Completed" alias), falling back to the first status — same logic as Jira/Trello.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Asana import | Project toolbar → ⋯ → **Import Asana** → upload an Asana JSON export → pick sprint → Import | tasks created in that sprint; statuses mapped from sections; result shows created/skipped counts |
| M2 | Monday import | ⋯ → **Import Monday.com** → upload a Monday CSV/XLSX → (auto-detected columns, adjust mapping if needed) → pick sprint → Import | tasks created; statuses/priorities mapped |
| M3 | Monday column mapping | upload a CSV with non-standard headers | mapping dropdowns let you map Name/Status/Priority/Due/Description; Name is required to import |
| M4 | Status mapping | export with statuses matching + not matching project statuses | matching → mapped; unknown → first project status; "Done" → "Completed" |
| M5 | Priority mapping | tasks with High/Medium/Low/Urgent | mapped via the shared Jira priority map; missing → Normal |
| M6 | Assignee (Asana) | Asana tasks with assignee emails that match company members | assigned to the matching user (via existing email→userId enrich); non-matching → unassigned |
| M7 | **Subtasks (Asana)** | export with parent tasks that have subtasks | only top-level tasks import; subtasks counted in **skipped** (MVP — no ParentTaskId-from-import yet) |
| M8 | Empty / invalid file | upload a non-export / empty JSON or a CSV with no name column | friendly validation message; nothing imported |
| M9 | Row cap | a huge export | same ≤2000-row guard as the other importers |
| M10 | Job record | after import | an IMPORT_JOBS record is written (status processing→done) like the other sources |

## Guards / non-regression
- **Additive only** — Jira/Trello/CSV importers, `finishImport`, `loadImportContext`, `enrichImportTasks`, and the existing modals/dropdown are unchanged. New endpoints reuse the exact same pipeline + call shape.
- **No new dependency** — `XLSX` (already used by the CSV/Jira modals) + native `JSON.parse`.
- Backend **jest 541 pass / 49 suites** (+17 tests, +2 suites: `asana-import-rules`, `monday-import-rules`); frontend **build clean (0 errors)**.
- Subtasks intentionally deferred (counted as skipped); flagged for a future schema enhancement.
- ⚠️ Asana has no first-party single-file JSON export for all plans; the adapter is tolerant of common shapes (`[...]`, `{tasks}`, `{data:{tasks}}`), and the modal's "download sample" documents the accepted shape.
