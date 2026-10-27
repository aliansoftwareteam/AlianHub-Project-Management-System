# Progress: Time tracker add-on — one signed build that connects to any workspace

## Checklist

- [x] T1 — Workspace address replaces the build-time `APIURL`
- [x] T2 — `GET /api/v2/tracker/handshake`
- [x] T3 — `alianhub-tracker://connect` deep link and "Open in tracker"
- [ ] T4 — Packaging, code signing, notarisation, auto-update, release CI
  - [x] appId `com.alianhub.tracker`, product "AlianHub Tracker", executable `alianhub-tracker`, version 6.0.0
  - [x] `alianhub-tracker://` registered on Windows, macOS (`CFBundleURLTypes` from `protocols`) and Linux (`.desktop` `MimeType`)
  - [x] `electron-updater` on a generic feed, `https://downloads.alianhub.com/tracker/<channel>/`, channels stable and beta
  - [x] `.github/workflows/tracker-release.yml` on `tracker-v*` tags
  - [ ] Certificates and accounts: Apple Developer ID + notarisation, Windows signing certificate, GPG key, downloads bucket — not bought or set up yet, so none of the workflow's secrets exist
  - [ ] Proper icons — the build still uses `resources/logo.png`; needs artwork (`.ico`, `.icns`, Linux sizes)
- [x] T5 — Several workspaces in one tracker
- [x] T6 — Desktop app card in the web app
- [x] T7 — Screenshot storage shown and counted (shown on the card; counting uploads against the storage limit is 064 T3)
- [ ] T8 — Tests and release checklist
  - [x] Tracker unit tests (root jest): address, handshake outcomes, per-request base URL, switch stops the timer, workspace list, deep links, upgrade, update channel
  - [x] Server jest: handshake in managed and self-hosted modes, add-on off, card endpoint, update feed
  - [x] Web app vitest: Desktop app card, sign-in return scheme, connect link
  - [ ] Manual release checklist (`time-tracker-app/README.md`) — written, not run: it needs signed builds

## Last step

Built and committed T1–T3, T5–T7, the T4 configuration and workflow, and the automated T8 tests on
`feat/tracker-any-workspace`. Next: buy the certificates, add the workflow secrets, draw the icons, cut
`tracker-v6.0.0-beta.1`, then run the release checklist.

## Blockers

- Apple Developer account, a Windows signing certificate, a GPG key and the downloads bucket (070) —
  the release workflow refuses an unsigned stable build and keeps files on the run without a bucket.
- Sign-in refusal for a workspace without the add-on is 064 T5; until it lands only the handshake says no.

## Notes for other tasks

- **Handshake** (public): `GET /api/v2/tracker/handshake` →
  `{ status, statusText, data: { app: 'alianhub', version, name, logoUrl, tracker: { enabled, minVersion }, managed } }`.
  `name` is the brand product name the sign-in page shows (else `APP_NAME`), `logoUrl` the desktop logo
  path. `enabled` is true when any non-disabled company has the tracker, or when there is no company yet.
  Cached 60 s.
- **Card**: `GET /api/v2/tracker/desktop-app` (signed in, company header) →
  `{ enabled, managed, portalUrl, seats: { used, limit }, release: { channel, version, downloads: [{ os, kind, version, url }] }, screenshots: { bytes, retention: { enabled, maxAgeMonths } } }`.
- **064**: the add-on is read from `planFeature` by `trackerAccess()` in `Modules/DesktopTracker/access.js`:
  `trackerTimesheet !== false` means on, `timeTrackerUser` is the seat limit (0 or empty: none). Have
  `applyEntitlements` write `trackerTimesheet = features.timeTracker.enabled` and
  `timeTrackerUser = features.timeTracker.seats`, or change that one function.
- **061**: `isManaged()` in `Modules/DesktopTracker/handshake.js` reads `process.env.HOSTING_MODE === 'managed'`;
  switch it to `Config/hostingMode.js` `isManaged()` at merge. Both branches add `HOSTING_MODE` and
  `PLATFORM_URL` to `scripts/env-doc.meta.json`: keep 061's entries.
- **Deep links**: `alianhub-tracker://connect?url=<encodeURIComponent(workspace origin)>`;
  sign-in returns on `alianhub-tracker://authorize?client_id=&code=` when the tracker asks with
  `&scheme=alianhub-tracker` (the sign-in page allows only `alianhub-tracker` and `myapp`, default `myapp`).
- **Release secrets** (`.github/workflows/tracker-release.yml`): `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`,
  `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`,
  `TRACKER_GPG_PRIVATE_KEY`, `TRACKER_GPG_PASSPHRASE`, `TRACKER_S3_BUCKET`, `TRACKER_S3_ENDPOINT`,
  `TRACKER_S3_REGION`, `TRACKER_S3_ACCESS_KEY_ID`, `TRACKER_S3_SECRET_ACCESS_KEY`.
- **070**: the feed layout is `tracker/stable/` and `tracker/beta/`, each with the installers and
  `latest.yml`, `latest-mac.yml`, `latest-linux.yml` (uploaded last, `Cache-Control: no-cache`).
- **071**: never raise `TRACKER_MIN_VERSION` (default 6.0.0) before the matching tracker is on stable.

## Log

### 2026-10-28
- Built autonomously while the owner was away; decisions below are mine and open to review.
- Server: `Modules/DesktopTracker` (handshake, card endpoint, update-feed reader). The handshake is
  wrapped in the usual `{ status, statusText, data }` shape. Download links are read by the server from
  the feed's `latest*.yml` (15 min cache, 5 min after a miss) rather than by the browser, so the web app
  needs no CSP or CORS change; `TRACKER_UPDATE_URL=off` leaves an offline instance on its own uploaded
  builds (`TIMETRACKER_DOWNLOAD`), which the card falls back to. `latest-linux.yml` names only the
  AppImage, so the `.deb` name is derived from a fixed `artifactName`.
- Screenshot storage: the nightly bucket-size job now also records `trackshotSize` (MB) on the company;
  the card says "counted overnight" until it has run. 063's byte counter can replace it.
- Tracker: version 6.0.0. The build-time `APIURL` only pre-fills the first workspace. Requests take their
  base URL per request. Typed addresses must be https except localhost. On start the tracker re-runs the
  handshake: a plan without the tracker or a too-old tracker sends it to the Connect screen; any other
  failure (offline, an older server without the route) is ignored so it keeps working.
- Several workspaces: switching asks before stopping a running timer, refuses while the offline queue
  holds unsent entries (they replay against the current workspace), keeps each workspace's sign-in
  aside in local storage, and reloads the window.
- Upgrade from tracker 5: on first run the main process reads the old build's baked `APIURL` from its
  installed `app.asar` pages and copies its `Local Storage` and `IndexedDB` into the new profile, so the
  tracker starts signed in on the same server. An address shipped by a build may be plain http.
- `myapp://` stays registered next to `alianhub-tracker://`. The web app's "Start in tracker" still opens
  `myapp://open?…`: switching it now would break every tracker 5 install before tracker 6 is on stable.
  Move it to `alianhub-tracker://` once it is.
- Updates: each build follows the channel of its own version (a pre-release follows beta), checked at
  start and every 6 hours; installs on quit.
- Packaging: the dead `build` block in `package.json` (with a placeholder certificate password) and
  `macOS/Info.plist` (copied to the wrong place) are gone; everything is in `electron-builder.yml`. macOS
  builds a universal dmg and zip with the hardened runtime and notarises with notarytool when the team id
  is set. Windows signs with a pfx (`CSC_LINK`); an EV token or Azure Trusted Signing needs
  electron-builder 25's `azureSignOptions` or a custom sign hook.
- Tests: `tests/desktop-tracker-*.test.js` (root jest, 121 with the existing capture-refusal test),
  `frontend/tests/unit/trackerDesktopAppCard.spec.js` plus the updated sign-in and deep-link specs.
  The tracker compiled with `nextron build --no-pack` after `npm ci` in `time-tracker-app` (not committed).
