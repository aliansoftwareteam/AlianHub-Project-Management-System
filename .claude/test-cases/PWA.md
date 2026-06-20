# Installable PWA — Test Cases

**Feature:** SEC-03 — installable Progressive Web App (interim before native apps)
**Files:** `frontend/public/manifest.webmanifest`, `frontend/public/service-worker.js`, `frontend/public/index.html`
**Note:** browser/runtime-verified (not in the Node suite). Served as static files at `/manifest.webmanifest` + `/service-worker.js` (scope `/`).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| PWA-01 | Manifest valid | Built app | DevTools → Application → Manifest | Name/short_name/theme/icons/standalone load with no errors | | ⬜ |
| PWA-02 | Service worker registers | Built app over HTTPS (or localhost) | DevTools → Application → Service Workers | `service-worker.js` is activated + running | | ⬜ |
| PWA-03 | Installable | Chrome/Edge desktop or Android | Use the install / "Add to Home Screen" prompt | App installs + launches standalone (no browser chrome) | | ⬜ |
| PWA-04 | Offline shell | App loaded once, then go offline | Reload / navigate | The cached app shell loads (no dino); API calls fail gracefully (not cached) | | ⬜ |
| PWA-05 | API never cached | — | Inspect SW cache | No `/api/*` or `/socket*` responses cached; only shell + static assets | | ⬜ |
| PWA-06 | Update after deploy | New build deployed | Reload twice | Online navigations fetch fresh (network-first); old cache purged on the new SW activating | | ⬜ |
| PWA-07 | Mobile usability | Phone | Open core flows (projects, tasks, timesheet) | Usable on a phone screen (viewport-fit=cover; responsive) | | ⬜ |

**Total:** 7 cases (browser/device). Native iOS/Android apps + a deeper per-view mobile UX pass remain follow-ups.
