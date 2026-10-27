---
id: 067
title: Cloud portal — sign-up, plans, subdomain, checkout and the customer dashboard
status: backlog
priority: high
depends_on: [060, 062, 064, 068, 069]
created: 2026-10-27
---

# Cloud portal — sign-up, plans, subdomain, checkout and the customer dashboard

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M3 (checkout T5 in M5) · Repo: `alianhub-cloud` (new)

> **Order set by the owner (27 Oct 2026): the payment gateway comes last.** Build everything here in
> M3 except the paid checkout (T5): until 068 lands in M5, a sign-up gets its plan from an **invite
> code** (created in the back office, carrying plan, add-ons and expiry) or by **staff approval** in
> the back office queue, and the orchestrator is triggered by that grant instead of by
> `subscription.activated`. Billing pages (T11) show "Invoiced by AlianHub" until M5. T5 is then
> added without changing the provisioning flow.

## Goal

A buyer goes from the pricing page to a live `https://<sub>.alianhub.com` without talking to anyone,
and afterwards manages everything about that instance — plan, add-ons, seats, storage, invoices,
cancellation, backups, the time tracker — at **account.alianhub.com**. The portal is the only place
money and plans are handled; the instance itself never talks to a payment provider.

## Where we start

- Nothing exists yet. `alianhub-cloud` is a new repository; this task creates its portal half.
- Contracts are fixed in [architecture.md](../../active/060-alianhub-cloud-programme/resources/architecture.md):
  domains (§3), subdomain rules (§3), lifecycle states (§11), entitlements (§9), usage report (§10),
  plans and add-ons (§12), control-plane collections (§13).
- The instance side the portal relies on is built in 062 (`/api/v2/platform/owner/login-link`,
  `/owner/activation-link`), 064 (limits enforced in the app) and 066 (tracker build that connects to
  any workspace). Billing internals are 068; provisioning and every call into an instance go through
  the orchestrator in 069. The portal never calls an instance directly.
- Team stack, chosen in architecture §18.10: Node 20, Express, MongoDB, Vue 3 + Vite, Agenda.

Repository layout this task creates (069 and 072 add their folders):

```
alianhub-cloud/
├── server/           Express API, workers, webhooks
│   ├── modules/      feature folders (auth, catalog,
│   │                 subdomains, checkout, instances…)
│   └── jobs/         Agenda job definitions
├── portal/           Vue 3 SPA → account.alianhub.com
├── ops/              Vue 3 SPA → ops.alianhub.com (072)
├── agent/            host agent (069)
└── packages/shared/  catalog types, validators, i18n
```

## Scope — the work, task by task

### T1 — Repository foundations

- Monorepo with npm workspaces; Node 20 LTS; ESLint + Prettier; Jest for the server, Vitest +
  Playwright for the SPA; GitHub Actions CI (lint, test, build, container image).
- `server/` follows AlianHub's module shape (`modules/<Feature>/{controller,helpers,routes}.js`) and
  response shape `{ status, statusText, data }` so the team reads both codebases the same way.
- Config through env only (`CONTROL_MONGODB_URL`, `SESSION_SECRET`, `MASTER_KEY`, provider keys);
  a `config.js` that fails fast at boot when a required key is missing.
- Sessions: server-side sessions in MongoDB (`sessions` TTL collection), cookie
  `__Host-ahc_session` (`Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`), 14-day sliding
  expiry, rotated on login and privilege change. CSRF: double-submit token header `x-csrf-token`
  on every non-GET.
- Rate limits (per IP and per account) on auth, subdomain check and checkout routes.
- i18n from day one (`portal/src/locales/en.js`); every visible string through `t()` — same rule
  as AlianHub. Design tokens copied as a **new file written for the portal** (not AlianHub's
  `tokens.css` verbatim — see 073 T2 on keeping AGPL code out of the portal).
- Done when: CI is green on an empty app, `/health` answers, a staging deploy exists.

### T2 — Accounts, sign-up, sign-in

Collections: `accounts`, `portalUsers` (architecture §13).

```
accounts {
  _id, name, country, billingEmail, taxId, taxIdType,
  address{line1,line2,city,state,postalCode,country},
  currency: 'USD'|'INR'|'EUR', providerCustomerId,
  acceptedTerms{version, at, ip}, notes[], tags[],
  createdAt, deletedAt
}
portalUsers {
  _id, accountId, email, emailVerifiedAt, name,
  passwordHash, googleSub, role: 'owner'|'billing'|'admin',
  totp{secretEnc, enabledAt}, lastLoginAt, createdAt
}
```

Routes:

| Route | Purpose |
|---|---|
| `POST /api/v1/auth/signup` | name, email, password, company name, country, `acceptTerms` → account + owner, sends verify email |
| `POST /api/v1/auth/verify-email` | token from email → `emailVerifiedAt` |
| `POST /api/v1/auth/login` | email + password (+ TOTP if enabled) |
| `POST /api/v1/auth/google` | Google ID token → sign in or sign up |
| `POST /api/v1/auth/logout` | ends session |
| `POST /api/v1/auth/forgot` / `reset` | one-time token, 30 min |
| `GET /api/v1/me` | user, account, role, instances summary |
| `PUT /api/v1/me` / `PUT /api/v1/me/password` / `POST /api/v1/me/totp` | profile, password, 2FA |

- Password rule identical to AlianHub's `meetsPasswordRule` (same wording to the user).
- Cloudflare Turnstile on sign-up and forgot-password (bot and card-testing defence).
- Email must be verified before checkout (the instance owner is created from this email).
- A buyer may arrive with `?plan=pro&interval=month` from alianhub.com; the choice is kept through
  sign-up.
- Done when: sign-up → verify → sign-in → 2FA works end to end in Playwright.

### T3 — Public plan catalog

- `GET /api/v1/catalog?currency=USD` (no auth, CDN-cacheable 5 minutes) returns plans, add-ons and
  prices from `plans`, `addons`, `prices` (edited in 072, synced to the provider in 068).
- Used by the portal's plan picker and by the pricing page on alianhub.com (073 T10).

```json
{
  "currency": "USD",
  "plans": [{
    "key": "pro", "name": "Pro", "order": 2,
    "prices": { "month": 7900, "year": 79000 },
    "limits": { "seats": 50, "guests": 25, "workspaces": 3,
      "storageBytes": 107374182400, "maxFileBytes": 104857600,
      "emailsPerDay": 2000 },
    "features": { "timeTracker": "addon", "customDomain": "addon",
      "ownSmtp": false, "backupDownload": true,
      "compute": "shared-2vcpu-3gb", "backupsKept": 14 },
    "highlights": ["50 users", "100 GB storage", "…"]
  }],
  "addons": [{
    "key": "storage_50gb", "name": "Extra storage",
    "unit": "50 GB", "prices": { "month": 1000 },
    "maxQuantity": 20, "plans": ["pro", "business"]
  }]
}
```

- Amounts are integer minor units. Plan keys are `starter`, `pro`, `business`; add-on keys
  `storage_50gb`, `time_tracker`, `seats_10`, `custom_domain` (architecture §12).

### T4 — Subdomain picker

Collection `subdomainReservations { name, accountId, expiresAt, subscriptionId, createdAt }` with a
unique index on `name` and a TTL index on `expiresAt`.

- `GET /api/v1/subdomains/check?name=acme` → `{ name, available, reason, suggestions[] }`.
  `reason` ∈ `too_short`, `too_long`, `invalid_chars`, `reserved`, `taken`, `held`, `recently_deleted`,
  `blocked_word`. Validation exactly as architecture §3 (shared validator in `packages/shared`, the
  orchestrator runs the same function again in 069).
- Suggestions when taken: `acme-team`, `acmehq`, `acme-pm`, `<name><2 digits>` — only ones that pass.
- `POST /api/v1/subdomains/reserve` → holds the name 30 minutes for this account; extending is
  allowed while checkout is open; one active hold per account.
- Rate limit 30 checks per minute per IP; responses do not reveal which account holds a name.
- UI checks as the user types (debounce 300 ms), shows the full address
  `acme.alianhub.com` live, and explains each refusal in one line.

### T5 — Checkout

Flow: plan → interval (monthly / annual) → subdomain → billing details → pay.

- `POST /api/v1/checkout` body:
  `{ plan, interval, subdomain, addons:[{key,quantity}], couponCode, workspaceName, teamFocus,
  region, billing:{name,country,taxId,address} }`.
  Server re-validates everything, creates the `subdomainReservations` hold, a `subscriptions`
  document with `status: 'incomplete'`, and asks the provider adapter (068 T3) for a checkout
  session. Returns `{ subscriptionId, checkout: { kind: 'redirect'|'overlay', url|token } }`.
- Paddle and Razorpay open as an overlay on the page; Stripe redirects to Checkout. Return URL:
  `/setup/<subscriptionId>`.
- No instance exists until the provider confirms payment by webhook (068 T4). The webhook creates
  the `instances` document (`state: 'provisioning'`) and queues the orchestrator (069).
- The checkout page shows the exact amount, tax line (from the provider's estimate), renewal date,
  and the terms checkbox if the terms version changed since sign-up.
- Region picker appears only when more than one region is enabled (Q5 default: one region).
- Abandoned checkout: the hold expires after 30 minutes; one reminder email after 2 hours
  ("Your acme.alianhub.com is still free — finish setting up").

### T6 — Provisioning progress

- `/setup/<subscriptionId>` polls `GET /api/v1/subscriptions/:id` until the instance exists, then
  subscribes to `GET /api/v1/instances/:id/events` (Server-Sent Events; heartbeat every 15 s;
  falls back to polling `GET /api/v1/instances/:id/progress` every 3 s).
- Steps come from the orchestrator's state machine (architecture §11) and are shown with friendly
  labels; internal step names never reach the customer.

| Orchestrator steps | Customer label |
|---|---|
| `queued`, `host_allocated` | Reserving your server |
| `dns_created`, `storage_created` | Creating acme.alianhub.com |
| `stack_rendered`, `stack_started`, `app_healthy` | Starting AlianHub |
| `config_pushed`, `owner_provisioned`, `entitlements_applied` | Setting up your workspace |
| `public_url_verified`, `active` | Ready |

- On `active`: "Open AlianHub" button (T12) and a note that the activation email went to the owner.
- On `failed` or after 10 minutes without `active`: "We're finishing your setup — we'll email you
  as soon as it's ready." The back office already has the alert (072 T4); the customer is never
  shown a stack trace or asked to retry payment.

### T7 — Dashboard and instance detail

- `GET /api/v1/instances` and `GET /api/v1/instances/:id` read `instances`, the latest
  `usageSnapshots` row, `subscriptions` and `backups`.
- Instance detail shows: address, state (with the state's explanation from architecture §11), plan,
  interval, next renewal and amount, region, AlianHub version, usage meters (seats, workspaces,
  storage, tracker seats, mail today), last activity, add-ons, backups (Pro+), danger zone.
- Usage meters read `usageSnapshots` (polled every 15 minutes by 069); the page shows "updated
  N minutes ago". Meter colours: normal < 80%, warning 80–99%, full at 100%.
- State banners: `past_due` (update payment), `read_only`, `suspended`, `cancelled` (reactivate),
  `failed` (we're on it).

### T8 — Change plan and add-ons

- `GET /api/v1/instances/:id/plan-change/preview?plan=business&interval=month` →
  `{ allowed, blocking[], amountDueNow, nextInvoiceAmount, effectiveAt, hostMove, notes[] }`.
  - Upgrades are immediate with proration (068 T7).
  - Downgrades take effect at the period end and are **blocked** while usage exceeds the target
    plan: `blocking` lists e.g. `{ limit: 'seats', used: 23, target: 10 }`,
    `{ limit: 'workspaces', used: 2, target: 1 }`, `{ limit: 'storageBytes', … }`.
  - Pro → Business needs a move to a dedicated server: `hostMove: true` and a note
    "About 10 minutes of maintenance, scheduled by you". The customer picks a window
    (`POST … { plan, interval, moveWindow: { start } }`); 069 runs the move.
- `POST /api/v1/instances/:id/plan-change` applies the previewed change (preview id echoed back so
  the amount cannot drift between preview and confirm).
- Add-ons: `POST /api/v1/instances/:id/addons` `{ key, quantity }` with the same preview pattern
  (`GET …/addons/preview`). Lowering `time_tracker` below tracker seats in use, or removing
  `storage_50gb` units below current storage, is blocked with the numbers shown.
- After the provider confirms, 068 recomputes entitlements and 069 pushes them; the page shows
  "Applied in your workspace" once the instance reports the new `entitlementsVersion`.

### T9 — Cancel and reactivate

- Cancel at period end only (refunds are a staff action, 068 T12, except the 14-day money-back
  which the customer can request in this flow during the first 14 days).
- Cancel flow: reason survey (too expensive, missing feature, moving to self-host, moving to
  another tool, project ended, other + text), the data timeline in plain words (from Q13 default),
  a link to export (AlianHub's own export) and, for Pro+, the latest backup download.
- `POST /api/v1/instances/:id/cancel { reason, comment }` → `subscriptions.cancelAtPeriodEnd`.
- "Keep my plan" undoes a scheduled cancel until the period ends
  (`POST /api/v1/instances/:id/resume`).
- After the period ends (`cancelled`), "Reactivate" restarts billing and the stack (069 `stack.start`)
  as long as the instance is not `deleted`.

### T10 — Portal team and roles

| Role | Can |
|---|---|
| owner | everything, incl. cancel, delete account, transfer ownership |
| billing | invoices, payment method, billing details, plan and add-on changes |
| admin | see instances, open AlianHub, grant support access, download backups, tracker download |

- `GET/POST /api/v1/team`, `PUT/DELETE /api/v1/team/:userId`; invitations by email, 7-day token.
- One owner per account; `POST /api/v1/team/transfer-ownership` requires password re-entry.
- Portal users are separate from instance users. The page says so in one line: "These people
  manage billing for your AlianHub. People who work in AlianHub are invited inside AlianHub."

### T11 — Billing pages

- Invoices list from the `invoices` mirror (068 T13): number, date, amount, tax, status, PDF link.
- Payment method: provider-hosted management link (`GET /api/v1/billing/manage-url`, 068 T1).
- Billing details: name, address, tax id (GSTIN/VAT), billing email — synced to the provider.
- Card-expiry and failed-payment banners link here.

### T12 — "Open AlianHub" and activation emails

- `POST /api/v1/instances/:id/open` → orchestrator `instance.call` →
  `POST /api/v2/platform/owner/login-link` → `{ url }` (valid 60 s) → the SPA navigates to it.
- Allowed only when the portal user's verified email equals the instance owner's email recorded at
  provisioning (`instances.ownerEmail`); everyone else gets the plain address and signs in normally.
- "Resend activation email" (owner not yet activated) → `POST /api/v2/platform/owner/activation-link`
  through 069; the portal sends the email (073 T3, "Your AlianHub is ready").
- Every open and resend writes an `events` row.

### T13 — Time tracker download

- Shown only when the instance's entitlements have `features.timeTracker.enabled`.
- Reads the release feed published by 066 (`GET /api/v1/tracker/releases` → per OS: version,
  file size, download URL, checksum).
- Instructions show the instance address to type and a "Copy address" button; a second button
  deep-links to the instance's own tracker page (066 builds "Open in tracker" inside AlianHub).
- Shows tracker seats used / limit from usage, and the add-on quantity control (T8).

### T14 — Support access grant

- Owner or admin grants our support team access for 24 hours (Q20 default):
  `POST /api/v1/instances/:id/support-access { hours: 24, reason }`; revoke any time
  (`DELETE …/support-access`).
- Stored on the instance document: `supportAccess { grantedBy, grantedAt, expiresAt, revokedAt,
  reason }`, every change in `events`. 072 T9 uses it.
- Email to all portal admins on grant, on use (first sign-in by support) and on expiry.

### T15 — Backups (Pro and Business)

- List from `backups` (069/071 write it): taken at, size, kind (`nightly`, `on_demand`,
  `pre_upgrade`), kept until.
- `POST /api/v1/instances/:id/backups/:backupId/download` → presigned URL valid 15 minutes,
  one download link per request, logged. Business may also `POST /api/v1/instances/:id/backups`
  for an on-demand backup (max 3 per day).
- The download is a MongoDB archive plus a file manifest; a help article (073 T6) explains
  restoring it into a self-hosted AlianHub.

### T16 — Subdomain change

- Q9 default: once every 30 days. `POST /api/v1/instances/:id/subdomain { name }` with the same
  validation and a preview of consequences: links in old emails redirect for 30 days, the tracker
  and API integrations must use the new address, the old name is held 90 days.
- 069 runs the change (new DNS record, Traefik rule, `WEBURL`/`APIURL` update, restart, redirect
  rule for the old name).

### T17 — Portal emails

The portal sends every billing and lifecycle email (subjects and triggers in 073 T3) through the
platform mail relay (architecture §16). `emailLog { accountId, to, template, subject, providerId,
status, at }`. Templates live in `server/modules/mail/templates/<key>.{html,txt}.js`, localised.

### T18 — Account deletion and data rights

- Owner can delete the portal account only when no instance is `active`/`past_due`/`read_only`.
- Deletion: personal data in `portalUsers` erased, `accounts` kept as a minimal billing record for
  the legal retention period (invoices), `events` keep ids only.
- Export of the account's portal data as JSON (`GET /api/v1/me/export`).

## How it looks

Sign-up (arrives with `?plan=pro`):

```
┌──────────────────────────────────────┐
│ AlianHub Cloud                       │
│ Create your account                  │
│                                      │
│ Your name     [ Riya Shah         ]  │
│ Work email    [ riya@acme.com     ]  │
│ Password      [ ••••••••••        ]  │
│ Company       [ Acme              ]  │
│ Country       [ India           ▾ ]  │
│ [x] I agree to the Terms and         │
│     Privacy Policy                   │
│                                      │
│ [ Create account ]                   │
│ ─────────── or ───────────           │
│ [ Continue with Google ]             │
│                                      │
│ Plan: Pro · $79/month   change       │
└──────────────────────────────────────┘
```

Choose your address:

```
┌──────────────────────────────────────┐
│ Step 2 of 4 · Your address           │
│                                      │
│ [ acme           ].alianhub.com      │
│ ✓ acme.alianhub.com is available     │
│                                      │
│ Workspace name [ Acme Projects    ]  │
│ Team focus     [ Software       ▾ ]  │
│                                      │
│ [ Back ]              [ Continue ]   │
└──────────────────────────────────────┘

Taken:
│ ✗ acme is taken. Try:                │
│   acme-team · acmehq · acme-pm       │
```

Review and pay:

```
┌──────────────────────────────────────┐
│ Step 4 of 4 · Review                 │
│                                      │
│ Pro, monthly            $79.00       │
│ Time tracker × 5        $10.00       │
│ Coupon BETA50          −$44.50       │
│ Tax (estimated)          $0.00       │
│ ──────────────────────────────────── │
│ Due today               $44.50       │
│ Renews 27 Nov 2026 at   $89.00       │
│                                      │
│ acme.alianhub.com · Bangalore        │
│                                      │
│ [ Pay $44.50 ]                       │
│ Cancel any time. 14-day money back.  │
└──────────────────────────────────────┘
```

Setting up:

```
┌──────────────────────────────────────┐
│ Setting up acme.alianhub.com         │
│                                      │
│ ✓ Payment received                   │
│ ✓ Reserving your server              │
│ ✓ Creating acme.alianhub.com         │
│ ● Starting AlianHub          0:42    │
│ ○ Setting up your workspace          │
│ ○ Ready                              │
│                                      │
│ Usually under 3 minutes. You can     │
│ close this page — we'll email you.   │
└──────────────────────────────────────┘

Ready:
│ ✓ Ready                              │
│ [ Open AlianHub ]                    │
│ We sent riya@acme.com a link to set  │
│ the AlianHub password.               │
```

Dashboard:

```
┌──────────────────────────────────────┐
│ Acme                     Riya ▾      │
│ Instances  Billing  Team  Support    │
├──────────────────────────────────────┤
│ acme.alianhub.com        ● Active    │
│ Pro · monthly · renews 27 Nov $89    │
│                                      │
│ Users      23 / 60   ███████░░░      │
│ Storage  12.4 / 150 GB  █░░░░░░░     │
│ Workspaces  2 / 3    ██████░░░       │
│ Tracker     8 / 20   ████░░░░░       │
│ updated 6 minutes ago                │
│                                      │
│ [ Open AlianHub ]  [ Change plan ]   │
│ [ Add-ons ]        [ Backups ]       │
└──────────────────────────────────────┘
```

Change plan — downgrade blocked:

```
┌──────────────────────────────────────┐
│ Change to Starter                    │
│                                      │
│ You can't move to Starter yet:       │
│ • 23 users — Starter allows 10       │
│ • 2 workspaces — Starter allows 1    │
│ • 34 GB stored — Starter allows 20   │
│                                      │
│ Remove users or workspaces inside    │
│ AlianHub, then try again.            │
│                         [ Close ]    │
└──────────────────────────────────────┘
```

Upgrade with a server move:

```
┌──────────────────────────────────────┐
│ Change to Business                   │
│ Due now (prorated)        $112.40    │
│ Then $249.00 monthly from 27 Nov     │
│                                      │
│ Business runs on its own server.     │
│ Moving takes about 10 minutes, when  │
│ AlianHub is unavailable.             │
│ Move on [ Sat 1 Nov ▾ ] [ 02:00 ▾ ]  │
│                                      │
│ [ Cancel ]        [ Upgrade ]        │
└──────────────────────────────────────┘
```

State banners (top of the dashboard):

```
past_due:
│ ! Payment failed on 27 Nov. Update   │
│   your card by 4 Dec to avoid        │
│   read-only mode.  [ Update card ]   │

read_only:
│ ! acme.alianhub.com is read-only.    │
│   People can view and export but     │
│   not change anything.  [ Pay now ]  │

suspended:
│ ! acme.alianhub.com is suspended.    │
│   Data is kept until 27 Dec.         │
│   [ Pay now ]                        │
```

Cancel:

```
┌──────────────────────────────────────┐
│ Cancel acme.alianhub.com             │
│                                      │
│ Why are you leaving?                 │
│ ( ) Too expensive                    │
│ ( ) Missing a feature                │
│ ( ) Moving to self-hosted AlianHub   │
│ ( ) Moving to another tool           │
│ ( ) Project ended                    │
│ ( ) Other [                       ]  │
│                                      │
│ What happens:                        │
│ • Works normally until 27 Nov        │
│ • Then stopped; data kept 30 days    │
│ • Deleted on 27 Dec                  │
│ [ Download latest backup ]           │
│                                      │
│ [ Keep my plan ] [ Cancel at 27 Nov ]│
└──────────────────────────────────────┘
```

Support access:

```
┌──────────────────────────────────────┐
│ Support access                       │
│ Let AlianHub support sign in to      │
│ acme.alianhub.com to help you.       │
│                                      │
│ Duration [ 24 hours ▾ ]              │
│ Reason   [ Import is stuck        ]  │
│                                      │
│ Every action is recorded in your     │
│ audit log.          [ Grant access ] │
│                                      │
│ Active until 28 Oct 14:20  [Revoke]  │
└──────────────────────────────────────┘
```

Time tracker:

```
┌──────────────────────────────────────┐
│ Time tracker        8 / 20 seats     │
│                                      │
│ Windows 5.2.0  84 MB   [ Download ]  │
│ macOS   5.2.0  96 MB   [ Download ]  │
│ Linux   5.2.0  88 MB   [ Download ]  │
│                                      │
│ When it asks for your workspace,     │
│ type:  acme.alianhub.com   [ Copy ]  │
│                                      │
│ Seats [ 20 ] [ Update ]  $2/seat/mo  │
└──────────────────────────────────────┘
```

Error response shape (all portal APIs):

```json
{ "status": false, "statusText": "acme is taken.",
  "data": { "code": "taken",
            "suggestions": ["acme-team", "acmehq"] } }
```

## Platform view

- **Isolation of cookies.** Portal cookies are host-only `__Host-` (Q8); the portal never sets
  `Domain=.alianhub.com` and never trusts a cookie it did not set.
- **No direct instance calls.** Every instance action is an orchestrator job (`instance.call`), so
  the portal holds no `PLATFORM_API_KEY` in memory outside the encrypted store (architecture §13).
- **Card testing and bots.** Turnstile on sign-up, per-account checkout limit (5 sessions/hour),
  provider fraud tools on (Radar / Paddle risk / Razorpay risk), verified email before checkout.
- **Subdomain races.** Unique index on `subdomainReservations.name` plus the orchestrator's second
  check; webhook for a payment whose hold expired still provisions if the name is free, otherwise
  marks the instance `failed` with reason `subdomain_lost` and the back office contacts the buyer
  (rare; alert in 072).
- **SSE scale.** One SSE connection per open setup page; the server reads job progress from a
  MongoDB change stream on `jobs` (one stream per process, fanned out in memory). Behind
  Cloudflare, SSE needs `Cache-Control: no-store` and a 15 s heartbeat.
- **Failure modes.** Provider checkout down → page says payments are temporarily unavailable,
  hold extended; control plane down → instances keep running (entitlements fail open, §9);
  orchestrator backlog → setup page keeps the "we'll email you" path.
- **Monitoring.** Synthetic sign-up in staging every hour with sandbox payment; production uptime
  check on `/health`; alert when p95 paid → active exceeds 3 minutes over an hour or any instance
  sits in `provisioning` longer than 10 minutes.
- **Hosting of the portal itself** is part of the control plane deployment (DigitalOcean specifics
  in 070): two app containers behind the load balancer, MongoDB replica set, daily backups.

## Management view

- **Funnel to watch** (first dashboard in 072 T10): pricing visit → sign-up → email verified →
  checkout started → paid → active < 3 min → owner activated within 24 h → 5+ users invited in
  7 days. Targets for the first quarter: 40% sign-up → paid among verified accounts, 95% of paid
  live in under 3 minutes, 70% of owners activated in 24 h.
- **Revenue levers in the portal:** annual interval preselected? (no — monthly default, annual shown
  with "2 months free"), add-on upsell at 80% meters, upgrade prompt when a downgrade is blocked
  the other way (seat limit reached inside AlianHub links here, 064).
- **Support load drivers:** activation email not received (resend button, T12), wrong subdomain
  (T16), downgrade blocked (clear blocking list), invoices with tax ids (T11). Each has a self-serve
  path so tickets stay under ~1 per 10 customers per month.
- **Risks.** Abandoned setups from slow provisioning → keep the "close this page" promise and email;
  squatting of brand names → brand-protection list (072 T6); chargebacks from confused billing
  descriptor → descriptor "ALIANHUB CLOUD" set in the provider.
- **Staffing.** One frontend and one backend developer for ~4 weeks, sharing 068's backend dev.

## Out of scope

- The pricing page on alianhub.com itself (073 T10).
- Payment logic, proration math, dunning (068).
- Creating hosts, DNS, stacks, entitlement signing and pushing (069, 070).
- Custom domains (Q10 default: later).
- Multiple regions per account (Q5 default: one region).
- Reseller/agency accounts, multiple instances under one subscription.
- In-portal chat support (support desk is 073 T4).

## Acceptance criteria

- [ ] A new visitor can sign up, verify email, pick a plan and a free subdomain, pay in sandbox and
      land on a working `https://<sub>.alianhub.com` in under 3 minutes (p95 over 20 runs).
- [ ] Subdomain validation in the portal and the orchestrator is one shared function with tests for
      every `reason` code and the reserved list.
- [ ] A held subdomain cannot be taken by another account for 30 minutes; it is released afterwards.
- [ ] The setup page never shows internal step names or errors; a failed setup shows the
      "we'll email you" message and raises a back-office alert.
- [ ] Dashboard meters match the latest `usageSnapshots` row and show its age.
- [ ] A downgrade with usage over the target plan is refused with each blocking limit listed; an
      upgrade shows the prorated amount and applies within 1 minute of payment confirmation.
- [ ] Add-on changes appear in the instance (new `entitlementsVersion` reported) within 2 minutes.
- [ ] Cancel at period end, undo, and reactivate after `cancelled` all work and are audited.
- [ ] "Open AlianHub" signs the matching owner in with a one-time link; other portal users get the
      plain address.
- [ ] Support access grant, revoke and expiry work, notify admins, and appear in `events`.
- [ ] Pro/Business backup download returns a 15-minute presigned URL; Starter has no download.
- [ ] Every visible string is in `locales/en.js`; Playwright covers sign-up → active, plan change,
      cancel, reactivate.
- [ ] Portal cookies are `__Host-` host-only; CSRF header enforced on all non-GET routes.

## Dependencies

- 060 contracts (architecture.md, open-questions.md).
- 068 billing adapter for checkout, previews, webhooks, invoices.
- 069 orchestrator for provisioning, `instance.call`, usage polling, subdomain change, host move.
- 062 platform API (`owner/login-link`, `owner/activation-link`) and 064 (limits) in the app.
- 066 tracker release feed.
- 073 for email copy, legal text and the pricing page.

## Open questions

- Q1 / Q2 — plan numbers and flat pricing: catalog values come from 072, so the portal code does not
  change when they do.
- Q3 — provider decides overlay vs redirect in T5; both are built behind the adapter.
- Q4 — no trial: checkout always takes payment; 14-day money-back request in the cancel flow.
- Q5 — one region: the region picker stays hidden.
- Q8 — instances on `<sub>.alianhub.com`; portal uses host-only cookies.
- Q9 — subdomain change once per 30 days (T16).
- Q10 — no custom domains in this task.
- Q11 — one tracker build; T13 shows the address to type.
- Q19 — backup download for Pro and Business.
- Q20 — support access 24 hours, granted by owner/admin.

## Estimate

About 4 weeks for one frontend and one backend developer (T1–T2: 1 week; T3–T6: 1.5 weeks;
T7–T18: 1.5 weeks), in parallel with 068 and 069. Playwright coverage and accessibility pass
included.
