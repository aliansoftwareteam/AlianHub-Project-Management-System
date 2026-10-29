---
id: 070
title: Hosting infrastructure on DigitalOcean — account, hosts, network, edge, TLS, registry, storage, mail
status: active
priority: high
depends_on: [060, 065]
created: 2026-10-27
---

# Hosting infrastructure on DigitalOcean — account, hosts, network, edge, TLS, registry, storage, mail

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M2 · Repo: `alianhub-cloud` (`infra/`) + DigitalOcean, Cloudflare, Wasabi, Resend accounts

## Goal

Stand up everything AlianHub Cloud runs on, in DigitalOcean, reproducibly and safely: the account and
its limits, the control plane, the shared and dedicated tenant hosts with a fixed baseline, the
private network and firewalls, the edge router and TLS in front of every `<sub>.alianhub.com`, the
image registry, object storage for files and backups, and the mail relay. When this task is done an
engineer can run `cloudctl host add` and get a ready host in under 10 minutes, and the beta (M2) can
start.

This answers the owner's question "which DigitalOcean API, and do we push our Docker there?" — in
short: **DigitalOcean API v2 for servers only; tenants on a shared host need no DigitalOcean call;
the image stays on GitHub's registry with a DigitalOcean registry mirror.** The evidence is in
[digitalocean.md](../../active/060-alianhub-cloud-programme/resources/digitalocean.md).

## Decisions on 2026-10-28 (owner)

- **DNS is AWS Route 53**, not Cloudflare: the `alianhub.com` hosted zone gets one `A` record per
  tenant (`<sub>` → host IP, TTL 60) through the Route 53 API. No proxy sits in front, so TLS is a
  Let's Encrypt wildcard `*.alianhub.com` issued by the control plane over a Route 53 DNS-01 challenge
  and pushed to every host by the agent (`edge.tls`); a DigitalOcean Cloud Firewall leaves only
  80/443 open to the world.
- **Files: one Wasabi bucket per installation**, with its own Wasabi IAM user, inline policy and
  access key, created at provisioning and pushed to the instance; all four are removed on delete.
  Backups go to a separate Wasabi backups bucket through presigned PUT URLs.
- **DigitalOcean, Route 53 and Wasabi keys are placeholders** in the control plane's `.env` until the
  owner adds them (the accounts are tied to payment). Every adapter has a fake; `CLOUD_DRY_RUN=true`
  logs each provider call instead of making it; `npm run cloud:check` proves each key with read-only
  calls; the agent path is proven end to end on a local host before any key exists.
- Hosts can also be **registered by hand** (`cloudctl host add --manual`): the agent runs on any
  Docker machine, including the developer PC, so the cloud mode is testable without DigitalOcean.

- **2026-10-29 update (owner): DNS stays on QUIC.cloud, not Route 53.** `alianhub.com`'s name
  servers are QUIC.cloud's and cannot move, and customer addresses must stay `<sub>.alianhub.com`.
  The control plane therefore writes each tenant's `A` record and the `_acme-challenge` TXT records
  through QUIC.cloud's API (`https://api.quic.cloud/v2`; create, update in place and delete were
  tried against the real zone). Route 53 remains a supported option.
- **2026-10-29 update (owner): Wasabi names.** Each installation's bucket and IAM user are
  `alianhub-cloud-<subdomain>-<6 characters of the instance id>`, tagged with instance, subdomain,
  account, plan and env. Backups go in the shared `alianhub-cloud-backups` bucket (created in
  `ap-southeast-1`) under one folder per installation, named like its bucket.

## Where we start

- Nothing is provisioned. The owner chose DigitalOcean (Q5).
- Facts that shape this task (all sourced in digitalocean.md):
  - **SMTP ports 25, 465 and 587 are blocked on every Droplet**, with no documented way to lift it.
  - A **new account allows 3 Droplets, Basic plans up to $48**; prepaying $1,000 (Tier 4) allows
    25 Droplets of any size, $4,000 (Tier 5) allows 100. Every Business customer uses one Droplet.
  - **App Platform cannot run a MongoDB container** (no persistent volumes); **Load Balancers cannot
    route by Host**; Managed MongoDB clashes with the app's fixed `global` database. So: Droplets +
    Docker + Traefik.
  - **Spaces keys can be limited to a bucket, not a prefix**; 100 buckets and 200 keys per account by
    default; no documented object lock.
  - **Uptime checks: 100 per account**, no probe in India.
  - Memory-Optimized 8 vCPU / 64 GiB costs **$336/month**; Basic 8 vCPU / 16 GiB **$96**; a
    4 vCPU / 8 GiB Business server **$48–63**.
  - Cloudflare allows **200 DNS records** on a Free zone created after Sep 2024 (1,000 on older Free
    zones), **3,500 on Pro**.

## Scope — the work, task by task

### T1 — Account, team, limits, tokens

- DigitalOcean **team** "AlianHub Cloud" separate from any personal or client work, 2FA enforced,
  at least two owners.
- **Limits, in the owner's order (27 Oct 2026):** build and test the whole infrastructure first on
  what a new account allows — **3 Droplets, Basic up to $48** (4 vCPU / 8 GiB): one control plane,
  one shared host, one host to test Business servers, host moves and evacuation. Raise the limits
  **second to last** (Q25, phase M4), just before real customers: prepay $1,000 (credit used against
  bills; Tier 4: 25 Droplets, every size) or file a limit increase with the expected numbers (1–2
  weeks). Managed MongoDB, Spaces, the registry and volumes do not count against the Droplet limit.
- Projects `alianhub-cloud-prod` and `alianhub-cloud-staging`.
- Three **custom-scoped tokens**, stored only in the control plane's secret store, rotated every
  90 days:

  | Token | Scopes |
  |---|---|
  | Orchestrator | `droplet:*`, `image:read`, `ssh_key:read`, `vpc:read`, `tag:read/create`, `project:read/assign_resource`, `firewall:read/update`, `registry:read/update`, `spaces_key:read/create_credentials/delete`, `uptime:read/create/delete`, `monitoring:read/create`, `actions:read`, `sizes:read`, `regions:read` |
  | Back office | `billing:read`, `api:read` |
  | CI | `registry:read/update` (verify it can push) |

- Client: a thin `fetch` wrapper in `server/adapters/digitalocean.js` (CommonJS like the rest of our
  stack; the official `@digitalocean/dots` client is ESM-only). Honour `ratelimit-remaining` and
  `retry-after`; the budget is 5,000 requests/hour, 250/minute per token — provisioning a shared
  tenant uses **zero** DigitalOcean calls, so this is generous.

### T2 — Region and network

- Launch region per Q5: **BLR1** if customers are mostly in India (FRA1/AMS3 for Europe, NYC3 for
  the US). Host, files and backups of a tenant stay in one region.
- One **VPC** per region (`POST /v2/vpcs`); control plane and hosts talk over it (agent traffic,
  metrics) — free and private.
- **Cloud Firewall** by tag `ah-tenant-host` (attach by tag; a firewall takes only 10 Droplets by
  id): inbound 443 from Cloudflare IP ranges only, 22 from the office/VPN bastion only, everything
  from the VPC; outbound 443/80/53/123 and the VPC. A weekly job refreshes the Cloudflare ranges
  (`PUT /v2/firewalls/{id}`).
- Firewall `ah-control-plane`: 443 from Cloudflare, 22 from the bastion, VPC.
- Reserved IPv4 for the control plane and for each Business server (free while assigned).

### T3 — Control plane hosting

- Two Droplets (General Purpose 2 vCPU / 8 GiB, ~$63 each) running the portal API, back-office API,
  orchestrator workers and webhook receiver in Docker; behind Cloudflare. Until the limits are
  raised (M4), one `dev-b8` Droplet runs the control plane and the monitoring stack together.
- Control-plane MongoDB: a **DigitalOcean Managed MongoDB 3-node replica set** (~$45+/month) — here a
  managed database is right: it is one database, it holds the business, and HA plus point-in-time
  backups matter more than cost. (Tenants keep Mongo in their own stacks.)
- Prometheus, Grafana, Loki for 071 on a third small Droplet.
- Secrets (master encryption key, entitlements signing key, provider tokens) in environment
  variables injected from a password-manager vault at deploy; never in the database or the repo.

### T4 — Tenant hosts: sizes and baseline

Host classes *(placeholder until the M2 measurements)*:

| Class | Droplet | $/mo | Holds |
|---|---|---|---|
| `dev-b8` | Basic 4 vCPU / 8 GiB (allowed on a new account) | 48 | ~5 Starter; development, staging and the M2–M3 testing |
| `shared-m64` | Memory-Optimized 8 vCPU / 64 GiB | 336 | ~40–60 Starter or ~20–30 Pro by measured use |
| `shared-b16` | Basic 8 vCPU / 16 GiB | 96 | ~10–14 Starter (first hosts, or while on Tier 1) |
| `dedicated-8` | Basic Premium 4 vCPU / 8 GiB or GP 2 / 8 | 56–63 | one Business customer |

- **Image:** a golden snapshot built by Packer (or a scripted `doctl` build) monthly: Ubuntu 24.04
  LTS, pinned Docker Engine + Compose plugin, the host agent, node-exporter, cAdvisor, the log
  shipper, Traefik, and the current AlianHub image already pulled. Boot from the snapshot is
  minutes faster than cloud-init on a bare image and has no drift. (The Docker 1-Click image is not
  pinned to versions — not used.)
- **Bootstrap** (`user_data` cloud-init, < 64 KiB): writes the host's agent token and identity,
  enables the services, joins the VPC, registers with the control plane (`host.report`).
- **Data volume:** each host mounts a DigitalOcean **Volume** at `/srv/alianhub` (stack files, Docker
  volumes with each tenant's Mongo data, logs; tenant files themselves are in object storage). If a Droplet dies, a new Droplet from the snapshot re-attaches the volume and
  every tenant comes back with **no data loss since the last write**, in minutes — instead of
  restoring last night's dump. Volume size per class: 200 GiB ($20) for `shared-m64`, 50 GiB ($5)
  for `dedicated-8`; resized online when 70% full.
- **Droplet backups off** for tenant hosts (the volume and nightly `mongodump` cover recovery; DO's
  crash-consistent backups would cost 20–30% more for little).
- Hardening: SSH keys only, no root login, `unattended-upgrades` for security patches with reboots
  in the maintenance window, `fail2ban`, auditd, time sync, swap 2 GiB, Docker `live-restore`,
  log rotation, `vm.overcommit_memory` defaults, `nofile` raised for Traefik.
- Placement uses **measured** memory (cAdvisor working set, p95 over 7 days) with 25% headroom;
  tier limits from 065 stay as per-container ceilings. This is what makes the economics work (see
  Management view).

### T5 — Edge and TLS

> Superseded on 2026-10-28: Route 53 + a control-plane wildcard certificate (see Decisions). The
> Cloudflare text below is kept for the record.

- DNS stays on **Cloudflare**: one proxied `A` record per tenant (`acme` → host IP) created by the
  orchestrator (069) through the Cloudflare API with a zone-scoped token; TTL auto.
- Zone plan: **Cloudflare Pro** before the beta (3,500 records; WAF rules; ~$25/month). If the
  `alianhub.com` zone is a Free zone created after Sep 2024 it stops at 200 records.
- TLS: Cloudflare Universal SSL at the edge covers `*.alianhub.com` first-level names; SSL mode
  **Full (strict)**; each host's Traefik serves a **Cloudflare Origin CA wildcard certificate**
  (15-year, `*.alianhub.com`), so no ACME runs on hosts. **Authenticated origin pulls** (mTLS from
  Cloudflare) so only Cloudflare can reach Traefik even if an IP leaks.
- Traefik on every host (static config in the snapshot, dynamic from Docker labels per 065):
  entrypoint `websecure`, file middlewares `platform-deny` (403 for `/api/v2/platform*`),
  `security-headers`, `ratelimit` (per IP, generous), access logs to the shipper, metrics for 071.
- WebSockets (Socket.io) pass through Cloudflare and Traefik with no special setup.
- Upload limit: Cloudflare Pro refuses request bodies over 100 MB — matches `maxFileBytes` (064).
- **Scale step past ~3,000 tenants:** replace per-tenant records with one `*.alianhub.com` wildcard
  pointing at a small edge tier (2 Droplets on a Reserved IP, Traefik routing by Host over the VPC
  from a map the control plane maintains), or move the zone to Enterprise. Not built now; written
  down so it is not a surprise.

### T6 — Registry

- **Source of truth: GHCR** (`ghcr.io/aliansoftwareteam/alianhub`), public, multi-arch, already
  built by `.github/workflows/docker.yml`. Droplets pull it anonymously — **we do not have to push
  to DigitalOcean.**
- **Mirror: DigitalOcean Container Registry, Basic ($5/month)**, registry `alianhub` in the launch
  region: the release workflow also pushes the same digest to
  `registry.digitalocean.com/alianhub/alianhub`. Hosts pull **by digest** from DOCR and fall back
  to GHCR, so new hosts and upgrades keep working during a GitHub outage.
- Pull credentials: the control plane mints **read-only, 1-hour** credentials
  (`GET /v2/registries/alianhub/docker-credentials?read_write=false&expiry_seconds=3600`) and hands
  them to the host agent inside each `stack.create` / `stack.update` job — no long-lived registry
  token sits on hosts.
- Monthly garbage collection outside release windows (manual GC makes the registry read-only for a
  while). Keep the last 5 versions.
- Order: start M2 on GHCR only; add the mirror in M4.

### T7 — Object storage

> Superseded on 2026-10-28: one Wasabi bucket and IAM user per installation, backups in a Wasabi
> backups bucket (see Decisions).

- **Tenant files: Wasabi** (Q26), one bucket per region (`alianhub-cloud-tenants-<region>`), a
  prefix per instance and **one IAM user + policy per instance** limited to its prefix
  (architecture §15) — the isolation Spaces cannot give. Wasabi's nearest region to India is
  Singapore; if Indian data residency is required, switch to the fallback.
- **Fallback (Spaces):** one Spaces bucket per shared host and per Business customer, with a
  per-bucket key; blast radius one host (~30–60 tenants); ~100 buckets cover ~2,000+ tenants
  before a limit increase. 063 supports both (shared bucket + prefix, or bucket of its own).
- **Backups: Spaces** in the launch region (`alianhub-cloud-backups-<region>`), versioning on,
  lifecycle expiry per plan retention. Spaces has no minimum storage duration — Wasabi bills
  everything for 90 days, which would make 7–14-day backups cost 6–13× more. Hosts never hold a
  backups key: each nightly backup is uploaded through a **presigned PUT URL** minted by the control
  plane for that one object, so a compromised host can add a backup but cannot list, read or delete
  any (this replaces object lock, which Spaces does not document).
- **Downloads bucket** (Spaces + its built-in CDN): tracker installers and update feeds (066),
  `releases/index.json` mirror.

### T8 — Mail

- **Resend over HTTPS** for all platform and instance mail (SMTP ports are blocked on Droplets).
  The app already prefers `RESEND_API_KEY` when set; 069 pushes it via `PUT /api/v2/platform/config`
  with `RESEND_FROM_EMAIL`. `NODEMAILER_*` stays unset on hosted instances.
- Sending domain `mail.alianhub.com` (or `notify.alianhub.com`) with SPF, DKIM and DMARC
  (`p=quarantine`, reports to a monitored box); bounce and complaint webhooks to the control plane
  (069 T6).
- One Resend API key per region at first; per-instance daily caps are enforced in the app (064 T6).
  Move to per-instance keys or a provider with sub-accounts if one tenant's complaints ever affect
  the others.
- Business "own mail": allowed only through an API key (Resend/Postmark/SES API) or an SMTP
  provider offering a non-standard port (e.g. 2525); the console's mail test explains the blocked
  ports when 25/465/587 fail (061).

### T9 — Monitoring hooks on the provider side

- `monitoring: true` on every Droplet (free metrics agent) and **tag-based alert policies**
  (`POST /v2/monitoring/alerts` on `ah-tenant-host`: memory > 85% 10 min, disk > 80%, CPU > 90%
  30 min, to email + Slack) — a safety net beside 071's Prometheus.
- DigitalOcean **uptime checks** only for: portal, back office, status page, and one canary tenant
  per host (the 100-check account limit rules out one per tenant; per-tenant health is polled by
  the control plane, 071).

### T10 — Infrastructure as code and runbooks

- `infra/` in `alianhub-cloud`: Packer template for the golden snapshot, cloud-init template,
  Traefik static config and middlewares, firewall and alert definitions, Cloudflare zone settings
  (Terraform with the `digitalocean` and `cloudflare` providers for the static pieces; the
  orchestrator owns the dynamic ones — tenant records, hosts).
- `cloudctl host add|cordon|drain|evacuate|remove` (069) uses these.
- Break-glass SSH: through a bastion Droplet with short-lived certificates (`step-ca` or
  Teleport-lite), every session logged.

### T11 — Staging environment

The same layout at minimum size in the staging project and a `staging-alianhub.com` (or
`*.stg.alianhub.com` via a separate zone) — every workflow in 069 and every upgrade in 071 runs here
first.

## How it looks

What exists after this task (launch region BLR1, beta size):

```
DigitalOcean team "AlianHub Cloud"
└── project alianhub-cloud-prod (BLR1, VPC 10.20.0.0/16)
    ├── cp-1, cp-2        GP 2/8   control plane
    ├── mon-1             Basic    Prometheus/Grafana/Loki
    ├── bastion-1         Basic    SSH, 22 from office
    ├── host-blr1-01      M 8/64   shared  + vol 200 GiB
    ├── host-blr1-02      M 8/64   shared  (warm spare)
    ├── biz-ins_01jd5x…   B 4/8    Business + vol 50 GiB
    ├── firewalls  ah-tenant-host, ah-control-plane
    ├── registry   alianhub (Basic, mirror)
    └── spaces     alianhub-cloud-backups-blr1,
                   alianhub-downloads (CDN)
Managed MongoDB  cp-db (3 nodes)
Cloudflare  alianhub.com (Pro): acme → host-blr1-01 …
Wasabi      alianhub-cloud-tenants-ap-southeast-1
Resend      mail.alianhub.com
```

`cloudctl host add`:

```
$ cloudctl host add --class shared-m64 --region blr1
→ droplet host-blr1-03 (m-8vcpu-64gb) from snap-2026-11
→ volume vol-host-blr1-03 200 GiB attached
→ active in 58 s, agent registered in 1m41s
→ firewall ah-tenant-host via tag ✓
→ canary uptime check ✓
host-blr1-03 ready · 0/60 units · BLR1
```

## Platform view

- **Isolation.** Per-tenant Docker networks (065), host firewall to Cloudflare only, authenticated
  origin pulls, per-instance storage credentials, presigned-only backup writes, no long-lived
  registry or backup credentials on hosts.
- **Recoverability.** Volume per host (minutes, no data loss) → nightly encrypted dump (≤ 24 h loss)
  → host evacuation runbook (071).
- **Single points of failure** at launch: one region, Cloudflare, the control plane (two Droplets +
  managed DB). A control-plane outage stops sign-ups and changes, never running instances (they
  hold their own entitlements).
- **Limits to watch** (gauges with 80% alerts): Droplet count against tier, Spaces buckets/keys,
  Cloudflare records, uptime checks, DO API rate, registry storage.

## Management view

**Monthly cost at beta size** (list prices, 27 Oct 2026):

| Item | $/mo |
|---|---|
| Control plane 2 × GP 2/8 | 126 |
| Managed MongoDB 3-node | ~45 |
| Monitoring + bastion (Basic) | ~30 |
| Shared hosts 2 × M 8/64 (one warm spare) | 672 |
| Host volumes 2 × 200 GiB | 40 |
| Registry Basic, Spaces base, uptime checks | ~15 |
| Cloudflare Pro | ~25 |
| Wasabi (1 TB minimum) | ~8 |
| Resend (paid tier) | ~20 |
| **Fixed platform total** | **~$980** |

Each Business customer adds ~$60–70 (Droplet + volume). The platform breaks even at roughly 25–35
paying Starter/Pro customers.

**Cost per shared tenant — the number that changes the plan.** At the $75/host assumed in
architecture §12 a Starter tenant cost ~$2.5; on DigitalOcean the same 64 GiB host is $336:

| Density on `shared-m64` | $/Starter tenant | Starter margin at $29* |
|---|---|---|
| 30 (tier ceilings) | 11.20 | ~53% |
| 45 (measured use) | 7.50 | ~65% |
| 60 (measured use) | 5.60 | ~72% |

\*after ~$2 payment fees and ~$0.5 storage/backup/mail. Pro at $79 uses 2 units: ~65% margin at the
tier-ceiling density, 75–80% at measured density. **Decision for Q1:** keep Starter at $29 only if M2 measurements show ≥ 45 Starter
stacks per 64 GiB host; otherwise $35–39, or a 5-seat $19 tier on `shared-b16` hosts.

- **While building (M2–M3):** 3 × `dev-b8` ($144) + managed MongoDB (~$45) + Cloudflare Pro, Wasabi,
  Resend, registry ≈ **$250/month**.
- **Up-front cash at M4:** $1,000 prepayment for Tier 4 (it is credit, consumed by the first ~month),
  or a free limit request.
- **Risks:** the limit request can take 1–2 weeks or be refused — start it at the beginning of M4,
  not on launch week; Cloudflare Free-zone record cap.

## Out of scope

- Multi-region and customer-chosen regions.
- Kubernetes (DOKS) — revisit after M4 or past ~10 shared hosts.
- Customer custom domains (Cloudflare for SaaS custom hostnames) — Q10, later.

## Acceptance criteria

- [ ] The DigitalOcean team exists with 2FA, two owners and three scoped tokens in the secret store;
      the whole setup works on the new-account limit (3 × Basic $48); before real customers (M4) the
      limits are raised to Tier 4 or an approved increase.
- [ ] VPC, firewalls (by tag) and alert policies exist in the launch region via `infra/`.
- [ ] `cloudctl host add` creates a ready shared host from the golden snapshot with an attached
      volume in under 10 minutes, registered with the control plane.
- [ ] A tenant host accepts 443 only from Cloudflare (verified by a direct-IP request failing) and
      serves `*.alianhub.com` with Full (strict) TLS and authenticated origin pulls.
- [ ] `/api/v2/platform/*` through the public edge returns 403.
- [ ] Hosts pull the AlianHub image by digest from DOCR with 1-hour credentials and fall back to GHCR
      when DOCR is unreachable (tested by blocking it).
- [ ] Tenant files land in Wasabi under the instance prefix with a key that cannot read another
      prefix (tested); backups upload through presigned PUTs and the host cannot list or delete
      the backups bucket (tested).
- [ ] Instance mail goes out through Resend with SPF/DKIM/DMARC passing.
- [ ] Destroying a host's Droplet and re-attaching its volume to a new one brings every tenant back
      with no data loss (drill).
- [ ] The staging environment mirrors production at minimum size.

## Dependencies

- 065 (managed compose and Traefik labels), 069 (the orchestrator calls the adapters configured here),
  071 (monitoring stack on `mon-1`).

## Open questions

- Q5 — ✅ BLR1.
- Q25 — ✅ second to last: build on the new-account limit, raise limits in M4 (prepay or request,
  chosen then).
- Q26 — ✅ Wasabi (Singapore) for tenant files, Spaces for backups.
- Q6 — open: shared hosts + dedicated Business servers is the default; the host classes support
  either answer.
- Q24 — registry: GHCR + DOCR mirror (default, from the research).
- Q8 — `*.alianhub.com` vs a separate tenant domain.

## Estimate

8–10 engineer days for the build-out and the drills, plus 1–2 weeks of calendar lead time for the
limit increase and the Cloudflare/Resend/Wasabi accounts.
