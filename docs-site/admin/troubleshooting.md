# Troubleshooting

What to check when an instance misbehaves, and the fixes for the errors self-hosters meet most. For problems people have while using the app, see the [Help troubleshooting page](/help/troubleshooting).

## Where to look first

1. **Settings › Instance › Health**: the cards say which part is unhappy (database, storage, mail, migrations, automation queue, backups, scheduled jobs). See [Logs and monitoring](./monitoring#the-health-tab).
2. **`curl -s http://localhost:4000/health`** from the host: 200 with `"status":"ok"`, or 503 with the database error, plus `migrationsPending`, `migrationError` and `maintenance`.
3. **Settings › Instance › Logs**, or the files in `log/`: `error-*.log` first.
4. **The process output**: `docker compose logs -f app`, `journalctl -u alianhub -f` or `pm2 logs alianhub`. Boot errors (a bad `.env`, a refused issuer, a key that will not start) appear only here, because the console is not up yet.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| The browser shows the setup page on an instance that has users | the app cannot see the database (setup checks for users) | `curl /health`; fix `MONGODB_URL` or start MongoDB |
| `No database configured. Set MONGODB_URL...` at boot | `.env` missing, or `MONGODB_URL` empty | set it; in Docker check the `environment:` block |
| The setup page says the database is unreachable inside Docker | `MONGODB_URL` includes a database name, or `mongo` is not healthy yet | use `mongodb://mongo:27017`; `docker compose ps` |
| Invitations never arrive | no mail provider, or its test fails | **Settings › Instance › Settings › Mail**, press **Test**; see [Mail](./mail) |
| Uploads fail with `EACCES` | the storage volume is not writable by the `node` user | `chown -R 1000:1000` the volume, or run **Test** under Storage |
| Login over HTTPS loops back to the login page | `WEBURL` still `http://`, or the proxy does not forward `X-Forwarded-Proto` | set `WEBURL`, `TRUST_PROXY=1`, and the proxy headers in [HTTPS](./https) |
| `429 Too Many Requests` for one office | many people behind one IP | raise `GLOBAL_RATE_LIMIT_PER_MIN` or set `TRUST_PROXY` correctly |
| Every API call answers 503 with `maintenance: true` | a restore is running, or maintenance was left on | wait; or **Settings › Instance › Health › Leave maintenance** |
| Secrets show as "not set" after changing `JWT_SECRET` | stored secrets are encrypted with the old key | re-enter them, or put the old `JWT_SECRET` back |
| `JWT_SECRET is required` from `docker compose up` | no `.env` next to `docker-compose.yml`, or it lacks `JWT_SECRET` | `echo "JWT_SECRET=$(openssl rand -hex 32)" > .env` |
| The page loads but is blank on a bare-metal install | `frontend/dist` was never built, or the build failed | `cd frontend && npm ci && NODE_OPTIONS=--max-old-space-size=4096 npm run build` |
| The web app build stops with "JavaScript heap out of memory" | webpack needs about 4 GB of heap | set `NODE_OPTIONS=--max-old-space-size=4096`, or build on a bigger machine and copy `frontend/dist` |

## Database connection

**`querySrv ENOTFOUND`, `querySrv ECONNREFUSED` or `queryTxt ETIMEOUT` with a `mongodb+srv://` address.** The driver looks up SRV and TXT DNS records to find an Atlas cluster, and the host's DNS resolver cannot answer them. Common on some home routers, corporate DNS, older Docker and WSL setups.

- Test from the host: `nslookup -type=SRV _mongodb._tcp.cluster0.example.mongodb.net`.
- Point the host (or the container, with `dns:` in a compose override) at a resolver that answers SRV queries, such as your cloud provider's or `1.1.1.1`.
- Or use the standard connection string Atlas offers (`mongodb://host1:27017,host2:27017,host3:27017/?ssl=true&replicaSet=...`), which needs no SRV lookup.

**Authentication failed.** For a `mongodb://` address the app appends `/<database>?authSource=admin`, so the user must be defined in the `admin` database. `MONGODB_URL` must not carry a database name, a trailing slash or a query string of its own.

**Atlas refuses the connection.** Add the server's public IP to the Atlas network access list.

**Timeouts under load.** Raise `MONGO_POOL_SIZE`, or look at MongoDB's CPU: half a core is not enough once activity grows. The `MONGO_*_TIMEOUT_MS` settings are in [Environment variables](./env-reference#database).

## Real-time updates do not arrive

Changes made by others appear only after a reload, or the browser console shows failing `/socket.io/` requests.

- The proxy must forward WebSocket upgrades: `Upgrade` and `Connection` headers in nginx, nothing extra in Caddy. See [HTTPS and reverse proxy](./https#nginx).
- Without WebSockets Socket.io falls back to long polling; if polling also fails, the proxy is blocking `/socket.io/` entirely.
- A proxy or load balancer idle timeout shorter than the app's keep-alive (65 s, `SERVER_KEEP_ALIVE_TIMEOUT_MS`) drops idle sockets; raise the proxy's timeout.
- Behind several app processes, a load balancer must keep each client on the same process (sticky sessions).

## Cookies and plain HTTP

With `NODE_ENV=production` (the Docker default) session cookies are `Secure`, and browsers drop them over plain `http://`. The login succeeds, then the next request is unauthenticated and you are back on the login page. Serve the instance over HTTPS. For a quick test on a LAN without a certificate, set `NODE_ENV=development`, and never leave it that way on a reachable server.

## CORS errors

The browser console shows "blocked by CORS policy" when the page is opened at an address the API does not know.

- `WEBURL` and `APIURL` must be exactly the address in the browser's address bar (scheme, host and port, no path).
- If the web app and the API are on different origins, or another site calls the API from a browser, add the extra origins to `CORS_ORIGINS`, comma-separated. It applies without a restart.

## Mail not sending

1. **Settings › Instance › Settings › Mail › Test** names the problem.
2. A timeout on ports 587 or 465 usually means the host blocks outbound SMTP (common on cloud providers and shared hosting). Use Amazon SES or Resend, or port 2525 if your provider offers it.
3. Gmail refuses your normal password: create an app password. See [Mail](./mail#gmail-or-google-workspace).
4. Amazon SES in the sandbox delivers only to verified addresses, 200 a day. Request production access.
5. Mail sent but not received: check spam, and publish SPF, DKIM and DMARC for the sending domain.

## Uploads failing

- **`EACCES` with `STORAGE_TYPE=server`**: the directory is not writable by the app's user; `chown -R 1000:1000` the volume in Docker, or give the service user ownership of `storage/` on bare metal.
- **413 Request Entity Too Large**: the proxy's body limit; raise `client_max_body_size` in nginx. The app's own limits are `UPLOAD_MAX_FILE_BYTES` and `UPLOAD_MAX_FILES`.
- **Bucket errors with S3-compatible storage**: press **Test** under Storage. Check the address (empty for Amazon S3), the region, the key's permissions on the bucket, and **Bucket in the path** for MinIO.
- **Disk full**: the Storage card shows free space. Move to a bucket or a bigger volume.
- **Files missing after changing `STORAGE_TYPE`**: changing the driver does not move files; see [File storage](./storage#move-between-the-server-s-disk-and-a-bucket).

## Sign-in providers

- **Google**: "origin mismatch" means `WEBURL` is not listed under **Authorized JavaScript origins**.
- **GitHub or GitLab**: "redirect_uri mismatch" means the callback URL at the provider is not exactly the address people open.
- **No SSO button on the login page**: no workspace has an enabled connection with a verified domain yet, or `SSO_LOGIN_ENABLED=false`.

See [Sign-in: OAuth, SSO and SCIM](./sso-oauth).

## Migrations

- `/health` shows `migrationError` and the Upgrade tab names the failing step. Read the error, fix the cause (often a database permission or disk space), then press **Run pending migrations** or restart.
- `npm run migrate:status` lists what is applied and pending; `npm run migrate -- verify` re-checks what applied ones guarantee. See [Upgrades](./upgrades#migrations).

## The server will not start

Read the process output. The usual causes:

- `MONGODB_URL` unset or unreachable.
- `MCP_OAUTH` set on while `APIURL` (or `MCP_OAUTH_ISSUER`) is not an `https` origin: set `MCP_OAUTH=off` or fix the address.
- `AUDIT_CHAIN` on with a different `AUDIT_CHAIN_KEY` than the one first used: put the previous key back.
- Port 4000 already in use: change `PORT` (or `APP_PORT` in Docker).

## Known issues

The project keeps a list of the serious bugs it knows about, where someone could lose work or see wrong data. At the last check these included: a task with more than 35 subtasks shows only the first 35; restoring a folder from the trash also brings back tasks that were deleted on their own earlier; a deleted chat category cannot be restored; a publicly shared doc does not show its uploaded images; and heavy use from one address can get that address rate-limited for a short while. The current list is [docs/KNOWN-ISSUES.md](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/KNOWN-ISSUES.md).

## Getting help

Search or open an issue on [GitHub](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues) with your version (from **Settings › Instance › Upgrade** or `/health`), how you installed it, and the relevant lines from `error-*.log`, with secrets removed. Report security problems privately; see [Security](./security#reporting-a-vulnerability).

## Related

- [Logs and monitoring](./monitoring)
- [HTTPS and reverse proxy](./https)
- [Help: troubleshooting](/help/troubleshooting)
