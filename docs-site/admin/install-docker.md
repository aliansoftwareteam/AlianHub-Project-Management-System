# Install with Docker

The recommended way to run AlianHub: the published image plus MongoDB 7, started by one `docker compose` command. The image already contains the built web app, so there is nothing to compile.

## Install

On any host with Docker and the Compose plugin:

```bash
mkdir alianhub && cd alianhub
curl -O https://raw.githubusercontent.com/aliansoftwareteam/AlianHub-Project-Management-System/main/docker-compose.yml
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Open `http://<host>:4000`. A fresh database sends you to the setup page; see [First run](./first-run).

`JWT_SECRET` is the only value you must provide; Compose refuses to start without it. It signs sessions and encrypts the secrets the Instance console stores, so keep it stable once set.

## What the compose file gives you

| Piece | Purpose |
|---|---|
| `app` | AlianHub: `ghcr.io/aliansoftwareteam/alianhub:${ALIANHUB_VERSION:-latest}` (Node 20, the built web app served by the API) |
| `mongo` | MongoDB 7, on the project network only (not published on the host) |
| `coturn` | Optional TURN relay for calls, only with `--profile calling` |
| volume `<project>_alianhub_mongo_data` | the databases (`/data/db`) |
| volume `<project>_alianhub_storage` | uploaded files when `STORAGE_TYPE=server`, the image default (`/app/storage`) |
| volume `<project>_alianhub_logs` | rotating logs, readable from **Settings › Instance › Logs** (`/app/log`) |
| volume `<project>_alianhub_backups` | archives written by **Settings › Instance › Backups** (`/app/backups`) |
| network `<project>_alianhub` | the private bridge network the two containers share |

`<project>` is the Compose project name: the folder that holds `docker-compose.yml`, or the name given with `-p` (or `COMPOSE_PROJECT_NAME` in `.env`). Containers carry it too (`<project>-app-1`, `<project>-mongo-1`).

The `app` service sets these itself:

| Variable | Value | Change it with |
|---|---|---|
| `MONGODB_URL` | `mongodb://mongo:27017` | edit the compose file (see below) |
| `JWT_SECRET` | from `.env` | `.env` |
| `APIURL` | `http://localhost:4000/` | `APIURL` in `.env` |
| `WEBURL` | `http://localhost:4000` | `WEBURL` in `.env` |
| `STORAGE_TYPE` | `server` | `STORAGE_TYPE` in `.env` |
| `PORT` | `4000` inside the container | `APP_PORT` in `.env` for the host port |

`MONGODB_URL` must be the server address only, never with a database name: the app creates one database per workspace under it (a `global` database plus one named after each workspace id).

Any other variable in the `.env` next to `docker-compose.yml` reaches the app too (the `env_file` entry), so mail, OAuth and AI keys can go there. Most of them can also be set later from **Settings › Instance › Settings**; a value in `.env` wins and shows as locked there. The image itself has no `.env` file.

## Settings worth putting in .env

```bash
JWT_SECRET=<64 hex characters from openssl rand -hex 32>
WEBURL=https://pm.example.com
APIURL=https://pm.example.com/
TRUST_PROXY=1
# APP_PORT=4000
# ALIANHUB_VERSION=14.36.0
```

`WEBURL` and `APIURL` must match the address people open, or emails, OAuth callbacks and CORS break. See [HTTPS and reverse proxy](./https).

## Health check

The image declares a Docker `HEALTHCHECK` that calls `http://localhost:4000/health` every 30 seconds (5-second timeout, 40-second start period, 3 retries). `/health` answers 200 only when the database answers, so the container becomes **healthy** once MongoDB is up. The `mongo` service has its own check (`mongosh ... ping`), and `app` waits for it (`depends_on: condition: service_healthy`).

```bash
docker compose ps
curl -s http://localhost:4000/health
```

## Pin a version

`ALIANHUB_VERSION` picks the image tag. `latest` follows stable releases. Each release is also tagged `14.36.0`, `14.36` and `14`, so `ALIANHUB_VERSION=14` takes minor and patch releases but never a new major. Pin an exact version when you want upgrades to happen only when you change it. See [Upgrades](./upgrades).

Release images are signed with cosign (keyless). The release notes on GitHub carry the exact `cosign verify` command and the image digest.

## Use your own MongoDB

To use MongoDB Atlas or a database server elsewhere, override `MONGODB_URL` and drop the bundled `mongo` service from the dependency, for example in a `docker-compose.override.yml`:

```yaml
services:
  app:
    environment:
      MONGODB_URL: mongodb+srv://alianhub:<password>@cluster0.example.mongodb.net
    depends_on: !reset {}
```

Then start only the app: `docker compose up -d app`. The connection string still names no database.

## Build the image from source

From a clone of the repository:

```bash
docker compose build
docker compose up -d
```

The build compiles the web app inside the image (it needs about 4 GB of memory for webpack) and installs production dependencies only.

## A second copy on the same host

Staging next to production, or a restore drill, needs only its own folder with its own `.env`, a project name and a free port:

```bash
mkdir ../alianhub-staging && cd ../alianhub-staging
cp ../alianhub/docker-compose.yml .
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
APP_PORT=4001 docker compose -p staging up -d
```

It gets its own containers, volumes and network (`staging-app-1`, `staging_alianhub_mongo_data`, ...), so it cannot touch the first copy's data. Never load `docker-compose.legacy.yml` in a second copy: that file fixes the volume names, so the copy would attach to the live data.

## Calling relay (optional)

Calls are peer-to-peer and most connect without help. Behind symmetric NAT or strict firewalls (roughly 15–20% of real connections) they need a TURN relay. The compose file ships coturn under a profile:

1. Add to `.env`:

   ```bash
   TURN_PUBLIC_IP=<the host's public IP>
   TURN_STATIC_AUTH_SECRET=<a long random secret>
   TURN_URLS=turn:turn.example.com:3478
   ```

2. Open 3478 and 49160–49200 (UDP and TCP) on the host firewall.
3. Start it: `docker compose --profile calling up -d`.

coturn uses host networking so it can advertise an address reachable from outside. `TURN_URLS` and `TURN_STATIC_AUTH_SECRET` can also be set under **Settings › Instance › Settings › Calling**.

## Useful commands

| Task | Command |
|---|---|
| Follow the app's output | `docker compose logs -f app` |
| Shell in the app container | `docker compose exec app sh` |
| Migration status | `docker compose exec app npm run migrate:status` |
| Restart after changing `.env` | `docker compose up -d` |
| Stop (data stays in the volumes) | `docker compose down` |

`docker compose down -v` deletes the volumes and with them every database, file, log and backup. Do not run it on an instance you want to keep.

## Related

- [First run](./first-run)
- [HTTPS and reverse proxy](./https)
- [Upgrades](./upgrades)
- [Backup and restore](./backups)
