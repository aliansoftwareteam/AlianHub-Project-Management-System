---
id: 074
title: Local Docker host — real AlianHub Cloud instances on a developer PC
status: active
priority: high
depends_on: [062, 063, 064, 065, 067, 072]
created: 2026-10-28
---

# Local Docker host — real AlianHub Cloud instances on a developer PC

> Part of [060 AlianHub Cloud](../060-alianhub-cloud-programme/task.md) · first slice of
> [069](../../backlog/069-provisioning-orchestrator/task.md) · Repo: `alianhub-cloud`

## Goal

When a plan is granted in the local portal or back office (invite code or approved request), a
real hosted AlianHub starts in Docker on this PC at `https://<sub>.alianhub.localhost`, and every
later change from the portal or back office really reaches it. That lets M1 and M3 be tested end to
end before DigitalOcean exists (M2). It is built as the first slice of 069: the workflow steps, job
records and signed entitlements are 069's real code, and only the host, DNS and storage adapters are
local, so M2 swaps adapters instead of rewriting.

## Scope

### T1 — Local edge, one command

`dev/local-host/` in `alianhub-cloud`, started and stopped with `npm run local-host:up|down`:

- Docker network `edge`.
- Traefik v3.6 on `127.0.0.1:443`, using its built-in self-signed certificate and the 065 dynamic
  config (`platform-deny`, `security-headers`).
- Local registry `registry:2.8.3` on `127.0.0.1:5000`.
- SeaweedFS S3 on `127.0.0.1:8333` (decided 2026-10-28).
- Mailpit: SMTP on `1025` for the instances, inbox UI at `http://localhost:8025`.

### T2 — The AlianHub image

`npm run local-host:image -- <path to an AlianHub checkout>`:

- Defaults to the `chore/pre-staging` worktree, because the public `latest` image has none of 061–066.
- Builds the image, pushes it to the local registry and records `image@sha256:…` and the version for
  the engine.

### T3 — Engine `ORCHESTRATOR_MODE=local`

- Refused in production, as `simulate` is.
- Uses 069's T1 step model `{ name, run, verify }`: one `jobs` row per step attempt, `verify` skips
  work that is already done, and a failed workflow resumes from its failed step (the back office's
  Retry).
- One workflow per instance at a time.
- An in-process runner over `jobs`, which picks up unfinished work at boot. Agenda and the
  long-polling host agent stay in 069.
- Adapters, one file each, with the same interfaces as 069 T2:
  - **host `localDocker`:** writes `<LOCAL_HOST_DIR>/tenants/<instanceId>/` (`meta.json`, `.env`),
    runs 065's `render.js`, `up.sh`, `down.sh` and `destroy.sh` through Git Bash, and makes instance
    calls with `platform-call.sh`, which runs inside the app container.
  - **dns `localhost`:** nothing to create, because `*.localhost` resolves to this PC.
  - **objectStore `seaweed`:** one identity, key and prefix per instance; reports prefix bytes;
    deletes a prefix.
  - **mail `mailpit`:** instance mail settings point at Mailpit.
- A `host` row "local-pc" is registered automatically.

### T4 — Provision workflow

The existing `PROVISION_STEPS` with real work behind them:

| Step | Does |
|---|---|
| `host_allocated` | Places the instance on local-pc, subject to T7 capacity. |
| `dns_created` | Verifies that the name resolves locally. |
| `storage_created` | Creates the instance's S3 key and prefix; verified with a put/get/delete probe. |
| `stack_rendered` | Generates the secrets (encrypted at rest, as 069 says), writes `.env` and `meta.json`, renders `compose.yml`. |
| `stack_started` | Runs `up.sh`. |
| `app_healthy` | Checks that platform `status` reports `dbOk`. |
| `config_pushed` | Pushes S3, mail and URLs through `PUT /config`. |
| `owner_provisioned` | Calls `POST /provision`; the ready email carries the real activation link. |
| `entitlements_applied` | Builds with `computeEntitlements`, signs with Ed25519, sends `PUT /entitlements`. |
| `public_url_verified` | Gets `https://<sub>.alianhub.localhost/health` through Traefik. |
| `active` | Marks the instance active. |

### T5 — Changes and calls

- `entitlements.push`: sign and push.
- `resize`: re-render with the new tier, then `up.sh`.
- `lifecycle`: `POST /lifecycle`.
- `cancel`: `down.sh`, then state `cancelled`.
- `reactivate`: `up.sh` plus `lifecycle active`.
- `delete`: `destroy.sh`, delete the S3 prefix, revoke its key.
- `rename`: re-render with the new host, restart, push URLs.
- `restart`.
- Every `INSTANCE_CALL_ACTIONS` call is proxied for real: login link, activation link, support session,
  transfer, usage, status, config.

### T6 — Usage

Every 5 minutes, and on demand, a `usage` call to each active local instance feeds the portal and
back-office meters.

### T7 — Capacity on this PC

- Local tier sizes are capped at app 1 GB / Mongo 512 MB for every plan, Business included.
- At most 4 running instances. A 5th is refused with 069's "adding capacity" message and an alert,
  never half-created.

### T8 — Launch and docs

- The test launcher (`F:/Projects/alianhub-test-data/cloud/env.mjs`) switches to
  `ORCHESTRATOR_MODE=local` and `INSTANCE_ROOT_DOMAIN=alianhub.localhost`.
- A README section, "Run real instances on your PC".
- A record in the repo's `docs/decisions.md`.

## Out of scope

- DigitalOcean, Cloudflare, Wasabi, DOCR and Resend adapters.
- The host agent process with host tokens and long polling (069 T3), and cosign verification.
- Agenda.
- Backup, restore, `move_host`, `upgrade` and `rotate_secrets`. These keep their simulated answers in
  local mode (069 / 071).
- 065's iptables edge isolation (Linux only).
- Trusted certificates: the browser warns once per address (decided 2026-10-28).
- Payments (068).

## Acceptance criteria

- [ ] `npm run local-host:up` starts Traefik, the registry, SeaweedFS and Mailpit; `local-host:down`
      removes them.
- [ ] `npm run local-host:image` builds the pre-staging image into the local registry and records its
      digest.
- [ ] Redeeming an invite or approving a plan request starts a real stack. The setup screen shows the
      real steps, and the instance is ready in under 3 minutes with the image already pulled.
- [ ] The activation link in the ready email opens `https://<sub>.alianhub.localhost`, sets a
      password and lands in the workspace with the sample project.
- [ ] "Open AlianHub" in the portal signs the owner in.
- [ ] After a plan change approved in the back office, the instance's Plan & usage shows the new
      limits within a minute, signed by the cloud's key.
- [ ] Suspend and Resume in the back office show and clear the suspended notice in the instance.
- [ ] A support session from the back office opens the instance as AlianHub Support.
- [ ] Invitation emails from the instance appear in Mailpit.
- [ ] Uploads land under the instance's own S3 prefix, and one instance's key cannot read another's.
- [ ] Back-office usage matches the instance.
- [ ] Cancel stops the stack; Reactivate starts it again with the data intact.
- [ ] Delete removes the containers, volumes, S3 prefix and key.
- [ ] Restarting the cloud server mid-provision resumes from the step it reached, with no second
      stack, key or owner.
- [ ] A 5th instance is refused cleanly.
- [ ] `ORCHESTRATOR_MODE=local` is refused in production.
- [ ] Lint, tests (steps against fake adapters: verify, resume, idempotency) and the build pass.

## Constraints & notes

- **This PC:**
  - Docker Desktop 29.5 with 8 GB and 20 CPUs.
  - Ports 443, 5000, 8333, 1025 and 8025 were free on 2026-10-28.
  - 065's bash scripts run through Git Bash, and the Docker socket mount works for Traefik on
    Docker Desktop.
- **Signing key:**
  - New `ENTITLEMENTS_SIGNING_KEY` (Ed25519 PKCS8), held only in the control-plane environment.
  - Instances get the matching public key as `PLATFORM_PUBLIC_KEY`.
  - `PLATFORM_URL` for instances is a placeholder https URL, because the pull fallback isn't used
    locally.
- **Existing records:** the two simulated instances (`acmesmoke`, `abcaa`) stay. Retry in the back
  office provisions them for real, or they can be deleted.
- **Databases:** each instance has its own Mongo container. Nothing touches the live demo database.

## Resources

- `../060-alianhub-cloud-programme/resources/architecture.md` — §5 stack, §8 platform API, §11 steps,
  §14 job kinds.
- 065 `deploy/managed/smoke/run.sh` in the AlianHub repo — the local host this task generalises.
