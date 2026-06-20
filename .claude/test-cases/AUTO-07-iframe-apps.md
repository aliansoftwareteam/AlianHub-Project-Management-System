# Test Cases — AUTO-07 Custom Apps / iframe Plugins (AHE-3741)

Embed external tools (dashboards, docs, BI boards) as in-app panels. Apps are
stored as `custom_iframe` connections (AUTO-04, `multiple:true`); the hub **Apps**
section adds/lists/opens/removes them. **https-only**, sandboxed iframe.

**Backend:** reuses `/api/v1/integrations/connections` (type `custom_iframe`).
`isEmbeddableUrl` enforces https only (blocks http / `javascript:` / `data:`).
**Frontend:** Integrations hub → **Apps** — add (name + url), tabs per app,
sandboxed iframe render, remove.

## Pure-rule unit tests (`tests/integrations-rules.test.js`) — 7/7 passing

New: `isEmbeddableUrl` — https → true; http / `javascript:` / empty → false.
(`custom_iframe` connect path also asserts the https requirement + multiple instances.)

## Manual / integration test cases

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| M1 | Add app | Apps → name "Grafana", url `https://grafana.example.com` → Add | App tab appears |
| M2 | Open | Click the tab | Sandboxed iframe loads the URL in a panel |
| M3 | Multiple | Add a second app | Both tabs; switching changes the frame |
| M4 | http rejected | url `http://x` | 400 "A valid https:// URL is required." |
| M5 | javascript: rejected | url `javascript:alert(1)` | rejected |
| M6 | Remove | Click ✕ on a tab | App removed; frame clears if it was open |
| M7 | Framing-blocked site | embed a site sending `X-Frame-Options: DENY` | Frame stays blank (browser blocks); note in UI warns about this |
| M8 | companyId isolation | two companies | each sees only its own embedded apps |

## Guards / non-regression
- iframe is `sandbox="allow-scripts allow-forms allow-popups allow-same-origin"` + `referrerpolicy="no-referrer"` + `loading="lazy"` — the embed can't navigate the top window or leak the referrer.
- **https only**, validated both client- and server-side (`isEmbeddableUrl`); blocks `javascript:`/`data:`/http.
- Reuses the existing `integration_connections` collection (type `custom_iframe`) — no new collection or route.
- A site that refuses framing (X-Frame-Options / frame-ancestors) simply renders blank — documented in the UI; nothing breaks.
