---
id: 072
title: Cloud back office — the staff console at ops.alianhub.com
status: backlog
priority: high
depends_on: [060, 067, 068, 069]
created: 2026-10-27
---

# Cloud back office — the staff console at ops.alianhub.com

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M3 · Repo: `alianhub-cloud` (new)

> Until the payment gateway (068, last) exists, the back office is where plans are granted: invite
> codes (plan, add-ons, expiry) and an approval queue for sign-ups, plus a "record manual invoice"
> action so beta revenue is still tracked.

## Goal

Our team can see and fix everything about every customer from one place, without SSH and without
touching the database: who the customer is, what they pay, which server their instance lives on,
whether it is healthy, why a setup failed — and act on it (retry, suspend, extend grace, move,
restore, refund) with a reason that is recorded forever. Management reads MRR, churn and margin per
plan from the same console.

## Where we start

- Nothing exists. This task creates `ops/` (Vue 3 SPA) and the `/api/ops/v1/*` routes in the shared
  `server/` of `alianhub-cloud` (layout in 067 T1).
- Data comes from the control-plane collections (architecture §13), the orchestrator's `jobs` and
  `hosts` (069), billing's `subscriptions`, `invoices`, `ledgerEntries`, `metricsDaily` (068),
  `usageSnapshots` and `backups` (069/071), and monitoring alerts (071).
- Every action here is an orchestrator job or a billing call; the back office has no private path
  around them, so the same audit and idempotency apply.

## Scope — the work, task by task

### T1 — Access, staff accounts and roles

- **Network gate:** `ops.alianhub.com` is reachable only through Cloudflare Access (Zero Trust)
  with the company Google Workspace as identity provider; Access policy limits to named staff
  emails. The origin refuses requests without a valid `Cf-Access-Jwt-Assertion` (verified against
  the Access public keys and audience tag).
- **App login on top:** `staffUsers { _id, email, name, role, totp{secretEnc, enabledAt},
  status:'active'|'disabled', lastLoginAt, createdBy, createdAt }`. TOTP 2FA is mandatory; first
  login forces enrolment. Session cookie `__Host-ahc_ops` (8-hour absolute lifetime, 30-minute
  idle), separate secret from the portal.
- **Roles and permissions:**

| Action | admin | support | finance | read-only |
|---|---|---|---|---|
| View customers, instances, jobs, events | ✓ | ✓ | ✓ | ✓ |
| View invoices, ledger, metrics | ✓ | — | ✓ | ✓ |
| Retry provisioning, restart stack | ✓ | ✓ | — | — |
| Open instance as support (granted) | ✓ | ✓ | — | — |
| Extend grace, resend emails, owner links | ✓ | ✓ | ✓ | — |
| Suspend / resume (non-payment reasons) | ✓ | ✓ | — | — |
| Change plan (comp), coupons, refunds | ✓ | — | ✓ | — |
| Move host, rotate keys, trigger backup | ✓ | — | — | — |
| Restore from backup, delete now | ✓ + second admin | — | — | — |
| Catalog and billing settings | ✓ | — | ✓ (prices) | — |
| Hosts: add, cordon, drain | ✓ | — | — | — |
| Staff management | ✓ | — | — | — |

- Offboarding: disabling a staff user kills their sessions at once; Access policy updated in the same
  checklist (073 T13 runbook).

### T2 — Customers

- List (`GET /api/ops/v1/accounts?q=&plan=&state=&country=&page=`): name, owner email, country,
  plans, instances count, MRR, state of worst instance, created, tags. Search by name, email,
  subdomain, provider customer id, invoice number.
- Detail: profile, portal users and roles, billing details and tax id, subscriptions, invoices,
  ledger entries, instances, emails sent (`emailLog`), notes (`accounts.notes[] { by, at, text }`),
  tags (`vip`, `beta`, `at_risk`, `abuse`), timeline from `events`.
- Actions: add note, add/remove tag, send templated email (073 T3 templates plus a free-text
  "support follow-up" template), resend verification, reset portal 2FA (admin, reason required).

### T3 — Instances

- List: subdomain, account, plan, state, host, region, version, seats used/limit, storage used/limit,
  last activity, health (from 071), entitlements version applied vs issued.
- Detail tabs:
  - **Overview** — state with since-when, plan and add-ons, renewal, host, version, image digest,
    URLs, owner email, support access status, health checks (last 24 h).
  - **Usage** — `usageSnapshots` chart (30 days) for seats, storage, mail, DAU/MAU.
  - **Jobs** — every orchestrator job with step, attempts, duration, output/error (secrets redacted
    by 069 before storing).
  - **Events** — `events` for this instance, newest first, with actor (customer, staff, system,
    provider).
  - **Backups** — list, sizes, kind, restore point picker.
  - **Entitlements** — the last issued document (decoded), the version the instance reports,
    "Re-push" button.
  - **Actions** — see T8.
- Secrets are never shown: `PLATFORM_API_KEY`, S3 keys and `JWT_SECRET` appear as fingerprints
  (first 6 chars of their SHA-256) with "rotated at".

### T4 — Provisioning failures queue

- `GET /api/ops/v1/provisioning/failures`: instances in `failed` or in `provisioning` > 10 minutes,
  with failed step, last error, attempts, host, age, whether the customer has been emailed.
- Actions per row:
  - **Retry from step** — re-queues the orchestrator at the failed step (069 guarantees idempotent
    steps).
  - **Retry from start on another host** — when the host is the problem.
  - **Mark resolved** — after manual fix, with note.
  - **Refund and cancel** — finance/admin; calls 068 T12; customer email "We couldn't finish
    setting up acme.alianhub.com" (073 T3).
- Alert to the on-call channel when an item enters the queue (071 routes it).

### T5 — Hosts and capacity

- List (`hosts`, written by 069/070): name, region, size, role (`shared`|`dedicated`|`control`),
  status (`active`|`cordoned`|`draining`|`retired`), tenants count, CPU/memory/disk use, Docker
  version, agent version, last report.
- Capacity panel per region: free tenant slots per tier given current limits
  (architecture §5 tier sizes), projected days until full at the last 14 days' sign-up rate.
- Actions (admin): add host (runs 070's host bootstrap via 069), cordon (no new tenants), drain
  (move tenants off in waves, each a host-move job), retire. DigitalOcean specifics in 070.

### T6 — Catalog editor

- Edit `plans`, `addons`, `prices` (068 T2) as a **draft catalog version**; diff view against live;
  publish runs `billing.catalog.sync` and only then makes the version live.
- Limit changes on a live plan: the console shows how many instances are affected and whether any
  would exceed the new limit; publishing re-pushes entitlements to the affected instances in waves
  (069). Lowering a limit below current usage for any instance needs an admin and a reason.
- Price changes create new prices; existing subscribers stay grandfathered until a **price
  migration** is scheduled (30-day notice email, 073 T3).
- Brand-protection and reserved-subdomain lists are edited here (used by 067 T4 and 069).

### T7 — Coupons

- Create, pause, expire coupons (068 T9 fields), see redemptions and the MRR discounted by each.
- Bulk codes for partners (CSV export of N single-use codes).

### T8 — Manual actions, each with a reason

Every action opens a modal: what will happen, who is affected, a **reason** (required, ≥ 10
characters, plus a reason code), and for destructive ones the subdomain typed to confirm. On submit
the server writes an `events` row (`ops.<action>` with staff id, reason, before/after) and queues
the job.

| Action | Effect | Role |
|---|---|---|
| Suspend | `lifecycle.set suspended`, reason `abuse`/`legal`/`security`/`other` | admin, support |
| Resume | `lifecycle.set active` (not allowed while unpaid unless grace extended) | admin, support |
| Extend grace | `subscriptions.graceExtendedUntil` (≤ 30 days at a time) | admin, support, finance |
| Change plan (comp) | plan/add-ons without charge, `comp: true`, end date required | admin, finance |
| Move host | host-move job (069) with optional window | admin |
| Restart stack | `stack.restart` | admin, support |
| Rotate keys | `PLATFORM_API_KEY` via `/rotate-key`; S3 key via 063/069; `JWT_SECRET` rotation logs everyone out — extra confirmation | admin |
| Trigger backup | `stack.backup` (on-demand) | admin |
| Restore | `stack.restore` from a chosen backup, takes a pre-restore backup first | admin + second admin approval |
| Owner activation link / transfer | `/owner/activation-link`, `/owner/transfer` | admin, support |
| Change subdomain | same job as 067 T16, bypassing the 30-day rule | admin |
| Re-push entitlements | sign and push the current document again | admin, support |
| Delete now | skips retention: `stack.destroy`, S3 prefix purge, DNS removal; final backup still kept | admin + second admin approval |
| Refund | 068 T12 | admin, finance |

- **Two-person rule:** restore and delete-now create an `approvals { action, instanceId,
  requestedBy, reason, approvedBy, approvedAt, expiresAt }` request; a different admin approves
  within 24 hours; then the job runs.
- Rate limit: max 20 destructive actions per staff member per hour; more needs a second admin.

### T9 — Support access sessions

- When a customer granted access (067 T14, `instances.supportAccess` not expired), support sees
  **Open as support**. It runs `instance.call` → `POST /api/v2/platform/support-session`
  `{ staffEmail, staffName, expiresAt }` → a one-time URL that signs into a dedicated, flagged
  support user (`AlianHub Support · <name>`), not the owner, limited to the grant's expiry.
  *(New platform API route — see contract changes.)*
- Every session start/end is an `events` row; the instance's own audit log shows the support user's
  actions under that name, so the customer sees exactly what we did.
- Without a grant the button is disabled with "Ask the customer to grant access in the portal".

### T10 — Business dashboards

From `metricsDaily` (068 T14), `usageSnapshots`, `jobs`, `hosts`:

- **Revenue:** MRR (with new / expansion / contraction / churn / reactivation bars), ARR, ARPA,
  net revenue retention (trailing 12 months when available), logo churn %, involuntary vs voluntary
  churn, refunds, fees, add-on attach rate (tracker, storage, seats), annual share.
- **Plans:** active instances per plan, upgrades/downgrades per month, blocked downgrades,
  gross margin per plan = revenue − (host cost share by allocated vCPU/RAM + S3 bytes × rate +
  backups + mail + payment fees). Host cost comes from DigitalOcean invoice items
  (`GET /v2/customers/my/invoices/preview` month to date; items carry `resource_uuid`, mapped to
  `hosts`), with the back-office token (`billing:read`); a Business customer's Droplet and volume are
  charged to that customer directly. Other cost inputs editable (`costSettings`, admin/finance).
- **Funnel** (067): visits → sign-ups → verified → checkout → paid → active < 3 min → owner
  activated 24 h.
- **Operations:** provisioning p50/p95, failure rate by step, instances per state, uptime per plan
  (from 071), backup success rate, hosts capacity.
- Exports: CSV for every chart; dates in UTC with a timezone switch.

### T11 — Audit log viewer

- `events` search by account, instance, actor, type prefix (`ops.`, `billing.`, `orchestrator.`,
  `portal.`), date range; CSV export (finance/admin).
- `events` is append-only at the database level (application user has insert/find only on it).

### T12 — Alerts inbox

- Lists open alerts from 071 and billing (068 T4/T15): host down, instance unhealthy, provisioning
  failed, webhook backlog, reconciliation mismatch, mail complaint spike, backup failed.
- Acknowledge with note; link to the runbook (071) for that alert type.

### T13 — Back-office API

All under `/api/ops/v1`, Access JWT + staff session + role check + CSRF header:

```
GET  /accounts            GET  /accounts/:id
GET  /instances           GET  /instances/:id
GET  /instances/:id/jobs  GET  /instances/:id/events
POST /instances/:id/actions/:action
GET  /provisioning/failures
GET  /hosts               POST /hosts/:id/actions/:action
GET  /catalog/draft       PUT  /catalog/draft
POST /catalog/publish     GET  /coupons  POST /coupons
GET  /approvals           POST /approvals/:id/approve
GET  /metrics?from&to     GET  /events?…
GET  /alerts              POST /alerts/:id/ack
GET  /staff               POST /staff  PUT /staff/:id
```

## How it looks

Home:

```
┌──────────────────────────────────────┐
│ AlianHub Cloud · OPS   SANDBOX?  Nik │
├──────────────────────────────────────┤
│ MRR $18,420  +6.2% m/m               │
│ Active 214 · past_due 6 · ro 2       │
│ Setup p95 2m14s · failures today 1   │
│                                      │
│ Needs attention                      │
│ ! acme2 failed at dns_created  12m   │
│ ! host do-blr1-07 disk 86%           │
│ ! webhook lag 7m (paddle)            │
│                                      │
│ Customers  Instances  Hosts          │
│ Catalog  Coupons  Metrics  Audit     │
└──────────────────────────────────────┘
```

Instance detail:

```
┌──────────────────────────────────────┐
│ acme.alianhub.com      ● active      │
│ Acme · Pro monthly · renews 27 Nov   │
│ Host do-blr1-03 · v14.40.0           │
│ Entitlements v7 issued / v7 applied  │
│ Support access: until 28 Oct 14:20   │
├──────────────────────────────────────┤
│ Overview Usage Jobs Events Backups   │
│ Entitlements Actions                 │
├──────────────────────────────────────┤
│ Seats 23/60  Storage 12.4/150 GB     │
│ Mail today 140/2000  MAU 31          │
│ Health ✓ 24h  Last active 2m ago     │
│                                      │
│ [Open as support] [Restart] [More ▾] │
└──────────────────────────────────────┘
```

Action modal:

```
┌──────────────────────────────────────┐
│ Suspend acme.alianhub.com            │
│                                      │
│ Everyone in Acme will be signed out  │
│ and see "suspended" until resumed.   │
│                                      │
│ Reason code [ abuse            ▾ ]   │
│ Reason      [ Phishing pages in   ]  │
│             [ public shares, CF-… ]  │
│ Type acme to confirm [          ]    │
│                                      │
│ [ Cancel ]              [ Suspend ]  │
└──────────────────────────────────────┘
```

Failures queue:

```
┌──────────────────────────────────────┐
│ Provisioning failures (2)            │
├──────────────────────────────────────┤
│ acme2  dns_created  3 tries  12m     │
│ DigitalOcean API 429 rate limited    │
│ [Retry step] [Other host] [Refund]   │
├──────────────────────────────────────┤
│ lumen  app_healthy  3 tries  31m     │
│ /health 503: mongo not ready         │
│ [Retry step] [Other host] [Refund]   │
└──────────────────────────────────────┘
```

Hosts:

```
┌──────────────────────────────────────┐
│ Hosts · BLR1                         │
│ Free slots: Starter 41 · Pro 18      │
│ Full in ~23 days at current rate     │
├──────────────────────────────────────┤
│ do-blr1-03 shared  24 t  CPU 41%     │
│   RAM 68%  Disk 52%  agent 1.4 ●     │
│ do-blr1-07 shared  29 t  CPU 55%     │
│   RAM 81%  Disk 86% !  agent 1.4 ●   │
│ do-blr1-b1 dedicated · lumen         │
│ [ Add host ]  [ Cordon ] [ Drain ]   │
└──────────────────────────────────────┘
```

Catalog publish:

```
┌──────────────────────────────────────┐
│ Publish catalog v5                   │
│ Changes from v4:                     │
│ • Pro storage 100 GB → 150 GB        │
│ • New price Pro annual INR ₹65,900   │
│                                      │
│ Affects 88 Pro instances. None over  │
│ the new limits. Entitlements will be │
│ re-pushed in waves of 20.            │
│ [ Cancel ]            [ Publish ]    │
└──────────────────────────────────────┘
```

Metrics:

```
┌──────────────────────────────────────┐
│ Revenue · last 6 months              │
│ MRR  12.1k 13.4k 14.9k 16.0k 17.3k   │
│      18.4k                           │
│ Churn MRR %  1.9 1.4 1.6 1.2 1.1 1.0 │
│ ARPA  $86                            │
│                                      │
│ Gross margin by plan                 │
│ Starter 78%  Pro 84%  Business 81%   │
└──────────────────────────────────────┘
```

## Platform view

- **Two gates:** Cloudflare Access at the edge and staff session + TOTP in the app; the origin
  validates the Access JWT itself, so a misconfigured DNS record pointing around Cloudflare still
  refuses everyone.
- **Least privilege:** the role matrix is enforced on the server per route; the SPA hides what the
  role cannot do but is never the check.
- **Immutable trail:** `events` insert-only; `approvals` for destructive actions; staff actions carry
  `staffId`, IP, user agent.
- **No secrets on screen:** fingerprints only; rotation is an action, never a reveal.
- **Blast-radius limits:** destructive-action rate limit, two-person rule, waves for catalog
  re-pushes and host drains (069 runs at most N concurrent host moves per region).
- **Availability:** the back office shares the control plane deployment; if it is down, instances
  keep running (architecture §9 fail-open). Break-glass procedure (071 runbook) documents doing a
  suspend via `cloudctl` when the console is unavailable.

## Management view

- **Who uses it:** founders/admins (catalog, metrics), 1–2 support staff (customers, instances,
  support sessions), finance (refunds, ledger, coupons).
- **Cost:** Cloudflare Access free tier covers up to 50 users; no other paid tools.
- **Metrics it puts in front of management weekly:** MRR and movements, churn (voluntary vs
  involuntary), gross margin per plan, setup p95 and failure rate, open alerts older than 24 h,
  support sessions per 100 customers.
- **Policies it enforces:** reasons for every action, two-person rule, no SSH for routine support —
  each one is a written SOP linked from the console (073 T4).
- **Risks:** insider misuse → audit + two-person + Access logs; console bug acting on the wrong
  instance → typed-subdomain confirmation and preview of effects; metrics drift from provider
  truth → reconciliation (068 T15) shown on the revenue page.

## Out of scope

- A customer-facing status or announcement banner pushed into instances.
- Ticketing inside the back office (support desk is 073 T4; tickets link to accounts by email).
- Direct database editing or a generic "run command on host" shell.
- Forecasting beyond simple capacity projection.

## Acceptance criteria

- [ ] `ops.alianhub.com` refuses any request without a valid Cloudflare Access JWT, and any staff
      user without TOTP.
- [ ] Each role can do exactly what the matrix allows, verified by server-side tests per route.
- [ ] Every action requires a reason, writes an `events` row with before/after, and runs through
      the orchestrator or billing (no direct writes to instances).
- [ ] Restore and delete-now need a second admin's approval within 24 hours.
- [ ] A failed provisioning appears in the queue within 1 minute and "Retry from step" completes it
      without duplicating DNS records, S3 users or stacks.
- [ ] Host list shows live CPU/RAM/disk and tenant counts; cordon stops new placements immediately.
- [ ] Catalog publish shows affected instances, syncs to the provider, and re-pushes entitlements
      in waves; a failed provider sync leaves the old catalog live.
- [ ] "Open as support" works only during a customer grant and signs in as the flagged support user;
      the session appears in the instance's audit log.
- [ ] Revenue dashboard MRR equals `metricsDaily` and the ledger for the same month.
- [ ] No secret value is retrievable from any back-office API response.

## Dependencies

- 067 (accounts, portal users, support grants), 068 (billing actions, metrics, catalog sync),
  069 (jobs, hosts, actions), 070 (host bootstrap; DigitalOcean specifics in 070), 071 (alerts,
  health, backups, runbooks).
- 062 needs one more route for T9 (`POST /api/v2/platform/support-session`).

## Open questions

- Q17 — upgrades are automatic in waves; the console shows each instance's wave and lets admins
  pin a version for an instance (pinning UI lives with 071's rollout).
- Q20 — support access only with the customer's 24-hour grant (T9).
- Q22 — staffing: assumes 1–2 support staff at launch; roles cover a finance person part-time.

## Estimate

About 3 weeks for one full-stack developer (T1–T4: 1 week; T5–T9: 1 week; T10–T13: 1 week),
overlapping the end of M3.
