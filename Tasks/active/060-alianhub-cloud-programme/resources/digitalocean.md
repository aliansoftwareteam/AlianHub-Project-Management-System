# DigitalOcean for AlianHub Cloud

Research for task 060, done 2026-10-27 against docs.digitalocean.com, digitalocean.com/pricing and
the DigitalOcean API reference. Each section says when its source page was last verified. Anything
marked **unverified** could not be confirmed from a primary source and needs a check (usually one
API call or a support ticket) before we rely on it.

---

## Recommendation summary

- **Use:** Droplets (shared hosts and Business servers), VPC, Cloud Firewalls by tag, Monitoring, tags.
- **Skip:** App Platform (no volumes, so no Mongo), DOKS, Load Balancers (no Host routing), Managed DB.
- **API:** v2 at `https://api.digitalocean.com/v2`, custom-scoped token, 5,000/hour and 250/minute.
- **Client:** plain `fetch`, or the official TypeScript client `@digitalocean/dots`.
- **Calls:** Droplet lifecycle, registry credentials, Spaces keys, uptime checks.
- **A tenant on a shared host needs no DO API call.** The host agent and Cloudflare DNS do it.
- **Registry:** no need to push to DO, because Droplets pull public `ghcr.io` anonymously.
- Add a DOCR Basic mirror ($5/month); hosts pull by digest from DOCR, falling back to GHCR.
- **Storage:** Spaces keys can't be limited to a prefix (100 buckets, 200 keys, no object lock).
- So keep tenant files and backups on Wasabi (architecture §15); fallback is a Spaces bucket per host.
- **DNS:** stay on Cloudflare, one proxied record per tenant. The quota is 3,500 records per zone on Pro.
- **Mail:** SMTP 25/465/587 is blocked on all Droplets. Send via the Resend HTTPS API the app supports.
- **Limits:** a new account allows 3 Droplets of Basic $48 or less; prepay $1,000 (Tier 4) for 25.
- **Cost:** a 64 GiB host is $336–504/month, not the ~$75 assumed, so about $11–14 per Starter tenant.

---

## API endpoints the orchestrator will call

Steps: **setup** happens once per account or region; **host+** is adding a host; **biz+** is
creating a Business server; **ops** is day-to-day work; **host-** is removing a host.

| Method | Path | Purpose | Step |
|---|---|---|---|
| GET | `/v2/sizes`, `/v2/regions` | Check slugs and prices | setup |
| POST | `/v2/vpcs` | VPC per region | setup |
| POST | `/v2/firewalls` | 80/443 from Cloudflare, 22 from office, by tag | setup |
| POST | `/v2/monitoring/alerts` | CPU, memory and disk alerts by tag | setup |
| POST | `/v2/projects` | `alianhub-cloud-prod` | setup |
| POST | `/v2/droplets` | Host with cloud-init and agent token | host+ / biz+ |
| GET | `/v2/actions/{id}` | Poll until the create finishes | host+ / biz+ |
| GET | `/v2/droplets/{id}` | Read public and private IPs | host+ / biz+ |
| POST | `/v2/projects/{id}/resources` | File the Droplet in the Project | host+ / biz+ |
| GET | `/v2/registries/{name}/docker-credentials` | Read-only pull creds with expiry | host+ / ops |
| POST | `/v2/spaces/keys` | Per-bucket key (only if Spaces) | host+ / biz+ |
| POST | `/v2/uptime/checks` | Canary check on a host or Business tenant | host+ / biz+ |
| POST | `/v2/droplets/{id}/actions` | Resize, power cycle, snapshot, toggle backups | ops |
| PUT | `/v2/firewalls/{id}` | Refresh Cloudflare IP ranges | ops |
| GET | `/v2/customers/my/invoices/preview` | Month-to-date cost per resource | ops |
| DELETE | `/v2/droplets/{id}` | Decommission | host- |
| DELETE | `/v2/spaces/keys/{access_key}` | Revoke the key | host- |
| DELETE | `/v2/uptime/checks/{id}` | Remove the check | host- |

The orchestrator also calls these, outside the DO API:

| Method | Path | Purpose | Step |
|---|---|---|---|
| POST | CF `/zones/{zone}/dns_records` | Proxied A record for `acme` | tenant+ |
| DELETE | CF `/zones/{zone}/dns_records/{id}` | Remove it | tenant- |
| S3 | `CreateBucket` (Spaces/Wasabi) | Only if bucket per host | host+ |

If we chose DO DNS instead, the record calls would be `POST/DELETE
/v2/domains/alianhub.com/records`, described in section 8.

---

## 1. DigitalOcean API v2 basics

**Base URL and auth**
- Base URL: `https://api.digitalocean.com/v2`, HTTPS only.
- Header: `Authorization: Bearer $DIGITALOCEAN_TOKEN`.
- Pagination: 20 items per page by default, `?per_page=` up to **200**.
- Source: [OpenAPI description](https://raw.githubusercontent.com/digitalocean/openapi/main/specification/description.yml)

**Rate limits (per token)**
- 5,000 requests per hour.
- 250 requests per minute (5% of the hourly total).
- Headers: `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `retry-after` on
  burst 429s.
- A 429 response body carries `id: "too_many_requests"`.
- No Droplet create call can run more than 10 Droplets at once ([Droplet limits](https://docs.digitalocean.com/products/droplets/details/limits/)).

**Tokens and scopes**
- Personal access tokens come in Full Access (`api:write`), Read Only (`api:read`) or **Custom
  Scopes**. You can't change a token's scopes after creating it, only rename or regenerate it. You
  choose the expiry when you create the token.
  ([Create a token](https://docs.digitalocean.com/reference/api/create-personal-access-token/),
  [Scopes](https://docs.digitalocean.com/reference/api/scopes/))
- A call that needs a missing scope returns 403. The scopes page does not list which scopes depend
  on others. The endpoint docs say `POST /v2/droplets` also needs `image:read` and `ssh_key:read`,
  plus `vpc:read` with `vpc_uuid`, `tag:create` with `tags` and `block_storage:read` with
  `volumes`.

We should use three tokens:

| Token | Scopes |
|---|---|
| Orchestrator | `droplet:create/read/update/delete`, `image:read`, `ssh_key:read`, `vpc:read`, `tag:read/create`, `project:read/assign_resource`, `firewall:read/update`, `registry:read/update`, `spaces_key:read/create_credentials/delete`, `uptime:read/create/delete`, `monitoring:read/create`, `actions:read`, `sizes:read`, `regions:read` |
| Back office | `billing:read`, `api:read` |
| CI (registry push) | `registry:read/update` (**unverified** whether that is enough to push; test it) |

Notes:
- `docker-credentials` needs both `registry:read` and `registry:update`
  ([Container Registries API](https://docs.digitalocean.com/reference/api/reference/container-registries/)).
- Creating a Spaces key needs `spaces_key:create_credentials`
  ([Spaces Keys API](https://docs.digitalocean.com/reference/api/reference/spaces-keys/)).
- The fetched scopes list does not show `image:read`, but the Droplet endpoint requires it.
  **Unverified** wording; check it in the token UI.

**SDKs** ([SDK page](https://docs.digitalocean.com/reference/libraries/))
- The official clients are **Godo** (Go, the primary SDK), **PyDo** (Python) and **DoTs**
  (TypeScript, npm `@digitalocean/dots`).
- DoTs needs Node 18+, TypeScript 5+ and an ESM project (`"type": "module"`). It is generated with
  Kiota from DO's OpenAPI spec, and its first call looks like `client.v2.droplets.get()`.
  It went GA on 20 Aug 2025 ([DoTs docs](https://docs.digitalocean.com/reference/dots/),
  [release notes](https://docs.digitalocean.com/release-notes/dots/)).
- DropletKit (Ruby) is deprecated. No community Node library is listed.
- **For us:** the AlianHub stack is CommonJS, so a thin `fetch` wrapper is simpler than pulling an
  ESM-only generated client into the orchestrator. We call fewer than 20 endpoints.

**doctl** is the official CLI. Use it for the registry login and for ops. The API overview shows
v1.164.0 as a recent release ([API overview](https://docs.digitalocean.com/reference/api/)).

---

## 2. Droplets API

**`POST /v2/droplets`** returns 202 with `links.actions`; poll `GET /v2/actions/{id}`
([Droplets API](https://docs.digitalocean.com/reference/api/reference/droplets/)).

| Field | Notes |
|---|---|
| `name` / `names` | `names` creates up to 10 Droplets in one call |
| `region` | e.g. `blr1` |
| `size` | slug, e.g. `m-8vcpu-64gb` (see prices below) |
| `image` | slug or ID; Docker 1-Click is `docker-20-04` |
| `ssh_keys` | IDs or fingerprints already on the team |
| `user_data` | cloud-init or bash script, **max 64 KiB** |
| `vpc_uuid` | omitted means the default VPC for the region |
| `tags` | created if missing; firewalls and alerts follow tags |
| `monitoring` | `true` installs the metrics agent |
| `backups` / `backup_policy` | weekly or daily, see section 10 |
| `ipv6`, `with_droplet_agent`, `volumes` | optional |

**Docker 1-Click**
- The API slug is `docker-20-04`, but the listing says Ubuntu 22.04. The slug name is legacy.
- No Docker or Compose version is pinned.
  ([Marketplace](https://marketplace.digitalocean.com/apps/docker),
  [catalog doc](https://docs.digitalocean.com/products/marketplace/catalog/docker/), generated
  17 Aug 2026)
- **Recommendation:** start from `ubuntu-24-04-x64` and install a pinned Docker in cloud-init, or
  better, build our own **snapshot image** with Docker, the host agent and the current AlianHub
  image already pulled. That cuts boot-to-ready time and avoids drift in the 1-Click image.
  Snapshots cost $0.06/GB-month.

**Boot time**
- DO markets "up and running in under a minute"
  ([pricing page](https://www.digitalocean.com/pricing/droplets)).
- No measured figure was found (**unverified**). Measure it ourselves. Expect about 1 minute to
  `active` plus cloud-init time, which fits the "under 10 minutes on a new VM" target.

**Droplet limit**
([Resource limits](https://docs.digitalocean.com/platform/resource-limits/), verified 30 Sep 2026)

| Tier | Droplets | Sizes allowed |
|---|---|---|
| 1 | 3 | Basic up to $48 |
| 2 | 10 | Basic up to $56, some dedicated up to $84 |
| 3 | 15 | larger dedicated, up to $163 |
| 4 | 25 | all |
| 5 | 100 | all |

- The tiers follow prepayment: none, $50, $250, $1,000, $4,000. Limits also rise automatically as
  invoices are paid.
- To raise a limit: Resource Limits page, then **Request an increase** with a reason
  ([how-to](https://docs.digitalocean.com/platform/teams/how-to/view-resource-limits/)).
- **Every Business customer uses one Droplet slot**, so plan the increase before launch.

**Prices** (monthly, bundled plans, billed per second with a 672-hour monthly cap)
([pricing](https://www.digitalocean.com/pricing/droplets),
[billing rules](https://docs.digitalocean.com/products/droplets/details/pricing/), verified
26 Oct 2026)

(a) Shared host, 32–64 GiB, all with dedicated vCPU:

| Plan | vCPU / RAM | $/mo |
|---|---|---|
| Memory-Optimized | 4 / 32 GiB | 168 |
| Memory-Optimized | 8 / 64 GiB | **336** |
| General Purpose | 8 / 32 GiB | 252 |
| General Purpose | 16 / 64 GiB | 504 |
| CPU-Optimized | 16 / 32 GiB | 336 |
| CPU-Optimized | 32 / 64 GiB | 672 |
| Basic (shared CPU) | 8 / 16 GiB | 96 |

- **Best fit:** Memory-Optimized 8 vCPU / 64 GiB at $336. Our stacks are memory-bound, mostly
  idle and bursty.
- Slugs are assumed to be `m-8vcpu-64gb`, `g-16vcpu-64gb`, `c-32`. **Unverified**: confirm with
  `GET /v2/sizes`.
- **v5 configurations** (AMD EPYC gen 5, sized freely, billed per second with no monthly cap,
  `g5-`/`s5-` slugs) work out to about $352 + disk for 8 vCPU / 64 GiB, which is not cheaper. They
  are also **not offered in BLR1**
  ([choosing a plan](https://docs.digitalocean.com/products/droplets/concepts/choosing-a-plan/)).

(b) Dedicated Business server, about 4 vCPU / 8 GiB:

| Plan | vCPU / RAM | $/mo |
|---|---|---|
| Basic Regular (shared) | 4 / 8 GiB | 48 |
| Basic Premium AMD (shared) | 4 / 8 GiB | 56 (**unverified**, third-party) |
| General Purpose | 2 / 8 GiB | 63 |
| CPU-Optimized | 4 / 8 GiB | 84 |

- Pick Basic Premium AMD $56 or General Purpose $63, the latter if the 99.9% SLA promise needs
  dedicated CPU.
- Bandwidth: 4–7 TiB per Droplet, pooled across the team. Overage is $0.01/GiB; inbound and VPC
  traffic are free.

---

## 3. Container Registry (DOCR)

**Tiers** ([pricing](https://docs.digitalocean.com/products/container-registry/details/pricing/),
verified 26 Oct 2026)

| Tier | $/mo | Storage | Repos | Registries |
|---|---|---|---|---|
| Starter | 0 | 500 MiB | 1 | 1 |
| Basic | 5 | 5 GiB | 5 | 1 |
| Professional | 20 | 100 GiB | unlimited | 10 |

- Extra storage is $0.02/GiB, and untagged images count toward it.
- **Bandwidth or egress charges are not documented** (**unverified**). An older community answer
  says all registry traffic is included. Inbound to Droplets is free either way.

**Push**
([how-to](https://docs.digitalocean.com/products/container-registry/how-to/use-registry-docker-kubernetes/))
- `doctl registry login`, then `docker tag … registry.digitalocean.com/<registry>/<repo>:<tag>`,
  then `docker push`.
- Without doctl: `docker login registry.digitalocean.com` with an API token.

**Pull from a Droplet**
- Call `GET /v2/registries/{name}/docker-credentials?read_write=false&expiry_seconds=3600`. It
  returns a `config.json` `auths` block, **read-only by default** and **never expiring unless
  `expiry_seconds` is set**. The response holds a DO API token.
- The older `/v2/registry/docker-credentials` path is deprecated.
  ([API](https://docs.digitalocean.com/reference/api/reference/container-registries/),
  [doctl docker-config](https://docs.digitalocean.com/reference/doctl/reference/registry/docker-config/))
- Credentials apply to every registry on the account
  ([limits](https://docs.digitalocean.com/products/container-registry/details/limits/)).
- **Design:** the control plane mints short-lived read-only credentials and hands them to the host
  agent with each `stack.create` or `stack.update` job. No long-lived token sits on hosts.

**Garbage collection**
([how-to](https://docs.digitalocean.com/products/container-registry/how-to/clean-up-container-registry/),
verified 7 Apr 2026)
- Manual GC puts the registry in **read-only mode**, after a wait of up to 15 minutes.
- Automatic GC with no read-only window is in public preview.
- Run GC outside release windows.

**Other limits**
- No image over 100 GB and no layer over 20 GB.
- A registry's region cannot change.
- The availability page lists **BLR1** among 11 regions, including mirror registries
  ([availability](https://docs.digitalocean.com/products/container-registry/details/availability/)).
  The old create endpoint only enumerates nyc3, sfo3, ams3, sgp1 and fra1, so confirm with
  `GET /v2/registries/options`.

**Recommendation: keep GHCR public as the source of truth, add a DOCR mirror.**

| Option | For | Against |
|---|---|---|
| GHCR only | Free, already built, no creds on hosts | GitHub outages block new hosts and upgrades; GHCR pull limits undocumented |
| GHCR + DOCR mirror | Pulls stay inside DO; survives a GHCR outage; room for private cloud-only images | $5/mo, one more CI step, creds to mint |
| DOCR only | One vendor for hosts | Self-hosters still need GHCR, so this saves nothing |

- Pull volume is tiny either way. Each host pulls a version **once**, and every tenant on it
  shares the layers. So egress and pull speed are minor. **Availability during an upgrade or a
  new-host build** is the real argument for the mirror.
- GitHub says container storage and bandwidth are currently free and public packages are free.
  It publishes no pull rate limit for ghcr.io (**unverified**)
  ([GitHub Packages billing](https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-packages/about-billing-for-github-packages)).
- **Pin by digest** (`alianhub@sha256:…`) so both registries serve the identical image.
- Basic (5 GiB) holds a handful of versions plus the host-agent image. GC old tags monthly.
- Start M2 on GHCR only and add the mirror in M4.

---

## 4. App Platform

- **Images:** it accepts DOCR, Docker Hub and **GHCR** images (`image.registry_type`). Only DOCR
  gets automatic redeploys
  ([app spec](https://docs.digitalocean.com/products/app-platform/reference/app-spec/),
  [limits](https://docs.digitalocean.com/products/app-platform/details/limits/), verified
  20 May 2026).
- **Persistent volumes: not supported.** Local disk is ephemeral and capped at 4 GiB, and is lost
  on every deploy. **So there can be no MongoDB container.**
- **WebSockets:** work (DO's own sample deploys a WebSocket app over `wss`)
  ([tutorial](https://docs.digitalocean.com/tutorials/app-deploy-websockets/)).
- **Domains:** up to 500 custom domains per app. The app spec has `domains[].wildcard`, and the
  apex must be added before its wildcard.
- **One app per customer via API:** possible (`POST /v2/apps` with a spec). But the default is
  **10 apps per account** per a 2023 community answer (**unverified** today; raise via support).
- **Price:** the smallest container is $5 (512 MiB, fixed). 1 GiB costs $10–12, 2 GiB costs $25.
  Transfer overage is $0.02/GiB
  ([pricing](https://www.digitalocean.com/pricing/app-platform)).

**Verdict: App Platform does not fit.** It cannot run the per-customer MongoDB container. Using it
would mean a Managed MongoDB per customer (from $15 each), or rewriting the app's fixed `global`
database. Both break architecture.md §6.

---

## 5. DOKS (Kubernetes), briefly

([pricing](https://docs.digitalocean.com/products/kubernetes/details/pricing/), verified
26 Oct 2026; [limits](https://docs.digitalocean.com/products/kubernetes/details/limits/))

- The control plane is free. An **HA control plane costs $40/month**, and it is on by default from
  DOKS 1.36.
- Nodes cost the same as Droplets.
- Limits: up to 512 nodes and 110 pods per node.
- **Worth it when:** we have more than about 10 hosts and want automatic rescheduling when a node
  dies, StatefulSets with volumes for Mongo, and rolling upgrades for free.
- **Not worth it now:** one stack per customer with local Mongo volumes maps directly onto
  `docker compose` plus our host agent. DOKS would add a volume per tenant ($0.10/GiB, minimum
  1 GiB, max 15 volumes per node for Mongo PVCs), Kubernetes skills and the $40 HA fee, without
  removing the orchestrator we need anyway.
- Revisit after M4.

---

## 6. Managed MongoDB (context only)

([pricing](https://docs.digitalocean.com/products/databases/mongodb/details/pricing/), verified
17 Jun 2025, possibly outdated; [limits](https://docs.digitalocean.com/products/databases/mongodb/details/limits/),
verified 3 Sep 2026)

- **Price:** a single node starts at $15/month (1 GiB RAM, not HA). An HA 3-node replica set
  costs about $45/month or more.
- **Versions:** 7.0 and 8.0 only.
- **Count:** 10 clusters per account by default.
- **Users:** read-write and read-only users can be created **via the API only**. Creating
  databases by API is **unverified**.
- **Why we keep Mongo in the container:** a shared cluster would clash on the app's fixed
  `global` database (architecture.md §6), and a cluster per customer costs $15–45 or more each.

---

## 7. Spaces Object Storage

**Pricing** ([pricing](https://docs.digitalocean.com/products/spaces/details/pricing/), verified
26 Oct 2026)
- $5/month covers 250 GiB and 1,024 GiB of egress across all buckets.
- Extra storage is $0.02/GiB-month and extra egress is $0.01/GiB.
- Inbound is free. CDN is included. No per-request fees are listed.
- Cold Storage costs $0.007/GiB-month with a 30-day minimum, and is **not in BLR1**.
- Spaces-to-Droplet traffic in the same region is free.

**Limits** ([limits](https://docs.digitalocean.com/products/spaces/details/limits/), verified
3 Sep 2026)

| Limit | Value |
|---|---|
| Buckets per account | **100** (raise via support) |
| Access keys per account | **200** (raise via support) |
| Ops/sec per new bucket | **800** total |
| Single PUT | 5 GB |
| Multipart | 10,000 parts, 5 TB |
| Objects per bucket | 100M unversioned |

**Access keys**
- Keys are created by API, generally available since 8 Apr 2025, at `POST /v2/spaces/keys` with
  `grants: [{bucket, permission: read|readwrite|fullaccess}]`. One key can cover several buckets.
  Only the name can be changed later.
  ([API](https://docs.digitalocean.com/reference/api/reference/spaces-keys/),
  [announcement](https://www.digitalocean.com/blog/spaces-api-access-logs))
- The "manage access" doc still says keys are made only in the control panel. That page is
  stale.
- **No prefix-level scoping.** Grants are per bucket only.
- **Bucket policies:** `PutBucketPolicy` exists, but the documented examples only use
  `Principal: "*"`. Per-bucket keys **cannot** be combined with a bucket policy on the same bucket
  ([bucket policies](https://docs.digitalocean.com/products/spaces/how-to/configure-bucket-policies/)).
  Whether a policy can name a key or use `s3:prefix` is **unverified**.

**Features**
- Versioning: yes, set by API only.
- Lifecycle: expiry and incomplete-multipart cleanup; no tag-based rules.
- ACLs: `private` and `public-read` only.
- Presigned URLs: V2 and V4.
- Encryption: SSE-C only.
- Access logs: public preview.
- **Object lock: no lock configuration API is documented. Treat it as unsupported**
  (**unverified**).
  ([S3 compatibility](https://docs.digitalocean.com/products/spaces/reference/s3-compatibility/),
  [Spaces API](https://docs.digitalocean.com/reference/api/spaces/))

**Regions:** NYC3, AMS3, SFO2, SFO3, SGP1, LON1, FRA1, TOR1, **BLR1**, SYD1, ATL1, RIC1 and MKC1.
CDN is available everywhere Spaces is
([availability](https://docs.digitalocean.com/products/spaces/details/availability/)).

**Recommendation for hundreds to a few thousand customers**

| Layout | Verdict |
|---|---|
| Bucket per customer + per-bucket key | **No.** 100 buckets and 200 keys by default; thousands would need support approval that may not come |
| One shared bucket, prefixes | **No.** Every tenant key can read every tenant; a leak exposes all; 800 ops/s ceiling for everyone |
| Bucket per shared host + per Business customer, per-bucket key | **Acceptable fallback.** Blast radius of one host (~30 tenants), ~100 buckets covers ~2,000 tenants |
| Stay on Wasabi, prefix + per-instance IAM policy | **Recommended.** Per-tenant isolation as designed in §15; object lock for backups |

Wasabi facts:
- Wasabi Pay-Go rose to **$7.99/TB-month** on 1 Jul 2026, with a 1 TB minimum charge, a **90-day
  minimum storage duration**, and free egress and API under fair use
  ([Wasabi May 2026 pricing](https://docs.wasabi.com/docs/may-2026-wasabi-pricing),
  [FAQ](https://wasabi.com/pricing/faq)).
- Wasabi's IAM prefix policies and object lock are taken from architecture.md §15 and were not
  re-verified here.

Caveats:
- **On Wasabi, nightly backups kept 7–14 days are billed as if kept 90 days.** Either keep backups
  on Spaces (no minimum duration, but no object lock), or accept the cost (about 6–13 times the
  live backup size).
- Moving the app off bucket-per-company is needed on either provider. Today the app creates
  buckets with its own key, which requires a full-access key (task 063).
- Wasabi has no India region (**unverified**; Singapore is the nearest). Spaces BLR1 is closer to
  Indian users.

---

## 8. DNS and certificates

**DO Domains API**
([records API](https://docs.digitalocean.com/reference/api/reference/domain-records/),
[DNS limits](https://docs.digitalocean.com/products/networking/dns/details/limits/), verified
18 Mar 2026)
- Create a record with `POST /v2/domains/alianhub.com/records` and a body of
  `{type:"A", name:"acme", data:"<ip>", ttl:300}`.
- Update with `PUT` or `PATCH .../records/{id}`, delete with `DELETE`. List filters by `name` and
  `type`.
- **Minimum TTL: 30 seconds.** Wildcard records are supported, and an explicit record overrides
  the wildcard for that hostname.
- DNSSEC is not supported.
- Zones per account follow the tier (6 at Tier 1, 100 at Tier 4). We need only one zone.
- Records per zone and propagation time are **unverified**.

**Let's Encrypt on DO Load Balancers**
([SSL termination](https://docs.digitalocean.com/products/networking/load-balancers/how-to/ssl-termination/),
verified 13 Jul 2026)
- Fully managed and renewed automatically, including the **wildcard** option.
- **Only available when the domain's DNS is hosted on DigitalOcean.** Otherwise you upload your
  own certificate.

**Cloudflare (recommended, as architecture.md already assumes)**
- Proxied record per tenant: `POST /zones/{zone_id}/dns_records` with `proxied: true`.
- Universal SSL covers the apex and **first-level** subdomains, so `acme.alianhub.com` works and
  `x.acme.alianhub.com` does not
  ([limitations](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/)).
- Origin: a Cloudflare Origin CA wildcard certificate in Traefik on each host. No ACME runs on
  hosts.
- Host IPs stay hidden, and the WAF and DDoS protection are included. The DO firewall admits
  443 only from Cloudflare ranges.
- **Record quota per zone:** Free zones created on or after 1 Sep 2024 get 200 records (older Free
  zones get 1,000). Pro and Business get **3,500**. Enterprise gets an account quota (1M)
  ([Cloudflare DNS records](https://developers.cloudflare.com/dns/manage-dns-records/)).
- **To scale past about 3,400 tenants:** move to Enterprise, or point a single `*.alianhub.com`
  wildcard at a small edge tier (2 Droplets behind a reserved IP running Traefik), which routes by
  Host over the VPC to the right tenant host. That needs no per-tenant DNS record.
- The 100 MB upload cap on Free and Pro still applies (architecture.md §12).

---

## 9. Load Balancers

([pricing](https://docs.digitalocean.com/products/networking/load-balancers/details/pricing/),
[features](https://docs.digitalocean.com/products/networking/load-balancers/details/features/),
[limits](https://docs.digitalocean.com/products/networking/load-balancers/details/limits/),
verified Jul–Oct 2026)

- **Price:** regional HTTP costs $12 per node per month; regional network $15 per node; global
  $15/month with 25M requests and 1 TB included.
- **No Host or path routing.** The docs state that they "are not application load balancers".
  So **Traefik on each host stays.**
- **Global LB:** up to 20 domains, and no SNI.
- **WebSockets:** work with no setup, with a 1-hour idle timeout (60 s for plain HTTP).
- **Capacity:** about 10,000 requests/s per node, 40 forwarding rules, 10 named backends (or
  any number by tag), PROXY protocol v1 on HTTP LBs.
- **Max request body size: not documented** (**unverified**).
- **Our use:** none for tenant traffic. Each tenant record points at its host through Cloudflare.
  Possible later use: a regional LB for an HA control plane.

---

## 10. Firewalls, VPC, Reserved IPs, Volumes, backups

| Product | Price | What we use it for |
|---|---|---|
| Cloud Firewalls | free | One firewall on tag `ah-tenant-host`: 443 from CF ranges, 22 from office/VPN |
| VPC | free inside a VPC | Hosts and control plane talk privately; agent traffic not billed |
| VPC NAT gateway | $40/mo per unit | Not needed |
| Reserved IPv4 | free assigned, $5/mo idle | Stable IP for control plane and Business servers |
| Volumes | $0.10/GiB-mo | Optional: Mongo data on a volume so a host can be rebuilt |
| Snapshots | $0.06/GB-mo | Golden host image; pre-upgrade snapshots |
| Backups (bundled) | 20% weekly, 30% daily | Host-level disaster recovery only |

Sources: [firewall limits](https://docs.digitalocean.com/products/networking/firewalls/details/limits/),
[VPC pricing](https://docs.digitalocean.com/products/networking/vpc/details/pricing/),
[reserved IPs](https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/),
[volumes](https://docs.digitalocean.com/products/volumes/details/pricing/),
[volume limits](https://docs.digitalocean.com/products/volumes/details/limits/),
[snapshots](https://docs.digitalocean.com/products/snapshots/details/pricing/),
[backups](https://docs.digitalocean.com/products/backups/details/pricing/). All verified 2026
except backups (9 Mar 2026).

Firewall limits:
- 50 rules per firewall.
- Up to 1,000 sources per rule, enough for all Cloudflare ranges in one rule.
- **Only 10 Droplets attached by ID**, so attach by tag.
- Up to 5 tags per firewall.
- Firewalls cannot be applied to LBs.

Reserved IPs:
- Tier 1 allows 3. A Droplet holds one at a time.
- **SMTP through a reserved IP is blocked too.**

Volumes: 1 GiB to 16 TiB, up to 15 per Droplet, 7,500–15,000 IOPS.

Backups:
- Usage-based plans charge $0.01–0.04/GiB and allow backups every 4, 6 or 12 hours, daily or
  weekly.
- Backups are **crash-consistent**, and DO itself recommends application-level backups for
  databases. Our nightly `mongodump` stays the real backup.
- Retention counts are not stated on the backup pages (**unverified**).

---

## 11. Monitoring and uptime

- **Metrics agent:** free and open source. Set `monitoring: true` on create.
  ([monitoring pricing](https://docs.digitalocean.com/products/monitoring/details/pricing/))
- **Alert policies:** `POST /v2/monitoring/alerts` with `type` (for example
  `v1/insights/droplet/memory_utilization_percent`), `compare`, `value`, a `window` of 5m, 10m,
  30m or 1h, and `entities` or **`tags`**. Alerts go to email or Slack. One tag-based policy
  covers every host ([Monitoring API](https://docs.digitalocean.com/reference/api/reference/monitoring/)).
- **Uptime checks:** `POST /v2/uptime/checks` takes `type` (ping, http, https), `target` and
  `regions` (us_east, us_west, eu_west, se_asia; **no India probe**). Alerts per check can be
  `down`, `down_global`, `latency` or `ssl_expiry`
  ([Uptime API](https://docs.digitalocean.com/reference/api/reference/uptime/)).
  - **Price:** $1 per check per month, with 1 free check
    ([pricing](https://docs.digitalocean.com/products/uptime/details/pricing/)).
  - **Limit:** **100 checks per account**, 5 alerts per check, IPv4 only
    ([limits](https://docs.digitalocean.com/products/uptime/details/limits/)).
  - **So no uptime check per tenant at scale.** Use DO checks for the portal, the status page and
    one canary tenant per host. Per-tenant health comes from the control plane polling each
    instance's `/health` (it already polls `/usage`).

---

## 12. Projects, tags and cost per resource

- **Projects:** `POST /v2/projects/{id}/resources` with URNs such as `do:droplet:<id>`,
  `do:space:<bucket>`, `do:domain:<name>`, `do:volume:<uuid>` and `do:loadbalancer:<uuid>`. Needs
  `project:assign_resource`
  ([Project Resources API](https://docs.digitalocean.com/reference/api/reference/project-resources/)).
  The maximum number of projects is **unverified**.
- **Tags:** `POST /v2/tags`, `POST /v2/tags/{tag}/resources`, or `tags` on create. Firewalls,
  alerts and `GET /v2/droplets?tag_name=` all key off tags.
- **Cost per resource:** this exists.
  - Invoice items (`GET /v2/customers/my/invoices/{uuid}`, `/csv`, or `preview` for month to date)
    carry `resource_uuid`, `resource_id`, **`project_name`**, `product`, `amount` and `duration`.
  - **Billing insights** (`GET /v2/billing/{account_urn}/insights/{start}/{end}`, up to 31 days)
    gives daily cost by SKU and region.
  - There is **no cost-by-tag breakdown**
    ([Billing API](https://docs.digitalocean.com/reference/api/reference/billing/)).
- **Recommendation:**
  - Use one Project per environment (prod and staging), not one per customer.
  - Map `resource_uuid` to `instanceId` in our `hosts` collection, so the back office can show
    cost per Business customer and per shared host.
  - Shared-host tenants are not DO resources. Split their cost by allocated memory.

---

## 13. Outbound email

- **"SMTP ports 25, 465, and 587 are blocked on all Droplets."** The block "applies to all
  Droplets by default", including traffic through a Reserved IP.
- DO recommends a third-party email service and names no unblock procedure
  ([why is SMTP blocked](https://docs.digitalocean.com/support/why-is-smtp-blocked/), verified
  13 Jul 2026; [Droplet limits](https://docs.digitalocean.com/products/droplets/details/limits/)).
- Community threads say the policy began on 22 Jun 2022 for new accounts and that support rarely
  lifts it. That is not documented (**unverified**). Plan as if it can never be lifted.
- **Impact on AlianHub:** the app's default `NODEMAILER_PORT` is 587, which is blocked. The app
  already prefers `RESEND_API_KEY` (HTTPS API) when it is set (`Modules/Instance/controller.js`).
- **Recommendation:**
  - Platform mail goes through the Resend (or Postmark/SES) **HTTPS API**, pushed as a platform
    credential.
  - If SMTP is needed, use the provider's alternate port (for example 2587 or 2525). Port numbers
    are provider-specific and **unverified** here.
  - **"Own SMTP" for Business** only works when the customer's provider offers a non-standard
    port or an API. Say so in the plan copy, or relay their mail through ours.

---

## 14. Regions

16 datacenters
([regional availability](https://docs.digitalocean.com/platform/regional-availability/),
verified 9 Oct 2026): NYC1, NYC2, NYC3, AMS3, SFO2, SFO3, SGP1, LON1, FRA1, TOR1, **BLR1**,
SYD1, ATL1, RIC1, MKC1 and MEM1. AMS2 and SFO1 are legacy and closed to new resources.

| In BLR1 | Status |
|---|---|
| Droplets (all bundled plans) | yes |
| v5 Droplets | **no** |
| Spaces Standard / Cold | yes / **no** |
| Container Registry | yes (API enum disagrees; check) |
| App Platform | yes |
| DOKS, LBs, Volumes, VPC | yes |
| Managed MongoDB | yes (not Memory-Optimized) |
| Uptime probe in India | **no** (nearest `se_asia`) |

**Suggestion:** BLR1 for India-first customers, FRA1 or AMS3 for Europe. Keep each tenant's host,
bucket and backups in one region.

---

## Monthly cost sketch

Assumptions: list prices as of 27 Oct 2026, no tax, Memory-Optimized 64 GiB host holding
~30 Starter stacks (or ~15 Pro).

**One shared host**

| Item | $/mo |
|---|---|
| Droplet `m-8vcpu-64gb` | 336.00 |
| Weekly Droplet backups (20%) | 67.20 |
| DOCR Basic (mirror) | 5.00 |
| Spaces base (if used for backups) | 5.00 |
| Spaces overage, ~360 GiB stored | 2.20 |
| Uptime checks (2 beyond the free one) | 2.00 |
| Monitoring, firewall, VPC, reserved IP | 0.00 |
| **Total** | **~417** |

- That is about **$13.90 per Starter tenant** at 30 tenants, or about $27.80 per Pro tenant at 15.
- The shared parts (registry, Spaces base, portal checks) are paid once, not per host.
- Dropping Droplet backups (since `mongodump` is the real backup) brings it to about $350, or
  **~$11.70 per Starter tenant**.
- Real density will be higher than the tier caps, because idle stacks use far less than their
  limit. Measure it in M2.

**One dedicated Business server**

| Item | $/mo |
|---|---|
| Droplet, 4 vCPU / 8 GiB (Basic $48–56, or GP 2/8 $63) | 48–63 |
| Daily Droplet backups (30%) | 14–19 |
| Uptime check | 1 |
| Reserved IPv4 (assigned) | 0 |
| **Total** | **~63–83** |

- Against the $249 placeholder price, compute is roughly 25–33%. Storage on Wasabi or Spaces
  comes on top (500 GB costs about $4 on Wasabi or about $10 on Spaces).
- **Compared with architecture.md §12:** the plan assumed about $75 for a 64 GB host. On DO the
  same memory costs $336–504, so Starter at $29 lands near 45–55% gross margin, not 75% or more.
  Re-price Starter, raise density, or put Starter on Basic shared-CPU hosts (16 GiB for $96, about
  $6/GiB).
