---
id: 066
title: Time tracker add-on — one signed build that connects to any workspace
status: active
priority: medium
depends_on: [060, 064]
created: 2026-10-27
---

# Time tracker add-on — one signed build that connects to any workspace

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one (`time-tracker-app/` + web app)

## Goal

Sell the desktop time tracker as an add-on. A customer who buys it downloads **one** tracker
(Windows, macOS, Linux), connects it to `acme.alianhub.com` once — by typing the address or by
clicking "Open in tracker" in their workspace — and their tracked users sign in. A customer without
the add-on cannot connect. Updates reach every customer from one update feed.

The brief describes generating a tracker per customer. This PRD recommends one build instead
(Q11) and keeps the per-customer build as a fallback design at the end.

## Where we start

- `time-tracker-app/` is a Nextron (Electron + Next.js static export) app, version 5.1.6.
- The server address is baked in at build time: `renderer/next.config.js` puts `process.env.APIURL`
  into `publicRuntimeConfig`, read by `utils/services.js` (axios base URL), `Login.jsx` (opens
  `${APIURL}/#/oauth2?code_challenge=…` for the PKCE sign-in), `Header.jsx` (logo) and
  `taskWebLink.js`.
- Packaging is unfinished for a product people pay for: `appId: com.example.nextron`, deep-link
  scheme `myapp://`, `publish: null` (no auto-update), product name "Alian Hub Time Tracker 2.0".
- Server side: tracker sign-in (`/api/v1/auth/loginAuthTracker`, `/api/v2/auth/tracker-code`),
  tracker seats (`Modules/trackerUserPermission`, `planFeature.timeTrackerUser`), downloads list
  (`Modules/trackerDownload`, global `TIMETRACKER_DOWNLOAD` collection), screenshot retention
  (`Modules/ScreenshotRetention`).
- 064 gates tracker sign-in and seats on `features.timeTracker`.

## Why one build, not one per customer

| | One build, workspace address at sign-in | A build per customer |
|---|---|---|
| Release effort | 3 builds per release (one per OS) | 3 × number of customers per release |
| Code signing / notarisation | Once per release | Once per customer per OS per release — Apple notarisation queues and Windows signing certificates make this hours of CI per release at 100 customers |
| Auto-update | One update feed for everyone | A feed per customer |
| Time to deliver after purchase | Instant (download already exists) | Minutes to hours (a build has to run) |
| Customer changes subdomain | Re-connect in the app | New build |
| Gating the add-on | Server refuses sign-in without the add-on (064) | Same — a build alone cannot be trusted to gate |

The per-customer build buys nothing the server check does not already give, and costs a build
pipeline per customer.

## Scope — the work, task by task

### T1 — Workspace address replaces the build-time `APIURL`

- New store `renderer/store/workspace.js` persisted with `electron-store` in the main process:
  `{ workspaces: [{ url, name, logoUrl, lastUsedAt }], current }`.
- `utils/services.js`: axios instances take their `baseURL` from the current workspace at request
  time (interceptor), not from `publicRuntimeConfig`. Same for `Login.jsx`, `Header.jsx`,
  `taskWebLink.js`. `APIURL` at build time becomes only the **default** for self-hosted builds that
  want it pre-filled.
- First run with no workspace → the Connect screen (see "How it looks").
- Validation of a typed address: normalise (`acme` → `https://acme.alianhub.com`; full URLs kept for
  self-hosted), require `https://` except `localhost`, then `GET /api/v2/tracker/handshake`.

### T2 — `GET /api/v2/tracker/handshake` (server, public)

Returns what the tracker needs before sign-in, without leaking anything private:

```json
{ "app": "alianhub", "version": "14.40.0",
  "name": "Acme", "logoUrl": "/api/v1/getLogo?key=logo&type=desktop",
  "tracker": { "enabled": true, "minVersion": "6.0.0" },
  "managed": true }
```

- `tracker.enabled` false (add-on off, 064) → the Connect screen says "Time tracking isn't part of
  this workspace's plan. Ask your admin to add it." and does not proceed.
- `minVersion` lets the server refuse trackers too old for its API, with an update prompt.
- Self-hosted instances answer `enabled: true` unless their own `planFeature` says otherwise.

### T3 — "Open in tracker" deep link

- Rename the scheme to `alianhub-tracker://` and register it on all three OSes
  (`setAsDefaultProtocolClient`, macOS `Info.plist` `CFBundleURLTypes`, Linux `.desktop`
  `MimeType`).
- The web app's Time tracking settings and the tracker download card get **Open in tracker**:
  `alianhub-tracker://connect?url=https%3A%2F%2Facme.alianhub.com`. The tracker adds the workspace
  (after the handshake) and starts the normal PKCE sign-in against it.
- If the app is not installed the link does nothing visible, so the button sits next to the
  download buttons with the text "Installed it? Open in tracker".

### T4 — Product packaging fit to sell

- `appId: com.alianhub.tracker`, product name "AlianHub Tracker", executable `alianhub-tracker`,
  proper icons.
- Code signing: Windows (EV or OV certificate via Azure Trusted Signing or a hardware token),
  macOS (Developer ID + notarisation, hardened runtime, entitlements for screen recording
  permission prompts), Linux (AppImage + deb, signed checksums).
- Auto-update with `electron-updater`, `publish: generic` pointing at
  `https://downloads.alianhub.com/tracker/<channel>/` (an S3/Spaces bucket behind the CDN — 070),
  channels `stable` and `beta`.
- CI: `.github/workflows/tracker-release.yml` builds, signs and uploads on a `tracker-v*` tag.

### T5 — Multiple workspaces in one tracker

A freelancer or agency may track for two customers. The tracker keeps a list; the header shows the
current workspace's logo and name with a switcher; timers never run in two workspaces at once
(switching stops the running timer after a confirm).

### T6 — Downloads inside the web app

- Settings → Time tracking → **Desktop app** card: OS-detected primary download, other OSes listed,
  version, "Open in tracker", and the add-on state (on: seats used / total; off: "Add the time
  tracker" link to the portal for owners/admins, "Ask your admin" for others).
- The download URLs come from the update feed's `latest.yml` files, so the web app always offers
  the current version without a server release. The global `TIMETRACKER_DOWNLOAD` list stays for
  self-hosted installs that host their own builds.

### T7 — Screenshots and storage

Tracker screenshots go through the same upload path and count against storage (064 T3). The add-on
page and the portal say so plainly, and Settings → Time tracking shows screenshot storage used and
the retention period (`Modules/ScreenshotRetention`) so admins can keep it bounded.

### T8 — Tests

- Tracker unit tests: address normalisation, handshake handling (enabled, disabled, too old,
  unreachable, non-AlianHub host), per-request base URL, workspace switch stops the timer.
- Server jest: handshake output in managed and self-hosted modes, add-on off → handshake disabled
  and sign-in refused (064).
- Manual release checklist: signed installers launch without OS warnings on Windows 11, macOS 14+,
  Ubuntu 24.04; auto-update from the previous version works.

## How it looks

First run:

```
          AlianHub Tracker
  Connect to your workspace

  Workspace address
  [ acme                   ].alianhub.com
  Self-hosted? Enter the full address

              [ Continue ]

  Or click "Open in tracker" in AlianHub
  → Settings → Time tracking
```

Add-on not active:

```
  Acme · acme.alianhub.com
  ✕ Time tracking isn't part of this
    workspace's plan.
    Ask your admin to add the time
    tracker in their AlianHub account.
            [ Try another address ]
```

Web app, Settings → Time tracking → Desktop app (add-on on):

```
Desktop time tracker          8 of 20 users
──────────────────────────────────────────
[ Download for Windows ]   v6.0.2
  macOS · Linux (AppImage, deb)
Installed it?  [ Open in tracker ]

Screenshots: 2.1 GB · kept 90 days
```

## Platform view

- **Distribution.** One bucket + CDN for installers and update manifests (070); egress is small
  (installers ~100 MB, a few downloads per customer).
- **Security.** The tracker trusts only HTTPS workspaces; the handshake reveals a workspace name and
  logo only, both already shown on its public login page. Gating is server-side (064), so a copied
  installer is worthless without the add-on.
- **Compatibility.** `minVersion` from the server lets us retire old tracker APIs safely; fleet
  upgrades (071) must not raise `minVersion` before the matching tracker release is on `stable`.
- **Signing keys** live in CI secrets (or the signing service), never on developer machines.

## Management view

- **Revenue.** The tracker becomes a clean upsell: $2/user/month (placeholder, Q11) with
  near-zero marginal cost besides screenshot storage, which the storage limit already covers.
- **Cost.** 6–8 developer days, plus certificates: Apple Developer Program ($99/year), a Windows
  code-signing certificate or Azure Trusted Signing (~$10/month), one-time setup of notarisation.
- **Support.** "Which tracker do I download?" disappears: everyone gets the same one. Self-hosted
  users benefit too.
- **Risk:** existing tracker users on old builds with a baked-in address. Mitigation: the new
  version pre-fills the old `APIURL` as the first workspace on upgrade, so nobody has to reconnect.

## Fallback design: a build per customer (only if Q11 says so)

A `tracker.build` job in the orchestrator (069) runs the CI workflow with
`APIURL=https://<sub>.alianhub.com`, `productName="AlianHub Tracker — <Name>"`, signs, uploads to
`downloads.alianhub.com/tracker/<instanceId>/`, and posts the links to the instance and portal. Each
tracker release then re-runs it for every customer with the add-on. Gating still has to be the
server's (064). Estimate: +5 days, plus CI minutes and signing time per customer per release.

## Out of scope

- New tracker features (idle detection rules, app/URL tracking changes).
- Mobile trackers.
- Pricing — set in the portal catalog (068) from Q11.

## Acceptance criteria

- [ ] One installer per OS connects to any AlianHub workspace by typed address or by the
      "Open in tracker" link, and signs in with the existing PKCE flow.
- [ ] A workspace without the add-on is refused at connect time with the plan message, and at
      sign-in on the server.
- [ ] Installers are signed (Windows, macOS notarised) and open without security warnings.
- [ ] Auto-update moves a tracker from the previous version to the new one on the stable channel.
- [ ] A tracker upgraded from a build-time `APIURL` version keeps working without reconnecting.
- [ ] Two workspaces can be connected; switching stops a running timer after confirmation.
- [ ] The web app's Desktop app card shows the current version from the update feed, seats used,
      screenshot storage and retention.
- [ ] i18n and style checks pass for the web app changes.

## Dependencies

- 064 (tracker gating and seats on the server).
- 070 for the downloads bucket and CDN (can start with a plain public bucket).

## Open questions

- Q11 — ✅ one build for everyone (owner, 27 Oct 2026); the "Fallback design" section is not needed.
  Price per tracked user still a placeholder ($2/user/month).

## Estimate

6–8 developer days, plus certificate procurement lead time (Apple: days; Windows EV: 1–2 weeks).
