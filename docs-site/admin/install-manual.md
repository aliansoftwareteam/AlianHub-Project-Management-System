# Install on a server (Node + MongoDB)

Run AlianHub straight on a Linux, macOS or Windows host without Docker: Node.js 20 runs the app, MongoDB holds the data, and a process manager keeps it running. Use this when Docker is not an option, on shared hosting with cPanel, or to work on the code.

## Prerequisites

- Node.js 20 (`node -v` prints `v20.x`) and npm.
- MongoDB 6 or 7 reachable from the host, local or hosted (Atlas works with `mongodb+srv://`).
- Git, or a copy of the source.
- About 6 GB of free memory for the one-time web app build (webpack). See [Requirements](./requirements).

## Quick install

```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm run setup
```

`npm run setup` (`scripts/dev.js`):

1. installs the dependencies of the server and of `frontend/`;
2. builds the web app once into `frontend/dist` (2–3 minutes), unless a build is already there;
3. writes `.env` from `.env.example` with a random `JWT_SECRET`, `MONGODB_URL="mongodb://localhost:27017"` and `STORAGE_TYPE="server"` (an existing `.env` is kept; missing keys are added);
4. starts the server with `npm start` and opens `http://localhost:4000/#/setup`.

Continue with [First run](./first-run). Stop it with Ctrl+C. Options: `npm run setup -- --no-open` (no browser), `npm run setup -- --force` (wipe `node_modules` and reinstall), `npm run dev` (start without reinstalling).

## Prepare .env for production

`.env` lives in the app folder, next to `package.json`. Before running it for real, edit at least:

```bash
NODE_ENV="production"
PORT=4000
MONGODB_URL="mongodb://alianhub:<password>@db.internal.example.com:27017"
JWT_SECRET="<output of: openssl rand -hex 32>"
WEBURL="https://pm.example.com"
APIURL="https://pm.example.com/"
STORAGE_TYPE="server"
TRUST_PROXY=1
```

- `MONGODB_URL` is the server address only, with no database name and no trailing slash. The app appends `/<database>?authSource=admin` itself (for `mongodb+srv://` it appends only the database name).
- `NODE_ENV=production` marks session cookies `Secure`, so the instance must be served over HTTPS; see [HTTPS and reverse proxy](./https).
- `.env.example` sets `SOCKETIO_ADMIN_USERNAME` and `SOCKETIO_ADMIN_PASSWORD_HASH` to sample values, which turns on the Socket.IO admin namespace. Clear both lines unless you use it.

Every variable is listed in [Environment variables](./env-reference).

## Install step by step

When you want each step under your control, for example on a server where the setup script should not start anything:

```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm ci --omit=dev
cp .env.example .env            # then edit it as above
cd frontend
npm ci
NODE_OPTIONS=--max-old-space-size=4096 npm run build
cd ..
npm start
```

The server serves the built app from `frontend/dist`; without a build the API runs but the browser shows nothing. The web app reads `frontend/.env` (`VUE_APP_*`) at build time only, so after changing one of those values, build again.

`npm start` runs `node server.js`, which loads `index.js`. Migrations run before the server starts listening; see [Upgrades](./upgrades).

## Keep it running

`npm start` stays in the foreground and does not restart itself after a crash. Run it under a process manager.

### pm2

```bash
npm install -g pm2
cd /opt/alianhub
pm2 start server.js --name alianhub --time --max-memory-restart 1G
pm2 save
pm2 startup        # prints the command that starts pm2 at boot
```

Run a single instance (no cluster mode): scheduled jobs and Socket.io assume one process per server. If you add replicas behind a load balancer, set `CRON_ENABLED=false` on all but one.

### systemd

```ini
# /etc/systemd/system/alianhub.service
[Unit]
Description=AlianHub
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=alianhub
WorkingDirectory=/opt/alianhub
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now alianhub
journalctl -u alianhub -f
```

The app reads `.env` from its working directory, so `WorkingDirectory` must be the app folder. The service user needs write access to `storage/`, `log/`, `backups/`, `wasabiUploads/`, `thumbnails/` and `wasabiUploadsLocal/exports/` inside it.

## Shared hosting with cPanel

Hosts that offer **Setup Node.js App** in cPanel (CloudLinux with Phusion Passenger) can run AlianHub. You need a MongoDB elsewhere, since shared hosting rarely offers one: MongoDB Atlas or a database server you run.

1. **Build the web app on your own computer.** Shared hosting usually lacks the memory for webpack. In a clone of the repository run `cd frontend && npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
2. **Create the application.** In cPanel open **Setup Node.js App** › **Create Application** and fill in:

   | Field | Value |
   |---|---|
   | Node.js version | 20.x |
   | Application mode | Production |
   | Application root | a folder in your home directory, such as `alianhub` |
   | Application URL | the domain or subdomain it should answer on |
   | Application startup file | `index.js` |

   Then **Create**. cPanel creates the folder and a virtual environment.
3. **Upload the code** into the application root with **File Manager** or Git: everything from the repository except `node_modules` and the `frontend/` sources, plus the `frontend/dist` folder you built in step 1. Keep `package.json` and `package-lock.json` at the root of the application folder.
4. **Install dependencies.** Back in **Setup Node.js App**, open the application, press **Run NPM Install**, and wait for it to finish.
5. **Set the environment variables** with **Add Variable** on the same page (or upload a `.env` into the application root): `NODE_ENV=production`, `MONGODB_URL`, `JWT_SECRET`, `WEBURL`, `APIURL` (your domain, with a trailing slash), `STORAGE_TYPE=server` and `TRUST_PROXY=1`. Leave `PORT` unset: Passenger hands the app its port.
6. **Start the app** with **Start App** (or **Restart** after a change) and open your domain. A fresh database shows the setup page; continue with [First run](./first-run).

Things to know on shared hosting:

- `index.js` is the file that starts the HTTP server; `server.js` only loads it. Either works as the startup file.
- Passenger may stop an idle app; the first request after a pause is slow while it starts and runs its boot checks.
- Real-time updates need WebSockets. If the host's proxy does not pass them, Socket.io falls back to long polling and updates arrive a little later.
- Many shared hosts block outbound SMTP. Use Amazon SES or Resend for [Mail](./mail).
- To upgrade, upload the new code and a new `frontend/dist`, press **Run NPM Install**, then **Restart**.

## Related

- [First run](./first-run)
- [HTTPS and reverse proxy](./https)
- [Environment variables](./env-reference)
- [Upgrades](./upgrades)
