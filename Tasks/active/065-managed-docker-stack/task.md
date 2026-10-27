---
id: 065
title: Hosting-ready image and compose template — many customers per server, one command up
status: active
priority: high
depends_on: [060, 061, 062]
created: 2026-10-27
---

# Hosting-ready image and compose template — many customers per server, one command up

> Part of [060 AlianHub Cloud](../../active/060-alianhub-cloud-programme/task.md) · Phase M1 (the build) · Repo: this one

## Goal

"After that, it will be done with one command, and things will be running." Ship a compose
template and a bring-up script so that one command on a prepared DigitalOcean Droplet starts a
customer's stack — AlianHub app + its own MongoDB — routed at `https://<sub>.alianhub.com`, with
limits sized to the plan, without colliding with the other 15–30 customers on the same server; and
publish every release as an image the hosts can pull fast and reliably.

## Where we start

- `Dockerfile`: multi-stage, Node 20 Alpine, non-root, tini, healthcheck on `/health`,
  `NODE_ENV=production`, `STORAGE_TYPE=server` default.
- `docker-compose.yml`: `app` + `mongo:7` (+ optional `coturn` profile) for a single self-hosted
  install. It **hard-codes** `container_name` (via env defaults), volume names
  (`name: alianhub_mongo_data` …) and the network name (`name: alianhub`) — a second copy on the same
  host shares the first one's database volume unless every name is overridden.
- `.github/workflows/docker.yml` builds amd64 + arm64 and pushes `ghcr.io/aliansoftwareteam/alianhub`
  with semver tags from release-please and `latest` for stable releases.
- Mongo runs with default WiredTiger cache (50% of RAM − 1 GB), far too much per tenant on a shared
  host.
- No reverse proxy configuration exists in the repo.

## Scope — the work, task by task

### T1 — Fix the self-hosted compose for everyone

Remove the fixed `name:` on volumes and network and the `container_name` defaults, so
`docker compose -p <project>` gives each copy its own volumes and network automatically. Keep the
old names reachable for existing installs: on first start a one-line note in the README explains
`ALIANHUB_LEGACY_NAMES=true` (keeps the old fixed names via an override file
`docker-compose.legacy.yml`). Upgrade note in `CHANGELOG.md` `selfHost.upgradeNeeded`.

### T2 — The managed compose template

New `deploy/managed/compose.yml.tmpl`, rendered by the host agent (069) with values from the control
plane:

```yaml
name: t_${INSTANCE_ID}
services:
  app:
    image: ${IMAGE}@${IMAGE_DIGEST}
    restart: unless-stopped
    env_file: [.env]
    environment:
      ALIANHUB_DOCKER: "true"
    deploy:
      resources:
        limits: { cpus: "${APP_CPUS}", memory: "${APP_MEM}" }
    read_only: true
    tmpfs: [/tmp]
    volumes:
      - logs:/app/log
      - backups:/app/backups
    security_opt: ["no-new-privileges:true"]
    cap_drop: [ALL]
    networks: [internal, edge]
    depends_on: { mongo: { condition: service_healthy } }
    logging: { driver: local, options: { max-size: "10m", max-file: "5" } }
    labels:
      traefik.enable: "true"
      traefik.docker.network: edge
      traefik.http.routers.t_${INSTANCE_ID}.rule: Host(`${HOSTNAME}`)
      traefik.http.routers.t_${INSTANCE_ID}.entrypoints: websecure
      traefik.http.routers.t_${INSTANCE_ID}.middlewares: platform-deny@file,security-headers@file
      traefik.http.services.t_${INSTANCE_ID}.loadbalancer.server.port: "4000"
      com.alianhub.instance: ${INSTANCE_ID}
      com.alianhub.tier: ${TIER}
  mongo:
    image: mongo:7.0.${MONGO_PATCH}
    restart: unless-stopped
    command: ["--wiredTigerCacheSizeGB", "${MONGO_CACHE_GB}", "--quiet"]
    deploy:
      resources:
        limits: { cpus: "${MONGO_CPUS}", memory: "${MONGO_MEM}" }
    volumes: [mongo:/data/db]
    networks: [internal]
    healthcheck: { test: [CMD, mongosh, --quiet, --eval, "db.adminCommand('ping').ok"], interval: 10s, retries: 6, start_period: 30s }
    logging: { driver: local, options: { max-size: "10m", max-file: "3" } }
volumes: { mongo: {}, logs: {}, backups: {} }
networks:
  internal: { internal: true }
  edge: { external: true }
```

- Image pinned **by digest**, so a re-pushed tag can never change what runs.
- `internal: true` network: Mongo has no route out and no route to other tenants.
- `platform-deny` (Traefik file middleware, 070): refuses `/api/v2/platform` at the edge.
- `read_only` root filesystem with `tmpfs` for `/tmp` — verify every write path (uploads in S3 mode,
  logs and backups on volumes, sharp/temp files under `/tmp`); fix any write outside them.
- Tier sizing table in `deploy/managed/tiers.json` *(placeholder, tuned in load tests)*:

  | Tier | APP_CPUS | APP_MEM | MONGO_CPUS | MONGO_MEM | MONGO_CACHE_GB |
  |---|---|---|---|---|---|
  | starter | 1.0 | 1g | 0.5 | 512m | 0.25 |
  | pro | 2.0 | 2g | 1.0 | 1g | 0.5 |
  | business | 3.0 | 5g | 1.0 | 3g | 1.5 |

- `NODE_OPTIONS=--max-old-space-size` set to ~75% of `APP_MEM` so Node frees memory before the
  container is OOM-killed.

### T3 — `deploy/managed/up.sh` — the one command

`up.sh <instanceDir>`: validates `.env` (every bootstrap key from architecture §5 present and
well-formed), `docker compose -p t_<id> pull`, `up -d`, waits up to 120 s for `app` healthy and
`GET /api/v2/platform/status` → `dbOk`, prints a JSON line `{ ok, version, ms }` the host agent
parses. Exit codes: 0 ok, 2 bad env, 3 pull failed, 4 unhealthy (with the last 50 app log lines).
Companion `down.sh` (stop, keep volumes), `destroy.sh` (requires `--yes-delete-data`).

The same script is the manual path for the M2 beta, run over SSH by an engineer:

```
$ deploy/managed/up.sh /srv/alianhub/tenants/ins_01jd3k…
{"ok":true,"version":"14.40.0","ms":41230}
```

### T4 — Release pipeline for hosting

- Keep GHCR as the source of truth (public, open source, already multi-arch).
- Add the image **digest** of every release to the GitHub release notes and to a machine-readable
  `releases/index.json` asset the control plane reads (version, digest, minTrackerVersion, migration
  flags, `selfHost.upgradeNeeded`).
- Registry used by hosts (Q24, from
  [digitalocean.md §3](../../active/060-alianhub-cloud-programme/resources/digitalocean.md#3-container-registry-docr)):
  we do **not** have to push to DigitalOcean — Droplets pull the public GHCR image. From M4,
  `docker.yml` also pushes the same digest to DigitalOcean Container Registry
  (`registry.digitalocean.com/alianhub/alianhub:<version>`, Basic plan, $5/month) as a mirror;
  `up.sh` pulls `${IMAGE}@${IMAGE_DIGEST}` from DOCR with the short-lived read-only credentials the
  host agent passes in, and falls back to GHCR (same digest) when DOCR fails. The CI token for the
  push needs `registry:read/update` (verify it is enough).
- Images are signed with cosign (keyless, GitHub OIDC); the host agent verifies the signature before
  `up` (069).

### T5 — Image hardening and size

- Stay on Node 20 LTS until the fleet upgrade plan moves to 22; pin the Alpine digest in the
  Dockerfile and let Renovate/Dependabot bump it.
- Run `npm prune`/`--omit=dev` already done; also drop `docs/` except what the Instance console
  serves, and test fixtures.
- Trivy scan in CI; fail on critical CVEs with a fix available.
- Target: image under 450 MB compressed, cold pull on a new Droplet under 30 s.

### T6 — Smoke test of the managed stack in CI

A GitHub workflow job (`managed-smoke`) on every release candidate: start Traefik + MinIO + a fake
platform (tiny Node server holding the Ed25519 key) in Docker, render the template for two tenants,
run `up.sh` for both, then: provision both via the platform API (062), push config and entitlements,
sign in as each owner over HTTPS through Traefik, upload a file, and assert tenant A cannot reach
tenant B's container, database or files, and that `/api/v2/platform/*` through Traefik returns 403.

## How it looks

On a host:

```
/srv/alianhub/
├── edge/                 Traefik (070)
└── tenants/
    ├── ins_01jd3k…/
    │   ├── compose.yml   (rendered)
    │   ├── .env          (600, root)
    │   └── meta.json
    └── ins_01jd4m…/

$ docker ps --format '{{.Names}}\t{{.Status}}'
t_ins_01jd3k…-app-1     Up 3 days (healthy)
t_ins_01jd3k…-mongo-1   Up 3 days (healthy)
t_ins_01jd4m…-app-1     Up 6 hours (healthy)
t_ins_01jd4m…-mongo-1   Up 6 hours (healthy)
traefik                 Up 9 days
alianhub-agent          Up 9 days
```

Self-hosted users still run exactly:

```
cp .env.example .env   # set JWT_SECRET
docker compose up -d
```

## Platform view

- **Density.** Tier limits are ceilings, not reservations: 070 places stacks by measured memory, aiming
  at 45–60 Starter stacks on a 64 GiB Droplet ($336/month). The idle footprint of a stack (app +
  Mongo with the small WiredTiger cache) is therefore the number that decides Starter's margin —
  measure it in T6 and in the M2 beta, and trim it (lazy-loaded modules, smaller Node heap, fewer
  idle timers) if it is above ~800 MB.
- **Isolation.** Separate networks per tenant, internal-only Mongo, no Docker socket in any tenant
  container, dropped capabilities, read-only root filesystem, resource limits so one tenant cannot
  starve the others.
- **Reproducibility.** Digest-pinned images and a rendered, stored compose file mean any stack can be
  recreated exactly (restore, host move).
- **Logs.** `local` log driver with rotation keeps disks safe; application logs stay on the `logs`
  volume for 071's shipping.

## Management view

- **Why it matters.** This is the unit we sell; its size per tier sets how many customers fit on a
  server and therefore the margin.
- **Cost.** 5–6 developer days (T6, the two-tenant smoke test, is the most valuable piece).
- **Open-source benefit.** Self-hosters can finally run two copies on one machine (staging + prod).
- **Risk:** the read-only filesystem breaks a rarely used feature that writes to disk. Mitigation:
  T6 exercises uploads, imports, exports, thumbnails, backups and AI brief extraction; anything
  failing gets a `tmpfs` or a volume.

## Out of scope

- Traefik, firewall and host configuration (070).
- The host agent and orchestration (069).
- Kubernetes manifests or Helm charts.

## Acceptance criteria

- [ ] `docker compose -p a up -d` and `docker compose -p b up -d` on one machine give two
      independent installs (own volumes, networks, containers).
- [ ] Existing installs upgrading keep their data (legacy names path documented and tested).
- [ ] The managed template renders for each tier and passes `docker compose config`.
- [ ] `up.sh` brings a stack to healthy in under 60 s on a warm host and returns the documented exit
      codes for bad env, failed pull and unhealthy start.
- [ ] The app runs with a read-only root filesystem through uploads, imports, exports, thumbnails,
      backups and AI brief extraction.
- [ ] Every release publishes its digest and `releases/index.json`; images are cosign-signed and
      Trivy-scanned.
- [ ] The `managed-smoke` workflow proves two tenants are isolated and the platform path is closed at
      the edge.

## Dependencies

- 061 (managed mode boot checks), 062 (status, provision, config used by `up.sh` and T6).
- 070 provides Traefik's `edge` network and file middlewares on real hosts; T6 brings its own.

## Open questions

- Q24 — registry (GHCR only vs mirror to DigitalOcean Container Registry).
- Q6 — tier sizes depend on the shared/dedicated split.

## Estimate

5–6 developer days.
