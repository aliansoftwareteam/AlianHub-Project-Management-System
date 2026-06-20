# Test Cases — AUTO-04 Native App Integrations (AHE-3738)

A generic **integration connections registry** + a static **catalog** of
connectable apps. This is the foundation the marketplace (AUTO-05), Slack
(AUTO-06) and custom iframe apps (AUTO-07) all build on. Secrets are stored in
config but **never returned** to the client (`redact`).

**Collection:** `integration_connections` (per-company).
**Endpoints** (JWT + companyId under `/api/v1/integrations`):
- `GET /catalog` — static catalog (field metadata only, no values)
- `GET /connections` — this company's connections (secrets redacted → `secrets:{field:bool}`)
- `POST /connections` `{type, config}` — connect (single-instance types update in place)
- `PUT /connections/:id` `{enabled}` · `DELETE /connections/:id` (disconnect)

Catalog: Slack, GitHub, GitLab, Google Calendar (OAuth), Microsoft Teams, Zapier, Custom embed (iframe, multiple).

## Pure-rule unit tests (`tests/integrations-rules.test.js`) — 6/6 passing

| Group | Cases |
|-------|-------|
| catalog | non-empty, every item has key/name/fields · `getCatalog` exposes only field metadata (secret flag, never values) |
| validateConnection | known type filters to allowed fields (drops unknown keys) · unknown type rejected · custom_iframe requires a valid https URL + keeps name |
| redact | hides secret values, reports which secrets are set |

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Catalog | GET /catalog | Returns the catalog with field metadata; no secret values |
| M2 | Connect Slack | POST `{type:'slack', config:{signing_secret, default_channel}}` | Connection created `status:connected`; GET /connections shows `secrets.signing_secret=true`, value hidden |
| M3 | Single-instance update | Connect 'slack' again | Updates the existing connection (no duplicate) |
| M4 | Custom embed (multiple) | Connect two `custom_iframe` apps | Both stored (multiple:true) |
| M5 | Bad URL | custom_iframe with `ftp://` | 400 "A valid https URL is required." |
| M6 | Unknown type | POST `{type:'evil'}` | 400 "Unknown integration type." |
| M7 | Disconnect | DELETE /connections/:id | soft-deleted, gone from list |
| M8 | companyId isolation | two companies | each lists/connects only its own |

## Guards / non-regression
- Config is filtered to the catalog item's declared fields — a connect call can't store arbitrary keys.
- Secrets are redacted on every read; the catalog never returns values.
- New `integration_connections` collection + new route prefix; additive only. No external network calls made by this module (it stores config; specific integrations act on it).

Frontend (the marketplace that browses this catalog + connects) ships in AUTO-05.
