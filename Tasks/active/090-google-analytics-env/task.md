---
id: 090
title: Optional Google Analytics — page-view traffic from one env variable
status: active
priority: medium
depends_on: []
created: 2026-11-04
---

# 090 — Optional Google Analytics (PRD)

## Goal
Let an instance owner see how much traffic reaches the web app by setting one env variable,
`GA_MEASUREMENT_ID` (a GA4 id, `G-XXXXXXXXXX`). It is meant for our own domains. An instance
that leaves it unset behaves exactly as it does today: no script, no request to Google, no CSP
change and no log noise. It is a core, env-only switch, with no instance-console setting.

## How it fits the code that exists
- **Delivery:** the SPA is one build for every domain, so the id cannot be a `VUE_APP_*` build value.
  It goes out at runtime in `/api/v2/instance/public-config` (`Config/instanceSettings.js#publicConfig`)
  as `analytics: { gaMeasurementId }`, and `frontend/src/config/publicConfig.js` picks it up.
- **CSP:** `Config/contentSecurityPolicy.js` allows no inline script, so the gtag bootstrap lives
  in bundled JS (a new `frontend/src/utils/analytics.js`), never as an inline `<script>` in
  `index.html`. With the id set, the policy adds `https://www.googletagmanager.com` to
  `script-src` and the GA collect hosts (`https://*.google-analytics.com`,
  `https://*.analytics.google.com`, `https://www.googletagmanager.com`) to `connect-src`.
  `img-src` already allows `https:`. Unset, the policy is byte-for-byte what it is now.
- **Page views:** the router uses hash history (`createWebHashHistory`), which GA's automatic
  page-view tracking reads badly. gtag is configured with `send_page_view: false`, and
  `router.afterEach` in `frontend/src/router/index.js` sends a `page_view` itself.
- **What is sent:** the route's real path (`route.path`, ids included, chosen 2026-11-04) and
  the route name. The query string and hash fragment are always dropped, because magic-link,
  password-reset, OAuth and referral tokens travel there. `page_location` is rebuilt as
  origin + `/#` + path so GA never sees the full URL either. No user id, email, company name
  or page title is sent. Google signals and ad personalisation are switched off in the gtag config.
- **Managed cloud:** `managed: "fixed"` in `scripts/env-doc.meta.json`, so only the platform
  env sets it and a customer cannot change it from their console.

## Never an error
- Unset or empty → `analytics.js` returns at once; nothing loads.
- An id that is not `G-` + letters and digits → treated as unset; the server logs one warning at
  start-up naming the variable. It never throws and never blocks start-up (unlike `CSP_MODE`).
- The script failing to load (ad blocker, offline, Google down) → swallowed; no console error
  from our code, no effect on routing or rendering.
- Every call in `analytics.js` is wrapped so a GA problem can never break navigation.

## Scope
1. `GA_MEASUREMENT_ID` read and validated on the server; exposed in public-config.
2. CSP hosts added only when the id is valid.
3. `frontend/src/utils/analytics.js`: load gtag once, configure it, `trackPageView(route)`.
4. Call it from `applyPublicConfig` (load) and `router.afterEach` (page views).
5. Web browser only: skipped inside the Electron desktop app.
6. Docs: entry in `scripts/env-doc.meta.json` (group `general`), `.env.example`, then
   `npm run env:doc` so `docs/ENV.md` and `docs-site/admin/env-reference.md` regenerate.
7. Tests: CSP with and without the id, invalid id ignored, public-config field, `analytics.js`
   no-op when unset, page path keeps ids but never a query string or token.

## Out of scope
- Instance-console setting or per-company setting.
- Custom events (task created, sign-ups, …) — page views only for now.
- A cookie-consent banner or Consent Mode. Fine for our internal domains; any instance that
  serves EU visitors and turns this on needs its own consent decision first.
- The server-rendered public pages (public shares, public forms) — they send their own stricter CSP.
- The existing Firebase `MEASUREMENTID`, which stays as it is.

## Acceptance criteria
- With `GA_MEASUREMENT_ID` unset: no request to any Google analytics host on any page, the CSP
  header is unchanged, public-config has `analytics.gaMeasurementId: ""`, and the existing suites pass.
- With a valid id: GA4 Realtime shows a page view for the login page and one for each route
  change; no path or location in GA contains a query string or token.
- With `CSP_MODE=enforce` and a valid id: no CSP violation reports from GA.
- With an invalid id: the server starts, logs one warning, and behaves as unset.
- With the script blocked by an ad blocker: the app works and our code logs no errors.
- `npm run env:doc:check`, `npm run i18n:check` and `npm run style:check` pass (no UI strings or colours are added).
