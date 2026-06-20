# Test Cases — REP-07 Saved / Reusable Report Templates (AHE-3724)

**Builds on REP-02** (CustomReports). Saved reports already existed (`SAVED_REPORTS`
collection + create/list/run/update/delete). REP-07 adds the *reusable* layer:
a built-in template catalog, "start a new report from a template", and "duplicate".

**New endpoints** (under the existing JWT-scoped `/api/v1/reports/custom` prefix):
- `GET  /api/v1/reports/custom/templates` — built-in template catalog (static)
- `POST /api/v1/reports/custom/from-template` `{ templateKey, name? }` — save a new report from a template
- `POST /api/v1/reports/custom/:id/duplicate` — clone an existing saved report

**Frontend:** Custom Report page — "Start from a template" picker + per-report "Duplicate".

## Pure-rule unit tests (`tests/report-templates.test.js`) — 4/4 passing

| # | Case | Expected |
|---|------|----------|
| 1 | Catalog non-empty | ≥ 5 templates shipped |
| 2 | Every template config validates | `reportRules.validateConfig(t.config).valid === true` for all |
| 3 | Keys unique | no duplicate template keys |
| 4 | `getTemplate` | returns the template for a known key, `null` for unknown |

Templates shipped: Tasks by status, Tasks by project, Tasks by sprint, Story points by sprint, Story points by project.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Template picker populates | Open Custom Report | "Start from a template" lists the built-in templates |
| M2 | Apply a template | Pick "Story points by sprint" | Builder switches to dimension=sprint, metric=points; preview re-runs; name pre-filled; picker resets |
| M3 | Save from applied template | After M2, click Save | New saved report appears in the list |
| M4 | from-template endpoint | POST `{templateKey:'tasks_by_status'}` | 201, new saved report with that config |
| M5 | Unknown template | POST `{templateKey:'nope'}` | 404 "Unknown template." |
| M6 | Duplicate a saved report | Click "Duplicate" on a saved report | A `"<name> (copy)"` clone appears; original untouched |
| M7 | Duplicate missing id | POST `/:id/duplicate` with bad id | 404 "Not found." |
| M8 | companyId isolation | Two companies | Each only sees/duplicates its own saved reports; template catalog is shared/static |

## Guards / non-regression
- Templates are validated through the same REP-02 whitelist engine — a template can never inject an unsupported dimension/metric/chart or raw Mongo.
- Reuses the existing `SAVED_REPORTS` collection and `/api/v1/reports/custom` route prefix — **no new collection, no new middleware/boot wiring**.
- All existing REP-02 endpoints (run/create/list/update/delete) unchanged; new routes are ordered so literal paths resolve before `:id` params.
- `removeCache('saved_reports:<companyId>')` after create/duplicate keeps the list fresh.
