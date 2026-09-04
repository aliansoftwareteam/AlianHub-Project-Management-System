# AlianHub Architecture Guide

**[← Back to main guide](../CLAUDE.md)**

## High-Level Design

```
┌─────────────────────────────────────────────────────────┐
│                    Web Clients (Vue.js)                 │
│                   Desktop (Electron)                    │
└───────────┬──────────────────────────┬──────────────────┘
            │                          │
    ┌───────▼───────────────────────────▼──────┐
    │   API Server (Express.js) — /api/v1, v2  │
    │   - Controllers (50+ modules)            │
    │   - Routes, Middleware, Error Handling   │
    │   - Socket.io Event Emitter (LiveSync)   │
    │   - Scheduled Tasks (node-schedule)      │
    │   - Authentication (JWT, OAuth, Firebase)│
    └───────┬──────────────────┬────────────────┘
            │                  │
    ┌───────▼────────┐    ┌───▼──────────────┐
    │  MongoDB       │    │  Storage Layer   │
    │  (Multi-tenant)│    │  (Wasabi/Server) │
    │  (Company-scoped)   │  (S3-compatible) │
    └────────────────┘    └──────────────────┘
```

## Data Flow

1. **Request:** Client sends HTTP request to `/api/v{version}/endpoint`
2. **Route Matching:** Express router matches request to module controller
3. **Business Logic:** Controller (with chained middleware) processes request
4. **Validation:** Input validation at API boundary
5. **Database:** MongoDB query via `MongoDbCrudOpration(companyId, mongoObj, operation)`
6. **Real-time:** Socket.io emits event for other connected clients
7. **Cache:** In-memory cache invalidated after mutations
8. **Response:** Returns `{ status, statusText, data }` JSON format

## Design Patterns in Use

### Module-Based Organization
The codebase is organized into 50+ feature modules under `Modules/`. Each module encapsulates:
- **Controller:** HTTP request handlers (endpoint logic)
- **Routes:** Route definitions (registered via `exports.init(app)`)
- **Helpers:** Business logic and utilities
- **Schema:** Mongoose schema (if applicable)

### Centralized MongoDB Abstraction
All database queries go through a single function:
```javascript
const result = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

This prevents:
- SQL-injection-like vulnerabilities
- Inconsistent query patterns
- Data scoping bugs (missing companyId)

### Company-Scoped Multi-Tenancy
Each company has its own MongoDB database (`${MONGODB_URL}/<companyId>`); users, companies and sessions live in `global`. `MongoDbCrudOpration(companyId, mongoObj, method)` opens (and pools) the connection for that database, so the first argument decides which tenant a query touches. Handlers take it from `tenantOf(req)` (`Config/tenant.js`): the `companyid` header, validated as an ObjectId and checked against the token's audience (`req.aud`).

### Request pipeline
`index.js` mounts, in order: CORS → `Config/requestLog.js` (assigns `X-Request-Id`, opens the async context, logs one line on finish) → body parsers (`BODY_LIMIT`) → static `frontend/dist` → `strictStatus` (real 4xx for API tokens and `Prefer: status-codes`) → the JWT guard lists from `Config/setMiddleware.js` (`verifyJWTTokenV2` then `requireCompanyAud`) → every module's `routes.js` → `spaFallback` → `Config/errorHandler.js`.

### Errors
A handler answers `{ status: false, statusText }` with HTTP 200 (`Config/respond.js` `fail` adds `statusCode` for callers that want it). Anything thrown or passed to `next(err)` reaches `errorHandler`, which logs the stack under the request id and answers `{ status: false, statusText, requestId }`. Process-level `uncaughtException`/`unhandledRejection` go through winston too.

### Cache Invalidation Pattern
In-memory cache (node-cache) is invalidated after mutations:
```javascript
const cacheKey = `project:${projectId}`;
MongoDbCrudOpration(...).then(() => {
  removeCache(cacheKey);  // Clear stale data
});
```

### Real-Time Events via Socket.io
After data mutations, Socket.io broadcasts events to connected clients:
```javascript
require('../event/socketEventEmitter').emitEvent('TASK_UPDATED', {
  taskId, projectId, changes
});
```

This enables LiveSync — all clients see updates in real-time.

## API Versioning Strategy

AlianHub maintains **v1 and v2 endpoints** for backward compatibility:

- **v1 endpoints:** `/api/v1/projects/list`
- **v2 endpoints:** `/api/v2/projects/list` (preferred)

**Rules:**
- v2 is the default for new routes
- v1 remains for legacy clients
- Never mix versions in a single module (consistency)
- v2 may have enhanced request/response formats

## Real-Time Architecture (Socket.io)

Socket.io enables live updates when tasks/projects change:

1. **Connection:** Client connects on page load
2. **Event Listener:** Socket listens for events (`TASK_UPDATED`, `PROJECT_CREATED`, etc.)
3. **Broadcast:** When mutation happens, server emits event to all connected clients
4. **Update:** Client receives event and updates local state

**Key Event Types:**
- `TASK_CREATED`, `TASK_UPDATED`, `TASK_DELETED`
- `PROJECT_CREATED`, `PROJECT_UPDATED`, `PROJECT_DELETED`
- `COMMENT_ADDED`
- `CHAT_MESSAGE`

**Critical:** If you add a mutation, emit the corresponding event or other clients won't see the change.

## Multi-Tenancy Implementation

AlianHub supports running a single instance for multiple companies:

1. **Database isolation:** one MongoDB database per company, named by its id; `global` holds users, companies, sessions and instance settings
2. **Request scoping:** `tenantOf(req)` resolves the `companyid` header (params, query, body as fallbacks) and rejects anything outside the token's audience with a `TenantError` (403)
3. **Query scoping:** `MongoDbCrudOpration(companyId, …)` or `tenantDb(req)(mongoObj, method)`; ESLint rejects a literal or `undefined` tenant in a controller, and `tests/conventions/tenant-scoping` keeps body/query tenant reads from growing
4. **Storage scoping:** uploads live under the company's bucket or directory
5. **Membership:** `Config/jwt.js` re-checks the user still belongs to the company (cached `MEMBERSHIP_CACHE_TTL_SECONDS`)

**Security critical:**
- A query against the wrong first argument reads another tenant's database
- A tenant id taken from the body instead of the header trusts the client
- JWT validation failure → authentication bypass

## State Management Layers

### Backend State
- **Database:** Persistent state (projects, tasks, users)
- **In-Memory Cache:** Frequently accessed data (projects, user settings)
- **Socket.io State:** Connected client list

### Frontend State
- **Vuex/Pinia Store:** Global app state (current project, user, UI)
- **Local Component State:** Component-level data (form inputs, modals)
- **Server State:** Fetch from API when needed

## Authentication Flow

1. **Login:** User sends credentials → JWT generated
2. **Token Storage:** Client stores JWT in localStorage
3. **Request:** Client sends JWT in Authorization header
4. **Validation:** Express middleware validates JWT
5. **Scoping:** Extracts userId and companyId from JWT
6. **Authorization:** Endpoint checks user has permission

**Token Format:** Standard JWT with `userId`, `companyId`, `role` claims

## Storage Architecture

Two storage backends supported via abstraction layer:

### Wasabi (S3-Compatible)
- **Use case:** Cloud deployments, scalable file storage
- **Configuration:** WASABI_ACCESS_KEY, WASABI_SECRET_ACCESS_KEY, USERPROFILEBUCKET
- **Implementation:** common-storage/common-wasabi.js

### Local File System
- **Use case:** Self-hosted deployments, development
- **Configuration:** STORAGE_TYPE="server"
- **Implementation:** common-storage/common-server.js

Both support:
- Image resizing (Sharp)
- File uploads
- Presigned URLs (for temporary access)
- Cleanup after deletion
