# Logs and monitoring

How to see whether an instance is healthy, where its logs are, and how to feed them to your own monitoring. Start with **Settings › Instance › Health**; use `/health`, the log files and OpenTelemetry tracing from outside.

## The Health tab

**Settings › Instance › Health** shows a card per part of the system:

| Card | Green | Amber or red |
|---|---|---|
| **Database** | answers within a few ms (latency shown) | unreachable: the app cannot work; check `MONGODB_URL` and that MongoDB runs |
| **Storage** | directory writable (free space shown) or bucket reachable | uploads will fail; check the volume or the bucket credentials |
| **Mail** | a provider is set (**Test mail** tries it) | invitations and resets cannot be sent |
| **Migrations** | none pending, no error | pending: open Upgrade; error: read it, fix the cause, run again |
| **Automation queue** | 0 failed | failed jobs are automation runs that gave up; the Automations page lists them |
| **Backups** | one exists | take one |
| **Scheduled jobs** | every job's last run OK | a red job names the error; with `CRON_ENABLED=false` nothing runs |

The **readiness card** at the top lists what is still missing for a production instance: mail configured, storage chosen, a first backup taken, a public URL on HTTPS, migrations up to date, each with a button to fix it.

The same tab holds **Enter maintenance** and **Leave maintenance**.

## /health

```bash
curl -s http://localhost:4000/health
```

| Answer | When |
|---|---|
| `200 {"status":"ok", ...}` | the database answered |
| `503 {"status":"degraded", ...}` | the database did not answer within `HEALTH_DB_TIMEOUT_MS` (3000 ms) |

The body also carries `version`, `db` (`ok`, `latencyMs`, `error`), `migrationsPending`, `migrationError`, `maintenance` and `uptimeSeconds`. Only a dead database makes it fail: a pending migration or maintenance mode is a warning, because restarting would not fix it. That makes `/health` the right target for:

- the Docker `HEALTHCHECK` (built into the image),
- your load balancer's health check,
- an uptime monitor (alert on anything but 200, and on `migrationError` not being null).

`/health` needs no authentication and is answered even in maintenance mode.

## Logs

The server writes rotating log files with Winston to `LOG_DIR` (`log/` in the app folder; the `alianhub_logs` volume, `/app/log`, in Docker):

| File | Holds |
|---|---|
| `error-YYYY-MM-DD.log` | errors |
| `combined-YYYY-MM-DD.log` | everything |
| `track-YYYY-MM-DD.log` | warnings |

**Settings › Instance › Logs** tails each of them and lets you download a file. Files rotate daily and at `LOG_MAX_SIZE` (20 MB), and are kept for `LOG_MAX_FILES` (14 days).

| Key | Default | Meaning |
|---|---|---|
| `LOG_DIR` | `log` | where the files go |
| `LOG_FORMAT` | `text` | `json` writes one `{ ts, level, label, requestId, traceId, message }` record per line, for log shippers |
| `LOG_MAX_SIZE` | `20m` | size at which a file rotates |
| `LOG_MAX_FILES` | `14d` | how long rotated files are kept |
| `LOG_DATE_PATTERN` | `YYYY-MM-DD` | date in the file name |

The process also writes to standard output: `docker compose logs -f app`, `journalctl -u alianhub -f` or `pm2 logs alianhub`. To keep logs longer or search them, set `LOG_FORMAT=json` and ship `log/` to your log system (Loki, Elasticsearch, a SIEM).

The workspace audit log (who changed roles, SSO, tokens and so on) is separate: see [Security](./security#audit-log).

## Tracing with OpenTelemetry

Set an OTLP/HTTP collector address to export traces of HTTP requests, Express routes and MongoDB calls:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=alianhub
```

Traces go to `<endpoint>/v1/traces`. Unset, the OpenTelemetry SDK stays off, but every log line still carries a trace id, so you can match a log record to a request. Restart after changing either key.

## Scheduled jobs

Reminders, recurring tasks, digests, retention and the other scheduled jobs run inside the app process, in the time zone `CRON_TZ` (UTC by default). The **Scheduled jobs** card shows each job's last run. If you run more than one app process against the same database, set `CRON_ENABLED=false` on all but one so jobs do not run twice.

## Resource use

What to expect, from load tests of the hosted plans:

- The app uses up to about 350 MB of memory while busy.
- MongoDB uses its cache cap plus about 0.25 GB; uncapped on a large host it grew past 1.5 GB. Cap it with `--wiredTigerCacheSizeGB` (see [Requirements](./requirements)).
- MongoDB with half a CPU core struggles once the activity log grows; give it at least one core.

The project's speed budgets (from `docs/PERFORMANCE.md`), measured on a project with 10,000 tasks on a warm server:

| What | Budget | Measured (2026-10-01) |
|---|---|---|
| Task-query API, first page | under 300 ms | 7 ms for one group, 15 ms for a whole list |
| Board: first cards visible | under 1.5 s | 1.37 s |
| List: first rows visible | under 1.5 s | 2.27 s (over budget, from a fixed one-second wait in the List view) |
| Status change, opening the task panel | under 150 ms | 52 ms, 71 ms |
| Scrolling | 50 frames per second | 60 |

Filters and searches return the whole project in one answer (a filter matching 2,400 tasks returned 3.1 MB in 112 ms), so they are what grows with very large projects. The first page load is about 2.3 MB uncompressed, 0.74 MB gzipped; serve it with compression at your proxy. The full method and numbers are in [docs/PERFORMANCE.md](https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/blob/main/docs/PERFORMANCE.md).

## Instance numbers

**Settings › Instance › Stats** shows instance-wide numbers and the list of workspaces, with an audit CSV export per workspace. Scripts can read the same data from `GET /api/v2/instance/stats` and `GET /api/v2/instance/companies` with the `adminkey` header.

## Related

- [Troubleshooting](./troubleshooting)
- [The Instance console](./instance-console)
- [Environment variables](./env-reference#logging)
