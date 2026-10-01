# Installable app shell — Test Cases

**Feature:** task 046 A5 / C2 — the web app installs and its shell opens offline (replaces the SEC-03 worker withdrawn in June 2026)
**Files:** `frontend/public/manifest.webmanifest`, `frontend/src/serviceWorker/` (`rules.js`, `worker.js`, `registration.js`), `frontend/shellWorkerPlugin.js`, `Config/appShellWorker.js`
**Note:** needs a production build (`cd frontend && npm run build`) served by the backend; the dev server has no worker. Unit and server tests cover the route table and the worker's logic; `e2e/specs/app-shell.spec.js` covers PWA-04 and PWA-05 in Chromium. The rest is by hand.
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| PWA-01 | Manifest valid | Built app | DevTools → Application → Manifest | Name, colours, four icons (192 and 512, plain and maskable), standalone; no errors or warnings | | ⬜ |
| PWA-02 | Worker registers | Built app on https or localhost | DevTools → Application → Service Workers | `sw.js` activated and running, scope `/`; Cache Storage has one `ah-shell-<version>` | | ⬜ |
| PWA-03 | Install | Chrome or Edge, signed in | Profile menu → Install app | The browser's install dialog opens; the app launches standalone; the entry is gone afterwards and in the installed window. No install pop-up appeared on load | | ⬜ |
| PWA-04 | Offline, signed out | App loaded once, signed out | Airplane mode (or DevTools → Network → Offline), reopen | Sign-in page with "You're offline. Sign in when your connection is back." | | ⬜ |
| PWA-05 | Offline, signed in | App loaded once, signed in | Go offline, reopen | "You're offline" card under the offline banner, not a blank page or an endless spinner; back online it reloads by itself into the app | | ⬜ |
| PWA-06 | Nothing private held | Signed in, used the app | DevTools → Application → Cache Storage, open each cache | Only `/index.html`, the manifest, `/js`, `/css`, `/fonts`, `/icons` and `/img` entries; no `/api`, `/share`, `/form`, `/socket.io`, storage or download entry | | ⬜ |
| PWA-07 | Sign-out and workspace switch | Signed in, `ah-runtime-v1` present | Sign out; sign in; switch workspace | `ah-runtime-v1` is gone each time; `ah-shell-<version>` stays | | ⬜ |
| PWA-08 | New build, open tab | Tab open on build A; deploy build B | Look at the tab again after an hour, or DevTools → Service Workers → Update | "A new version is ready." with Reload and Later; nothing reloads until Reload; Reload lands on build B | | ⬜ |
| PWA-09 | New build, fresh load | Build B deployed, no tab open | Open the app | Build B loads with no notice; a moment later only build B's cache remains | | ⬜ |
| PWA-10 | Public pages untouched | A share link and a public form link | Open each with DevTools → Network | No request is marked "(ServiceWorker)"; reloading offline shows the browser's offline page, not the app | | ⬜ |
| PWA-11 | Withdrawal | `APP_SHELL_WORKER=off`, server restarted | Load the app twice | No worker under Service Workers, Cache Storage empty, app works; unset and reload → worker back | | ⬜ |
| PWA-12 | Push still arrives | Firebase configured, notifications granted | Send a notification with the tab closed | Notification arrives; Service Workers shows the push worker under `/firebase-cloud-messaging-push-scope` and `sw.js` under `/` | | ⬜ |
| PWA-13 | Desktop app | Time-tracker desktop app | Start it and track time | Unchanged; it loads its own bundled pages and registers no worker | | ⬜ |
| PWA-14 | Dev server | `npm run serve` in `frontend/` | Open the dev server, edit a file | No worker registered; hot reload works with no reload loop | | ⬜ |

**Total:** 14 cases.
