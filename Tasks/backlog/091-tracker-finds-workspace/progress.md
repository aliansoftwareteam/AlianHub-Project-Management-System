# Progress: 091 — Tracker sign-in finds the workspace

## Checklist

Execution plan: five PRs, in this order. Each is independently safe to merge; the feature turns on only when the
tracker release (PR 4) reaches people.

### PR 0 — `fix(tracker): start the main process and deliver connect links` → `staging`
- [x] `time-tracker-app/nextron.config.js`: babel `sourceType: 'unambiguous'` (main crashed: "ES Modules may not
      assign module.exports" from `main/helpers/workspaceState.js`). Found and fixed 2026-11-05, uncommitted.
- [x] `main/background.js`: reset the renderer-ready flag on main-frame `did-start-navigation`, not
      `did-start-loading` (a second "Open in tracker" link stayed queued). Fixed 2026-11-05, uncommitted.
- [x] Check a packaged Windows build starts (`npm run build`), since the crash applies there too.
- [x] Rename branch to `fix/tracker-main-start`, rebuild on `origin/staging`, open PR.

### PR 1 — `feat(auth): workspace hint and tracker sign-in round trip` (AlianHub server + web) → `staging`
- [x] Read how the `#/oauth2` route handles a signed-out visitor (`frontend/src/router/auth/index.js`): the query
      (`code_challenge`, `state`, `scheme`) must survive the login redirect. Fix if it does not. (Ticked before it was
      true: it did not survive until 2026-11-25, see Log.)
- [x] `Modules/Auth/helpers/workspaceHint.js` (pure): parse / merge (newest first, dedupe, cap 5) / remove a label;
      `hintFor(hostname, env)` → label or null (managed + host ends in `.${WORKSPACE_HINT_DOMAIN}`, one label deep).
- [x] Call it from `finalizeSession` (every sign-in path ends there; confirm 2FA validate and SSO do) and from
      sign-out (`loginSession.js` ~264).
- [x] `WORKSPACE_HINT_DOMAIN` in `.env.example`, `scripts/env-doc.meta.json`.
- [ ] Hosted instances get `WORKSPACE_HINT_DOMAIN`: the control plane's job since c402d85df, nothing in `deploy/managed/`
      sets it, and alianhub-cloud `main` (b8b29b9) does not either (see Log, 2026-11-25). Until then no hosted workspace
      writes `ah_ws` and the finder always asks for an address.
- [x] Handshake: add `url` (canonical: `WEBURL` without trailing slash, else request origin). Update
      `tests/` handshake test and `scripts/api-doc.meta.json` description (the description on 2026-11-25).
- [x] `TrackerLogin.vue`: validate and pass `state`, add `workspace=` to the `authorize` link. Unit spec for the
      link builder (move it to `frontend/src/utils/trackerDeepLink.js` beside `buildTrackerConnectLink`).
- [x] Tests: `tests/workspace-hint.test.js` (set/merge/cap/remove/off/custom domain/self-hosted),
      handshake `url`, cookie flags on a managed login (integration:
      `tests/integration/workspace-hint-cookie.int.test.js`, 2026-11-25).
- [x] Privacy note for `ah_ws`: `docs-site/user-guide/time-tracker-app.md` and `docs-site/admin/security.md`.
- [x] `npm run i18n:check`, `npm run style:check`, backend + frontend tests for touched files.

### PR 2 — finder page (alianhub-cloud) → `main` of alianhub-cloud
- [x] Host decided: a dedicated app built only for this, at `auth.alianhub.com` (owner, 2026-11-05).
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
- [x] Deploy: its own service, DNS `auth.alianhub.com`, TLS cert (`/health` and `/tracker` answered over https,
      2026-11-25).
- [ ] Uptime check on `auth.alianhub.com` (none found or confirmed).

### PR 3 — `docs: 091 progress, beta log, api doc` → `staging`
- [x] After PR 0 and PR 1 merge: `npm run version:log`, `npm run api:doc` (handshake changed), commit
      `docs/BETA-LOG.md`, `docs/API.md`, `docs/api/openapi.json`, tick this file (73b45a55b, d79b6f244).
- [ ] The same for the branch of 2026-11-25: the handshake's `url` reaches `docs/API.md` and `openapi.json` only then.

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
- [x] Tag `tracker-v6.1.0-beta.2` → beta channel (`6.1.0-beta.1`'s release build failed, see Log; never published).

### Verification (after PR 1 is on staging, PR 2 deployed, PR 4 beta installed)
- [ ] Run every acceptance criterion in `task.md` on Windows; spot-check macOS and Ubuntu (deep link + sign-in).
      Per criterion, see Log 2026-11-25: checked locally up to the installed app; not against a hosted workspace.
- [ ] Old tracker 6.0 ↔ new server, new tracker ↔ old server (fallback path). Covered by tests on both sides, not run
      with two real versions.
- [x] Promote tracker to stable: tag `tracker-v6.1.0` (ef98c8cb6), release run 43888831081 green, and
      `latest.yml`, `latest-mac.yml` and `latest-linux.yml` under `downloads.alianhub.com/tracker/stable/` all say 6.1.0
      with the installers answering 200 (2026-11-25). The release run says macOS was built unsigned.
- [ ] Close the task.

## Last step

2026-11-25: gaps closed on local branch `claude/tracker-091-finish-9251c7` (from `origin/staging` 41893e722), not
pushed: the cookie's integration test, the sign-in return path fix, the handshake's `url` in the API meta, the privacy
note. Everything before it is merged (#1774, #1776, #1778, alianhub-cloud PR 60) and tracker 6.1.0 is on stable.

## Blockers

- Open question 3 in `task.md` (hint lifetime): 400 days until the owner decides; the privacy note says 400 days.
- Hosted instances need `WORKSPACE_HINT_DOMAIN` from the control plane (alianhub-cloud change, owner's go-ahead).

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
  `auth.alianhub.com`, with no database and nothing shared with the portal, back office or control plane. The
  portal-account instance list is dropped with it (the finder has no portal session).
- Built PR 0, 1, 4 here and PR 2 in alianhub-cloud (`F:/Projects/alianhub-cloud-wt/tracker-finder`). Commit
  shape differs from the plan in two places: the "Open in tracker" branch work is one branch with one commit
  per PR, to be split on push; the hint is set in `finalizeSession` and `finalizeSsoSession`, which every
  sign-in path ends in.
- Not done: the packaged-build start check (PR 0), integration test of the cookie flags on a real login
  (covered by unit tests of the helper), the managed stack setting `WORKSPACE_HINT_DOMAIN` (the control
  plane writes instance env, so it belongs to the cloud deploy), macOS/Linux (owner: Windows first).
- Windows local check (`abb.alianhub.localhost:4200` hosted mode from this branch, finder on
  `auth.alianhub.localhost:4400`, dev tracker): finder check by label and by full address answer the
  workspace's `#/oauth2` URL; an `authorize` link with a wrong state is ignored; with the right state the
  tracker handshakes abb, saves and switches to it, and redeems there once (a fake code got 400).
- Found: on a managed instance the handshake's `tracker.enabled` reads the company `planFeature`, while
  sign-in is gated by the signed entitlements (`tracker_disabled`, 403). They disagreed on the local test
  instance, so the finder said yes and the sign-in said no. Pre-existing; follow-up: the handshake should
  read the entitlements in managed mode.
- Found: a stale `renderer/.next` cache kept the dev window on "Loading…" with no error after the
  renderer changed; deleting it fixed it (dev only).
- Owner renamed the finder host from `login.alianhub.com` to `auth.alianhub.com`. It is already in the cloud's
  reserved subdomains (`packages/shared/src/subdomain.js`), so no customer can hold it.
- Hosted the finder locally from its production image (`docker build -f finder/Dockerfile`, 290 MB, read-only,
  no capabilities) at `auth.alianhub.localhost:4400`. With production settings it refuses private, loopback and
  metadata addresses and will not start with `FINDER_ALLOW_PRIVATE`. Through the container: the tracker's own
  challenge and state reached abb's `#/oauth2` link unchanged; the return link switched the tracker to abb and
  the code was redeemed there (a fake code gave 400, and the tracker showed abb's sign-in screen).
- Tests 2026-11-05: finder 45, backend tracker/auth/session/handshake 753 (39 suites), frontend sign-in 51,
  all pass. Still open: the browser click-through with a real login, and the second round showing the hint.
- Renumbered 090 → 091 when rebasing on `staging`: 090 went to Optional Google Analytics meanwhile. Commit
  messages from before the rebase still say 090.
- Owner approved pushing and opening the PRs (2026-11-05). Shipped as one AlianHub PR and one alianhub-cloud PR
  rather than the five planned, so the whole flow can be tried on a server together.
- #1774 merged into `staging` as build 14.43.0-beta.6 (counted from v14.42.0 once #1777 back-merged the release). The finder is live at `https://auth.alianhub.com`
  (PM2 `alianhub-finder` on the control-plane host behind nginx, from alianhub-cloud PR 60's branch). Live
  workspaces without #1774 (alian, demo) get the `connect` fallback. A packaged Windows build from this branch
  starts (`dist/AlianHub-Tracker-Setup-6.0.0.exe`), which closes PR 0's packaged-build check.
- Review of the promotion PR #1776 found the tracker sign-in page and "Open in tracker" sending only the origin,
  so a workspace served under a path reached the tracker without it. Fixed in #1778 (build 14.43.0-beta.9) with
  `workspaceAddressOf` in `frontend/src/utils/trackerDeepLink.js`; the same PR keeps workspace and project ids
  out of Google Analytics (#1773).

### 2026-11-14
- Tagged `tracker-v6.1.0-beta.1` to ship the beta release; its CI run failed `Build for win` and `Build for mac`
  with `... not a file`. Cause: GitHub sets an unset secret to an empty string rather than leaving it unset, and
  electron-builder resolves a defined-but-empty `CSC_LINK` as a local path instead of treating it as absent.
  Fixed in PR #1801 (merged to `staging`) by unsetting `CSC_LINK`/`CSC_KEY_PASSWORD` in `tracker-release.yml`
  when empty, before calling electron-builder. `tracker-v6.1.0-beta.1` was left as a failed, unpublished tag
  (no artifacts ever uploaded) rather than moved; `tracker-v6.1.0-beta.2` carries the fix and built clean on
  Windows, macOS and Linux (unsigned, beta channel; no signing secrets configured in this repo yet).
- Not done: installing and running the beta build (Windows/macOS/Ubuntu), the deep-link and auto-update
  checks in the Verification section below, and the `BETA-LOG.md`/`version:log` docs follow-up for this merge.

### 2026-11-25
- Found and fixed: a browser that was not signed in lost the tracker sign-in. The router sends it to
  `/login?redirect_url=/oauth2?code_challenge=…`, and the sign-in page compared `redirect.split("/")[1]`
  (`oauth2?code_challenge=…`) with `oauth2`, so after login it opened Home and the person had to start over. The same
  check was in the Google, GitHub and GitLab buttons, and the last two also dropped the path when the provider sent the
  browser back to the origin. Now one rule in `frontend/src/utils/loginReturn.js`, with
  `loginTrackerRedirect.spec.js` and `oauthTrackerReturn.spec.js`. Trackers already installed need no update.
- Clicked through in Chromium: this branch's server in managed mode with a signed plan, the finder from alianhub-cloud
  `main` (b8b29b9), `*.alianhub.localhost`, a fixture account. Typed `abb` signed out → login page → tracker page →
  `alianhub-tracker://authorize` with the state and workspace; a wrong state and a second use were refused; the
  tracker's own store handed over the verifier and the code redeemed (200). Then one hint → "Continue to abb"; a second
  host → both, newest first; sign-out of one → only the other. The finder made no outside request. Without the fix the
  same run stopped on Home. The web bundle was an older build (2026-11-12) with the one changed expression patched in,
  because this machine had no memory for a full build; the deep link was read from the browser, not opened by the app.
- The handshake and the entitlements agree now: Starter defaults answered `enabled: false` (the finder said "isn't part
  of this workspace's plan") and a pushed plan turned it on within the handshake's minute, so the 2026-11-05 follow-up
  needs nothing.
- Live, read only: the finder's headers (`no-store`, `no-referrer`, nonce CSP with no outside source); `demo` answers a
  handshake with `url`; `alian` is on 14.42.0-beta.1 without it, so it takes the `connect` fallback. Both say
  `managed: false`, so neither will ever set `ah_ws`.
- Control plane: `WORKSPACE_HINT_DOMAIN: adapters.domain()` belongs in the `env` object of `stackFiles`,
  `server/modules/orchestrator/workflows/stack.js` after line 71 (`HOSTING_MODE`), with an expectation beside
  `server/test/workflowEngine.test.js:270`. Running instances get it at their next re-render (upgrade, plan move, domain
  change). Not changed here.
- Tests: the new integration file 8 (each of four deliberate breaks of the code failed it); nine sign-in integration
  files 121; finder 45. `api-doc.test.js` (path separator) and `plain-words` (line endings) fail on this Windows
  checkout with or without the branch.
- Not done: macOS and Ubuntu, the installed app against a hosted workspace, tracker 6.0 with the new server as two real
  versions, 2FA and SSO in a browser.
