# AlianHub admin guide

Everything a self-hoster needs to install, configure, upgrade, back up and troubleshoot an instance, without reading code. The Instance console inside the app (**Settings › Instance**, visible only to the account that ran setup) links to the matching section of this page.

Contents: [Install](#install) · [First run](#first-run) · [Configure](#configure) · [HTTPS](#https) · [Upgrade](#upgrade) · [Backup and restore](#backup-restore) · [Troubleshooting](#troubleshooting) · [Reference](#reference)

---

## Install

### Docker (recommended)

Three commands on any host with Docker installed:

```bash
curl -O https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/docker-compose.yml
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Open `http://<host>:4000`. A fresh database sends you to the setup page ([First run](#first-run)).

What the compose file gives you:

| Piece | Purpose |
|---|---|
| `app` | AlianHub (Node 20, the built web app served by the API) |
| `mongo` | MongoDB 7 on the internal network only |
| volume `alianhub_mongo_data` | the databases |
| volume `alianhub_storage` | uploaded files when `STORAGE_TYPE=server` (the default in the image) |
| volume `alianhub_logs` | rotating logs, readable from Settings › Instance › Logs |
| volume `alianhub_backups` | archives written by Settings › Instance › Backups |

`MONGODB_URL` must be the server address only (`mongodb://mongo:27017`); the app creates one database per company under it. The container becomes **healthy** once `/health` answers 200, which needs the database.

Anything else (mail, storage, AI, sign-in providers) is configured later from the app, or put in `.env` next to the compose file — the file is read by `docker compose` and passed to the container.

### Bare metal (Node 20 + MongoDB)

```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm run setup
```

`npm run setup` installs dependencies, writes `.env` with random secrets, a local `MONGODB_URL` and `STORAGE_TYPE=server`, builds the web app once (2–3 minutes), starts the server and opens `http://localhost:4000/#/setup`. Afterwards, `npm start` is all you need. Run it under a process manager (pm2, systemd) in production.

Prerequisites: Node.js 20, MongoDB 6 or 7 reachable at `MONGODB_URL`.

---

## First run

With an empty database every address redirects to **`/#/setup`**. The page checks the database first; if it cannot be reached it shows the exact error and the three steps to fix it (set `MONGODB_URL`, restart, check again).

The form asks for the owner account (name, email, password) and the workspace name, an optional "what does your team mainly do" that picks the sample content, and whether to start with a sample project. Under a minute later you are logged in as the owner.

Setup does, in order: global seeds (file-type rules, custom-field types, tours), the owner account (marked email-verified, since mail is rarely configured yet), the workspace with its default settings, the sample project. Progress streams to the page; a failure names the step and nothing you typed is lost.

The owner account is the **instance owner** (`users.isProductOwner`): it is the only account that sees Settings › Instance. Everyone else is invited from Settings › Members.

Setup refuses to run again once a user exists (HTTP 409). To start over, drop the databases or restore an empty backup.

---

## Configure

**Settings › Instance › Settings** holds every operational setting, grouped as General, Mail, Storage, AI, Sign-in, Calling and Security. Values are stored in the database (`global.instance_settings`); secrets are encrypted with a key derived from `JWT_SECRET`, so keep that secret stable — rotating it makes stored secrets unreadable and they read as unset.

Two rules to remember:

1. **The environment wins.** A key set in `.env` or the container environment shows as `env` and cannot be edited in the page; change it where it is set and restart.
2. **A few settings need a restart** and say so: the storage driver and Wasabi credentials, the security settings, the scheduler time zone. Everything else applies when you press Save.

Each group with something to test has a **Test** button that tries the values you typed before you save them.

### General
`APP_NAME`, `WEBURL` (the address people open; used in emails and OAuth callbacks), `APIURL` (same, with a trailing slash), `CRON_TZ`.

### Mail
Either SMTP (`NODEMAILER_HOST`, `NODEMAILER_PORT` 587 or 465, `NODEMAILER_EMAIL`, `NODEMAILER_EMAIL_PASSWORD`) or Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`). When a Resend key is set it is used. Test performs an SMTP login or a Resend API call. Without mail, invitations and password resets cannot be sent; the readiness card on the Health page reminds you.

### Storage
`STORAGE_TYPE=server` keeps uploads on disk under `storage/` (a volume in Docker). `wasabi` uses any S3-compatible bucket: `WASABI_ACCESS_KEY`, `WASABI_SECRET_ACCESS_KEY`, `WASABIENDPOINT`, `WASABI_REGION`, `USERPROFILEBUCKET`. Test checks that the directory is writable or that the bucket answers. Changing the driver needs a restart and does not move existing files.

### AI
`LLM_PROVIDER` (openai, anthropic, deepseek) plus the matching key and model. Test asks the provider to list models with the key. Nothing in the product requires AI; the AI pages simply stay empty without a key.

### Sign-in
Google, GitHub and GitLab each have an enable switch, a client id and a client secret. The login page learns which buttons to show from `GET /api/v2/instance/public-config`, so nothing needs a rebuild. Set the provider's callback URL to your `WEBURL`. `SSO_LOGIN_ENABLED` hides the "Continue with SSO" button when you do not use SAML/OIDC.

Push notifications (Firebase) are the one exception: the browser service worker is generated at build time, so those keys live in `frontend/.env` as `VUE_APP_*` and in `.env` as `APIKEY`, `PROJECTID`, ...; see `.env.example`.

### Calling
`STUN_URLS`, `TURN_URLS`, `TURN_STATIC_AUTH_SECRET` (or the weaker `TURN_USERNAME`/`TURN_PASSWORD`). Calls are peer-to-peer; a TURN relay is what makes them work behind strict NAT. The compose file ships an optional coturn service (`docker compose --profile calling up -d`).

### Security
`TRUST_PROXY` (`loopback` by default; a hop count or `true` behind a hosted proxy), `GLOBAL_RATE_LIMIT_PER_MIN` (1000 API requests per minute per IP; `0` turns it off), `HELMET_ENABLED` (security response headers, on). All three are read at boot.

### Keys that only live in the environment
`JWT_SECRET`, `MONGODB_URL`, `PORT`, `CRON_ENABLED`, `MIGRATIONS_AUTO`, `BACKUP_DIR`, `INSTANCE_ADMIN_KEY`, `LOG_DIR` and the other `LOG_*` knobs, the body and image size limits. `.env.example` documents each one.

`INSTANCE_ADMIN_KEY` lets a script call `/api/v2/instance/*` with an `adminkey` header, for a backup cron job for instance:

```bash
curl -s -X POST -H "adminkey: $INSTANCE_ADMIN_KEY" http://localhost:4000/api/v2/instance/backups -H 'content-type: application/json' -d '{}'
```

---

## HTTPS

Put a reverse proxy with a certificate in front of port 4000 (Caddy, nginx, Traefik; any of them can obtain a Let's Encrypt certificate). Then:

1. set `WEBURL=https://your.host` and `APIURL=https://your.host/` (General group, or `.env`);
2. set `TRUST_PROXY=1` (Security group) so rate limiting sees client addresses;
3. make the proxy forward WebSocket upgrades (`/socket.io/`), which every reverse proxy supports with one or two lines.

Minimal Caddyfile:

```
your.host {
    reverse_proxy localhost:4000
}
```

Cookies are marked `Secure` in production, so logging in over plain HTTP with `NODE_ENV=production` fails by design. Audio and video calls only work in a secure context.

The readiness card on the Health page stays amber until `WEBURL` starts with `https://`.

---

## Upgrade

**Settings › Instance › Upgrade** shows the running version, the latest GitHub release, the changelog entries newer than what you run (with the lines that concern self-hosters highlighted), and the migration state.

Docker:

```bash
docker compose pull && docker compose up -d
```

Bare metal:

```bash
git pull
npm ci
cd frontend && npm ci && npm run build && cd ..
npm start
```

Migrations run automatically at boot before the server starts listening; each one is recorded in `global.schema_versions` with its duration and, for per-company steps, the outcome per company. A failed migration does not stop the server: `/health` reports `migrationError`, the Upgrade page shows which step failed and why, and the next boot (or **Run pending migrations**) retries it. Set `MIGRATIONS_AUTO=false` to run them by hand instead:

```bash
npm run migrate:status   # what is applied and what is pending
npm run migrate          # apply what is pending
```

Take a backup before upgrading; the Upgrade page says so and the Backups page is one click away.

---

## Backup-restore

**Settings › Instance › Backups** writes a `.tar.gz` archive to `BACKUP_DIR` (`backups/`, a volume in Docker) containing `manifest.json` followed by every collection of every database as JSON lines (`global/users.jsonl`, `<companyId>/tasks.jsonl`, ...) in MongoDB's extended JSON, so ids and dates survive the round trip. Tick **Include uploaded files** to add `storage/` when `STORAGE_TYPE=server`.

Download an archive from the same page or copy it off the volume; keep at least one copy off the host.

### Restore

Choose an archive, read its manifest (date, version, workspaces) and type its name to confirm. A restore:

1. takes a safety backup (`pre-restore-*`);
2. switches the API to maintenance (every call except `/health` and the Instance console answers 503; open tabs show a banner and recover on their own);
3. drops and refills every collection named in the archive, and the files if they were included;
4. reruns migrations, clears caches and reconnects to the database.

Restore an archive taken by the same or an older version, never a newer one. A restore drill on a throwaway instance is the only way to know your backups work: run a second copy (`docker compose -p drill up -d` with a fresh volume), upload an archive there, restore it, log in.

### Alternatives

`mongodump --uri "$MONGODB_URL"` backs up the same data with MongoDB's own tool; with `STORAGE_TYPE=server` copy `storage/` as well. Docker users can snapshot the three volumes.

---

## Troubleshooting

**Settings › Instance › Health** is the first place to look. The legend:

| Card | Green | Amber / red |
|---|---|---|
| Database | answers within a few ms | unreachable: the app cannot work; check `MONGODB_URL` and that MongoDB runs |
| Storage | directory writable (free space shown) / bucket reachable | uploads will fail; check the volume or the bucket credentials |
| Mail | a provider is set (Test sends a login) | invitations and resets cannot be sent |
| Migrations | none pending, no error | pending: open Upgrade; error: read it, fix the cause, run again |
| Automation queue | 0 failed | failed jobs are automation runs that gave up; the Automations page lists them |
| Backups | one exists | take one |
| Scheduled jobs | every job's last run OK | a red job names the error; `CRON_ENABLED=false` means nothing runs |

The readiness card at the top lists what is still missing for a production instance.

**Logs**: Settings › Instance › Logs tails `error-*.log`, `combined-*.log` (everything) and `track-*.log` (warnings) from `LOG_DIR` and lets you download a file. Files rotate daily and are kept for `LOG_MAX_FILES` (14 days).

**From a terminal**:

```bash
curl -s http://localhost:4000/health
```

answers `200 {"status":"ok", "db":{"ok":true,...}}` or `503 {"status":"degraded", "db":{"ok":false,"error":"..."}}`, plus `migrationsPending`, `migrationError` and `maintenance`. Docker's `HEALTHCHECK` uses the same endpoint.

### Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Browser shows the setup page on an instance that has users | the app cannot see the database (setup checks users) | `curl /health`; fix `MONGODB_URL` or start MongoDB |
| `No database configured. Set MONGODB_URL...` at boot | `.env` missing or empty `MONGODB_URL` | set it; in Docker check the `environment:` block |
| Setup page says the database is unreachable inside Docker | `MONGODB_URL` includes a database name, or `mongo` is not healthy yet | use `mongodb://mongo:27017`; `docker compose ps` |
| Invitations never arrive | no mail provider, or Test fails | Settings › Instance › Settings › Mail, press Test |
| Uploads fail with `EACCES` | the storage volume is not writable by the `node` user | `chown -R 1000:1000` the volume, or run Test under Storage |
| Login over HTTPS loops back to the login page | `WEBURL` still `http://`, or the proxy does not forward `X-Forwarded-Proto` | set `WEBURL`, `TRUST_PROXY=1` |
| `429 Too Many Requests` for one office | many people behind one IP | raise `GLOBAL_RATE_LIMIT_PER_MIN` or set `TRUST_PROXY` correctly |
| Every API call answers 503 with `maintenance: true` | a restore is running, or maintenance was left on | wait; Settings › Instance › Health › Leave maintenance |
| Secrets show as "not set" after changing `JWT_SECRET` | stored secrets are encrypted with the old key | re-enter them |

---

## Reference

### Endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `GET /health` | anyone | liveness: 200 ok / 503 degraded |
| `GET /api/v2/setup/status` | anyone | `{installed, dbOk, dbError, version}` |
| `POST /api/v2/setup/complete` | anyone, once | creates owner and workspace; 409 afterwards |
| `GET /api/v2/instance/public-config` | anyone | sign-in providers, storage type, version |
| `GET/PUT /api/v2/instance/settings` | instance owner or `adminkey` | read (secrets masked) / save settings |
| `POST /api/v2/instance/settings/test` | owner | `{group: mail\|storage\|ai, values}` |
| `GET /api/v2/instance/health` | owner | the Health page's data |
| `POST /api/v2/instance/maintenance` | owner | `{on: true\|false}` |
| `GET /api/v2/instance/upgrade` · `POST /api/v2/instance/migrations/run` | owner | upgrade state, run pending migrations |
| `GET /api/v2/instance/logs?file=error&lines=500` · `/logs/files` · `/logs/download?name=` | owner | log tail, list, download |
| `GET/POST /api/v2/instance/backups` · `/:name/manifest` · `/:name/download` · `POST /:name/restore` · `DELETE /:name` | owner | backups |
| `GET /api/v2/instance/stats` · `/companies` · `/audit-export?companyId=` | owner | instance numbers, workspaces, audit CSV |

### Environment keys added by the Instance console

| Key | Default | Meaning |
|---|---|---|
| `CRON_ENABLED` | `true` | `false` stops every scheduled job |
| `MIGRATIONS_AUTO` | `true` | `false` only reads migration status at boot |
| `HELMET_ENABLED` | `true` | security response headers |
| `BACKUP_DIR` | `backups` | where archives are written |
| `INSTANCE_ADMIN_KEY` | unset | enables the `adminkey` header for scripts |
| `GLOBAL_RATE_LIMIT_PER_MIN` | `1000` | API requests per minute per IP; `0` disables |
| `TRUST_PROXY` | `loopback` | which proxies' `X-Forwarded-For` to believe |
| `HEALTH_DB_TIMEOUT_MS` | `3000` | how long `/health` waits for the database |

### Files and directories

| Path | Content |
|---|---|
| `.env` | environment; absent in Docker |
| `storage/` | uploads when `STORAGE_TYPE=server` |
| `log/` | `error-`, `combined-`, `track-YYYY-MM-DD.log` |
| `backups/` | archives |
| `migrations/NNN-name.js` | one file per migration; `global.schema_versions` records the runs |
| `global.instance_settings` | the settings document (`_id: "instance"`) |

### Scripts

`npm run setup` (first install), `npm start`, `npm run migrate:status`, `npm run migrate`, `npm test`.
