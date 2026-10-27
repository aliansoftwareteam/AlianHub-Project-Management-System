---
id: 060
title: AlianHub Cloud — sell and run hosted AlianHub instances (programme)
status: active
priority: high
depends_on: []
created: 2026-10-27
---

# AlianHub Cloud — sell and run hosted AlianHub instances (programme)

## Goal

Let anyone buy a hosted AlianHub on alianhub.com: choose a plan, name a subdomain, pay, and get a
live private instance at `https://<name>.alianhub.com` within minutes, renewed monthly, with add-ons
(storage, time tracker, seats) switched on from the portal. We run everything on DigitalOcean; the
customer never touches a server.

This is the programme PRD. It holds the phases, the child tasks and the definition of done for the
whole thing. The contracts every child task shares (states, APIs, entitlements, plans, layout) are
in [resources/architecture.md](resources/architecture.md); unanswered decisions are in
[resources/open-questions.md](resources/open-questions.md); DigitalOcean facts and the API choice
are in [resources/digitalocean.md](resources/digitalocean.md).

## Where we start

Much of the in-app foundation already exists, which keeps "the build" small:

| Need | Exists today | Gap |
|---|---|---|
| One-command install | `Dockerfile`, `docker-compose.yml` (app + mongo, healthcheck), image on GHCR | Compose hard-codes container, volume and network names, so two customers cannot share a server |
| Env overrides lock settings | `Config/instanceSettings.js` + `Modules/Instance/settingsCatalog.js`: a key set in env is shown locked in Settings → Instance | No "platform" owner; customer owner can still edit mail/storage/URLs that we must own |
| API to configure an instance | `/api/v2/instance/*` with `INSTANCE_ADMIN_KEY` header (`Modules/Instance/guard.js`) | No headless provisioning, no entitlements, no usage report, no suspension |
| First-run setup | `/api/v2/setup/complete` (wizard) | Unauthenticated until the first user exists — a stranger could claim a fresh hosted instance |
| Plan limits | `company.planFeature` (`users`, `bucketStorage`, `maxFileSize`, `timeTrackerUser`, …) | Mostly checked in the browser only; storage usage is computed by listing every object |
| S3 storage | Wasabi driver, **one bucket per company named after its id** | Hits the account bucket ceiling; cannot scope a key to one customer |
| Maintenance mode | `Modules/Instance/maintenance.js` | No read-only or suspended state |
| Time tracker | Electron app in `time-tracker-app/`, server URL baked in at build time (`APIURL`) | Cannot connect to an arbitrary customer workspace |
| Billing | Old in-app Chargebee/Paddle plugins (`frontend/src/plugins/chargebee`, `paddle`) | Wrong place for hosted billing — billing moves to the portal |

The ROADMAP already lists "Managed cloud hosting (we run it for you)" as a paid offering.

## Scope — child tasks

### Phase M1 — the build (this repo)

| ID | Task | Delivers |
|---|---|---|
| [061](../061-managed-mode-settings/task.md) | Managed mode and platform-owned settings | `HOSTING_MODE=managed`; settings precedence env > platform > saved > default; customer-safe Instance console; setup wizard closed; old billing screens hidden |
| [062](../062-platform-api/task.md) | Platform API on every instance | `/api/v2/platform/*`: provision owner + workspace, push config, entitlements, usage, lifecycle, owner links, key rotation |
| [063](../063-s3-prefix-storage/task.md) | Shared S3 storage with a prefix per instance | Generic S3 driver (Spaces/Wasabi/AWS), prefix mode, hot credential reload, storage usage counter |
| [064](../064-plan-entitlements/task.md) | Plan limits enforced on the server | Seats, storage, file size, workspaces, tracker, mail caps, read-only/suspended; in-app "Plan & usage" page |
| [065](../065-managed-docker-stack/task.md) | Hosting-ready image and compose template | Multi-tenant-safe compose, Traefik labels, limits per tier, release pipeline, `scripts/cloud/up.sh` one-command bring-up |
| [066](../066-tracker-any-workspace/task.md) | Time tracker add-on that connects to any workspace | One signed build; workspace address on first run; "Open in tracker" deep link; gated by entitlement |

### Phase M2 — infrastructure (new repo `alianhub-cloud`)

| ID | Task | Delivers |
|---|---|---|
| [070](../../backlog/070-hosting-infrastructure/task.md) | Hosting infrastructure on DigitalOcean | Host baseline, network, firewalls, edge, registry, TLS, storage, mail — on development-size Droplets first |
| [069](../../backlog/069-provisioning-orchestrator/task.md) | Provisioning orchestrator and host agent | State machine, DigitalOcean + DNS + storage calls, host agent, `cloudctl` CLI |
| [071](../../backlog/071-fleet-operations/task.md) | Fleet operations | Rolling upgrades, nightly backups, restore, monitoring, alerting, runbooks |

### Phase M3 — portal and back office

| ID | Task | Delivers |
|---|---|---|
| [067](../../backlog/067-cloud-portal/task.md) | Cloud portal | Sign-up, plan and subdomain pickers, live provisioning screen, customer dashboard (checkout waits for M5) |
| [072](../../backlog/072-cloud-back-office/task.md) | Back office | Staff console: customers, instances, jobs, hosts, catalog, manual actions, dashboards |

### Phase M4 — scale and harden

| ID | Task | Delivers |
|---|---|---|
| Q25 | DigitalOcean limits | Prepay or limit increase; production-size hosts |
| [073](../../backlog/073-cloud-launch-readiness/task.md) | Launch readiness | Legal, emails, support, status page, security review, load test, beta, pricing page |

### Phase M5 — payments and launch (last, per the owner)

| ID | Task | Delivers |
|---|---|---|
| [068](../../backlog/068-cloud-billing/task.md) | Billing engine | Provider adapter (provider chosen then — Q3), subscriptions, add-ons, proration, dunning, tax, invoices, ledger; checkout in 067 |

### Order

Set by the owner on 27 Oct 2026: infrastructure first, DigitalOcean account limits second to last,
payment gateway last.

```
M1 build (061–066)
  └─► M2 infrastructure (070 069 071)
        └─► M3 portal + back office (067 072)
              └─► M4 scale DO + harden (Q25 073)
                    └─► M5 payments + launch (068)
```

Inside M1: 061 first (managed mode is the switch every other change reads), then 062 and 063 in
parallel, then 064 (needs 062's entitlements endpoint and 063's usage counter), 065 alongside, 066
last (independent of the rest, can move earlier if a developer is free).

## Out of scope (for this programme)

- Customer-owned servers ("bring your own cloud") — the open-source self-hosted path already covers it.
- Multiple regions chosen by the customer — one launch region (Q5), more later.
- Customer custom domains in the first release (Q10).
- Selling AI credits (Q14) — bring your own key at launch.
- Migrating the old Chargebee SaaS customers, unless Q18 says there are some.
- A Kubernetes-based platform — revisit only when one region passes ~1,000 instances.

## Acceptance criteria (programme done)

- [ ] A stranger can go from alianhub.com → plan → subdomain → payment → working instance at
      `https://<name>.alianhub.com` with no staff involvement, p95 under 3 minutes on a shared host.
- [ ] The owner receives an activation email, sets a password, and lands in their workspace with
      sample data if they chose it.
- [ ] Monthly renewal charges automatically; a failed renewal walks through past_due → read_only →
      suspended → cancelled → deleted on the configured timeline, with an email at each step, and a
      successful payment at any point before deletion restores full access within 1 minute.
- [ ] Buying or removing an add-on in the portal changes the instance's limits within 1 minute
      (storage, tracker seats, extra seats), and the instance enforces them on the server.
- [ ] Upgrading Starter → Pro applies new limits immediately and new compute within 5 minutes;
      downgrading is refused while usage exceeds the target plan, with the reason shown.
- [ ] Every instance is backed up nightly to a separate bucket; a staff member can restore one into
      a fresh stack in under 30 minutes using the documented runbook.
- [ ] A new AlianHub release reaches every instance through staged waves with automatic rollback
      on a failed health check.
- [ ] One customer's credentials, files, database and containers are unreachable from another
      customer's instance (verified by the security review in 073).
- [ ] The back office shows every instance's state, host, version, usage and history, and every
      staff action is audited with a reason.
- [ ] Terms, privacy policy, DPA, refund policy and the AGPL source link are live.

## Constraints & notes

- Hard rules from CLAUDE.md apply to every M1 change: i18n for every string (Rule 3), tokens for
  every colour (Rule 5), Conventional Commits and the beta build log (Rule 4), minimal comments
  (Rule 1).
- Nothing in managed mode may make the open-source self-hosted install worse. Every M1 change is
  behind `HOSTING_MODE=managed` or is a strict improvement for everyone (for example the compose
  file no longer hard-coding names).
- The portal is a separate repository and product; tasks 067–073 live here only until that repo
  exists, then move with it.

## Resources

- `resources/architecture.md` — architecture, contracts, plans, lifecycle, decisions.
- `resources/open-questions.md` — every open decision with the default the plan assumes.
- `resources/digitalocean.md` — DigitalOcean products, API endpoints, limits and prices; the
  registry, storage, DNS and mail decisions.
