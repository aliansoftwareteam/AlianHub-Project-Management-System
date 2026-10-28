---
id: 071
title: Fleet operations — staged upgrades, nightly backups, restore, monitoring and on-call
status: active
priority: high
depends_on: [060, 065, 069, 070]
created: 2026-10-27
---

# Fleet operations — staged upgrades, nightly backups, restore, monitoring and on-call

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M2 (infrastructure) · Repo: `alianhub-cloud` (new) + runbooks

## Goal

Keep every hosted instance up to date, backed up, watched and recoverable, with a small team. A new
AlianHub release reaches all customers in safe waves that stop and roll back on their own; every
database is backed up nightly to storage a compromised server cannot erase; a lost host or a
customer's "we deleted everything" is a rehearsed, timed runbook; and the right person is woken up
only for things a customer would notice.

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

## Where we start

- AlianHub already exposes `/health` (200 only when the database answers), migration state, build
  info and an Upgrade page (`Modules/Instance/controller.js` `upgrade`) that reads release metadata
  including `selfHost.upgradeNeeded` / `breaking` flags from `CHANGELOG.md`.
- `MIGRATIONS_AUTO` runs pending migrations at boot.
- 065 publishes digest-pinned, signed images and `releases/index.json`; 069 provides per-instance
  `upgrade`, `backup`, `restore` and `move_host` workflows and host reports; 070 provides hosts,
  networking and the backups bucket.
- Nothing watches a fleet yet.

## Scope — the work, task by task

### T1 — Release rings and rollout

- Rings: **ring 0** internal instances (our own AlianHub, demo, a canary per tier) → **ring 1** 10%
  of customers (opted-in early adopters first, then random, never Business) → **ring 2** everyone
  except Business → **ring 3** Business in each customer's chosen window (Q17).
- A rollout is a record `{ version, digest, rings: [{ ring, startedAt, finishedAt, okCount,
  failCount }], state: running|paused|done|rolled_back }` driven by an Agenda job.
- Each ring waits for a soak time (ring 0: 24 h, ring 1: 48 h) and checks health gates before the
  next: error-rate (5xx) not above the previous version's by more than 0.5 points, p95 latency not
  worse by 20%, no failed migrations, no increase in crash restarts.
- Per instance: 069's `upgrade` workflow (backup → new digest → healthy + migrations done → verify
  sign-in page and API smoke) with automatic rollback to the previous digest; a migration that is not
  backwards-compatible (`releases/index.json` `migration.reversible: false`) forces restore-from-backup
  as the rollback path and is flagged before the rollout starts.
- Two failures in a ring pause the rollout and page on-call.
- Upgrades run inside each instance's maintenance window (default: 02:00–05:00 in the instance's
  `CRON_TZ`), with the in-app banner 24 hours ahead ("Brief update tonight between 02:00 and 05:00").
- Security releases can skip soak times with a two-person approval in the back office.

### T2 — Nightly backups

> 2026-10-28: the backups bucket is on Wasabi (owner's choice of S3), still written only through
> presigned PUT URLs. Client-side encryption follows in M4; M2 relies on the bucket's privacy.

- Database: the host's backup runner (part of the host agent's `stack.backup`) runs
  `mongodump --archive --gzip` against each tenant's Mongo container over its internal network,
  encrypts it client-side (age/libsodium, to a per-instance public key — the host can encrypt but
  never decrypt), and uploads it to the DigitalOcean Spaces backups bucket under
  `backups/<instanceId>/<yyyy>/<mm>/<dd>/<ts>.archive.gz.age` through a **presigned PUT URL** the
  control plane mints for that one object. Hosts hold no backups credentials at all.
- Schedule: one per instance per night, spread across 00:00–06:00 host time; a run takes
  seconds to minutes for typical sizes.
- Retention by plan (architecture §12): Starter 7, Pro 14, Business 30 daily; plus weekly kept 8
  weeks for Pro and Business. Expiry is done by the control plane (it deletes what it listed as
  expired), plus a Spaces lifecycle rule as a backstop. Spaces documents no object lock; the
  protection is that hosts can only add objects through single-use presigned URLs, and bucket
  versioning keeps overwritten objects.
- Spaces, not Wasabi, for backups: Wasabi bills every object for at least 90 days, which would make
  7–14-day backups cost 6–13× more.
- Files: already in object storage (Wasabi); protection is the tenants bucket's versioning, plus a
  nightly copy to a second region for Business if the SLA needs it.
- Host-level safety net: each host's data volume (070 T4) means a dead Droplet loses nothing since
  the last write; nightly dumps cover deletion and corruption, not just host loss.
- `backups` collection: `{ instanceId, at, bytes, sha256, keyId, kind: nightly|pre_upgrade|final|
  manual, expiresAt }`; the portal (067) lists the latest for download on Pro and Business (decrypted
  and streamed by the control plane, link valid 15 minutes).
- Verification: every night one random instance's latest backup is restored into a scratch stack,
  `/health` and a count of users/tasks compared with the usage snapshot — failures alert.

### T3 — Restore

Three runbooks, each scripted in `cloudctl` (069) and timed in a drill before launch (073):

| Case | Command | Target time |
|---|---|---|
| Customer asks to undo a disaster (whole instance to last night) | `cloudctl restore acme <backup-id>` (maintenance on → stop app → restore into the existing Mongo → start → verify) | < 30 min |
| Restore into a side instance so the customer can copy data back | `cloudctl restore acme <backup-id> --as acme-restore-1102` (new temporary subdomain, 7 days) | < 30 min |
| Host lost | `cloudctl host evacuate host-blr1-03` (each tenant: `stack.create` on another host from its last backup + DNS switch) | < 2 h for a full host |

Point-in-time recovery between nightly backups is out of scope in v1; Business may get a 4-hourly
backup if Q19/SLA needs it.

### T4 — Monitoring

| Layer | What | How |
|---|---|---|
| Outside-in | Every instance `https://<sub>.alianhub.com/health` every minute through Cloudflare | the control plane's health poller (it already polls `/usage`); DigitalOcean uptime checks (100 per account, $1 each) only for the portal, back office, status page and one canary tenant per host |
| Hosts | CPU, memory, disk, load, network, Docker daemon | node-exporter + cAdvisor on every host → Prometheus on `mon-1`; DigitalOcean's free metrics agent with tag-based alert policies as a safety net (070 T9) |
| Containers | restarts, OOM kills, memory against limit, per tenant | cAdvisor labels `com.alianhub.instance` |
| App | 5xx rate, p95 latency, migration errors, queue depth (Agenda), socket connections | Traefik metrics per router + AlianHub `/api/v2/instance/metrics` scraped with the platform key |
| Control plane | workflow failures per step, webhook lag, API errors, job queue age | Prometheus + Sentry |
| Business | storage counter drift (063), mail complaint rate, certificate expiry | scheduled checks |

Dashboards (Grafana): Fleet overview, Host detail, Instance detail (linked from the back office),
Rollout, Backups.

Logs: application logs stay on each stack's `logs` volume (7 days); errors and warnings are shipped
with a lightweight shipper (Vector/Promtail) to a central store (Loki) for 14 days, labelled by
instance — never with request bodies.

### T5 — Alerting and on-call

| Severity | Examples | Route |
|---|---|---|
| Page (24×7) | an instance down 3+ min for Business or 5+ customers down; host down; backups failed fleet-wide; control plane down; provisioning circuit breaker open | phone/SMS via on-call tool |
| Urgent (business hours) | single Starter/Pro instance down 10+ min; disk > 85%; rollout paused; backup failed for one instance twice; cert expiring < 14 days | chat channel + ticket |
| Info | drift > 1%, mail complaints rising, capacity < 30% | daily digest |

- Every alert links to a runbook (`runbooks/<alert>.md`) and the instance/host page in the back office.
- On-call: weekly rotation across the 2–3 engineers, a secondary, and a monthly review of every
  page (was it actionable?).
- Customer-facing incidents go to the status page (073) within 15 minutes.

### T6 — Capacity and cost reports

Weekly report generated from host reports and usage snapshots: units used per host, growth per week,
hosts needed in 30/60/90 days, cost per tenant per tier (compute + storage + backups + mail) against
plan price → gross margin per plan for the back office dashboards (072).

### T7 — Runbooks

`runbooks/` in the repo, each with symptoms, checks, commands, rollback and who to tell:
instance down, host down, disk full, Mongo won't start (WiredTiger repair), restore (three cases),
rollout paused, failed migration, DNS/Cloudflare outage, provider outage, certificate failure, mail
blocked/complaints, storage drift, suspected compromise of one instance (isolate: stop routing,
rotate keys, preserve volumes), control-plane restore.

## How it looks

Rollout page (back office):

```
Rollout 14.41.0  sha256:4b1e…   running
───────────────────────────────────────
ring 0 internal   6/6   ✓  soaked 24 h
ring 1 10%       31/31  ✓  soaking 18/48 h
   5xx 0.21% (prev 0.24%)  p95 312 ms (prev 305)
ring 2 rest       0/284    waiting
ring 3 Business   0/12     per window
          [ Pause ]  [ Roll back ring 1 ]
```

Backups for one instance (back office and, for Pro+, portal):

```
acme · Pro · 14 nightly + 8 weekly kept
 2 Nov 02:14  212 MB  ✓ verified 2 Nov
 1 Nov 02:11  210 MB  ✓
31 Oct 02:13  209 MB  ✓
 …
 [ Restore… ]  [ Restore as side copy… ]
```

Page text an on-call engineer receives:

```
[PAGE] host-blr1-03 unreachable 4m
14 instances affected (2 Business)
runbook: runbooks/host-down.md
back office: ops.alianhub.com/hosts/…
```

## Platform view

- **Upgrades are the riskiest routine operation.** Rings, health gates, pre-upgrade backups and
  automatic rollback keep one bad release from reaching everyone; irreversible migrations are known
  before the rollout starts.
- **Backups are only real if restored.** Nightly random restore verification plus quarterly full
  drills (073) prove it.
- **Separation.** Backups live in a different provider bucket, are encrypted to keys hosts never
  hold, and are written only through single-use presigned URLs; a compromised host can neither read
  old backups of other tenants nor erase its own.
- **Noise budget.** Pages only for customer-visible impact; everything else is a ticket or digest.

## Management view

- **Why it matters.** Data loss or a bad upgrade across all customers is the event that ends a hosting
  business; this task is the insurance. It is also what makes the 99.9% Business SLA a promise we
  can keep.
- **Cost.** 12–15 developer days, plus running cost: monitoring stack on a small control-plane
  Droplet, backup storage (~30% of customer database size × retention), uptime checks per instance
  (see digitalocean.md), an on-call tool (~$20–40/user/month).
- **People.** On-call needs at least 2 engineers to be humane; budget the on-call allowance.
- **Metrics.** Monthly uptime per tier, backup success rate (target 100%), restore drill time,
  rollout duration, pages per week (target < 3).
- **Risk:** the team spends its time operating instead of building. Mitigation: automation first
  (rings, auto-rollback, auto-host creation), runbooks, and a monthly review that turns repeated
  manual work into code.

## Out of scope

- Point-in-time recovery (oplog shipping) — later for Business if the SLA needs it.
- Multi-region failover.
- Customer-visible metrics dashboards.

## Acceptance criteria

- [ ] A release goes ring 0 → 3 with soak times and health gates; an injected failing build stops at
      ring 0 or 1 and every upgraded instance rolls back automatically.
- [ ] Every instance has a nightly, encrypted database backup on Spaces with plan-based retention,
      written through a presigned URL; a host cannot list, read or delete the backups bucket
      (tested); the backups dashboard shows 100% success for 7 days before launch.
- [ ] The nightly restore verification runs and alerts on failure.
- [ ] All three restore runbooks are executed in a drill within their target times.
- [ ] The control plane polls every instance's `/health` each minute and alerts per the T5 tiers;
      each host has one DigitalOcean canary uptime check.
- [ ] Host, container, app and control-plane metrics are on dashboards; each paging alert has a
      runbook link and was triggered once in a drill.
- [ ] The weekly capacity and cost report lists margin per plan.
- [ ] Runbooks in T7 exist and were reviewed by a second engineer.

## Dependencies

- 065 (digests, release index), 069 (workflows, host reports, `cloudctl`), 070 (hosts, backups
  bucket, edge metrics).

## Open questions

- Q17 — upgrade policy (default: automatic rings, Business picks a window).
- Q19 — backup download (default Pro+).

## Estimate

12–15 developer days, plus a one-day restore drill before launch.
