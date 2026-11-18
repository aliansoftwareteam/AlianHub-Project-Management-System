# Upgrades

How to move an instance to a newer AlianHub release, and what happens to the database when you do. Take a backup first, every time.

## Before you upgrade

1. Open **Settings › Instance › Upgrade**. It shows the running version, the latest GitHub release, the changelog entries newer than what you run (the lines that concern self-hosters are highlighted) and the migration state.
2. Read those changelog entries, especially anything marked as a breaking change.
3. Take a backup from **Settings › Instance › Backups** (the Upgrade page links to it) and copy it off the host. See [Backup and restore](./backups).
4. For a big jump, try the upgrade on a copy first: restore the backup into a second instance and upgrade that.

## Docker

```bash
docker compose pull && docker compose up -d
```

`pull` fetches the image named by `ALIANHUB_VERSION` (default `latest`); `up -d` recreates the app container on it. Data lives in the volumes and is kept. Migrations run when the new container starts; follow them with `docker compose logs -f app` or on the Upgrade page.

To move to a specific release, set `ALIANHUB_VERSION=14.36.0` (or `14.36`, or `14`) in `.env` before pulling. To go back after a failed upgrade, set the previous version, `docker compose up -d`, and restore the backup you took before: a newer release may already have migrated the data.

If you build from source instead: `git pull && docker compose build && docker compose up -d`.

### Installs from before project-named containers

Earlier `docker-compose.yml` files fixed the names: containers `alianhub` and `alianhub-mongo`, volumes `alianhub_mongo_data`, `alianhub_storage`, `alianhub_logs` and `alianhub_backups`, network `alianhub`. If you replace that file with the current one, the new file names everything after the project, and the install would start on new, empty volumes. To keep the data where it is, download `docker-compose.legacy.yml` next to `docker-compose.yml` and add one line to `.env` before `docker compose up -d`:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.legacy.yml
# on Windows: COMPOSE_FILE=docker-compose.yml;docker-compose.legacy.yml
```

It restores the old names. `ALIANHUB_APP_CONTAINER`, `ALIANHUB_MONGO_CONTAINER` and `ALIANHUB_COTURN_CONTAINER` still rename the containers under it. Running `docker compose pull && docker compose up -d` with the file you already have needs nothing.

## On a server (Node + MongoDB)

```bash
cd /opt/alianhub
git pull
npm ci
cd frontend && npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build && cd ..
pm2 restart alianhub          # or: sudo systemctl restart alianhub, or npm start
```

Rebuild the web app on every upgrade; the server serves whatever is in `frontend/dist`. To upgrade to a tagged release rather than the tip of `main`, use `git fetch --tags && git checkout v14.36.0` instead of `git pull`.

On cPanel, upload the new code and `frontend/dist`, press **Run NPM Install**, then **Restart**.

## Migrations

Migrations are one file each in `migrations/NNN-name.js`. They run automatically at boot, before the server starts listening, and each run is recorded in `global.schema_versions` with its duration and, for steps that run per workspace, the outcome per workspace.

A failed migration does not stop the server:

- `/health` reports `migrationError`;
- the Upgrade page shows which step failed and why;
- the next boot, or **Run pending migrations** on the Upgrade page, retries it.

Set `MIGRATIONS_AUTO=false` to run them by hand instead; the server then only reports what is pending.

```bash
npm run migrate:status            # what is applied and what is pending
npm run migrate -- up --dry-run   # what the pending ones would write, without writing it
npm run migrate                   # apply what is pending
npm run migrate -- verify         # re-check what the applied ones guarantee, read-only
```

In Docker, prefix them with `docker compose exec app`, for example `docker compose exec app npm run migrate:status`.

**`up --dry-run`** runs each pending migration's own code with every database write refused at the driver and recorded instead, then prints, per migration, each collection it would write, the operation, how many calls in how many databases, how many documents match, and the field names of the filter and update. Values and documents are never printed. Nothing is marked applied and no lock is taken. A migration that reads back what it (or an earlier pending one) would have written is listed as **cannot dry-run** with the collection it reads, because its plan would describe the old data. It exits 1 only when a migration throws under the dry run.

**`verify`** runs the optional check of every applied migration with writes refused and prints `pass`, `fail` (with the problems, by record id and count) or `no check`. It exits 1 when any check fails.

## Upgrade note: company access needs an active seat

A request that names a workspace is accepted only while the account holds an active seat in that workspace's member list. Being listed on the account (`users.AssignCompany`) is no longer enough. Installs that created members before seats existed, or that removed members without taking the workspace off the account, can have accounts listed on a workspace with no active seat. Those accounts lose access to that workspace after the upgrade.

List them before upgrading. The check is read-only and creates no seats:

```bash
node scripts/seat-check.js
```

It prints each workspace, account and seat state (`none`, `invited`, `removed`) and exits 1 when it lists anyone. If someone listed should still be a member, an owner or admin invites them again from **Settings › Members**.

## Upgrade note: AI app connections

Releases that turned on "connect your AI app" by default keep it off on installs that existed before: the upgrade records off for `MCP_OAUTH`, `MCP_TOOLS_DATA`, `MCP_TOOLS_MANAGE` and `MCP_TOOLS_WORK` unless `.env` names them. Turn them on under **Settings › Instance › Settings › AI**. See [AI providers](./ai-providers).

## Upgrade note: connectors

Releases with connectors move members' Google Calendar connections onto the Google connector, remove the per-person Google Drive and Dropbox settings, retire the Slack workspace bot, and move **App connections** into the **GitHub** section of **Integrations**. `CONNECTORS=google_calendar` no longer switches anything on: name `google`. After the upgrade, uninstall the old Slack bot app in Slack. See [Connectors setup](./connectors#upgrading-from-the-older-paths).

## Version numbers

AlianHub follows semantic versioning. Releases are cut from `main` by release-please and tagged `vMAJOR.MINOR.PATCH`; the changelog lists every change. A new major version (`15.0.0`) can need action from you; minor and patch releases should not.

| Where | What you see |
|---|---|
| **Settings › Instance › Upgrade** and `/health` | the running version |
| GitHub releases | the release notes, the image digest and how to verify its signature |
| Docker tags | `14.36.0`, `14.36`, `14` and `latest` (stable releases only) |
| A build from a branch | a pre-release version such as `14.36.0-beta.766`: the next release plus a build number |

Security fixes go into the latest release, so stay current. See [Security](./security).

## Related

- [Backup and restore](./backups)
- [Install with Docker](./install-docker)
- [Troubleshooting](./troubleshooting)
