# Coding Conventions

**[← Back to main guide](../CLAUDE.md)**

## File Naming Conventions

### Module Folders
- **Format:** PascalCase
- **Examples:** `Modules/Project/`, `Modules/MainChats/`, `Modules/Teams/`
- **Rule:** Each feature gets one PascalCase folder under Modules/

### Files Within Modules
- **Controllers:** camelCase (e.g., `getProjectById.js`, `updateTask.js`)
- **Routes:** Always `routes.js` (consistent across all modules)
- **Helpers:** camelCase (e.g., `helper.js`, `mongo_operations.js`, `task_class.js`)
- **Schemas:** `schema.js` (Mongoose model definitions)
- **Init:** `init.js` (module initialization)

### Configuration & Utilities
- **Config files:** camelCase (e.g., `config.js`, `loggerConfig.js`)
- **Utility files:** kebab-case or camelCase (e.g., `mongo-handler.js`, `taskHelper.js`)
- **Constants:** ALL_CAPS with underscores (e.g., `SCHEMA_TYPE`, `MAX_FILE_SIZE`)

### API Endpoints
- **Format:** kebab-case with version prefix
- **Examples:** `/api/v2/tasks/create`, `/api/v2/projects/list`, `/api/v1/auth/login`
- **Rule:** Always use a version (v1 or v2, prefer v2)

## Code Naming Conventions

### Variables
```javascript
const companyId = req.params.companyId;  // camelCase
const userData = { name: "John" };       // Objects: camelCase
let projectList = [];                    // Arrays: camelCase
```

### Functions
```javascript
// Named exports (preferred)
exports.loginAuth = (req, res) => { };
exports.updateProject = (req, res) => { };

// Arrow functions
const verifyToken = (token) => { };

// Regular functions (legacy)
function loginAuth(req, res) { }
```

### Constants
```javascript
const SCHEMA_TYPE = { PROJECTS: 'projects', TASKS: 'tasks' };  // UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 5 * 1024 * 1024;                          // UPPER_SNAKE_CASE
const API_VERSION = 'v2';                                       // UPPER_SNAKE_CASE
```

### Classes
```javascript
class Task {                              // PascalCase
  constructor(id, name) { }
  
  save() { }                              // Methods: camelCase
}

class ProjectManager {                    // PascalCase
  getAllProjects() { }                    // Methods: camelCase
}
```

### Request/Response Handlers
```javascript
// Controller file: Modules/Task/controller/createTask.js
exports.createTask = (req, res, next) => {
  const { companyId } = req.params;      // Always extract companyId
  const { taskName } = req.body;
  
  // Business logic...
  
  res.status(200).json({
    status: true,
    statusText: "Task created successfully",
    data: task
  });
};
```

## Module Organization Rules

### Standard Module Structure
```
Modules/FeatureName/
├── controller/
│   ├── action1.js                  # Individual endpoint handlers
│   ├── action2.js
│   └── helper.js                   # Shared logic for controllers
├── routes.js                       # All route definitions
├── helpers/
│   ├── helper.js                   # Business logic
│   ├── mongo_operations.js         # Database queries
│   └── class.js                    # Classes/models
├── schema.js                       # Mongoose schema (if needed)
└── init.js                         # Module initialization
```

### Route Registration Pattern
One `routes.js` per module exports `init(app)` (no `routes2.js`, `router.js` or `route.js`):
```javascript
// Modules/Task/routes.js
const ctrl = require('./controller/createTask.js');

exports.init = (app) => {
  app.post('/api/v2/tasks/create', ctrl.createTask);
  app.get('/api/v2/tasks/:id', ctrl.getTask);
  app.put('/api/v2/tasks/:id', ctrl.updateTask);
};
```

`Modules/Task/init.js` re-exports it and `initializeControllers()` in `index.js` calls `require('./Modules/Task/init').init(app)`. The route prefix must also appear in the `verifyJWTToken` list of `Config/setMiddleware.js` (or be declared public / self-guarded in `tests/conventions/v2-guard.test.js`); the conventions test fails until it does.

## Error Handling Pattern

### asyncHandler + respond
```javascript
const { tenantOf } = require('../../Config/tenant');
const { ok, fail, asyncHandler } = require('../../Config/respond');

exports.updateProject = asyncHandler(async (req, res) => {
  const companyId = tenantOf(req);                       // throws TenantError (403) when missing or outside req.aud
  const { projectId } = req.params;
  const { projectData } = req.body;
  if (!projectData?.name) return fail(res, 'Project name is required', 400);

  const project = await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: projectId }, { $set: projectData }]
  }, 'findOneAndUpdate');
  return ok(res, { statusText: 'Project updated successfully', data: project });
});
```

`asyncHandler` forwards a rejection to `next(err)`; `Config/errorHandler.js` logs the stack with the request id and answers `{ status: false, statusText, requestId }`. Older handlers that `try/catch` and `res.send({ status: false, statusText: error.message })` themselves keep working — use `fail(res, error.message, error.statusCode)` in the catch so API-token callers get the right HTTP status. `req.errorMessageObject` + `next()` is a legacy pattern (four call sites); do not add to it.

## Response Format (All Endpoints)

### Success Response
```javascript
{
  status: true,
  statusText: "Human-readable success message",
  data: { /* actual payload */ }
}
```

### Error Response
```javascript
{
  status: false,
  statusText: "Error description",
  message: "Alternative error field (if using legacy format)"
}
```

### HTTP Status Codes
- `200` — Success (data returned)
- `201` — Created (new resource)
- `400` — Client error (validation, missing fields)
- `401` — Unauthorized (invalid JWT)
- `403` — Forbidden (insufficient permissions)
- `404` — Not found
- `500` — Server error (database, logic failures)

## State Management Patterns

### Frontend (Vue.js)
Use **Vuex/Pinia** for global state:
```javascript
// Store module: store/modules/project.js
export default {
  state: () => ({
    currentProject: null,
    projectList: [],
    loading: false
  }),
  
  mutations: {
    setCurrentProject(state, project) {
      state.currentProject = project;
    }
  },
  
  actions: {
    async fetchProject({ commit }, projectId) {
      const project = await api.getProject(projectId);
      commit('setCurrentProject', project);
    }
  }
};
```

### Backend (Node.js)
- **Persistent:** MongoDB for long-term storage
- **Cache:** node-cache for frequent lookups
- **Session:** JWT in client localStorage
- **Real-time:** Socket.io for live updates

## Database Query Pattern (CRITICAL)

### Always Use MongoDbCrudOpration
```javascript
// ✅ CORRECT: Centralized, scoped, safe
const mongoObj = {
  type: SCHEMA_TYPE.PROJECTS,
  data: [{ _id: projectId }]
};
const project = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

### Never Hardcode Collection Names
```javascript
// ❌ WRONG: String instead of SCHEMA_TYPE enum
const mongoObj = {
  type: 'projects',  // Fails silently
  data: [...]
};
```

### Always Include companyId
```javascript
// ❌ WRONG: Missing company scoping
Task.findOne({ taskId: 123 });  // Data leak!

// ❌ WRONG: tenant from the client, literal or undefined (ESLint rejects the last two in controllers)
MongoDbCrudOpration(req.body.companyId, mongoObj, 'findOne');
MongoDbCrudOpration('64b1f0c2a1b2c3d4e5f60718', mongoObj, 'findOne');

// ✅ CORRECT: the request tenant, validated against the token
const companyId = tenantOf(req);
MongoDbCrudOpration(companyId, mongoObj, 'findOne');
const db = tenantDb(req);
db(mongoObj, 'findOne');
```

`'global'` (`SCHEMA_TYPE.GOLBAL`) is the only literal first argument: users, companies and sessions live there. `tests/conventions/tenant-scoping.test.js` counts `req.body`/`req.query` tenant reads per file and only lets the number fall.

## Cache Invalidation Pattern

After mutations, invalidate affected cache keys:
```javascript
const cacheKey = `project:${projectId}`;

MongoDbCrudOpration(companyId, mongoObj, 'update')
  .then(project => {
    removeCache(cacheKey);  // Clear from in-memory cache
    
    // Emit real-time event
    require('../event/socketEventEmitter').emitEvent('PROJECT_UPDATED', {
      projectId,
      data: project
    });
    
    res.json({ status: true, data: project });
  });
```

## Comments & Documentation

### When to Write Comments
- **Hidden constraint:** Non-obvious requirement (e.g., "must sort by date for consistency")
- **Subtle invariant:** Behavioral expectation that would surprise a reader
- **Workaround:** Specific bug fix or temporary solution
- **Why, not what:** The reason for the code, not what it does

### When NOT to Write Comments
- ✅ Self-explanatory code (good naming says it all)
- ✅ Following obvious patterns (standard module structure)
- ✅ Describing what the code does (method names + variable names cover it)

**Example:**
```javascript
// ✅ GOOD: Explains non-obvious constraint
const results = await MongoDbCrudOpration(companyId, mongoObj, 'find');
// Sort by date DESC to ensure newest tasks appear in UI first (legacy requirement)
results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// ❌ UNNECESSARY: Says what the code does (obvious)
// Sort results in descending order by creation date
results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
```

## Tests

- `tests/*.test.js` (Jest project `unit`): pure helpers and rule modules, one file per module (`<module>-rules.test.js`). No database, no network; require the helper and assert.
- `tests/conventions/*.test.js` (Jest project `conventions`): repository-wide rules that read the tree (`v2-guard`, `tenant-scoping`, `i18n-namespaces`, `env-doc`, `unused-components`, `naming-conventions`). A rule that must hold in every module belongs here, with a baseline file only when the tree does not satisfy it yet — and the baseline may only shrink.
- `frontend/tests/*.spec.js` (Vitest, jsdom): mount with `@vue/test-utils`; `frontend/tests/setup.js` provides i18n, `$t` and the shell injections. Mock `@/services` and heavy children; declare shared mocks in `vi.hoisted`.
- `npm test`, `npm run lint`, `cd frontend && npm test && npm run lint -- --no-fix && npm run build` are the CI gate (`.github/workflows/ci.yml`).

## Locale keys (i18n)

- One namespace per area in `frontend/src/locales/en.js` (`Projects`, `Settings`, `Time`, …). Never create a `<Name>V2` twin; add keys to the existing block. `node scripts/i18n-rename-namespace.js <From> <To>` moves a namespace and rewrites every reference.
- Call `t('Namespace.key')` with a literal. A key built at run time ends its literal with `_` or `.` (`t('Inbox.tab_' + kind)`) so `tests/conventions/i18n-namespaces` can resolve the prefix.
- Other locales fall back to English for a missing key; a new key needs an English value first.
