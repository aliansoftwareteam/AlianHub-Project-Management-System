# Admin guide

This guide is for the person who installs and runs an AlianHub instance: the server, its database, its files, its mail and its upgrades. If you only use AlianHub, start with the [User guide](/user-guide/) instead.

AlianHub is one Node.js process (the API, the real-time Socket.io server and the built web app) and one MongoDB server. Uploaded files live on the server's disk or in an S3-compatible bucket. Everything else (mail, sign-in providers, AI) is optional and can be set up after the first login.

## What an admin does

| Job | Where |
|---|---|
| Install the server and the database | [Install with Docker](./install-docker) or [Install on a server](./install-manual) |
| Create the owner account and first workspace | [First run](./first-run) |
| Put it behind HTTPS | [HTTPS and reverse proxy](./https) |
| Set mail, storage, sign-in, AI and security options | [The Instance console](./instance-console), [Environment variables](./env-reference) |
| Let members connect their own apps for AI | [Connectors setup](./connectors) |
| Take and test backups | [Backup and restore](./backups) |
| Upgrade to new releases | [Upgrades](./upgrades) |
| Watch health and logs, fix problems | [Logs and monitoring](./monitoring), [Troubleshooting](./troubleshooting) |

Inviting people, roles and workspace settings are done by a workspace owner or admin from **Settings › Members** and the other workspace settings; see [People and roles](/user-guide/people-and-roles).

## Two ways to install

| | Docker (recommended) | On a server (Node 20 + MongoDB) |
|---|---|---|
| What you install | Docker with Compose | Node.js 20, MongoDB 6 or 7, a process manager |
| Commands to a running app | three | `npm run setup`, then `npm start` under pm2 or systemd |
| Database | MongoDB 7 in a container, on a private network | your own MongoDB, local or hosted |
| Upgrades | `docker compose pull && docker compose up -d` | `git pull`, install, rebuild the web app, restart |
| Good for | most installs | hosts without Docker, shared hosting with cPanel, development |

Both run the same code and read the same [environment variables](./env-reference).

## The Instance console

The account that ran setup is the **instance owner**. Only that account sees **Settings › Instance**, the console for the whole server:

- **Health**: database, storage, mail, migrations, automation queue, backups and scheduled jobs, plus a readiness card listing what is still missing for production.
- **Settings**: General, Mail, Storage, AI, Sign-in, Calling and Security, each with a **Test** button where there is something to test.
- **Backups**, **Upgrade** and **Logs**.
- **Enforcement**, **Egress**, **Instruction guard**, **Knowledge**, **AI providers** and **Stats** for the security and AI controls.

A value set in the environment always wins over the console and shows as locked. See [The Instance console](./instance-console).

## Production checklist

Work through this before you invite your team. The readiness card on **Settings › Instance › Health** tracks the first five.

1. **HTTPS.** A reverse proxy with a certificate in front of port 4000, `WEBURL` and `APIURL` set to the `https://` address, `TRUST_PROXY` set, WebSocket upgrades forwarded. See [HTTPS and reverse proxy](./https).
2. **Mail.** Amazon SES, Resend or SMTP, tested with the **Test** button. Without it, invitations and password resets cannot be sent. See [Mail](./mail).
3. **Storage.** Decide between the server's disk and an S3-compatible bucket before people upload much; switching later means copying files. See [File storage](./storage).
4. **Backups.** Take one from **Settings › Instance › Backups**, copy it off the host, and restore it once on a throwaway copy. Schedule them with `INSTANCE_ADMIN_KEY` and cron. See [Backup and restore](./backups).
5. **Migrations up to date.** They run on their own at boot; the Upgrade page shows any that failed. See [Upgrades](./upgrades).
6. **Secrets.** A long random `JWT_SECRET` (`openssl rand -hex 32`) that you keep stable, `.env` readable only by the service user, no real values in version control. If you started from `.env.example`, clear `SOCKETIO_ADMIN_USERNAME` and `SOCKETIO_ADMIN_PASSWORD_HASH` or set your own. See [Security](./security).
7. **Database.** MongoDB on a private network only, with authentication when it is not on the same host or Docker network, and on an encrypted volume.
8. **Monitoring.** Point your uptime checker at `/health`. See [Logs and monitoring](./monitoring).

::: info AlianHub Cloud
On an instance hosted by AlianHub Cloud, the platform runs the server for you. The console there hides Backups, Upgrade and Logs, and shows the URL, mail, storage and security settings as managed. Most of this guide is about self-hosted instances.
:::

## Related

- [Requirements](./requirements)
- [Install with Docker](./install-docker)
- [Environment variables](./env-reference)
- [Troubleshooting](./troubleshooting)
