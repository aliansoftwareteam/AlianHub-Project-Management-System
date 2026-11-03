# Security

What AlianHub does to protect your data, what you as the operator must do, and the settings that harden an instance. AlianHub is self-hosted, so security is shared: the software provides the application controls; you own the server, the network, the secrets and the backups.

## Who does what

| Area | AlianHub provides | You provide |
|---|---|---|
| Sign-in | bcrypt passwords, a password rule, 2FA, OAuth, SAML/OIDC SSO, SCIM | an MFA policy, your identity provider |
| Access | roles and server-side permission checks, guest scoping | role assignment, periodic access reviews |
| Tenancy | every query scoped to the workspace; one database per workspace | |
| Audit | an audit log per workspace, with retention and an optional hash chain | shipping logs to your SIEM, reviewing them |
| Encryption in transit | works behind TLS; HSTS header | the TLS certificate and proxy ([HTTPS](./https)) |
| Encryption at rest | encrypts stored secrets | encrypted disks or volumes for MongoDB, files and backups |
| Network | security headers, rate limits, SSRF guards for webhooks and agents | firewall, private database network, WAF if you need one |
| Backups | in-app backups and restore | schedule, off-host copies, restore drills ([Backups](./backups)) |
| Patching | releases, dependency updates, signed images | applying upgrades, patching the host, Node and MongoDB |

## Hardening checklist

1. Serve only over HTTPS and redirect HTTP to it. See [HTTPS and reverse proxy](./https).
2. Set a long random `JWT_SECRET` (`openssl rand -hex 32`) and keep it out of version control.
3. Keep MongoDB on a private network, with authentication and a least-privilege user when it is not on the same host or Docker network. Never publish port 27017.
4. Encrypt the disks or volumes that hold MongoDB, `storage/` and `backups/`, or use server-side encryption on the bucket.
5. Set `TRUST_PROXY` correctly so rate limits and the audit log see real client addresses.
6. Require SSO with MFA at your identity provider for members, and set up SCIM so leavers lose access. See [Sign-in](./sso-oauth).
7. If your `.env` came from `.env.example`, clear `SOCKETIO_ADMIN_USERNAME` and `SOCKETIO_ADMIN_PASSWORD_HASH`, or replace the hash with your own: the sample values switch on the Socket.IO admin namespace.
8. Turn on `CSP_MODE=report`, then `enforce` once the Enforcement tab is quiet.
9. Move permission checks for browser sessions to `report`, then `enforce`.
10. Schedule backups, copy them off the host encrypted, and test a restore.
11. Ship `log/` and the audit log to your log system; set audit retention to your policy.
12. Upgrade when releases come out; read the changelog lines for self-hosters on the Upgrade tab.

## Secrets

| Key | What it protects | Rotating it |
|---|---|---|
| `JWT_SECRET` | signs sessions; derives the key that encrypts the secrets saved in the Instance console | logs everyone out, and secrets saved in the console read as "not set" until you enter them again |
| `SECRETS_KEY` | with `SECRETS_STORE=true`, seals integration and webhook secrets in a per-workspace store (AES-256-GCM); at least 32 characters | move the old value to `SECRETS_KEY_PREVIOUS`, set the new one, restart, run `npm run secrets:reencrypt`; unset the previous key only when the command says no live secret uses it |
| `TWO_FACTOR_ENC_KEY` | authenticator secrets at rest | secrets stored under the old key can no longer be read; keep it stable |
| `CLOUD_STORAGE_ENC_KEY` | people's Google Drive and Dropbox app credentials | credentials stored under the old key can no longer be read; keep it stable |
| `AUDIT_CHAIN_KEY` | the audit hash chain (with `AUDIT_CHAIN=true`); at least 32 characters | cannot change once the chain has been on: the server refuses to start with a different key |
| `INSTANCE_ADMIN_KEY` | lets scripts call `/api/v2/instance/*` with an `adminkey` header | change it and update your scripts |

Good practice:

- Keep `.env` readable only by the user that runs the app (`chmod 600 .env`). In Docker, the `.env` next to `docker-compose.yml` holds them.
- Keep `SECRETS_KEY` and `AUDIT_CHAIN_KEY` out of the database and out of the backups you share; a backup holds everything they protect.
- Unset `INSTANCE_ADMIN_KEY` when no script needs it. Whoever holds it can do anything the instance owner can in the Instance console, including restore.
- If a secret may have leaked (a committed `.env`, a shared screenshot), rotate it and every key next to it, not just the one you noticed.

## Sessions and cookies

- With `NODE_ENV=production` the session cookies are marked `Secure`, so they travel only over HTTPS.
- `SESSION_COOKIE_HTTPONLY=on` makes the session cookies `httpOnly`, so page JavaScript cannot read them; the web app then authenticates by cookie. The desktop tracker and API clients are unaffected.
- Access tokens last `JWT_EXP` (24 hours); an idle session expires after `SESSIONEXPIREDTIME` (172800 seconds, two days). Refresh tokens rotate, and reusing an old one after `REFRESH_TOKEN_REUSE_GRACE_SECONDS` revokes the session.
- Logging out ends the session for real-time connections too.

## Rate limits

| Key | Default | Applies to |
|---|---|---|
| `GLOBAL_RATE_LIMIT_PER_MIN` | `1000` | API requests per minute per client IP; `0` turns it off. Restart. |
| `AUTH_RATE_LIMIT_MAX_ATTEMPTS`, `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_BLOCK_MS` | 5 failures in 15 minutes, then 30 minutes blocked | failed logins per IP |
| `MCP_OAUTH_RATE_LIMIT_PER_MIN` | `30` | `/oauth/authorize` and `/oauth/token` per client address |

Many people behind one office IP can reach the global limit; raise it, or set `TRUST_PROXY` so each client is counted separately.

## Security headers and content security policy

`HELMET_ENABLED` (on by default) sends the standard security headers, including `Strict-Transport-Security`, `X-Content-Type-Options` and `X-Frame-Options`.

The content security policy is a separate switch, `CSP_MODE`:

| Value | Effect |
|---|---|
| `off` (default) | no policy header |
| `report` | `Content-Security-Policy-Report-Only`: nothing is blocked; what would be is counted on **Settings › Instance › Enforcement** |
| `enforce` | `Content-Security-Policy`: the browser blocks it |

The policy is built from your `WEBURL`, `APIURL` and storage address. Run `report` until the Enforcement tab shows nothing unexpected, then `enforce`. To allow another host, add it to the matching `CSP_EXTRA_*` variable (such as `CSP_EXTRA_IMG_SRC=https://cdn.example.com`). Violation reports keep only the day, directive, blocked host and page path shape, for 30 days.

Uploaded files served from the instance itself always carry `nosniff` and a sandboxing policy, and anything that is not an image, PDF, text, audio or video downloads instead of opening. See [File storage](./storage).

## Permission checks

**Permission checks for browser sessions** (`PERMISSION_ENFORCEMENT_MODE`, also on the **Enforcement** tab) controls how the server treats a browser request its permission rules would refuse:

- `off` (default): it passes, as in older releases.
- `report`: it passes, and the would-be denial is recorded. The Enforcement tab lists them per workspace, and says a workspace is ready once its log has been empty for a number of days in a row.
- `enforce`: it is refused.

Each workspace inherits the instance default unless you set its own mode on the Enforcement tab. API tokens are always enforced. `API_TOKEN_STRICT=true` additionally requires an expiry and a scope on every new API token, at most `API_TOKEN_MAX_DAYS` (365).

## Outbound requests

Webhooks and agents fetch URLs that people type, so both refuse internal addresses by default.

**Webhooks** refuse loopback, private, link-local and `.local`/`.internal` hosts. To post to a receiver on your own network, list its exact hostname (`hooks.lan`) or a CIDR range (`192.168.10.0/24`, `fd12:3456::/32`) under **Private webhook hosts** (`WEBHOOK_ALLOWED_PRIVATE_HOSTS`), separated by commas or new lines. It applies on save: a webhook is checked when it is saved and again before every delivery, so removing an entry stops deliveries to that host. Hostnames are resolved and the connection is pinned to the checked address.

These can never be allowed. An entry that is or overlaps one is refused on save, ignored if it comes through the environment, and a listed hostname that resolves to one is still refused:

| Range | Why |
|---|---|
| `169.254.0.0/16` | IPv4 link-local: the cloud metadata service at `169.254.169.254` (AWS, Azure, GCP, Oracle and others), the ECS and EKS credential agents at `169.254.170.2` and `169.254.170.23`, Tencent Cloud at `169.254.0.23` |
| `fe80::/10` | IPv6 link-local; a URL cannot carry a zone id, so no receiver is reachable there |
| `fd00:ec2::/64` | AWS metadata and EKS Pod Identity over IPv6 |
| `100.100.100.200` | Alibaba Cloud metadata (inside `100.64.0.0/10`, so list a narrower range such as `100.64.0.0/11`) |
| `fd20:ce::254` | GCP metadata over IPv6 |
| `fd00:c1::a9fe:a9fe` | Oracle Cloud metadata over IPv6 |

A range must also be `/8` or narrower for IPv4 and `/32` or narrower for IPv6, and may hold `0.0.0.0/8`, `127.0.0.0/8` or `::` only as exactly that block: `127.0.0.0/8` and `127.0.0.1` are accepted, `::/32` is not. Write IPv4 addresses as dotted quads; hex, octal and shorthand spellings such as `0x7f000001` or `127.1` are rejected. The settings page names the rule an entry broke.

**Agents** fetch public hosts and refuse private, metadata and link-local ones. With `AGENT_EGRESS_ALLOWLIST=true` (restart), the **Egress** tab lets you give each workspace a list of hosts its agents may fetch (`docs.example.com`, `*.example.com`, with an optional port); a workspace with a list then fetches only those, checked on every redirect, and each refusal is audited.

## AI safeguards

- **Hold risky AI writes for approval** (`AGENT_TAINT_ROUTING`, on while the AI tools are on): a risky change by an agent that read outside content (a web page, an email, a form, an uploaded file), or by an outside AI app, waits for a person in the AI Inbox. Set `AGENT_TAINT_ROUTING=off` in `.env` and restart to let those changes apply at once.
- **Instruction guard**: built-in patterns flag instruction-like text arriving from outside a workspace; add your own on the **Instruction guard** tab.
- `AI_ENABLED=false` stops every model call. See [AI providers](./ai-providers).

## Audit log

Each workspace has an audit log of sensitive actions (role changes, SSO and SCIM changes, member sync, token changes), visible to its owners and admins under **Settings › Audit Log**, and exportable as CSV per workspace from **Settings › Instance › Stats**.

- **Keep audit log entries (days)** (`AUDIT_RETENTION_DAYS`): older entries are pruned each night.
- `AUDIT_CHAIN=true` with an `AUDIT_CHAIN_KEY` chains every new row with a keyed hash, so someone who can write to the database cannot alter a row unnoticed; the audit log then marks each row verified, broken or unchained.

## Backups are not encrypted

Archives from **Settings › Instance › Backups** are plain `.tar.gz` files holding every database (including password hashes and encrypted secrets) and, if ticked, every uploaded file. Treat them like the database: keep `backups/` on an encrypted volume, and encrypt a copy before it leaves the host, for example:

```bash
gpg --symmetric --cipher-algo AES256 alianhub-14.36.0-20261102-020000.tar.gz
```

See [Backup and restore](./backups).

## Compliance documents

The repository holds a compliance pack for operators who need to show their controls:

- [Compliance overview](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/compliance/README.md): how to use the pack. Running AlianHub does not make a deployment certified.
- [Security whitepaper](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/compliance/security-whitepaper.md): architecture, authentication and authorization, tenancy isolation, auditing, data protection, hardening.
- [Control mapping](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/compliance/control-mapping.md): AlianHub controls mapped to SOC 2, ISO/IEC 27001:2022 Annex A and the HIPAA Security Rule.
- [Shared responsibility](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/compliance/shared-responsibility.md): who owns what, with the operator hardening checklist.
- [Gap register](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/compliance/gaps.md): what is still missing for certification, with status and owner.
- [MCP authorization checklist](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/security/mcp-checklist.md): each rule of the MCP authorization specification, where it is enforced and the test that proves it.

## Reporting a vulnerability

Report suspected vulnerabilities privately through [GitHub Security Advisories](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/security/advisories/new), with a summary, the impact and a proof of concept. Expect a first answer within 72 hours, on a best-effort basis. Fixes go into the latest release; details are published once users have had time to upgrade. There is no bug bounty. The full policy is in [SECURITY.md](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/SECURITY.md).

## Related

- [HTTPS and reverse proxy](./https)
- [Sign-in: OAuth, SSO and SCIM](./sso-oauth)
- [Backup and restore](./backups)
- [Environment variables](./env-reference#security)
