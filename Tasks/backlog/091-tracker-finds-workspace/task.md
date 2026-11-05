---
id: 091
title: Tracker sign-in finds the workspace — one Sign in button, no address typing for hosted users
status: backlog
priority: high
depends_on: []
created: 2026-11-05
---

# 091 — Tracker sign-in finds the workspace (PRD)

## Goal

A person who installs AlianHub Tracker clicks **Sign in** and lands in their workspace without typing an address.
The browser works out which workspace they use, the workspace itself signs them in, and the tracker comes back
connected. Only when no workspace can be found does the tracker (or the finder page) ask for an address, and a
typed custom or self-hosted address goes through the same sign-in.

The address is found centrally; the **sign-in never is**. No alianhub.com service ever sees, stores or relays a
workspace session or token.

## How it works today (investigation)

- **Connect** (`time-tracker-app/renderer/components/Connect/Connect.jsx`): the person types `acme` (becomes
  `https://acme.alianhub.com`) or a full address; `normaliseWorkspaceAddress` allows https only, http for local hosts.
  The tracker calls `GET <ws>/api/v2/tracker/handshake` (`Modules/DesktopTracker/handshake.js`: app, version, name,
  logoUrl, tracker.enabled, tracker.minVersion, managed).
- **"Open in tracker"** (`frontend/src/views/Settings/TimeTracking/DesktopAppCard.vue` → `openTrackerConnect(window.location.origin)`)
  opens `alianhub-tracker://connect?url=<origin>`; main (`main/background.js` `handleDeepLink`) forwards it to the
  window, which opens Connect with the address filled in.
- **Sign-in** (`renderer/components/Login/Login.jsx`): the tracker asks main for a PKCE pair (`tracker:pkce`), keeps the
  verifier **in window memory**, and opens `<ws>/#/oauth2?code_challenge=…&scheme=alianhub-tracker`.
  `frontend/src/views/Authentication/TrackerLogin/TrackerLogin.vue` issues a one-time code on a click
  (`POST /api/v2/auth/tracker-code`, needs the browser's session) and opens
  `alianhub-tracker://authorize?client_id=<uid>&code=<code>`. The tracker redeems it at
  `POST /api/v1/auth/loginAuthTracker` with the verifier (`Modules/Auth/controller/loginSession.js`).
- **The web session is host-only**: `res.cookie('accessToken'|'refreshToken', …, { domain: req.hostname, sameSite: 'Strict' })`
  in production. No other `*.alianhub.com` host can read it, so a central page **cannot** detect a sign-in by itself.
- **Switching workspace reloads the tracker window** (`controller/workspace/workspace.js` `moveTo`), so an in-memory
  verifier does not survive a sign-in that only learns its workspace when the code comes back.
- Customer portal (alianhub-cloud `portal/`) is served at `account.alianhub.com`; its owners and admins have portal
  accounts that know their instances' subdomains. Workspace members do not.

## The flow

```
Tracker (no workspace yet): [Sign in]
  │ main makes PKCE {verifier, challenge} + state, keeps them (survive reloads, expire in 10 min)
  │ opens https://<finder>/tracker?code_challenge=…&state=…&v=<tracker version>
  ▼
Finder page (alianhub-cloud, private repo)
  ├─ dedicated app at login.alianhub.com; reads the ah_ws hint cookie (.alianhub.com)
  ├─ 1 workspace  → "Continue to abb.alianhub.com"   [Continue]  [Use another workspace]
  ├─ several      → pick one from the list
  └─ none / other → "Enter your workspace" (abb · pm.abb.com · hub.example.com)
  │ checks the chosen address answers the handshake
  ▼ redirect (top-level navigation; passes code_challenge, state, scheme through, stores nothing)
https://abb.alianhub.com/#/oauth2?code_challenge=…&state=…&scheme=alianhub-tracker
  │ not signed in → normal web login, then back to this page
  │ signed in → [Open AlianHub Tracker]   (existing page; code issued on the click)
  ▼
alianhub-tracker://authorize?client_id=<uid>&code=<code>&state=<state>&workspace=https://abb.alianhub.com
  ▼
Tracker main: state matches a pending sign-in → hands {code, workspace, verifier} to the window once
Tracker window: normalise workspace → handshake ok (enabled, version) → redeem code at <workspace> →
  add workspace + store its session → switch to it → /home
```

Fallback for a workspace whose server is too old to echo `state`/`workspace` (handshake `version` below the release
that ships this task): the finder opens `alianhub-tracker://connect?url=<ws>` instead, and the tracker runs today's
per-workspace sign-in (one extra browser hop).

## Scope

**A. AlianHub web + server (this repo)**
1. **Workspace hint cookie.** On a successful web sign-in (password, SSO, OAuth, demo, 2FA finish) a **managed**
   instance whose host ends in the hint domain sets `ah_ws` on that parent domain: comma-separated subdomain labels,
   newest first, at most 5, `HttpOnly; Secure; SameSite=Lax; Max-Age=400 days`. Label only — never a user id, email
   or token. Sign-out removes this workspace's label. Driven by `WORKSPACE_HINT_DOMAIN` (empty = off; managed stacks
   set `alianhub.com`); self-hosted and custom-domain hosts never set it. Documented in `.env.example` / env doc.
2. **Sign-in page echoes the round trip.** `TrackerLogin.vue` passes `state` (validated: 16–128 url-safe chars)
   through unchanged and adds `workspace=<this workspace's canonical address>` to the `authorize` link. Canonical =
   the server's `WEBURL` when set, else `window.location.origin`. An old tracker ignores both extra params.
3. **Handshake** gains `url` (the canonical address) so the tracker and finder can compare what they were given with
   what the workspace calls itself. Additive; `minVersion` unchanged.

**B. Tracker (this repo, `time-tracker-app/`)**
4. **Pending sign-in in main.** `tracker:pkce` becomes `tracker:begin-sign-in` → `{ challenge, state }`; main keeps
   `{ verifier, state, workspace|null, createdAt }` for 10 minutes, one at a time (a new Sign in replaces the old).
   `authorize` links are matched on `state`; a link with an unknown or expired state is dropped (today's "a link
   nobody asked for" rule, now surviving reloads). Links without `state` still work for a sign-in started against a
   known workspace, so old servers keep signing in.
5. **Sign in without a workspace.** When no workspace is saved, Connect shows **Sign in with your browser** as the
   primary button and the address field as the secondary path. It opens the finder with `code_challenge`, `state`, `v`.
6. **Callback.** The window takes `{ code, workspace, verifier }` from main, normalises `workspace` (https rule),
   runs the handshake, shows "Connecting to Alian Hub · abb.alianhub.com…", redeems the code against that address,
   then adds the workspace and stores its session before switching (so the reload does not lose it). Handshake
   `disabled` / `tooOld` show today's Connect messages.
7. **Finder address is a build setting**: `NEXT_PUBLIC_WORKSPACE_FINDER_URL`, default the hosted finder; empty in a
   self-hosted build turns the button off (Connect behaves as today). A build with `APIURL` pre-filled skips it.
8. **Today's dev fixes ship first** (separate PR): `nextron.config.js` (`sourceType: 'unambiguous'`, the main process
   crashed on start) and `did-start-navigation` for the connect-link ready flag.

**C. Finder (alianhub-cloud, private repo — its own task.md in `docs/tasks/tracker-workspace-finder/`)**
9. `GET /tracker` page: validates `code_challenge` (43–128 url-safe), `state`, `v`; reads `ah_ws`; shows Continue /
   pick list / address box. (Portal-account instances are left out: the finder has no portal session or database.)
10. Address box: same normalisation as the tracker (`acme` → `acme.alianhub.com`, https only); server-side handshake
    check of the chosen address with a short timeout and an SSRF guard (public addresses only, no redirects followed
    to private ranges); clear messages for unreachable / not AlianHub / tracker not in plan.
11. Redirect builds `<ws>/#/oauth2?code_challenge&state&scheme=alianhub-tracker`, or the `connect` fallback for old
    servers. **Never auto-redirects** to an address that came from the URL rather than the hint or the person; a
    `?workspace=` hint only pre-fills the box.
12. No storage, no logging of `code_challenge`/`state`; rate-limited per IP; `Cache-Control: no-store`;
    `Referrer-Policy: no-referrer`; CSP with no third-party scripts.
13. **A dedicated app, built only for this**, at its own host `login.alianhub.com`: a new `finder/` package in
    alianhub-cloud with its own small server, deploy and health check. It shares no code path, database or session
    with the portal, back office or control plane, so a fault or compromise there cannot reach it and it cannot
    reach them. It has no database at all; everything it knows comes from the request (`ah_ws`, query, the typed
    address) and the handshake probe.

## Out of scope

- Email lookup ("enter your email, we find your workspace") — needs a directory across instances' separate databases.
- Moving a saved workspace when a custom domain becomes primary (handshake `url` makes it possible; separate task).
- Hint for custom-domain or self-hosted workspaces (a browser cannot set an `.alianhub.com` cookie from them; they
  use the address box).
- Mobile apps, the web app's own login page, and SSO configuration.
- Changing `loginAuthTracker`, the one-time code, or PKCE itself.

## Acceptance criteria

- [ ] Fresh tracker, browser signed in to `abb.alianhub.com` (staging equivalent): **Sign in** → finder shows
      "Continue to abb…" → one click on the workspace page → tracker on `/home` for abb, nothing typed.
- [ ] Browser used two hosted workspaces: the finder lists both, newest first; the choice is the one connected.
- [ ] No hint and no portal session: the finder asks for an address; `abb` and `https://pm.abb.com` (custom domain)
      and a self-hosted https address all finish sign-in and connect.
- [ ] Browser not signed in to the chosen workspace: its login page appears, and after login the flow continues to the
      tracker without starting over.
- [ ] An `authorize` link with a wrong, missing-when-required, reused or >10-minute-old `state` is ignored; a crafted
      `alianhub-tracker://authorize?workspace=https://evil.example&code=x&state=guess` changes nothing.
- [ ] `workspace=http://…` (non-local) in a callback is refused; a workspace whose handshake says tracker disabled or
      too old shows the existing Connect messages and saves nothing.
- [ ] `ah_ws` holds labels only, is HttpOnly/Secure/Lax on the hint domain, is set only by managed instances on that
      domain, and loses this workspace's label on sign-out. Unit tests cover set/merge/cap/remove/off.
- [ ] Old tracker (6.0) against the new server and new tracker against an old server both still sign in
      (old server path: finder uses the `connect` fallback).
- [ ] Self-hosted build with `NEXT_PUBLIC_WORKSPACE_FINDER_URL=""` shows today's Connect screen unchanged.
- [ ] Finder page: no third-party requests, `no-store`, `no-referrer`; handshake probe refuses private/loopback
      addresses in production; rate limit answers 429.
- [ ] Tracker main process starts in dev and in a packaged build (the `nextron.config.js` fix), on Windows, macOS, Linux.
- [ ] i18n: every new web string in `en.js` + backfill; style check passes; `npm run i18n:check`, `style:check`,
      `api:doc:check` (in the docs PR) green.

## Constraints & notes

- **Security model:** the finder only routes. PKCE binds the code to the tracker that started the flow; `state` binds
  the callback (and its `workspace`) to that same start. The tracker must handshake the callback's workspace and
  redeem there — never trust `workspace` without both checks.
- **Privacy:** `ah_ws` reveals which hosted workspaces a browser used to any `*.alianhub.com` host. Acceptable because
  every such host is AlianHub-operated code; labels only, capped, removable on sign-out. Note it in the privacy docs.
- **Open-source boundary:** this repo learns only an optional finder URL and a cookie name/domain setting. Nothing in
  it depends on the finder existing.
- **Order of release:** server (A) can ship any time (additive). Finder (C) needs A on the instances it redirects to,
  else uses the fallback. Tracker (B) ships last on the beta channel, then stable.
- Rule 3/5 apply to `TrackerLogin.vue` and any web text; the tracker renderer is outside the i18n/style checks.

## Open questions (owner)

1. ~~Finder host~~ — decided 2026-11-05: a dedicated app built only for this, at `login.alianhub.com`.
2. ~~Portal-account instances~~ — dropped with 1: the dedicated finder has no portal session.
3. Hint lifetime: 400 days (browser max) or shorter?

## Resources

- none yet
