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
Every module exports an `init(app)` function:
```javascript
// Modules/Task/routes.js
const ctrl = require('./controller/createTask.js');

exports.init = (app) => {
  app.post('/api/v2/tasks/create', ctrl.createTask);
  app.get('/api/v2/tasks/:id', ctrl.getTask);
  app.put('/api/v2/tasks/:id', ctrl.updateTask);
};
```

Then in main server file:
```javascript
// index.js or server.js
const taskRoutes = require('./Modules/Task/routes.js');
taskRoutes.init(app);
```

## Error Handling Pattern

### Try-Catch with Middleware Propagation
```javascript
exports.updateProject = (req, res, next) => {
  try {
    const { companyId, projectId } = req.params;
    const { projectData } = req.body;
    
    // Validation
    if (!projectData.name) {
      req.errorMessageObject = { 
        message: "Project name is required", 
        statusCode: 400 
      };
      return next();
    }
    
    // Database operation
    const mongoObj = {
      type: SCHEMA_TYPE.PROJECTS,
      data: [{ _id: projectId, ...projectData }]
    };
    
    MongoDbCrudOpration(companyId, mongoObj, 'update')
      .then(project => {
        res.status(200).json({
          status: true,
          statusText: "Project updated successfully",
          data: project
        });
      })
      .catch(error => {
        req.errorMessageObject = { 
          message: error.message, 
          statusCode: 500 
        };
        next();
      });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

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

// ✅ CORRECT: Company scoped
MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

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
