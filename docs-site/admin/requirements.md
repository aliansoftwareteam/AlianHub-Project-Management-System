# Requirements

What a host needs to run AlianHub, and how big it should be. The numbers below come from the Docker image, `package.json` and load tests of the hosted plans.

## Software

| Piece | Version | Notes |
|---|---|---|
| Node.js | 20.x | `package.json` pins `"engines": { "node": "20.x" }`. The Docker image uses Node 20 on Alpine. Not needed on the host when you use Docker. |
| MongoDB | 6 or 7 | The compose file runs `mongo:7`. Any MongoDB you can reach with a connection string works, including a replica set or MongoDB Atlas (`mongodb+srv://`). |
| Docker (optional) | Docker Engine with the Compose plugin (`docker compose`) | The compose file uses `env_file` with `required: false`, which needs a recent Compose v2. |
| A reverse proxy (production) | Caddy, nginx, Traefik or any proxy that forwards WebSockets | Terminates HTTPS. See [HTTPS and reverse proxy](./https). |

The Docker image is published for `linux/amd64` and `linux/arm64` at `ghcr.io/aliansoftwareteam/alianhub`.

## Memory and CPU

AlianHub keeps one database per workspace under one MongoDB server, so MongoDB is usually the larger of the two processes.

| Process | Memory | CPU |
|---|---|---|
| AlianHub (Node) | up to about 350 MB while busy | 1 core is enough for a small team; 2 for a busy instance |
| MongoDB | its WiredTiger cache cap plus about 0.25 GB | at least 1 core; half a core is too little once activity logs grow |

MongoDB's cache, left alone, grows to half of (RAM − 1 GB). On a host shared with other services, cap it so the total stays predictable:

```yaml
# docker-compose.override.yml
services:
  mongo:
    command: ["--wiredTigerCacheSizeGB", "0.5"]
```

On a bare-metal MongoDB set `storage.wiredTiger.engineConfig.cacheSizeGB` in `mongod.conf` instead.

Sizing as a starting point:

| Team | RAM for the host | MongoDB cache cap | CPU |
|---|---|---|---|
| Trying it out, a few people | 2 GB | 0.25 GB | 1–2 cores |
| A team of up to about 50 | 4 GB | 0.5–1 GB | 2 cores |
| Several busy workspaces | 8 GB or more | 1.5 GB or more | 4 cores |

Building the web app from source (`npm run build` in `frontend/`) is the heaviest step: webpack needs a heap of about 4 GB (`NODE_OPTIONS=--max-old-space-size=4096`, as the Dockerfile sets). Build on a machine with 6 GB of RAM or more, or use the Docker image, which ships the built app.

## Disk

- The application itself: under 1 GB with its dependencies.
- MongoDB: grows with tasks, comments and activity. Leave room for at least twice the current data size so backups and compaction fit.
- Uploaded files when `STORAGE_TYPE=server`: as much as your team uploads, under `storage/` (a volume in Docker). With an S3-compatible bucket they do not touch the host.
- Logs: rotated daily at 20 MB per file and kept 14 days by default (`LOG_MAX_SIZE`, `LOG_MAX_FILES`).
- Backups: each archive holds every database, plus the uploaded files when you tick **Include uploaded files**.

## Network and ports

| Port | Direction | Purpose |
|---|---|---|
| 4000/tcp | in, from the proxy | The app: HTTP API, web app and Socket.io. `PORT` changes it; in Docker, `APP_PORT` changes the published host port. |
| 80 and 443/tcp | in, from users | Your reverse proxy. |
| 27017/tcp | app → MongoDB only | Never expose MongoDB to the internet. The compose file keeps it on the private network. |
| 3478 and 49160–49200 (udp/tcp) | in, optional | The coturn relay for audio and video calls, when you enable the `calling` profile. |
| Outbound 443 | app → providers | Mail APIs (SES, Resend), S3 storage, AI providers, OAuth providers, GitHub (the Upgrade page reads the latest release). |
| Outbound 587 or 465 | app → SMTP | Only when you send mail over SMTP. Some cloud hosts block these ports. |

## Browsers

The web app is built for the last two versions of current browsers (`> 1%, last 2 versions, not dead, not ie 11`): Chrome, Edge, Firefox and Safari on desktop and mobile. Internet Explorer is not supported. Audio and video calls, push notifications and the clipboard need a secure context, so they work over HTTPS (or `localhost`) only.

## Related

- [Install with Docker](./install-docker)
- [Install on a server](./install-manual)
- [Logs and monitoring](./monitoring)
