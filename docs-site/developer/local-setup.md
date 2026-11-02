# Local setup

Run AlianHub on your own machine for development: the API with reload on port 4000, and the web app's dev server on port 8080. This page covers what you need, the two ways to start, and the scripts you will use most.

## What you need

- **Node 20** (`"engines": { "node": "20.x" }` in `package.json`).
- **A MongoDB you can reach.** A local `mongod` on port 27017 is fine. The e2e suite runs its own on 27018 (see [Testing](./testing)).
- **Git**, and Docker only if you run the browser tests or the Docker install.

## Quick start

```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm run setup
```

`npm run setup` (`scripts/dev.js`) installs the dependencies of the root and `frontend/`, prepares `.env` from `.env.example`, and starts the server. On a fresh database the app opens its setup page (`/#/setup`), where you create your own company and owner account; nothing is created for you.

| Command | What it does |
|---|---|
| `npm run setup` | Install, prepare `.env`, start |
| `npm run dev` | Start without reinstalling (`--skip-install`) |
| `npm run setup:reset` | Wipe `node_modules` and reinstall (`--force`) |
| `npm run setup -- --no-open` | Do not open a browser |

## Step by step

```bash
npm ci && (cd frontend && npm ci)
cp .env.example .env            # MONGODB_URL, JWT_SECRET, APIURL, STORAGE_TYPE at least
npm run nodemon                 # API on :4000 with reload
cd frontend && npm run serve    # SPA on :8080, proxies /api to :4000
```

The least `.env` needs:

```ini
PORT=4000
MONGODB_URL="mongodb://localhost:27017"
JWT_SECRET="your-random-secret-string"
APIURL="http://localhost:4000/"
STORAGE_TYPE="server"
```

Every variable is described in `.env.example` and in [Environment variables](/admin/env-reference). Use a long random `JWT_SECRET`, and never commit `.env`.

- `npm run nodemon` restarts the server when a file under `Config/`, `Modules/`, `common-storage/`, `event/`, `middlewares/`, `socket/` or `utils/` changes (`nodemon.json`). Tests are ignored.
- The frontend dev server reloads the page as you edit `frontend/src`.
- The backend also serves the built app from `frontend/dist`. Run `cd frontend && npm run build` (2 to 3 minutes) to try it on port 4000 alone.
- A fresh database lands on the in-app first run. See [First run](/admin/first-run).

## Useful scripts

| Command | What it does |
|---|---|
| `npm run nodemon` | API with reload (`index.js`) |
| `npm start` | API without reload (`server.js`, for pm2 and production) |
| `npm run migrate` / `npm run migrate:status` | Apply pending migrations / list them. Migrations also run at boot |
| `npm run lint` | ESLint over the backend |
| `npm test` | Unit and conventions tests |
| `npm run version:show` | Print the running version |
| `npm run demo:seed` / `npm run demo:unseed` | Add or remove a demo team |
| `npm run demo:token` | Print a short-lived session token for a demo account (used by the screenshot atlas) |
| `npm run atlas` | Screenshot every screen into `artifacts/atlas/` |

## Good to know

- `CRON_ENABLED=false` keeps the scheduled jobs in `cron.js` from running, and `AUTOMATION_ENGINE=false` turns the automation queue off: useful when you point a second local server at the same database.
- Every request carries the company in the `companyid` header. If a call answers "A valid companyid header is required.", it was made without one.
- Each response carries `X-Request-Id`, and every log line written while handling it starts with the id, so searching the log for it reconstructs a failure.

## Related

- [Testing](./testing)
- [Architecture](./architecture)
- [Install on a server (Node + MongoDB)](/admin/install-manual)
- [Troubleshooting](/admin/troubleshooting)
