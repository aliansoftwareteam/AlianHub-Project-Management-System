---
id: 069
title: Provisioning orchestrator and host agent — paid to live in three minutes, and every change after
status: backlog
priority: high
depends_on: [060, 062, 065, 070]
created: 2026-10-27
---

# Provisioning orchestrator and host agent — paid to live in three minutes, and every change after

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M2 · Repo: `alianhub-cloud` (new)

> Triggers before the payment gateway exists (it comes last, M5): `cloudctl`, an invite code or staff
> approval from the portal/back office. The `subscription.*` events from 068 are added in M5 and
> start the same workflows.

## Goal

Turn "this customer paid for Pro as `acme`" into a running, verified instance at
`https://acme.alianhub.com` without a human — and do the same for every later change: plan resize,
add-on, suspension, subdomain change, upgrade, host move, cancellation, deletion. Every step is
recorded, retried safely and resumable from the step that failed. The same engine drives a
`cloudctl` command line first, so engineers can run the paid beta (M2) before the portal exists.

## Where we start

- Nothing exists in the new repo. The contracts are fixed in
  [architecture.md](../../active/060-alianhub-cloud-programme/resources/architecture.md): instance
  states and provisioning steps (§11), the host agent's job types (§14), the platform API (§8), the
  tenant stack layout (§5), storage layout (§15).
- The instance side is built in M1: platform API (062), managed compose and `up.sh` (065).
- DigitalOcean is the provider (Q5). [digitalocean.md](../../active/060-alianhub-cloud-programme/resources/digitalocean.md)
  settles the APIs: DigitalOcean API v2 for Droplets, volumes, registry credentials and canary
  checks; Cloudflare for DNS; Wasabi IAM for tenant file keys; Spaces for backups; Resend for mail.
  Each sits behind an adapter, so changing one is one file.

## Scope — the work, task by task

### T1 — Data model and job engine

- Collections (control-plane MongoDB): `instances`, `hosts`, `jobs`, `events`,
  `subdomainReservations`, `usageSnapshots` (shapes in architecture §13).
- `instances`: `{ _id: 'ins_…', accountId, subdomain, hostname, plan, tier, state, hostId,
  version, imageDigest, secrets: { jwtSecret, platformKey, s3 } (encrypted), entitlementsVersion,
  provision: { id, step, attempts, startedAt, finishedAt, error }, createdAt, deletedAt }`.
- `jobs`: one row per step attempt `{ instanceId, kind, step, idempotencyKey, state:
  queued|running|ok|failed, attempt, input (no secrets), output, error, startedAt, finishedAt }`.
- Engine: Agenda (MongoDB-backed, as AlianHub already uses), named workflows built from ordered,
  idempotent steps; each step `{ name, run(ctx), verify(ctx), undo?(ctx) }`. A step is skipped when
  `verify` says it is already done — that is what makes "retry from step" and crash recovery safe.
- Retries: 3 attempts per step with backoff 10 s / 60 s / 5 min; then the workflow stops at that
  step, the instance goes to `failed` (provisioning) or stays in its state with `opsAlert` set, and
  the back office alerts (072).
- Concurrency: one workflow per instance at a time (lock on `instances._id`); per host at most 3
  concurrent `stack.create` to protect pull bandwidth.

### T2 — Adapters (one file per provider)

| Adapter | Interface | First implementation |
|---|---|---|
| `compute` | `createHost(spec)`, `getHost(id)`, `destroyHost(id)`, `listHosts()`, `attachVolume()` | DigitalOcean API v2: `POST /v2/droplets` (from the golden snapshot, `user_data`, VPC, tags), `GET /v2/actions/{id}`, `GET/DELETE /v2/droplets/{id}`, volumes, `POST /v2/projects/{id}/resources` |
| `dns` | `upsertRecord(name, target)`, `deleteRecord(name)`, `getRecord(name)` | Cloudflare API, proxied `A` records (DigitalOcean DNS as the alternative) |
| `objectStore` | `createTenantKey(instanceId)`, `revokeKey(id)`, `deletePrefix(instanceId)`, `prefixBytes(instanceId)`, `presignBackupPut(instanceId, key)` | Wasabi IAM (user + prefix policy per instance) for files; Spaces presigned URLs for backups; Spaces per-bucket keys (`POST /v2/spaces/keys`) as the fallback (Q26) |
| `mailRelay` | `registerSender(instanceId)`, `setDailyCap(n)` | Resend HTTPS API (SMTP is blocked on Droplets) |
| `registry` | `credentialsFor(host)`, `digestOf(version)` | DOCR mirror: `GET /v2/registries/alianhub/docker-credentials?read_write=false&expiry_seconds=3600`; GHCR fallback |
| `uptime` | `createCanary(host)`, `deleteCanary(id)` | DigitalOcean `POST/DELETE /v2/uptime/checks` (one per host, not per tenant) |

The full list of DigitalOcean endpoints and the token scopes are in
[digitalocean.md](../../active/060-alianhub-cloud-programme/resources/digitalocean.md#api-endpoints-the-orchestrator-will-call).
Provisioning a tenant on an existing shared host makes **no** DigitalOcean call; only adding a host or a
Business server does.

Each adapter has a fake used by tests and by `cloudctl --dry-run`.

### T3 — Host agent (`agent/` in the repo, Node 20, single binary via `pkg` or a container)

- Runs on every tenant host as a systemd service (or a container with the Docker socket — the only
  container on the host allowed it).
- Long-polls `POST /agent/v1/jobs/claim` with `Authorization: Bearer <host token>`; token issued at
  host bootstrap (070), stored root-only, rotated monthly.
- Executes the job kinds in architecture §14 with `deploy/managed/up.sh` / `down.sh` /
  `destroy.sh` from 065; renders `compose.yml` and `.env` from the job payload (secrets arrive
  encrypted to the host's public key and are decrypted only on the host).
- Verifies the image's cosign signature before `up` (065 T4).
- `instance.call`: proxies one platform API request to the tenant container over the `edge` network
  with that instance's platform key, returns status and body.
- Reports `host.report` every 60 s: CPU, memory, disk, container states, image cache, agent version.
- Self-update: a `agent.update` job downloads, verifies and swaps the binary.
- Refuses any job whose `hostId` is not its own.

### T4 — Workflow: provision (paid → live)

Triggered by 068's `subscription.activated` for a new instance (or `cloudctl provision`):

| Step | Does | Verify |
|---|---|---|
| `reserve` | confirm the subdomain reservation, create `instances` row, `state: provisioning` | row exists |
| `allocate_host` | pick a host by tier with free capacity (T8); Business → create a dedicated Droplet + volume (`compute.createHost` from the golden snapshot, wait for the action, agent registers — 070) | host `ready` |
| `dns` | `dns.upsertRecord(subdomain, host)` | record resolves to the host |
| `storage` | `objectStore.createTenantKey(instanceId)` | key can put/get/delete a probe under its prefix |
| `secrets` | generate `JWT_SECRET`, `PLATFORM_API_KEY`; store encrypted | present |
| `stack_create` | agent `stack.create` with rendered env (architecture §5) | `/api/v2/platform/status` `dbOk` |
| `config` | `instance.call PUT /api/v2/platform/config` (S3, mail, TURN) | response `applied` |
| `owner` | `instance.call POST /api/v2/platform/provision` | `userId`, `activationUrl` |
| `entitlements` | build (068) → sign (Ed25519, key in control-plane env) → `PUT /entitlements` | stored version matches |
| `verify_public` | HTTPS GET `https://<sub>.alianhub.com/health` from outside, TLS valid | 200 |
| `activate` | `state: active`, emit `instance.activated`, portal sends the welcome email with the activation link | — |

Progress is published for the portal's live screen (067 T6) as `{ step, label, done, total }`.
Target p95: 3 minutes shared, 10 minutes dedicated.

### T5 — Workflows: change

| Workflow | Trigger | Steps |
|---|---|---|
| `entitlements.push` | plan or add-on change (068) | build → sign → `PUT /entitlements` |
| `resize` | tier change within shared hosting | `stack.update` with new limits (rolling restart ~20 s, announced to users 5 min ahead via `POST /lifecycle` message) |
| `move_host` | Pro → Business, host drain, rebalancing | maintenance on → `stack.backup` → `stack.create` on target → `stack.restore` → `config`/`entitlements` → `dns` switch → verify → old `stack.destroy` after 24 h |
| `lifecycle` | 068 state mapping | `POST /lifecycle` (`past_due`, `read_only`, `suspended`, `active`) |
| `cancel` | period end after cancellation | `stack.backup` (final) → `stack.stop` → `state: cancelled` |
| `reactivate` | payment while `cancelled` | `stack.start` → verify → `lifecycle active` |
| `delete` | 30 days after `cancelled` | final backup kept 30 days → `stack.destroy` → `objectStore.deletePrefix` → `revokeKey` → `dns.deleteRecord` → `state: deleted`; subdomain held 90 days |
| `rename` | subdomain change (067 T16) | new DNS record → Traefik router for both names → `PUT /config` URLs → restart → old name redirects 30 days → old record removed |
| `rotate_secrets` | monthly, or on demand | new S3 key → push → verify → revoke old; new platform key via `POST /rotate-key` → `stack.update` |
| `upgrade` | fleet rollout (071) | backup → `stack.update` to new digest → wait healthy + migrations done → verify; rollback to previous digest on failure |

### T6 — The control-plane endpoints the agent and instances call

- `POST /agent/v1/jobs/claim`, `POST /agent/v1/jobs/:id/result`, `POST /agent/v1/hosts/report`.
- `GET /api/v1/instances/:id/entitlements` — for the instance's pull fallback (062 T5),
  authenticated by `x-platform-key`, returns the latest signed token.
- `POST /api/v1/webhooks/mail` — bounces/complaints from the relay; pauses an instance's mail on a
  complaint spike.

### T7 — `cloudctl` (M2 manual beta and break-glass)

A CLI in the same repo using the same workflows, for engineers:

```
cloudctl host add --region blr1 --size <slug>
cloudctl provision --sub acme --plan pro \
  --owner maya@acme.com --name "Maya Shah"
cloudctl status acme
cloudctl entitlements acme --plan pro --addon storage_50gb
cloudctl lifecycle acme read_only --reason payment
cloudctl retry acme --from-step owner
cloudctl backup acme && cloudctl restore acme <backup-id>
cloudctl move acme --to host-blr1-04
cloudctl upgrade acme --version 14.41.0
cloudctl delete acme --yes-delete-data
```

`--dry-run` prints every adapter call. Every command writes `events` rows with the operator's name.
This is how the 3–5 beta customers are created and billed by hand in M2.

### T8 — Placement and capacity

- Host `capacity` in "units": Starter 1, Pro 2 (from 065's tier sizes). A shared host's budget comes
  from **measured** memory (p95 working set over 7 days + 25% headroom), not from tier ceilings —
  target 45–60 units on a 64 GiB Droplet (070 T4), final after the M2 measurements and the 073 load
  test.
- DigitalOcean account limits (Droplet count by tier) are a placement input: Business sign-ups are
  refused with a "we're adding capacity" message and an alert, never half-created, when the Droplet
  limit is reached.
- Place on the host with the most free units in the launch region, never above 85% of the budget,
  never on a host marked `cordoned`.
- When free units across hosts fall below 20% of the total, create a new shared host automatically
  (Droplet + bootstrap, ~5 minutes) and alert ops; never block a sign-up waiting for it — keep one
  spare host warm.
- Business: one dedicated Droplet each, sized by plan.

### T9 — Tests

- Unit: every step's `run`/`verify` against fakes; resume from each step after a simulated crash;
  idempotency (run each workflow twice → same end state, no duplicate resources).
- Contract: adapters against provider sandboxes (DigitalOcean API with a test team/project, Cloudflare
  test zone, Spaces test bucket) in a nightly job.
- End to end (staging region): provision → activation link works → resize → suspend → reactivate →
  cancel → delete; asserts DNS, bucket prefix and Droplet resources are all gone at the end.
- Chaos: kill the agent mid `stack.create`; kill the orchestrator mid workflow; revoke the DNS token —
  each recovers or stops cleanly with an alert.

## How it looks

Back-office job timeline for one instance (072 renders it):

```
acme · ins_01jd3k… · Pro · provisioning
────────────────────────────────────────
✓ reserve           0.2 s
✓ allocate_host     0.4 s   host-blr1-03
✓ dns               1.8 s
✓ storage           2.3 s
✓ secrets           0.1 s
✓ stack_create     44.0 s   v14.40.0
✓ config            1.2 s
✗ owner             3 tries  409 setup
  "already installed with another id"
  [ Retry from step ]  [ Open logs ]
```

`cloudctl status acme`:

```
acme  ins_01jd3k…  pro  active
host   host-blr1-03 (shared, 14/20 units)
url    https://acme.alianhub.com  TLS ok
ver    14.40.0  sha256:9f2c…
seats  23/60  storage 13.3/150 GB
last   entitlements v7 · 2 min ago
```

## Platform view

- **Safety.** Idempotent steps with `verify`, per-instance locks and an append-only `events` trail
  make every run explainable and resumable. Destructive steps (`destroy`, `deletePrefix`) only run
  in the `delete` workflow and only for instances `cancelled` for 30+ days; `cloudctl delete`
  requires the flag and writes the operator.
- **Secrets.** Generated in the control plane, encrypted at rest with the master key, sent to hosts
  encrypted to the host key, never logged; signing key for entitlements lives only in the
  control-plane environment.
- **Blast radius.** The agent can act only on its own host; a host token cannot claim another
  host's jobs; the control plane never holds an SSH key to tenant hosts (break-glass SSH is a
  separate, audited path in 070).
- **Monitoring.** Workflow durations and failure rates per step feed 071's dashboards; a step failing
  for several instances in a row pauses new provisioning automatically (circuit breaker) and pages
  on-call.
- **Provider limits.** API rate limits and account limits (Droplet count, Spaces keys, DNS records)
  are tracked as gauges with alerts at 80%.

## Management view

- **This is the product's engine.** Its reliability is the customer's first impression: target
  first-attempt success ≥ 99% and p95 under 3 minutes.
- **M2 earns early.** `cloudctl` lets the team onboard paying beta customers 4–6 weeks before the
  self-serve portal is ready.
- **Cost.** 15–20 developer days (engine 4, adapters 4, agent 4, workflows 5, CLI and tests 3).
  Running cost: one warm spare shared host (see digitalocean.md for the price).
- **Risks.** Provider API changes or outages → adapters isolate them, provisioning pauses rather than
  half-creating; stuck workflows → back-office queue with retry; capacity surprises → warm spare
  plus 80% alerts.
- **Staffing.** One engineer owns it; on-call rotation shares the runbooks from 071.

## Out of scope

- Billing decisions (068) — this task only reacts to normalized billing events.
- Customer-facing screens (067) and staff screens (072) — they read this task's data.
- Fleet-wide rollout policy (071) — this task provides the per-instance `upgrade` workflow.
- Multi-region placement chosen by the customer.

## Acceptance criteria

- [ ] `cloudctl provision` creates a working instance in the launch region with DNS, TLS, storage
      key, stack, owner activation link and entitlements, p95 under 3 minutes on a shared host.
- [ ] The same workflow runs from 068's `subscription.activated` with no human.
- [ ] Killing the orchestrator or the agent at any step and restarting finishes the workflow without
      duplicate Droplets, DNS records, keys or owners.
- [ ] "Retry from step" in the back office resumes a failed workflow from that step.
- [ ] Resize, move_host, lifecycle, cancel, reactivate, delete, rename, rotate_secrets and upgrade
      workflows each pass their end-to-end test in the staging region.
- [ ] `delete` leaves no Droplet (Business), DNS record, storage prefix, storage key or volume
      behind, and the final backup is kept 30 days.
- [ ] The host agent refuses jobs for other hosts and verifies image signatures before starting.
- [ ] A new shared host is created automatically when free capacity drops below 20%.
- [ ] Every action, automatic or by `cloudctl`, appears in `events` with actor and reason.

## Dependencies

- 062 and 065 (instance side), 070 (hosts, bootstrap, DNS/edge, registry), 068 (billing events and
  entitlements builder) for the automatic path; 071 uses the `upgrade` and `backup` workflows.

## Open questions

- Q5 region, Q6 shared vs dedicated, Q24 registry, Q21 mail relay — adapters keep each to one file.

## Estimate

15–20 developer days; `cloudctl` with provision/status/entitlements/lifecycle is usable for the beta
after about 8 of them.
