# Progress: Hosting-ready image and compose template — many customers per server, one command up

## Checklist

- [x] T1 — Self-hosted compose without fixed names (with a legacy-names path)
- [x] T2 — Managed compose template, tiers, read-only root filesystem
- [x] T3 — `deploy/managed/up.sh`, `down.sh`, `destroy.sh`
- [x] T4 — Release digests, `releases/index.json`, registry per Q24, cosign *(written, not yet run in Actions)*
- [ ] T5 — Image hardening, Trivy, size target — *done in code; image size and cold pull not measured (no Docker daemon here)*
- [ ] T6 — `managed-smoke` CI job with two tenants — *written; cannot pass until 061, 062 and 063 are merged*

## Last step

2026-10-28: everything built and committed on `feat/managed-docker-stack`. Not pushed. Next: push,
let CI run the unit/convention tests, then run `docker build` once to measure the image and
`workflow_dispatch` the Docker workflow on a test tag (or wait for the next release) to see the
scan, sign and index jobs run. Run **Managed smoke** by hand once 062 and 063 are on staging, then
set the repository variable `MANAGED_SMOKE=true`.

## Blockers

- T6 needs the platform API (062: status, provision, config, entitlements, owner/login-link,
  `/api/v2/auth/platform-login`) and S3 prefix storage (063) in the image it builds.
- T5 size/pull targets need a machine with a working Docker daemon (Docker Desktop is broken here).
- The DOCR mirror waits for the `DOCR_TOKEN` secret (070).

## Decisions and deviations

- **Legacy names (T1):** compose has no conditional include, and an empty interpolated `name:`
  makes compose create an anonymous volume, so `ALIANHUB_LEGACY_NAMES=true` cannot work as a
  switch. The legacy path is `COMPOSE_FILE=docker-compose.yml:docker-compose.legacy.yml` in `.env`
  (";" on Windows). Volume keys are unchanged (`alianhub_mongo_data` …), so the override only adds
  `name:`. Verified with `docker compose config`: `-p a`/`-p b` give `a_alianhub_mongo_data` /
  `b_…`, no container names; with the override the old names come back.
- **No CHANGELOG edit (T1):** CLAUDE.md Rule 4 lets only release-please edit `CHANGELOG.md`. The
  upgrade note lives in `docs/ADMIN-GUIDE.md#upgrade`, README and `.env.example`, and reaches the
  release index as `selfHost.upgradeNeeded` from `deploy/release-flags.json`.
- **Template (T2):** `${HOSTNAME}` renamed `${TENANT_HOST}` (a shell sets `HOSTNAME`, so any
  envsubst/compose interpolation would leak the machine name). Added: `pids` limit 512,
  `stop_grace_period: 20s`, a healthcheck with `start_interval: 2s` (faster ready on up), labels
  on mongo and `com.alianhub.version`, and the extra writable mounts found by auditing every write
  path: tmpfs `/tmp` (256m) and `/app/thumbnails` (64m); volumes `uploads` → `/app/wasabiUploads`
  (upload staging, on disk because files reach 100 MB) and `exports` →
  `/app/wasabiUploadsLocal/exports` (export jobs are downloaded later).
- **Rendering:** `deploy/managed/render.js <instanceDir>` reads `meta.json` (instanceId,
  hostname or subdomain(+baseDomain), tier, version, image, imageDigest, optional mongoPatch and
  limits overrides) and `tiers.json`, validates every field, writes `compose.yml` atomically,
  mode 0444. Node heap = 75% of the app memory limit. The mongo cache must be ≤ half the mongo limit.
- **up.sh:** validates `.env` with the same rules as 061's boot checks plus host-only ones
  (INSTANCE_ID = directory name, MONGODB_URL exactly `mongodb://mongo:27017`, APIURL = WEBURL + `/`,
  WEBURL host = the Host rule). Pulls with `--policy missing` (the app by digest; on failure retries
  `ALIANHUB_FALLBACK_IMAGE`, default GHCR, with the same digest and rewrites `compose.yml` to name
  what runs). Calls the platform status **inside the app container** with `docker compose exec`
  (no X-Forwarded-For, key read from the container env). Added exit code **5** (host not ready: no
  Docker, no `edge` network) and `restart.sh` (for `restartRequired` and `stack.restart`) and
  `platform-call.sh` (manual/smoke path to the platform API). `compose` is always called with
  `--env-file /dev/null` so the tenant `.env` never steers compose.
- **Release pipeline (T4):** `scan` runs Trivy (`aquasec/trivy:0.69.0` image, since the
  trivy-action release tags no longer resolve) on the untagged amd64 digest before `merge`, so a
  CRITICAL CVE with a fix leaves the release untagged; repository variable `TRIVY_ENFORCE=false`
  turns it into a report. `sign` (cosign keyless, no secret needed; `IMAGE_SIGNING=false` skips it)
  and `mirror` (`cosign copy` to `registry.digitalocean.com/<DOCR_REGISTRY|alianhub>/alianhub:<version>`,
  verified to keep the digest; skipped while `DOCR_TOKEN` is unset) never block the tags.
  `release-index` appends the digest (and the cosign verify command) to the release notes and
  attaches `index.json`, built by `scripts/release-index.js` from the newest earlier release's
  `index.json`, `deploy/release-flags.json` and `migrations/`. Stable address:
  `https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/releases/latest/download/index.json`.
- **Image (T5):** base pinned to `node:20.20.2-alpine3.23@sha256:fb4cd12c…` in all three stages,
  Dependabot (docker, weekly, against staging, no majors). Replaced `chown -R /app` (which copied
  every file into another layer) with `COPY --chown`; files stay owned by node so self-hosted
  features that write next to the code keep working. Dropped `docs/` (nothing reads it at runtime),
  source maps (the shell worker never caches `.map`) and yarn. npm stays for
  `docker compose exec app npm run migrate`. The image creates every writable directory so it boots
  read-only.
- **Edge (T6, for 070):** a Traefik middleware cannot 403 one path, so `platform-deny` is two
  pieces in `deploy/managed/smoke/traefik-dynamic.yml`: a router `PathRegexp((?i)^/+api/+v2/+platform)`
  at priority 1000000 to `noop@internal` behind an `ipAllowList` nobody matches (403), and a
  `platform-deny` headers middleware that strips `X-Platform-Key` on every tenant router. The match is
  case-insensitive because Express routes are. Tenants on the shared `edge` bridge can reach each
  other's app; `deploy/managed/smoke/edge-isolation.sh` (DOCKER-USER chain allowing only Traefik /
  the agent) closes that.
- **S3 in the smoke test:** MinIO images are no longer pullable from Docker Hub, so the smoke test
  uses SeaweedFS (`chrislusf/seaweedfs:4.00`) with a bucket and key per tenant.
- **Smoke trigger:** `workflow_dispatch`, and release-please pull requests to `main` only when the
  repository variable `MANAGED_SMOKE` is `true`, so it does not fail releases before 062/063 land.

## Notes for other tasks

- **061/062:** the platform guard refuses X-Forwarded-For only on `/api/v2/platform`; when the
  platform key is accepted on `/api/v2/instance/*` the same refusal should apply (the edge strips
  the key as a second lock). up.sh accepts a status body either bare or wrapped in `data`.
- **063/069:** `STORAGE_TYPE` defaults to `server` in the image; with a read-only root, uploads fail
  until the first `PUT /config` sets `s3` and the app restarts. Either put `STORAGE_TYPE=s3` in the
  bootstrap `.env` or push config before the owner signs in.
- **069:** the agent renders with `render.js` (or reuses its functions), writes `.env` mode 600, runs
  `up.sh`/`restart.sh`/`down.sh`/`destroy.sh --yes-delete-data` and parses the last stdout line.
  Registry credentials: set `DOCKER_CONFIG` to a directory holding the minted `config.json`.
  Verify signatures with the identity regexp
  `^https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/.github/workflows/docker.yml@refs/tags/v`
  and issuer `https://token.actions.githubusercontent.com`.
- **070:** the `edge` network must exist before any `up.sh` (exit 5 otherwise); the websecure
  entrypoint must enable TLS itself (`http.tls`), since tenant labels set no `tls`. Raise Docker's
  `default-address-pools` (each tenant adds one network; the default pools run out near 30). Use
  Traefik ≥ v3.6.1 with Docker 29. Mongo pulls come from Docker Hub (anonymous pull limits):
  pre-pull `mongo:7.0.<patch>` in the snapshot or mirror it. Secret `DOCR_TOKEN` (API token with
  `registry:read/update`; it is used as both username and password) and optional variable
  `DOCR_REGISTRY`.
- **Read-only root:** `Modules/emailTemplate` (rewrites `Modules/Template/*.js`) and the AI
  settings save that edits `.env` cannot write in managed mode; both are settings 061 locks there.

## Validation (2026-10-28)

- Run: `docker compose config` on both compose files and on the rendered template for all three
  tiers; `bash -n` on every script and every workflow `run:` block; ESLint on the new JS; jest
  (scratch config): `tests/managed-stack.test.js`, `tests/managed-stack-scripts.test.js` (the
  scripts against a fake `docker`: exit codes 0/2/3/4/5, fallback pull, crash loop, destroy guard),
  `tests/release-index.test.js`, and the conventions project (only the known Windows failures:
  CRLF and backslash paths; `ci-e2e-shards` passes once the workflows are LF).
- Not run: `docker build`, image size and cold pull, any real `up.sh` against Docker, Trivy, cosign,
  the DOCR copy, the release-index job, the smoke workflow, `edge-isolation.sh`. shellcheck is not
  installed here.

## Log

### 2026-10-28
- T1: compose names follow the project; `docker-compose.legacy.yml`; admin guide, README,
  `.env.example`.
- T2/T3: `deploy/managed/` template, tiers, `render.js`, `lib.sh`, `up.sh`, `down.sh`,
  `restart.sh`, `destroy.sh`, `platform-call.sh`; tests.
- T5: Dockerfile pinned and slimmed; read-only-ready directories; `.dockerignore`; Dependabot.
- T4: `docker.yml` scan/sign/mirror/release-index jobs; `scripts/release-index.js`;
  `deploy/release-flags.json`; tests.
- T6: `deploy/managed/smoke/` (run.sh, Traefik config, fake platform, edge isolation) and
  `.github/workflows/managed-smoke.yml`.

### 2026-10-27
- Task created from the AlianHub Cloud programme plan (060).
