# AlianHub Cloud — architecture and shared contracts

The single source of truth every AlianHub Cloud PRD (tasks 061–073) builds on. When a PRD and this
file disagree, this file wins until it is changed on purpose.

Status: **draft, with the owner's answers of 27 Oct 2026 applied** (see
[open-questions.md](open-questions.md#answers-so-far-owner-27-oct-2026)): BLR1, Mongo per stack,
`<name>.alianhub.com`, Wasabi for files, one tracker app, default plans, automatic upgrades in waves;
payment provider (Q3) and shared-vs-dedicated servers (Q6) still open. Numbers marked
*(placeholder)* are defaults to re-check after the beta.

---

## 1. What we are building, in one paragraph

A customer opens **alianhub.com**, picks a plan, types the subdomain they want (`acme`), pays, and
within about three minutes **https://acme.alianhub.com** is a live, private AlianHub with them as the
owner. Behind it is their own Docker stack (AlianHub app + their own MongoDB) on servers we run,
files in our S3 bucket under their own prefix, mail through our SMTP. Billing renews every month.
Missed payments lead to a banner, then read-only, then suspension — never silent data loss. Add-ons
(more storage, the desktop time tracker, more seats) are bought in the portal and switch on in the
instance within a minute.

## 2. The two products

| | **AlianHub** (this repo) | **AlianHub Cloud** (new repo `alianhub-cloud`) |
|---|---|---|
| What | The project-management app customers use | The portal + platform that sells, creates and runs AlianHub instances |
| Who uses it | The customer's team | Customer's buyer/admin (portal), our staff (back office) |
| Runs where | One Docker stack per customer | Our control-plane servers |
| Changes needed | "The build": tasks 061–066 | Tasks 067–073 |

The app never talks to a payment provider in hosted mode. The leftover in-app Chargebee screens are
hidden in managed mode (task 061) — billing lives only in the portal.

## 3. Domains and entry points

| Address | What it is | Notes |
|---|---|---|
| `alianhub.com` | Marketing site + pricing page | Existing site; pricing reads the plan catalog from the portal API |
| `account.alianhub.com` | Cloud portal (customers) | Sign-up, checkout, dashboard, billing |
| `ops.alianhub.com` | Back office (our staff) | Behind Cloudflare Access + 2FA; not reachable without it |
| `<sub>.alianhub.com` | A customer instance | One per subscription |
| `status.alianhub.com` | Public status page | Hosted status service |
| `help.alianhub.com` | Docs | Existing |

Security note (see open question Q8): tenant instances share the registrable domain with the portal.
The portal therefore uses host-only `__Host-` cookies only, never `Domain=.alianhub.com`, so a script
on any tenant subdomain cannot plant or read portal cookies.

### Subdomain rules (portal validates, orchestrator re-validates)

- 3–30 characters, `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`, lower-cased before checking.
- Not starting with `xn--`; no `--` anywhere.
- Not in the reserved list: `www app api admin account accounts portal ops mail smtp imap pop ftp
  status help docs support blog cdn static assets media files demo staging stage dev test qa sandbox
  auth login sso oauth billing pay payments cloud dashboard inbox email ns1 ns2 mx git alian alianhub
  root system internal` plus a profanity list and a brand-protection list kept in the back office.
- Unique, case-insensitive, across live **and** deleted-within-90-days instances (no reuse while an
  old owner's links still circulate).
- Held for the buyer for 30 minutes from the moment checkout starts (`subdomainReservations`), then
  released if not paid.

## 4. Big picture

```
 Customer browser
   │  account.alianhub.com         <sub>.alianhub.com
   ▼                                    ▼
 ┌────────────────┐            ┌──────────────────┐
 │ Cloudflare     │            │ Cloudflare       │
 │ (DNS+TLS+WAF)  │            │ proxied record   │
 └──────┬─────────┘            └────────┬─────────┘
        ▼                               ▼
 ┌──────────────────────┐     ┌───────────────────────────┐
 │ CONTROL PLANE        │     │ TENANT HOST (many)        │
 │ portal API + SPA     │     │ Traefik (edge router)     │
 │ back office          │     │ host agent  ◄── polls ────┤
 │ orchestrator (jobs)  │◄────┤ tenant stacks:            │
 │ billing webhooks     │     │  t_<id>: app + mongo      │
 │ MongoDB (platform)   │     │ node-exporter, cAdvisor   │
 └──────┬───────────────┘     │ backup runner             │
        │                     └───────────┬───────────────┘
        ▼                                 ▼
  Payment provider            Wasabi: tenant files
  Cloudflare API              DO Spaces: backups
  DigitalOcean API            Resend: mail (HTTPS)
```

Everything runs on **DigitalOcean** (Q5): Droplets with Docker and Traefik for tenants and the
control plane, a Managed MongoDB only for the control plane's own database, Spaces for backups and
downloads, Container Registry as a mirror. App Platform, Load Balancers, DOKS and Managed MongoDB for
tenants do not fit (no volumes / no Host routing / fixed `global` database) — see
[digitalocean.md](digitalocean.md) and task 070.

- **Control plane** — one Node 20 + Express + MongoDB service (portal API, back-office API,
  orchestrator workers, webhook receiver) and two Vue 3 SPAs (portal, back office). Same stack the
  team already knows; Agenda for durable jobs (already used by AlianHub's automation engine).
- **Tenant hosts** — Ubuntu LTS + Docker. Each runs Traefik, a **host agent**, metrics exporters and
  the backup runner. Starter and Pro tenants share hosts; Business gets a dedicated VM running the same
  baseline with one tenant (open question Q6).
- **The host agent pulls work** (`claim job → run → report`) over HTTPS with a per-host token. No
  inbound management port is open on tenant hosts; only 80/443 from Cloudflare IP ranges and SSH
  from the office/VPN.

## 5. Tenant stack (per customer)

Rendered by the host agent from a template (task 065) into `/srv/alianhub/tenants/<instanceId>/`:

```
/srv/alianhub/tenants/ins_01jd3k…/
├── compose.yml      ← rendered from the managed template, read-only
├── .env             ← bootstrap env, mode 600, root-owned
└── meta.json        ← instanceId, subdomain, plan tier, version, created
```

- Compose project name: `t_<instanceId>` (never the subdomain — subdomains can change).
- Services: `app` (ghcr.io/aliansoftwareteam/alianhub:<version>), `mongo` (mongo:7, its own volume,
  `--wiredTigerCacheSizeGB` sized per tier, never exposed).
- Volumes: `t_<id>_mongo`, `t_<id>_logs`, `t_<id>_backups`. No file volume — files live in S3.
- Networks: `t_<id>_internal` (app↔mongo only) and the shared external `edge` network (Traefik↔app).
  Tenants cannot reach each other's containers.
- Traefik routes `Host(<sub>.alianhub.com)` → `app:4000`. The path prefix `/api/v2/platform` is
  **refused at the edge**: the platform API is only reachable from the host agent on the internal path.
- Resource limits per tier *(placeholder)*: Starter 1 vCPU / 1.5 GB (app 1 GB, mongo 0.5 GB);
  Pro 2 vCPU / 3 GB; Business dedicated VM 4 vCPU / 8 GB.

### Bootstrap env (in `.env`, locked against the UI)

```
ALIANHUB_VERSION=14.40.0
HOSTING_MODE=managed
INSTANCE_ID=ins_01jd3k…
PLATFORM_URL=https://account.alianhub.com
PLATFORM_PUBLIC_KEY=<ed25519 public key, base64>
PLATFORM_API_KEY=<48 random bytes, base64url>
JWT_SECRET=<64 random bytes>
MONGODB_URL=mongodb://mongo:27017
WEBURL=https://acme.alianhub.com
APIURL=https://acme.alianhub.com/
TRUST_PROXY=2
MIGRATIONS_AUTO=true
```

### Pushed through the platform API (rotatable without redeploy)

S3 credentials and prefix, the Resend API key and from address (SMTP ports 25/465/587 are blocked on
every DigitalOcean Droplet, so mail leaves over HTTPS), TURN secret — everything a rotation might
touch. This follows the owner's instruction: *bootstrap values in env, credentials
passed by API*. Both paths lock the setting against the customer UI (§7).

## 6. MongoDB

One `mongo:7` container per customer stack, inside the stack (owner's instruction). Reason it must
stay one per customer: the app derives a database per company **plus a fixed `global` database** from
`MONGODB_URL`, so two instances on one Mongo server would collide on `global`. Backups are a nightly
`mongodump --archive --gzip` from the host (task 071), not the in-app backup screen.

## 7. Settings: who owns which value

Today: a key set in the environment is locked in Settings → Instance (`Config/instanceSettings.js`,
`lockedKeys()`), shown with `source: 'env'`. Managed mode adds one more owner. Precedence:

```
env  >  platform  >  saved (customer)  >  default
```

| Source | Set by | Customer sees in Instance console |
|---|---|---|
| `env` | `.env` rendered by the host agent | "Managed by AlianHub Cloud" lock, value hidden |
| `platform` | `PUT /api/v2/platform/config` | "Managed by AlianHub Cloud" lock, value hidden |
| `saved` | Customer owner in the console | Editable |
| `default` | Catalog default | Editable |

In managed mode the groups **general (URLs), mail, storage, security (proxy, rate limit, headers)**
are platform-owned as a whole: shown locked even when unset, so a customer cannot set their own SMTP
or bucket unless their plan allows it (Q21). Groups **ai, auth, calling** stay customer-editable.

## 8. The platform API on each instance (task 062)

Base path `/api/v2/platform`. Auth: header `x-platform-key: <PLATFORM_API_KEY>`, compared in constant
time, accepted only when `HOSTING_MODE=managed`. Every call is audited (`platform.*` audit rows).
Reachable only from inside the host (edge refuses the path). In managed mode the existing
`/api/v2/instance/*` routes also accept the platform key (`req.instanceAdmin = 'platform'`).

| Method & path | Body → result | Idempotent by |
|---|---|---|
| `GET /status` | → `{version, build, dbOk, setup:{installed}, migrations:{pending,error}, lifecycle, entitlementsVersion, maintenance}` | — |
| `POST /provision` | `{provisionId, owner:{email,firstName,lastName}, workspace:{name,teamFocus}, sampleData, locale, timezone}` → `{userId, companyId, activationUrl, activationExpiresAt}` | `provisionId` |
| `PUT /config` | `{values:{KEY:value,…}}` → `{applied, restartRequired}` | full replace of `platform` source |
| `PUT /entitlements` | `{token: <JWS>}` → `{applied:true, version}` | `version` (older ignored) |
| `GET /usage` | → usage report (§10) | — |
| `POST /lifecycle` | `{state:'active'|'past_due'|'read_only'|'suspended', reason, message, graceUntil}` → `{state}` | target state |
| `POST /owner/activation-link` | `{email?}` → new one-time `activationUrl` for the owner | — |
| `POST /owner/login-link` | `{}` → one-time 60-second sign-in URL for the owner (portal "Open AlianHub") | — |
| `POST /owner/transfer` | `{toEmail}` → makes another active member the instance owner | — |
| `POST /support-session` | `{staffEmail, staffName, expiresAt}` → one-time link signing in a flagged support user (never the owner), only while the owner's grant is open | — |
| `POST /rotate-key` | `{newKey}` → `{rotated:true}`; old key accepted 24 more hours | — |

Unauthenticated `POST /api/v2/setup/complete` is **disabled** in managed mode (a stranger who reaches a
fresh instance before the platform could otherwise make themselves owner).

## 9. Entitlements (the plan, as the instance sees it)

Signed by the platform (Ed25519 JWS, `kid` header) so the instance trusts it no matter who carried
it. The instance verifies with `PLATFORM_PUBLIC_KEY`, ignores any `version` ≤ the stored one, keeps
the last good document in the `global` DB, and also pulls
`GET {PLATFORM_URL}/api/v1/instances/{INSTANCE_ID}/entitlements` (header `x-platform-key`; route
owned by 069) at boot and every 6 hours.
If the platform is unreachable the last good document stays in force — **our outage never locks a
paying customer out**.

```json
{
  "instanceId": "ins_01jd3k…",
  "version": 7,
  "issuedAt": "2026-11-02T10:00:00Z",
  "plan": "pro",
  "lifecycle": "active",
  "limits": {
    "seats": 60,
    "guests": null,
    "workspaces": 3,
    "storageBytes": 161061273600,
    "maxFileBytes": 104857600,
    "emailsPerDay": 2000
  },
  "features": {
    "timeTracker": { "enabled": true, "seats": 20 },
    "customDomain": false,
    "ownSmtp": false,
    "sso": false
  },
  "graceUntil": null,
  "portalUrl": "https://account.alianhub.com/i/ins_01jd3k…"
}
```

`null` means unlimited. Seats are counted **across the whole instance** (distinct active users in all
workspaces), not per workspace.

## 10. Usage report (`GET /api/v2/platform/usage`)

```json
{
  "instanceId": "ins_01jd3k…",
  "at": "2026-11-02T10:05:00Z",
  "version": "14.40.0",
  "seats": { "active": 23, "pending": 2, "guests": 4, "limit": 60 },
  "workspaces": { "count": 2, "limit": 3 },
  "storage": { "bytes": 13312000000, "limit": 161061273600,
               "byWorkspace": [{ "companyId": "…", "name": "Acme", "bytes": 13000000000 }] },
  "timeTracker": { "seatsUsed": 8, "limit": 20 },
  "mail": { "sentToday": 140, "limit": 2000 },
  "activity": { "lastActiveAt": "2026-11-02T09:58:00Z", "dau": 14, "mau": 31 },
  "migrations": { "pending": 0, "error": null }
}
```

The orchestrator polls it every 15 minutes into `usageSnapshots`; the portal dashboard and the
back office read the latest snapshot.

## 11. Lifecycle

### Instance states (control plane is the master; the instance mirrors via `POST /lifecycle`)

```
provisioning ─► active ─► past_due ─► read_only ─► suspended ─► cancelled ─► deleted
      │            ▲          │            │             │
      ▼            └──────────┴────────────┴─────────────┘  (payment recovered → active)
    failed
```

Day 0 is the first failed renewal (or the end of the paid period for a cancellation).

| State | Customer experience | Default timing *(placeholder, Q13)* |
|---|---|---|
| `active` | Normal | — |
| `past_due` | Owner/admins see a banner: "Payment failed — update card"; everything works | Day 0 → day 7 |
| `read_only` | Everyone can sign in, read, export; every write is refused with a clear message | Day 7 → day 14 |
| `suspended` | Sign-in page says the workspace is suspended, link to the portal; API refuses all but health | Day 14 → day 30; stack keeps running small |
| `cancelled` | Stack stopped; data kept; reactivation in the portal restores it | Day 30 → day 60 |
| `deleted` | Volumes, S3 prefix, DNS record removed; final backup kept 30 more days, then gone | From day 60 |

### Subscription states (billing provider, normalized — task 068)

`incomplete → active ⇄ past_due → unpaid → cancelled`, plus `trialing` if trials are offered (Q4).
Mapping: `active|trialing` → instance `active`; `past_due` (≤ grace) → `past_due`; `past_due`
(> grace) → `read_only`; `unpaid` → `suspended`; ended → `cancelled`.

### Provisioning steps (orchestrator state machine, task 069)

`queued → host_allocated → dns_created → storage_created → stack_rendered → stack_started →
app_healthy → config_pushed → owner_provisioned → entitlements_applied → public_url_verified →
active`. Each step is idempotent, recorded with timestamps, retried with backoff (3 tries), and on
final failure the instance goes to `failed`, the customer sees "We're finishing your setup — we'll
email you", and the back office gets an alert with the failed step and a **Retry from step** button.
Target: paid → live in **under 3 minutes** on a shared host (p95), under 10 minutes on a new VM.

## 12. Plans and add-ons *(all numbers placeholder — Q1, Q2, Q12)*

Read "Not S space: it will be fixed" as **Starter — fixed storage**. Flat monthly price per plan with
a seat cap; add-ons stack on top.

| | **Starter** | **Pro** | **Business** |
|---|---|---|---|
| Price / month | $29 | $79 | $249 |
| Seats (active users) | 10 | 50 | 150 |
| Guests | 5 | 25 | unlimited |
| Workspaces | 1 | 3 | 10 |
| Storage | 20 GB, fixed (no add-on) | 100 GB | 500 GB |
| Max file size | 50 MB | 100 MB | 100 MB |
| Compute | shared · 1 vCPU · 1.5 GB | shared · 2 vCPU · 3 GB | dedicated VM · 4 vCPU · 8 GB |
| Backups | daily, 7 kept | daily, 14 kept | daily, 30 kept + on demand |
| Backup download | — | ✓ | ✓ |
| Own SMTP | — | — | ✓ |
| Custom domain | — | add-on | ✓ |
| Time tracker | add-on | add-on | add-on (10 seats included) |
| Mail per day | 500 | 2,000 | 10,000 |
| Support | email, 2 business days | email, 1 business day | priority + 99.9% uptime SLA |
| Annual billing | 2 months free | 2 months free | 2 months free |

| Add-on (key) | Unit | Price *(placeholder)* | Available on |
|---|---|---|---|
| Extra storage (`storage_50gb`) | +50 GB | $10 / month, stackable to +1 TB | Pro, Business |
| Time tracker (`time_tracker`) | per tracked user | $2 / user / month (min 5) | All |
| Extra seats (`seats_10`) | +10 seats | $15 / month | Pro, Business |
| Custom domain (`custom_domain`) | per instance | $10 / month | Pro |

Max file size stays at 100 MB in v1 because uploads go through the Cloudflare proxy, which refuses
request bodies over 100 MB on Free/Pro zones (direct-to-S3 uploads would lift that later).

### Unit economics (rough, for the management view — DigitalOcean list prices, 27 Oct 2026)

- Shared host: Memory-Optimized 8 vCPU / 64 GiB = **$336/month** (not the ~$75 first assumed).
  Starter costs **$11.20** of compute at the 30-stack tier-ceiling density, **$5.60–7.50** at the
  45–60 stacks measured use should allow (070 places by measured memory). Pro uses 2 units.
- Business: own Droplet 4 vCPU / 8 GiB + volume ≈ **$60–70/month**.
- Storage: Wasabi $7.99/TB (1 TB minimum) → 20 GB ≈ $0.16; backups on Spaces ≈ $0.02/GB.
- Mail ≈ $0.10 per 1,000 messages. Payment fees 3–5% + $0.50 with a merchant of record.
- Starter margin at $29: ~53% at 30 per host, ~65% at 45, ~72% at 60. **Keep $29 only if M2
  measures ≥ 45 Starter stacks per 64 GiB host** (Q1); Pro and Business clear 65–75%.
- Fixed platform cost at beta size ≈ **$980/month** (070) → break-even ≈ 25–35 paying customers.
- The back office shows real margin per plan from DigitalOcean invoice items (task 072).

## 13. Data model of the control plane (task 067–069)

`accounts` (the customer organisation) · `portalUsers` (owner / billing / admin roles) · `plans` ·
`addons` · `prices` (provider ids per currency and interval) · `subscriptions` · `instances` ·
`subdomainReservations` · `hosts` · `jobs` (orchestrator steps) · `usageSnapshots` · `backups` ·
`invoices` (mirror of provider) · `coupons` · `events` (append-only audit of every state change) ·
`emailLog` · `webhookEvents` (raw provider events, dedupe) · `ledgerEntries` (append-only revenue
ledger) · `metricsDaily` · `billingSettings` · `costSettings` · `staffUsers` · `approvals`
(two-person actions) · `sessions`. Every customer document carries `accountId`; every staff action
writes an `events` row with the staff member, reason and before/after.

Fields other tasks rely on: `instances.ownerEmail`, `instances.supportAccess`
(`{ grantedBy, until }`); `subscriptions.pendingChange`, `graceExtendedUntil`, `pastDueSince`,
`entitlementsVersion`; `accounts.billingProvider`, `accounts.acceptedTerms`; plans carry `status`,
`version`, and `features.backupDownload`, `backupsKept`, `compute`, `sla`.

Per-instance secrets (`JWT_SECRET`, `PLATFORM_API_KEY`, S3 keys) are stored encrypted with a master
key that exists only in the control plane's environment (and its offline backup), never in its
database dump.

## 14. Host agent contract (task 069)

The agent long-polls `POST {CONTROL}/agent/v1/jobs/claim` with `Authorization: Bearer <host token>`
and receives one typed job at a time:

| Job | Does |
|---|---|
| `stack.create` | write files, pull image, `docker compose -p t_<id> up -d`, wait for `/health` |
| `stack.update` | re-render compose/env (version, limits), `up -d`, wait healthy, roll back on failure |
| `stack.restart` / `stack.stop` / `stack.start` | as named |
| `stack.destroy` | stop, remove containers, volumes and files (only after `cancelled` + retention) |
| `stack.backup` / `stack.restore` | mongodump/mongorestore to/from the backups bucket |
| `instance.call` | proxy one platform API call to `http://t_<id>-app-1:4000/api/v2/platform/…` |
| `host.report` | disk, memory, CPU, container states, image cache |

Results go back with `POST /agent/v1/jobs/{id}/result` (`ok`, `output`, `error`, timings). Every job
carries an idempotency key; a job claimed but not reported in 10 minutes is re-queued.

## 15. Storage layout (task 063)

- **Tenant files on Wasabi** (Q26), **one bucket per installation** *(owner, 2026-10-28)*:
  `ahc-<instanceId without ins_>` in the Wasabi region of the host. Keys inside it keep 063's layout
  (`<instanceId>/<companyId>/<existing key>`), so moving to a shared bucket later is a copy, not a
  code change.
- One Wasabi IAM user + inline policy per installation, allowed `s3:*` on that bucket only. A leaked
  key exposes one customer, not all. The control plane creates bucket, user, policy and access key
  at provisioning (069 `storage_created`), pushes them to the instance, and removes all four on
  delete.
  DigitalOcean Spaces cannot do this (keys are per bucket, not per prefix); the Spaces fallback is a
  bucket per shared host and per Business customer.
- **Backups on DigitalOcean Spaces** in the launch region (`alianhub-cloud-backups-<region>`),
  versioned, lifecycle expiry by plan. Wasabi's 90-day minimum storage charge would bill 7-day
  backups as 90. Hosts hold **no** backups key: each backup is written through a presigned PUT URL
  for that one object, minted by the control plane, so a compromised host cannot read, list or
  delete backups (Spaces documents no object lock).
- Today the app creates **one bucket per company named after the companyId** — that does not scale
  (Wasabi's default is 1,000 buckets per account) and cannot be scoped per tenant. Task 063 adds the
  prefix mode; existing self-hosted installs keep the bucket-per-company mode.

## 16. Mail

DigitalOcean blocks SMTP ports 25, 465 and 587 on every Droplet, with no documented way to lift
it. All mail therefore leaves through the **Resend HTTPS API** (Q21), which AlianHub already
supports (`RESEND_API_KEY`), from a verified sending domain (SPF, DKIM, DMARC). From: `"Acme via AlianHub" <notifications@alianhub.com>`, `Reply-To` the acting user where
there is one. Per-instance daily cap from `limits.emailsPerDay`; bounces and complaints come back by
webhook to the control plane, which pauses an instance's mail on a complaint spike (abuse guard).

## 17. Phases

| Phase | Tasks | Ends with | Rough size *(estimate, 2–3 devs)* |
|---|---|---|---|
| **M0 Decisions** | 060 | Most answers in (27 Oct 2026); Q3 and Q6 open | done |
| **M1 The build** | 061–066 | An image a script stands up with one command and four API calls | 3–4 weeks |
| **M2 Infrastructure** | 070 on development-size Droplets, 069 (orchestrator, host agent, `cloudctl`), 071 (upgrades, backups, monitoring) | Instances created, upgraded, backed up and restored automatically on DigitalOcean | 5–7 weeks |
| **M3 Portal and back office** | 067 without checkout, 072 | Sign-up → live instance, plan granted by invite code or staff approval; beta customers invoiced by hand | 4–5 weeks |
| **M4 Scale and harden** | Q25 (raise DigitalOcean limits), production hosts, 073 (security review, load and failure tests, legal, support, status page) | Production capacity, drills passed | 2–3 weeks |
| **M5 Payments and launch** | 068 (provider chosen then — Q3), 067 checkout | Pay on the site → live instance, renewals, dunning; public launch | 3–4 weeks |

The owner set this order on 27 Oct 2026: **infrastructure first, DigitalOcean account limits second
to last, payment gateway last.** Until M5, customers get their plan by invite code or staff approval
and are invoiced by hand; everything the payment gateway later drives (entitlements, lifecycle,
suspension) is already exercised by `cloudctl` and the back office.

## 18. Decisions taken in this plan (change them on purpose)

1. **One stack per customer, own MongoDB inside it.** Owner's instruction; also forced by the fixed
   `global` database name.
2. **Shared hosts for Starter/Pro, dedicated VM for Business.** Density keeps Starter profitable.
3. **Pull-based host agent**, not SSH from the control plane and not the Docker API over the network:
   no inbound management port on tenant hosts.
4. **Signed entitlements, fail-open on our outage.** The instance enforces limits locally.
5. **Bootstrap in env, credentials by API.** Owner's instruction; credentials rotate without redeploy.
6. **One Wasabi bucket and one IAM user per installation** *(owner, 2026-10-28; replaces the
   prefix-per-instance plan)*. Created at provisioning, deleted with the instance; the default of
   1,000 buckets per Wasabi account needs a raise before ~800 instances.
7. **DNS on AWS Route 53, no proxy in front** *(owner, 2026-10-28; replaces Cloudflare)*. The
   `alianhub.com` hosted zone gets one `A` record per tenant pointing at its host. TLS is one
   Let's Encrypt wildcard `*.alianhub.com` certificate issued by the control plane over a Route 53
   DNS-01 challenge and pushed to every host by the agent (hosts never hold AWS keys, and one
   certificate avoids the duplicate-certificate rate limit). Hosts are reachable directly, so a
   DigitalOcean Cloud Firewall allows only 80/443 from anywhere and SSH from the ops addresses.
8. **One time-tracker build for every customer**, connecting by workspace address (task 066), instead of
   a build per customer — see that PRD for why, and Q11.
9. **Build our own thin orchestrator** rather than adopting Coolify/CapRover/Portainer: the lifecycle
   (entitlements, suspension, plan resize, per-tenant S3) is the product, and those tools would sit
   beside it rather than run it. Revisit if M3 slips.
10. **Same stack as AlianHub** (Node, Express, MongoDB, Vue 3, Agenda) for the portal, so the same
    team can maintain both.
11. **DigitalOcean API v2 for servers only.** The orchestrator calls it to create, poll, tag and
    delete Droplets and Volumes, mint registry pull credentials and manage a few uptime checks.
    Adding a customer to a shared host makes **no** DigitalOcean call (host agent + Cloudflare).
12. **The image stays on GHCR**; DigitalOcean Container Registry ($5/month) mirrors each release by
    digest so hosts can still pull during a GitHub outage. No separate push workflow for customers.
13. **Per-tenant health is polled by the control plane**, not DigitalOcean uptime checks (100 per
    account); DO checks cover the portal, status page and one canary per host.
14. **Backups on Wasabi too** *(2026-10-28, owner chose Wasabi for S3)*: a separate
    `alianhub-cloud-backups` bucket written only through presigned PUT URLs. Wasabi bills every
    object for 90 days, so 7–14-day retention costs more than on Spaces; the backups adapter is one
    file if that changes.
15. **Credentials live only in the control plane's env**: `DO_API_TOKEN`, the Route 53 key
    (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, limited to the one hosted zone), the Wasabi root
    key that may create buckets and IAM users, and the ACME account key. `npm run cloud:check`
    proves each with a read-only call before anything is created.
