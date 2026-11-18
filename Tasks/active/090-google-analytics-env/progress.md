# 090 — progress

## Checklist
- [x] `Config/googleAnalytics.js`: validate `GA_MEASUREMENT_ID`, warn once on a bad value
- [x] CSP adds the GA hosts only when the id is valid (`Config/contentSecurityPolicy.js`)
- [x] `analytics.gaMeasurementId` in `/api/v2/instance/public-config`
- [x] `frontend/src/utils/analytics.js`, started from `applyPublicConfig`, page views from `router.afterEach`
- [x] Skipped in the Electron desktop app
- [x] Env meta entry (`managed: fixed`), `.env.example`, `docs/ENV.md`, docs-site env reference
- [x] Tests: `tests/google-analytics.test.js`, `frontend/tests/unit/googleAnalytics.spec.js`
- [ ] GA4 Realtime check with a real measurement id on an internal domain (owner)

## Log
- 2026-11-05 — Built on `feat/google-analytics-env` from `origin/staging`. Backend GA, CSP, CSP-summary and
  SSO public-config suites pass (116 tests); 40 frontend specs that load the router or public config pass
  (`appWithoutWorkspace` timed out once under load and passes alone). `env:doc:check`, `i18n:check`,
  `style:check` and ESLint are clean.
- 2026-11-05 — Browser check without a database: the real `analytics.js` bundled into a scratch page behind
  the real CSP middleware in enforce mode with a test id. gtag.js loaded, two `page_view` hits reached
  `www.google-analytics.com/g/collect` with `dl` set to the bare path (no `code=` or `token` from the address
  bar), no console errors. With no id: no `dataLayer`, no request to Google.

## Last step
Code complete and committed; waiting for a real GA4 id on an internal domain to confirm Realtime.
