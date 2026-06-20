# Offline Mode — Test Cases

**Feature:** SEC-06 — work offline, sync on reconnect (app-level; NO service worker)
**Approach:** After the SEC-03 PWA worker was withdrawn (reload loop), offline mode is implemented purely in the app so it behaves identically on localhost / staging / production and can't cause a worker reload loop.
**Files:** `frontend/src/offline/{offlineRules.js,db.js,index.js}`, `frontend/src/components/offline/OfflineBanner.vue`, integration in `frontend/src/services/index.js`, mount + init in `frontend/src/App.vue`, i18n in `en.js`.
**How it works:** successful whitelisted GETs are cached in IndexedDB (fire-and-forget); on a request that fails because we're offline, whitelisted GETs are served from cache and whitelisted writes are queued; on reconnect (or the next successful request) the queue replays FIFO through the real request path.
**Online safety:** the request layer only calls the offline layer on the success side (non-blocking cache) and the failure path (which already rejected) — online behaviour is unchanged.
**Unit-tested:** `tests/offline-rules.test.js` (whitelists, offline-error detection, synthetic responses) — in the Node suite (31 suites / 356 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| OFF-01 | Online unchanged | Normal use | Use the app online (projects, tasks, comments, time) | Identical to before — no banner, no behaviour change; GET responses get cached in the background | | ⬜ |
| OFF-02 | Offline banner | App loaded, then go offline (DevTools → Network → Offline) | Observe top of app | Amber "You're offline…" banner appears; disappears on reconnect | | ⬜ |
| OFF-03 | View cached data offline | Visited project/task lists while online, then go offline | Navigate back to those project/task views | Last-cached data is shown (not an error/blank) | | ⬜ |
| OFF-04 | Uncached data offline | Offline; open a view never loaded online | Navigate there | Fails gracefully as before (no cache to serve) — app does not crash | | ⬜ |
| OFF-05 | Queue a task edit offline | Offline | Change a task status / field (PATCH /api/v2/tasks or PUT /api/v1/task) | UI accepts it (queued); banner shows "N change(s) waiting to sync" | | ⬜ |
| OFF-06 | Queue a comment offline | Offline | Post a comment | Accepted + queued; counted in pending | | ⬜ |
| OFF-07 | Queue a time log offline | Offline | Log time (POST /api/v2/manualLogtime) | Accepted + queued | | ⬜ |
| OFF-08 | Sync on reconnect | Items queued offline | Go back online | Banner shows "Syncing N…"; queued writes replay FIFO; pending count → 0; server reflects the changes | | ⬜ |
| OFF-09 | Sync without an online event | Online but server was unreachable; items queued | Server recovers; make any successful request | Backlog drains opportunistically (a success proves connectivity) | | ⬜ |
| OFF-10 | Rejected write is dropped | A queued write the server will 4xx (e.g. stale) | Reconnect | That item is dropped (not retried forever); others still sync | | ⬜ |
| OFF-11 | FIFO order | Multiple queued writes to the same task | Reconnect | Replayed in the order they were made; final state matches the last edit | | ⬜ |
| OFF-12 | Logout clears offline data | Queued/cached data exists | Log out, then log in as a different user | No cached data or queued writes from the previous account remain (store cleared on logout) | | ⬜ |
| OFF-13 | Non-whitelisted untouched | — | Offline, trigger a non-whitelisted write (e.g. member/SSO settings) | Not queued — fails as before (only safe, common edits are queued) | | ⬜ |
| OFF-14 | Works everywhere | localhost / staging / production | Repeat OFF-02..08 in each | Same behaviour in all three; no service worker involved; no reload loop | | ⬜ |
| OFF-15 | IndexedDB unavailable | Private mode / blocked storage | Use offline | Fails soft — app still works online; offline features simply no-op | | ⬜ |
| OFF-16 | Rules (unit) | — | `npx jest tests/offline-rules.test.js` | All green — whitelists, offline-error detection, synthetic responses | | ✅ |

**Total:** 16 cases (1 unit-automated, 15 runtime/manual). Scope per AHE-3763 done-when: cached data viewable offline + queued writes sync on reconnect. Cold-starting a brand-new tab with no network (which needs a service-worker shell) is intentionally out of scope — that's what caused the SEC-03 loop; a production-only PWA shell can be added later if wanted.
