# The Instance console

**Settings › Instance** is where the instance owner runs the whole server from the browser: its health, its settings, backups, upgrades and logs. Only the account that ran setup (the instance owner) sees it. Each tab has an **Admin guide** button that links to the matching page here.

## Tabs

| Tab | What it is for | Details |
|---|---|---|
| **Health** | Database, storage, mail, migrations, automation queue, backups and scheduled jobs at a glance, plus the readiness card and maintenance mode | [Logs and monitoring](./monitoring) |
| **Settings** | Every operational setting, in the groups below | this page |
| **Enforcement** | Permission checks for browser sessions (off, report, enforce), per instance and per workspace, and the content security policy report | [Security](./security) |
| **Egress** | The hosts each workspace's agents may fetch, when `AGENT_EGRESS_ALLOWLIST` is on | [Security](./security) |
| **Instruction guard** | Extra patterns that flag instruction-like text arriving from outside a workspace | [Security](./security) |
| **Knowledge** | What each workspace's knowledge index holds, its backfill and embedding model, reindex and re-embed | [AI providers](./ai-providers) |
| **Backups** | Take, download, restore and delete backups | [Backup and restore](./backups) |
| **Upgrade** | Running version, latest release, changelog, migrations | [Upgrades](./upgrades) |
| **Logs** | Tail and download the server logs | [Logs and monitoring](./monitoring) |
| **AI providers** | Each configured provider and model with its health, breaker state, latency and price | [AI providers](./ai-providers) |
| **Stats** | Instance numbers and workspaces, with an audit CSV export per workspace | |

## How settings work

**Settings** holds every operational setting, grouped as **General**, **Mail**, **Storage**, **AI**, **Sign-in**, **Calling** and **Security**. Values are stored in the database (`global.instance_settings`, document `_id: "instance"`). Secrets are encrypted with a key derived from `JWT_SECRET`, so keep that secret stable: rotating it makes stored secrets unreadable and they read as **not set**. A stored secret is never shown again; the field reads **•••••••• (set — type to replace)**.

Three rules:

1. **The environment wins.** A key set in `.env` or the container environment shows as **env** and cannot be edited here; change it where it is set and restart. The order is environment, then `.env`, then this page, then the built-in default.
2. **A few settings need a restart** and are marked **restart**: the storage driver, the scheduler time zone, **Connect an AI app by address**, and the security middleware settings (trusted proxies, rate limit, security headers). After saving, the page lists which keys wait for a restart. Everything else applies when you press **Save**.
3. **Test before you save.** Mail, Storage and AI have a **Test** button that tries the values you typed: an SMTP login, an SES or Resend call, a write to the storage directory or a call to the bucket, a model list from the AI provider.

Read and write the same settings from a script with `GET` and `PUT /api/v2/instance/settings` and the `adminkey` header (see [Security](./security)).

## General

| Field | Key | Notes |
|---|---|---|
| Product name | `APP_NAME` | Shown in emails and page titles; the sender name for SES mail. Default `AlianHub`. |
| Public web URL | `WEBURL` | The address people open; used in emails, OAuth callbacks and CORS. |
| Public API URL | `APIURL` | Usually the web URL with a trailing slash. |
| Scheduler time zone | `CRON_TZ` | IANA zone for reminders and digests, default `UTC`. Restart. |

## Mail

SMTP (`NODEMAILER_HOST`, `NODEMAILER_PORT`, `NODEMAILER_USER`, `NODEMAILER_EMAIL`, `NODEMAILER_EMAIL_PASSWORD`), Resend (`RESEND_API_KEY`, `RESEND_FROM_EMAIL`) and Amazon SES (`AWS_SES_REGION`, `AWS_SES_KEY`, `AWS_SES_SECRET`, `AWS_SES_FROM_DEFAULT`). When several are filled, SES wins, then Resend, then SMTP. See [Mail](./mail).

## Storage

**Storage driver** (`STORAGE_TYPE`): **This server** or **S3-compatible (Spaces, Wasabi, S3, MinIO)**; **Wasabi** is the same driver under its older name. Then **Storage address**, **Region**, **Bucket**, **Key prefix**, **Access key**, **Secret key**, **Bucket in the path** and **Public files address** (`S3_*`), and **Public assets bucket** (`USERPROFILEBUCKET`) for a bucket per workspace. The older `WASABI_*` fields appear only while they hold a value. The driver needs a restart and changing it does not move existing files. See [File storage](./storage).

## AI

**AI features** (`AI_ENABLED`, the instance-wide switch), **Workspace Guide in new workspaces**, **Provider** (`LLM_PROVIDER`: openai, anthropic, deepseek, openai_compatible) with each provider's key and model, the OpenAI-compatible server for local models, the daily limit for AI field fills, replay records, model prices (`LLM_PRICING`), and the switches that let people connect their own AI app: **Connect an AI app by address** (`MCP_OAUTH`), **AI data tools**, **AI management tools** and **AI everyday work tools**. Nothing in the product requires AI. See [AI providers](./ai-providers).

## Sign-in

Google, GitHub and GitLab each have an enable switch, a client id and a client secret; GitHub and GitLab also take their OAuth base URLs (for GitHub Enterprise or a self-managed GitLab). Also **Show "Continue with SSO" on the login page** (`SSO_LOGIN_ENABLED`), **Sign in with an emailed link** (`MAGIC_LINK_ENABLED`) and **Name in authenticator apps** (`TWO_FACTOR_ISSUER`). The login page learns which buttons to show from `GET /api/v2/instance/public-config`, so nothing needs a rebuild. See [Sign-in: OAuth, SSO and SCIM](./sso-oauth).

## Calling

| Field | Key |
|---|---|
| STUN servers | `STUN_URLS` (default `stun:stun.l.google.com:19302`) |
| TURN servers | `TURN_URLS`, comma-separated, such as `turn:turn.example.com:3478` |
| TURN static auth secret | `TURN_STATIC_AUTH_SECRET` |
| TURN username / password (fallback) | `TURN_USERNAME`, `TURN_PASSWORD`; weaker than a static secret |

Calls are peer-to-peer; a TURN relay makes them work behind strict NAT. The compose file ships an optional coturn service; see [Install with Docker](./install-docker#calling-relay-optional).

## Security

| Field | Key | Notes |
|---|---|---|
| Trusted proxies | `TRUST_PROXY` | `loopback`, a hop count such as `1`, or `true`. Restart. |
| API requests per minute per IP | `GLOBAL_RATE_LIMIT_PER_MIN` | Default 1000; `0` turns the limit off. Restart. |
| Private webhook hosts | `WEBHOOK_ALLOWED_PRIVATE_HOSTS` | Hostnames or CIDR ranges on your network that webhooks may post to. Applies on save. |
| Security response headers | `HELMET_ENABLED` | On by default. Restart. |
| Hold risky AI writes for approval | `AGENT_TAINT_ROUTING` | Shown only; set it in `.env`. |
| Permission checks for browser sessions | `PERMISSION_ENFORCEMENT_MODE` | off, report or enforce; the default for every workspace. Also on the **Enforcement** tab. |
| Keep audit log entries (days) | `AUDIT_RETENTION_DAYS` | Older entries are pruned each night; empty keeps the built-in window. |

See [Security](./security) for each one.

## Keys that only live in the environment

Some keys are never shown in the console, because the server needs them before it can read the database or because changing them from a browser would be unsafe: `JWT_SECRET`, `MONGODB_URL`, `PORT`, `NODE_ENV`, `CRON_ENABLED`, `MIGRATIONS_AUTO`, `BACKUP_DIR`, `INSTANCE_ADMIN_KEY`, `LOG_DIR` and the other `LOG_*` settings, the body, upload and image size limits, and the feature switches for agents and knowledge. See [Environment variables](./env-reference).

Push notifications (Firebase) are the other exception: the browser service worker is generated at build time, so those keys live in `frontend/.env` as `VUE_APP_*` and in `.env` as `APIKEY`, `PROJECTID`, and so on; see `.env.example`.

## Maintenance mode

**Enter maintenance** on the Health tab makes every API call except `/health` and the Instance console answer 503. Members see a banner and cannot use the app; open tabs recover on their own when you press **Leave maintenance**. A restore turns it on and off by itself.

## On AlianHub Cloud

An instance hosted by AlianHub Cloud runs with `HOSTING_MODE=managed`. There the platform owns the infrastructure settings:

- **Backups**, **Upgrade** and **Logs** are hidden; the platform backs up, upgrades and watches the instance.
- The General (except the product name and time zone), Mail, Storage and Security (except the permission mode and audit retention) groups are set by the platform and show as managed (**AlianHub Cloud manages this setting**), without their values. AI, Sign-in and Calling stay with the customer's owner.
- Settings that need a restart offer **Restart now**, limited to three restarts an hour.

## Endpoints

All under `/api/v2/instance/`, for the instance owner's session or the `adminkey` header:

| Method and path | Purpose |
|---|---|
| `GET /public-config` (anyone) | sign-in providers, storage type, version |
| `GET`, `PUT /settings` | read (secrets masked) or save settings |
| `POST /settings/test` | `{group: mail\|storage\|ai, values}` |
| `GET /health` | the Health tab's data |
| `POST /maintenance` | `{on: true\|false}` |
| `GET /upgrade`, `POST /migrations/run` | upgrade state, run pending migrations |
| `GET /logs?file=error&lines=500`, `/logs/files`, `/logs/download?name=` | log tail, list, download |
| `GET`, `POST /backups`, `GET /backups/:name/manifest`, `GET /backups/:name/download`, `POST /backups/:name/restore`, `DELETE /backups/:name` | backups |
| `GET /stats`, `/companies`, `/audit-export?companyId=` | instance numbers, workspaces, audit CSV |

## Related

- [Environment variables](./env-reference)
- [Logs and monitoring](./monitoring)
- [Security](./security)
