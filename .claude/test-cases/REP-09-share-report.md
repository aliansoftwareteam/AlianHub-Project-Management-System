# Test Cases — REP-09 Share a Report (AHE-3726)

Extends the existing **PublicShares** module (the sprint public-link feature) with a
`'report'` entity type, so a saved report (REP-02) gets a tokenized, read-only,
unauthenticated public link — reusing the same token store, global token→tenant
index, rate limiting, password/expiry options, and revoke flow.

**Backend changes (additive):**
- `shareRules.ENTITY_TYPES`: `['sprint']` → `['sprint', 'report']`
- `publicRenderer`: `GET /share/:token` now dispatches on `entityType` — for `report`
  it loads the saved report, runs its config through the REP-02 whitelist engine, and
  server-renders a read-only HTML table (dimension · metric rows + total)
- No new collection, route, or middleware — reuses `/api/v2/public-shares` + `/share/:token`

**Frontend:** Custom Report page — each saved report gets a **Share** button that
creates/fetches its public link, shows a copyable URL, and a **Revoke** action.

## Pure-rule unit tests (`tests/share-rules.test.js`) — 9/9 passing

Updated case: *"sprint + report shares pass; unknown entity types fail"* — asserts
`validateCreateShare({entityType:'report', …})` is valid and `'page'` still fails.
Existing token/intake/escape cases unchanged and still green.

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Create a report link | Save a report → click "Share" | A `…/share/<token>` URL appears; Copy works |
| M2 | Open the link (no auth) | Visit the URL in a logged-out browser | Read-only HTML page: report name + table of rows + Total |
| M3 | Link reflects live data | Change tasks, reopen the link | Table recomputes from current task data |
| M4 | Revoke | Click "Revoke" | Link row clears; visiting the URL → "This link is not available." (404) |
| M5 | Re-share | Click "Share" again on the same report | Returns the existing share (no duplicate) or a fresh one after revoke |
| M6 | Deleted report | Delete the saved report, open an old link | "This report is no longer available." (no crash) |
| M7 | Rate limiting | Hammer `/share/:token` > 60/min | 429 (shared IP limiter) — same protection as sprint shares |
| M8 | Password / expiry | (If set via the shared share doc) | Password gate / expiry enforced by the existing renderer path |
| M9 | companyId isolation | Token resolves tenant via the GLOBAL index | A report link only ever reads its own company's data |

## Guards / non-regression
- Report data is produced by the REP-02 whitelist engine (`reportRules.buildPipeline`) — the public page can never expose raw fields or run arbitrary Mongo.
- Sprint shares are completely unchanged — the report branch returns before the sprint board code; the intake form stays sprint-only.
- Reuses the existing IP rate-limiter, token entropy (32 bytes), `enabled`/`expiresAt`/password gates, and hard-revoke (removes the global index row).
- Page is served with `<meta name="robots" content="noindex">` (inherited from the shared renderer).
