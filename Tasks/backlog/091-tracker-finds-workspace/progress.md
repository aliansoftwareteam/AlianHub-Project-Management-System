# Progress: 091 — Tracker sign-in finds the workspace

## Checklist

Execution plan: five PRs, in this order. Each is independently safe to merge; the feature turns on only when the
tracker release (PR 4) reaches people.

### PR 0 — `fix(tracker): start the main process and deliver connect links` → `staging`
- [x] `time-tracker-app/nextron.config.js`: babel `sourceType: 'unambiguous'` (main crashed: "ES Modules may not
      assign module.exports" from `main/helpers/workspaceState.js`). Found and fixed 2026-11-05, uncommitted.
- [x] `main/background.js`: reset the renderer-ready flag on main-frame `did-start-navigation`, not
      `did-start-loading` (a second "Open in tracker" link stayed queued). Fixed 2026-11-05, uncommitted.
- [ ] Check a packaged Windows build starts (`npm run build`), since the crash applies there too.
- [x] Rename branch to `fix/tracker-main-start`, rebuild on `origin/staging`, open PR.

### PR 1 — `feat(auth): workspace hint and tracker sign-in round trip` (AlianHub server + web) → `staging`
- [x] Read how the `#/oauth2` route handles a signed-out visitor (`frontend/src/router/auth/index.js`): the query
      (`code_challenge`, `state`, `scheme`) must survive the login redirect. Fix if it does not.
- [x] `Modules/Auth/helpers/workspaceHint.js` (pure): parse / merge (newest first, dedupe, cap 5) / remove a label;
      `hintFor(hostname, env)` → label or null (managed + host ends in `.${WORKSPACE_HINT_DOMAIN}`, one label deep).
- [x] Call it from `finalizeSession` (every sign-in path ends there; confirm 2FA validate and SSO do) and from
      sign-out (`loginSession.js` ~264).
- [x] `WORKSPACE_HINT_DOMAIN` in `.env.example`, `scripts/env-doc.meta.json`; managed stack template sets
      `alianhub.com` (`deploy/managed/`).
- [x] Handshake: add `url` (canonical: `WEBURL` without trailing slash, else request origin). Update
      `tests/` handshake test and `scripts/api-doc.meta.json` description.
- [x] `TrackerLogin.vue`: validate and pass `state`, add `workspace=` to the `authorize` link. Unit spec for the
      link builder (move it to `frontend/src/utils/trackerDeepLink.js` beside `buildTrackerConnectLink`).
- [x] Tests: `tests/workspace-hint.test.js` (set/merge/cap/remove/off/custom domain/self-hosted),
      handshake `url`, cookie flags on a managed login (integration).
- [x] `npm run i18n:check`, `npm run style:check`, backend + frontend tests for touched files.

### PR 2 — finder page (alianhub-cloud) → `main` of alianhub-cloud
- [x] Host decided: a dedicated app built only for this, at `login.alianhub.com` (owner, 2026-11-05).
- [ ] Owner answers Open question 3 (hint lifetime).
- [x] Write `docs/tasks/tracker-workspace-finder/task.md` + `progress.md` in alianhub-cloud (cloud tasks live there).
- [x] New package `finder/` in alianhub-cloud: own `package.json`, a small Node server, no database, no shared
      session or code path with `server/`, `portal/`, `ops/`; `GET /health`.
- [x] `GET /tracker` (+ `POST /tracker/check` for the address box): param validation, `ah_ws` read, handshake probe
      with timeout + SSRF guard (resolve, refuse private/loopback/link-local in production, no redirects),
      per-IP rate limit, `no-store`, `no-referrer`, strict CSP.
- [x] Server-rendered page with one small script (no SPA framework needed): Continue / list / address box, error
      states, "Open in tracker" fallback for servers below the release in PR 1 (`alianhub-tracker://connect?url=`).
      AlianHub look via the same tokens as the portal, copied, not imported.
- [x] Tests: validation, hint parsing, SSRF refusals, fallback choice by version, redirect URL building (no
      auto-redirect from a URL-supplied address).
- [ ] Deploy: its own container/service, DNS `login.alianhub.com`, TLS cert, uptime check.

### PR 3 — `docs: 090 progress, beta log, api doc` → `staging`
- [ ] After PR 0 and PR 1 merge: `npm run version:log`, `npm run api:doc` (handshake changed), commit
      `docs/BETA-LOG.md`, `docs/API.md`, `docs/api/openapi.json`, tick this file.

### PR 4 — `feat(tracker): sign in without typing the workspace` (tracker) → `staging`
- [x] Main: replace `tracker:pkce` with `tracker:begin-sign-in` (`{ workspace|null }` → `{ challenge, state }`);
      pending store in `main/helpers/pendingSignIn.js` (pure, CommonJS, jest-tested): one entry, 10-min expiry,
      take-once by `state`; legacy links without `state` match only a pending sign-in that has a workspace.
- [x] Main: `authorize` links go through the store; the window gets `{ code, userId, workspace, verifier }` once.
- [x] Renderer `Login.jsx`: stop holding the verifier; consume the main-process payload.
- [x] Renderer: `controller/workspace/signInWithFinder.js` — handshake the callback workspace, redeem at that
      address, store session under it (`utils/workspaceSession`), `workspace:add`, then switch.
- [x] Connect screen: primary **Sign in with your browser** when the finder URL is set; address field stays.
- [x] `NEXT_PUBLIC_WORKSPACE_FINDER_URL` default + README "How it connects" section updated.
- [x] Tests (repository jest): pendingSignIn (match, expiry, reuse, wrong state, legacy), callback workspace
      normalisation (http refused), deepLink parsing of `state`/`workspace`.
- [ ] Tag `tracker-v6.1.0-beta.1` → beta channel.

### Verification (after PR 1 is on staging, PR 2 deployed, PR 4 beta installed)
- [ ] Run every acceptance criterion in `task.md` on Windows; spot-check macOS and Ubuntu (deep link + sign-in).
- [ ] Old tracker 6.0 ↔ new server, new tracker ↔ old server (fallback path).
- [ ] Promote tracker to stable; close the task.

## Last step

2026-11-05: PR 0, 1 and 4 committed on local branch `feat/tracker-finds-workspace` (from `origin/staging`);
PR 2 committed on alianhub-cloud local branch `feat/tracker-workspace-finder`. Nothing pushed (owner's
rule: no push without approval). Windows end-to-end: tracker half verified, browser click-through next.

## Blockers

- Open question 3 in `task.md` (hint lifetime) blocks PR 1's cookie Max-Age only; 400 days is the default.

## Log

### 2026-11-05
- Task created from the owner's idea: tracker Sign in opens a central web page that finds the browser's workspace,
  then the workspace signs the person in; typing an address is the fallback.
- Decided: the central page finds the address only and never relays a session (web sessions are host-only cookies,
  `SameSite=Strict`, so it could not read them anyway; relaying tokens would make one service able to sign in to
  every workspace). PKCE stays the binding; `state` added so a callback's `workspace` is trusted only for a sign-in
  this tracker started.
- Decided: the verifier moves from window memory to the main process, because the workspace is learned at the
  callback and switching to it reloads the window.
- Found while testing "Open in tracker" locally (`:4100` + dev tracker): the two PR 0 bugs above, and that the dev
  window's origin `http://localhost:8888` needs `CORS_ORIGINS` on a local server (a packaged tracker is `app://`).
- Owner: the finder is something built only for this. Decided: a dedicated `finder/` app in alianhub-cloud at
  `login.alianhub.com`, with no database and nothing shared with the portal, back office or control plane. The
  portal-account instance list is dropped with it (the finder has no portal session).
- Built PR 0, 1, 4 here and PR 2 in alianhub-cloud (`F:/Projects/alianhub-cloud-wt/tracker-finder`). Commit
  shape differs from the plan in two places: the "Open in tracker" branch work is one branch with one commit
  per PR, to be split on push; the hint is set in `finalizeSession` and `finalizeSsoSession`, which every
  sign-in path ends in.
- Not done: the packaged-build start check (PR 0), integration test of the cookie flags on a real login
  (covered by unit tests of the helper), the managed stack setting `WORKSPACE_HINT_DOMAIN` (the control
  plane writes instance env, so it belongs to the cloud deploy), macOS/Linux (owner: Windows first).
- Windows local check (`abb.alianhub.localhost:4200` hosted mode from this branch, finder on
  `login.alianhub.localhost:4400`, dev tracker): finder check by label and by full address answer the
  workspace's `#/oauth2` URL; an `authorize` link with a wrong state is ignored; with the right state the
  tracker handshakes abb, saves and switches to it, and redeems there once (a fake code got 400).
- Found: on a managed instance the handshake's `tracker.enabled` reads the company `planFeature`, while
  sign-in is gated by the signed entitlements (`tracker_disabled`, 403). They disagreed on the local test
  instance, so the finder said yes and the sign-in said no. Pre-existing; follow-up: the handshake should
  read the entitlements in managed mode.
- Found: a stale `renderer/.next` cache kept the dev window on "Loading…" with no error after the
  renderer changed; deleting it fixed it (dev only).
