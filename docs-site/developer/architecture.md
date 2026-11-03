# Architecture

AlianHub is one Node.js process that serves the API, the built web app and the Socket.io server, in front of MongoDB with one database per company. This page follows a request through it and names the file behind each layer, so you know where to look before you change something.

## The big picture

```
 Web app (Vue 3, frontend/dist)      Desktop time tracker (Electron)      AI apps (MCP)
            │  HTTPS + cookie/JWT               │                              │ Bearer token
            ▼                                   ▼                              ▼
 ┌───────────────────────────────────────────────────────────────────────────────────────┐
 │ index.js  Express                                                                     │
 │   security headers → global rate limit → body parsers → request log (X-Request-Id)    │
 │   → static frontend/dist → maintenance guard → strictStatus → JWT guard lists         │
 │   → every module's routes (Modules/*/init.js) → SPA fallback → errorHandler           │
 │                                                                                       │
 │ socket/socketinit.js   Socket.io, one namespace per person: userid_<company>_<user>   │
 │ cron.js (node-schedule)        Automations queue (@hokify/agenda on `global`)         │
 └───────────────┬───────────────────────────────────────┬───────────────────────────────┘
                 │ MongoDbCrudOpration(companyId, …)     │ common-storage/common-<STORAGE_TYPE>.js
                 ▼                                       ▼
   MongoDB: `global` + one database per company     Local disk, Wasabi or any S3
```

## A request, step by step

| Step | What happens | Where |
|---|---|---|
| 1 | Security headers, the global per-address rate limit (1000 requests a minute by default) and body parsers | `Config/securityHeaders.js`, `Config/globalRateLimit.js`, `index.js` |
| 2 | A request id is assigned, returned as `X-Request-Id`, and prefixed to every log line written while handling the request | `Config/requestLog.js` |
| 3 | `strictStatus` turns `statusCode` in a body into a real 4xx for API-token callers and anyone sending `Prefer: status-codes` | `Config/strictStatus.js` |
| 4 | For guarded prefixes, the JWT or API token is verified, the `companyid` header is checked against the token's audience, and membership is re-checked | `Config/setMiddleware.js`, `Config/jwt.js` |
| 5 | The module's route handler runs. It resolves the tenant with `tenantOf(req)` and queries through `MongoDbCrudOpration` | `Modules/<Name>/`, `Config/tenant.js` |
| 6 | After a write, the handler emits an event on the in-process emitter and clears any cache that held the old value | `event/socketEventEmitter.js`, `utils/commonFunctions.js` |
| 7 | The response is `{ status, statusText, data }` with HTTP 200. Anything thrown reaches the error handler | `Config/respond.js`, `Config/errorHandler.js` |

## Authentication

- **Sessions.** Sign-in issues a JWT kept in the `accessToken` cookie. `bearerFrom()` in `Config/jwt.js` reads `x-access-token`, then `Authorization: Bearer`, then the cookie. The token's `aud` lists the companies it may act for.
- **API tokens.** A token starting `ahp_` takes the API-token path in the same middleware (`verifyApiTokenRequest`). It is bound to one company.
- **Every request** names its company in the `companyid` header. `requireCompanyAud` refuses a company outside the token's audience, and `verifyCompanyMembership` re-checks that the person still belongs to it (cached for `MEMBERSHIP_CACHE_TTL_SECONDS`).
- **OAuth for AI apps.** `Modules/OAuthServer/` is a small authorization server for apps that connect to `/mcp` by address. See the [MCP server reference](/ai/mcp-server).
- **Sockets** check the same session on the handshake and again on every event, so a socket whose session ended is closed on its next event (`socket/socketinit.js`).

## Multi-tenant data

Each company has its own MongoDB database named by its 24-character id; `global` holds users, companies, sessions and instance settings. `MongoDbCrudOpration(companyId, mongoObj, method)` opens (and pools) the connection for that database, so the first argument decides which tenant a query touches. Collection names come from `SCHEMA_TYPE`. Details and real code are in [Multi-tenancy and data access](./multi-tenancy).

## Caching

An in-process `node-cache` instance (`myCache` in `Config/config.js`) holds hot reads such as a person's project list (`UserProjectData:` keys) and company data (`companyData_<id>`). `removeCache(key, isKeyWithPrefix)` in `utils/commonFunctions.js` deletes one key, or every key containing a prefix. The cache is per process: a write must clear what it changed.

## Real-time

A write emits `socketEmitter.emit('update' | 'insert' | 'delete', { module, companyId, data, updatedFields })`. The emitter also re-emits it as `<module>:<type>` (for example `task:update`), and each relay in `socket/controller/` listens to its own modules, checks who may receive the change, and pushes a client event such as `taskUpdate` or `projectChanged`. See [Real-time (Socket.io) events](./socket-events).

## Jobs

| Kind | What runs it | Where |
|---|---|---|
| Fixed schedules (reminders, recurring tasks, scheduled reports, storage reconcile, the agents' daily look, retention sweeps) | `node-schedule`, in `CRON_TZ` (UTC by default). Off with `CRON_ENABLED=false` | `cron.js` |
| Automation rules, workflow runs, recurring jobs of Agents and Knowledge | One `@hokify/agenda` queue per install, on the `global` database in `automation_jobs`; each job carries its `companyId` | `Modules/Automations/engine/queue/agendaDriver.js` |

`AUTOMATION_QUEUE_DRIVER` picks `agenda` (default) or `inline` (tests), and `AUTOMATION_ENGINE=false` turns the engine off. The reasoning is in ADR 002, summarised in [AI platform architecture](/ai/architecture).

## Storage

`STORAGE_TYPE` is `server`, `wasabi` or `s3`, and `index.js` loads `common-storage/common-<STORAGE_TYPE>.js`, then the routes of `Modules/storage/server/` or `Modules/storage/wasabi/`. `s3` and `wasabi` are the same S3-compatible driver (`common-s3.js` re-exports `common-wasabi.js`). With `server`, uploads are written under `storage/<companyId>` and served from the app's own origin with `nosniff` and a sandboxing Content-Security-Policy. See [File storage](/admin/storage).

## The AI layer

- `Modules/AICore/` is the only place a model is called: provider registry and factory, pricing and spend meter, budget reservation, routing policy and the instruction guard. `tests/conventions/ai-core-boundary.test.js` keeps vendor SDKs out of every other folder.
- `Modules/Agents/` holds the action registry, project policy, proposals, the audit log and undo.
- `Modules/Mcp/` is the MCP server at `/mcp`, and `Modules/OAuthServer/` its sign-in.

Every agent change takes one road: tool call, registry entry, `ask()` in `Modules/Agents/projectPolicy.js`, then act, propose or refuse. See [Agent actions and MCP tools](./agent-actions) and [AI platform architecture](/ai/architecture).

## API versions

Routes live under `/api/v1/*` (older) and `/api/v2/*` (new routes). Every `/api/v2/*` prefix must be in the JWT guard list of `Config/setMiddleware.js`, or be declared public by design or self-guarded in `tests/conventions/v2-guard.test.js`. The generated reference is in the [API section](/api/).

## Related

- [Module layout](./module-layout)
- [Multi-tenancy and data access](./multi-tenancy)
- [Real-time (Socket.io) events](./socket-events)
- [Frontend](./frontend)
