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
Every operation includes `companyId` for strict data isolation:
- **Database level:** All queries filtered by companyId
- **API level:** companyId comes from JWT or request params
- **Security:** Prevents accidental cross-company data access

### Error Propagation via Middleware
Errors don't throw — they're set on `req.errorMessageObject` and `next()` is called:
```javascript
try {
  // logic
} catch (error) {
  req.errorMessageObject = { message: error.message, statusCode: 400 };
  next();  // Passes to centralized error handler
}
```

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

1. **Database Isolation:** All collections include `companyId` field
2. **Request Scoping:** companyId extracted from JWT or request params
3. **Query Filtering:** Every MongoDB query filtered by companyId
4. **Storage Scoping:** File uploads organized under company directory
5. **API Scoping:** Each endpoint validates user belongs to that company

**Security Critical:**
- Missing `companyId` in query → data leak
- Hardcoded `companyId` → wrong company access
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
