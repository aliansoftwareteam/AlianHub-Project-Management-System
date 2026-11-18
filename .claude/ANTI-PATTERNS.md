# Anti-Patterns & What NOT to Do

**[← Back to main guide](../CLAUDE.md)**

## Data Scoping Violations

### ❌ Anti-Pattern: Querying Without companyId

**Problem:** Returns data from ANY company → security breach
```javascript
// WRONG: Missing companyId filter
Task.findOne({ taskId: 123 });

// WRONG: Using wrong companyId
MongoDbCrudOpration(differentCompanyId, mongoObj, 'findOne');

// WRONG: Hardcoding companyId
MongoDbCrudOpration('hardcoded-id-123', mongoObj, 'findOne');
```

**Why It's Bad:**
- User from Company A could access Company B's tasks
- GDPR/compliance violation
- Data breach
- Loss of customer trust

**✅ Correct Pattern:**
```javascript
// Always use the company from the request
const companyId = req.user.companyId;  // or req.params.companyId (with validation)

const mongoObj = {
  type: SCHEMA_TYPE.TASKS,
  data: [{ companyId, taskId: 123 }]  // ← Always include companyId
};

MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

---

## Hardcoded Collection Names

### ❌ Anti-Pattern: Using String Collection Names

**Problem:** String names aren't validated → typos go unnoticed → query silently fails
```javascript
// WRONG: String instead of enum
const mongoObj = {
  type: 'projects',  // ← This silently fails if not found in mapping
  data: [...]
};

// WRONG: Multiple different names for same collection
MongoDbCrudOpration(id, { type: 'project', ... });
MongoDbCrudOpration(id, { type: 'projects', ... });
MongoDbCrudOpration(id, { type: 'Project', ... });
```

**Why It's Bad:**
- Typos in collection names go unnoticed
- Inconsistent naming across codebase
- Hard to refactor (find/replace breaks on strings)
- No type safety

**✅ Correct Pattern:**
```javascript
// Use SCHEMA_TYPE enum from Config/collections.js
const { SCHEMA_TYPE } = require('../Config/collections');

const mongoObj = {
  type: SCHEMA_TYPE.PROJECTS,  // ← Single source of truth
  data: [...]
};
```

---

## Bypassing MongoDbCrudOpration

### ❌ Anti-Pattern: Raw Mongoose Queries

**Problem:** Inconsistent patterns, missing companyId, no error handling
```javascript
// WRONG: Direct Mongoose query
const Project = require('../Modules/Project/schema');
const project = await Project.findOne({ _id: projectId });

// WRONG: Mongoose without company filter
const tasks = await Task.find({ projectId });

// WRONG: Raw MongoDB operations
const result = await db.collection('projects').findOne({ _id: projectId });
```

**Why It's Bad:**
- Bypasses centralized error handling
- Inconsistent query patterns
- Easy to forget companyId filtering (data leak)
- Hard to add logging/auditing later
- Different error formats

**✅ Correct Pattern:**
```javascript
// Always use centralized abstraction
const mongoObj = {
  type: SCHEMA_TYPE.PROJECTS,
  data: [{ _id: projectId }]
};

MongoDbCrudOpration(companyId, mongoObj, 'findOne')
  .then(project => { /* handle success */ })
  .catch(error => { /* handle error */ });
```

---

## Mixing Async Patterns

### ❌ Anti-Pattern: Inconsistent Async Styles

**Problem:** Hard to read, easy to introduce bugs, inconsistent error handling
```javascript
// WRONG: Mixing callbacks, promises, and async-await
exports.getProject = (req, res, next) => {
  // Callback style (legacy)
  getAuth(req.body, (result) => {
    // Promise style (modern)
    MongoDbCrudOpration(id, obj, 'findOne')
      .then(project => {
        // Async-await style (newest)
        async function sendNotification() {
          await notificationService.send(project);
        }
        sendNotification();
      });
  });
};
```

**Why It's Bad:**
- Hard to follow execution flow
- Easy to miss error handling in one style
- Hard to refactor
- Future developers confused

**✅ Correct Pattern:**
```javascript
// Use async-await consistently (modern preferred)
exports.getProject = async (req, res, next) => {
  try {
    const mongoObj = { type: SCHEMA_TYPE.PROJECTS, data: [...] };
    const project = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
    
    await notificationService.send(project);
    
    res.json({ status: true, data: project });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

---

## Forgetting Socket.io Events

### ❌ Anti-Pattern: Mutation Without Broadcast

**Problem:** Other clients don't see the update → broken LiveSync
```javascript
// WRONG: Updated database but didn't emit event
exports.updateTask = (req, res, next) => {
  MongoDbCrudOpration(companyId, mongoObj, 'update')
    .then(task => {
      // ← Missing: emit Socket.io event
      res.json({ status: true, data: task });
    });
};
```

**Why It's Bad:**
- Other connected clients still see old data
- UI becomes inconsistent
- Users confused why changes don't appear
- Real-time feature appears broken

**✅ Correct Pattern:**
```javascript
// Always emit event after mutation
exports.updateTask = (req, res, next) => {
  const { taskId } = req.params;
  
  MongoDbCrudOpration(companyId, mongoObj, 'update')
    .then(task => {
      // Emit event for real-time updates
      require('../event/socketEventEmitter').emitEvent('TASK_UPDATED', {
        taskId,
        companyId,
        data: task
      });
      
      res.json({ status: true, data: task });
    });
};
```

---

## Skipping Cache Invalidation

### ❌ Anti-Pattern: Not Clearing Cache After Mutations

**Problem:** Cached data becomes stale → users see old data
```javascript
// WRONG: Updated database but cache is stale
exports.updateProject = (req, res, next) => {
  MongoDbCrudOpration(companyId, mongoObj, 'update')
    .then(project => {
      // ← Missing: removeCache()
      res.json({ status: true, data: project });
    });
};

// User requests same project → gets stale cached version
const cachedProject = await getCache(`project:${projectId}`);
```

**Why It's Bad:**
- User sees outdated information
- Confusing UI behavior
- Leads to data consistency issues
- Hard to debug (works locally, fails with cache)

**✅ Correct Pattern:**
```javascript
const { removeCache } = require('../utils/cacheHelper');

exports.updateProject = (req, res, next) => {
  const { projectId } = req.params;
  
  MongoDbCrudOpration(companyId, mongoObj, 'update')
    .then(project => {
      // Clear all affected cache keys
      removeCache(`project:${projectId}`);
      removeCache(`projectList:${companyId}`);
      
      // Emit real-time event
      require('../event/socketEventEmitter')
        .emitEvent('PROJECT_UPDATED', { projectId, data: project });
      
      res.json({ status: true, data: project });
    });
};
```

---

## API Versioning Inconsistency

### ❌ Anti-Pattern: Mixing API Versions

**Problem:** Inconsistent endpoints break clients during migration
```javascript
// WRONG: Mixing v1 and v2 in same module
app.post('/api/v1/tasks/create', ctrl.createTask);      // Old client
app.post('/api/v2/tasks/create', ctrl.createTask);      // New client
app.post('/api/tasks/create', ctrl.createTask);         // No version!

// WRONG: v2 endpoint calling v1 helpers
app.post('/api/v2/tasks/create', v1Ctrl.createTask);
```

**Why It's Bad:**
- Confusing for API consumers
- Hard to deprecate old endpoints
- Easy to break backward compatibility
- Versioning loses its purpose

**✅ Correct Pattern:**
```javascript
// Use consistent versioning
app.post('/api/v2/tasks/create', ctrl.createTask);      // New routes use v2
app.post('/api/v2/tasks/:id/update', ctrl.updateTask);
app.post('/api/v2/tasks/:id/delete', ctrl.deleteTask);

// Only maintain v1 for legacy clients
app.post('/api/v1/tasks/create', legacyCtrl.createTask);

// Deprecation plan: retire v1 after migration period
```

---

## Insufficient Input Validation

### ❌ Anti-Pattern: Trusting Client Input

**Problem:** SQL injection-like attacks, malicious data, crashes
```javascript
// WRONG: No validation
exports.createTask = (req, res, next) => {
  const { taskName, priority } = req.body;
  
  // What if taskName is null? Array? Object? 1000000 chars?
  // What if priority is "admin" or "DELETE FROM tasks"?
  
  MongoDbCrudOpration(companyId, { 
    type: SCHEMA_TYPE.TASKS,
    data: [{ taskName, priority }]
  }, 'save');
};
```

**Why It's Bad:**
- Invalid data in database
- Application crashes
- Security vulnerabilities
- Data integrity problems

**✅ Correct Pattern:**
```javascript
// Validate all input
exports.createTask = (req, res, next) => {
  const { taskName, priority } = req.body;
  
  // Validate type
  if (typeof taskName !== 'string') {
    req.errorMessageObject = { message: "Task name must be string", statusCode: 400 };
    return next();
  }
  
  // Validate length
  if (taskName.length === 0 || taskName.length > 255) {
    req.errorMessageObject = { message: "Task name must be 1-255 characters", statusCode: 400 };
    return next();
  }
  
  // Validate enum
  if (priority && !['low', 'medium', 'high'].includes(priority)) {
    req.errorMessageObject = { message: "Invalid priority", statusCode: 400 };
    return next();
  }
  
  // Safe to use
  MongoDbCrudOpration(companyId, { 
    type: SCHEMA_TYPE.TASKS,
    data: [{ 
      taskName: taskName.trim(), 
      priority: priority || 'medium'
    }]
  }, 'save');
};
```

---

## Not Using Centralized Error Handling

### ❌ Anti-Pattern: Sending Error Responses Directly

**Problem:** Inconsistent error formats, missing logging, hard to change error behavior
```javascript
// WRONG: Different error responses
res.status(400).json({ error: 'Invalid input' });  // Format 1
res.status(500).json({ message: 'Server error' }); // Format 2
throw new Error('Something went wrong');           // Unhandled!
```

**Why It's Bad:**
- Frontend doesn't know how to parse errors
- Inconsistent error handling across codebase
- Hard to add logging globally
- Difficult to change error behavior later

**✅ Correct Pattern:**
```javascript
// Always use middleware propagation
try {
  // ... logic
} catch (error) {
  req.errorMessageObject = { 
    message: error.message, 
    statusCode: 500 
  };
  next();  // Passes to centralized error middleware
}

// Centralized error middleware (in index.js)
app.use((err, req, res, next) => {
  logger.error(err.message, { statusCode: req.errorMessageObject.statusCode });
  
  res.status(req.errorMessageObject.statusCode || 500).json({
    status: false,
    statusText: req.errorMessageObject.message,
    message: req.errorMessageObject.message
  });
});
```

---

## Hardcoding Configuration

### ❌ Anti-Pattern: Hardcoded API URLs, Timeouts, Limits

**Problem:** Can't change behavior without code changes, environment-specific issues
```javascript
// WRONG: Hardcoded configuration
const API_URL = 'http://localhost:4000/api';      // Won't work in production
const MAX_FILE_SIZE = 5 * 1024 * 1024;            // Can't change per environment
const DB_RETRY_ATTEMPTS = 3;                      // Hardcoded retry logic

exports.uploadFile = async (file) => {
  if (file.size > MAX_FILE_SIZE) {                // ← Hardcoded limit
    throw new Error('File too large');
  }
};
```

**Why It's Bad:**
- Can't change behavior without redeploy
- Different production limits than development
- Hard to scale (what about larger customers?)

**✅ Correct Pattern:**
```javascript
// Use environment variables
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '5242880');
const DB_RETRY_ATTEMPTS = parseInt(process.env.DB_RETRY_ATTEMPTS || '3');
const API_URL = process.env.APIURL;  // From .env

exports.uploadFile = async (file, companyId) => {
  // Allow per-company limits from database
  const company = await getCompanySettings(companyId);
  const limit = company.fileUploadLimit || MAX_FILE_SIZE;
  
  if (file.size > limit) {
    throw new Error('File too large');
  }
};
```

---

## Comments That Duplicate Code

### ❌ Anti-Pattern: Redundant Comments

**Problem:** Comments rot, duplicate what code already says, waste space
```javascript
// WRONG: Comments say what code does
// Check if task name exists
if (taskName) {
  // ...
}

// Increment counter
count++;

// Filter by company ID
const filtered = tasks.filter(t => t.companyId === companyId);
```

**Why It's Bad:**
- Comments duplicate variable/function names
- Maintenance burden (code changes, comments don't)
- Hides real insights

**✅ Correct Pattern:**
```javascript
// Only comment NON-OBVIOUS things
// Must sort by creation date DESC for UI consistency (legacy requirement from issue #123)
results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// Validate input (don't explain why)
if (!taskName?.trim()) {
  throw new Error('Task name required');
}

// Filter by company (variable name says this)
const filtered = tasks.filter(t => t.companyId === companyId);
```

---

## Unused Code & Dead Branches

### ❌ Anti-Pattern: Commented-Out Code

**Problem:** Clutters codebase, confuses developers, version control exists for a reason
```javascript
// WRONG: Old code commented out
// const oldWay = await Task.findOne(...);  // ← Remove this!
const newWay = await MongoDbCrudOpration(...);

// WRONG: Unreachable branches
if (feature === 'OLD_FEATURE') {
  // This never runs, why is it here?
}
```

**Why It's Bad:**
- Confuses what's actually running
- Maintainability burden
- Version control (git) has history

**✅ Correct Pattern:**
```javascript
// Just delete old code—git history preserves it
const result = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');

// If you need old behavior, check git history
// git log --all -S "oldWay"
```


---

## Agents and MCP

Details and the steps to add an action are in [AGENTS-AND-MCP.md](AGENTS-AND-MCP.md).

### ❌ Anti-Pattern: A second road for an agent's change

**Don't:** write to the database from a tool, or call a handler without `actions.perform()`.

**Why:** the registry, the person's permissions, `ask()`, the audit row and the undo all live in `perform()`.

**✅ Do:** add a registry entry and an executor that runs the web app's own handler as the person.

### ❌ Anti-Pattern: Registering an action on the never-list

**Don't:** add `project.delete`, `task.delete`, `billing.*`, `deploy.production`, `git.merge`, `member.remove`, `permissions.edit` or `status.set("Done")` to any registry group.

**Why:** these are absent on purpose, so a token has nothing to switch on. `indexActions()` throws.

### ❌ Anti-Pattern: An action with no permission or no rating

**Don't:** register an action without `permission` or without a `RATINGS` entry.

**Why:** the person behind the agent is held to that permission, and the rating decides whether the agent may act alone.

### ❌ Anti-Pattern: Sending something outside AlianHub on an agent's own

**Don't:** let an agent send a message, an email or a calendar event directly.

**✅ Do:** mark the action `proposeOnly` so it waits for a person, with the exact text and destination.

### ❌ Anti-Pattern: A tool that decides, or a route that lets a token decide

**Don't:** add an MCP tool that approves, declines or undoes a proposal or keeps a standing approval. Don't mount a deciding route without `personDecides()` or `decidedByPerson()`.

**Why:** a decision needs a signed-in person.

### ❌ Anti-Pattern: Turning a new tool on by default

**Don't:** register a group with no flag, or a flag that defaults to on.

**✅ Do:** put it behind a flag that reads one variable on every call and defaults to `off`.

### ❌ Anti-Pattern: A query or event that does not name the workspace

**Don't:** read `companyId` from the request body, query a collection without `companyId` first, or emit an event without `companyId`.

**✅ Do:** take it from `tenantOf(req)` and pass it to `MongoDbCrudOpration` and into every event payload.

### ❌ Anti-Pattern: Technical words in tool text

**Don't:** put setting names, ids, `scope`, `token` or `payload` in a tool description, a refusal or an instruction a person reads.

**✅ Do:** say what the person would say: list, doc, task.

### ❌ Anti-Pattern: A long `instructions.js`

**Don't:** grow `Modules/Mcp/instructions.js` past `MAX_LENGTH` (4000 characters) or name a tool the connection is not offered.

### ❌ Anti-Pattern: A helper on a `taskMongo` mixin

**Don't:** add a helper method to a mixin in `Modules/Tasks/helpers/taskMongo/`.

**Why:** `PATCH /api/v2/tasks` and `POST /api/v2/tasks/bulk` call `taskMongo[action]` by name, so every method there is a route and needs a permission mapping.

**✅ Do:** put the helper in its own file.
