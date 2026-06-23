# Test Cases — AUTO-05 Integrations Marketplace (AHE-3739)

The **Marketplace** section of the Integrations hub — a browse/search/connect UI
over the AUTO-04 catalog + connections API. Pure frontend; no new backend.

**Frontend:** Integrations hub → **Marketplace** — card grid of catalog items,
search box, per-card Connect form (fields from the catalog; secret fields masked),
Connected badge + Reconfigure / Disconnect.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Browse | Open Marketplace | Cards for Slack, GitHub, GitLab, Google Calendar, Teams, Zapier (custom iframe lives in Apps) |
| M2 | Search | Type "git" | Filters to GitHub + GitLab |
| M3 | Connect | Click Connect on Slack → fill fields → Save | Card shows "Connected" badge |
| M4 | Secret masking | Reconfigure Slack | Secret fields render as password inputs; previously-saved secret value is NOT prefilled (only non-secret fields are) |
| M5 | Reconfigure | Change a non-secret field → Save | Updates the existing connection in place (no duplicate) |
| M6 | Disconnect | Click Disconnect | Badge clears; connection removed |
| M7 | companyId isolation | two companies | each sees only its own connected state |

## Guards / non-regression
- Reads the catalog + connections from AUTO-04; secrets are already redacted server-side, so the UI never receives stored secret values.
- Pure additive frontend (a new hub section + i18n + styles); no backend, schema or route change.
- Connect posts only catalog-declared fields; the server re-validates + filters.

## Roadmap
Per-integration "test connection" + OAuth connect buttons (for Google Calendar / others) layer on once their credentials are configured (see AUTO-02 / AUTO-04 notes).
