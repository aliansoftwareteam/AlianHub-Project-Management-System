# Design Philosophy & Trade-offs

**[← Back to main guide](../CLAUDE.md)**

## Why MongoDB Over SQL (PostgreSQL, MySQL)?

### Chosen: MongoDB
**Rationale:**

#### 1. Flexible Schema for Custom Fields
AlianHub needs to support user-defined custom fields on projects and tasks. With MongoDB:
```javascript
// Easy: Add custom field without schema migration
task.customFields = {
  budget: 10000,
  client_location: 'US',
  expertise_required: ['React', 'Node.js']
};
```

SQL would require:
- Altering tables (downtime risk)
- Separate "custom_fields" junction tables (complex queries)
- Migrations for every new field

#### 2. Document Nesting (One Query Per Entity)
MongoDB supports embedded sub-documents:
```javascript
project = {
  name: "Website Redesign",
  tasks: [
    { id: 1, name: "Design", status: "In Progress" },
    { id: 2, name: "Frontend", status: "Pending" }
  ],
  teams: [
    { id: 1, name: "Design Team", members: [...] }
  ]
}
```

One query returns everything. SQL needs multiple JOINs:
```sql
SELECT p.*, t.*, m.* FROM projects p
  LEFT JOIN tasks t ON p.id = t.project_id
  LEFT JOIN teams tm ON p.id = tm.project_id
  LEFT JOIN members m ON tm.id = m.team_id;
```

Overkill for nested relationships.

#### 3. Scalability via Sharding
MongoDB's sharding is simpler for multi-tenant:
- Shard by companyId
- Each company's data on different cluster nodes
- Easy horizontal scaling

#### 4. Development Speed
Schema can evolve without migrations:
- Add field to document
- No downtime
- Backward compatible (null checks in code)

### Trade-offs:

| Aspect | MongoDB | SQL |
|--------|---------|-----|
| **Schema Flexibility** | ✅ High (no migrations) | ❌ Rigid (migrations needed) |
| **Transactions** | ⚠️ Limited (until MongoDB 4.0) | ✅ Full ACID |
| **Nested Data** | ✅ One query | ❌ Multiple JOINs |
| **Storage** | ⚠️ Larger (duplicated data) | ✅ Normalized, compact |
| **Sharding** | ✅ Native | ❌ Complex (requires proxy) |
| **Consistency** | ⚠️ Eventually consistent | ✅ Strongly consistent |

### Risk Mitigation:
- Mongoose schema validation ensures data integrity
- Centralized MongoDbCrudOpration enforces consistency
- Regular backups (MongoDB Atlas handles this)

---

## Why Socket.io for Real-Time (vs WebSockets, SSE)?

### Chosen: Socket.io
**Why:**

#### 1. Automatic Fallbacks
If WebSocket fails (legacy browser, old proxy):
- Automatically falls back to HTTP long-polling
- User doesn't notice the difference
- Works everywhere

#### 2. Room-Based Broadcasting
Perfect for multi-user collaboration:
```javascript
// Broadcast to all users in project 123
socket.to(`project:123`).emit('TASK_UPDATED', data);

// Only current user
socket.emit('NOTIFICATION', data);
```

SQL Server SignalR has similar features, but Socket.io is simpler.

#### 3. Built-in Connection Management
- Automatic reconnection
- Heartbeat/ping-pong
- Connection timeout handling
- No need for custom logic

#### 4. Client Libraries
- JavaScript (browsers)
- React, Vue, Angular support
- iOS/Android support
- .NET support

#### 5. Lightweight & Battle-Tested
- Used by millions of apps
- Well-documented
- Active community support
- Small bundle size

### Alternatives Considered:

| Tool | Pros | Cons | Why Not |
|------|------|------|---------|
| **Raw WebSockets** | Lightweight | No fallbacks, complex setup | No fallback support |
| **Server-Sent Events (SSE)** | Simple, HTTP-based | One-way only (server→client) | Can't send client→server events |
| **Polling** | Simple | High latency, server load | Too slow for real-time |
| **GraphQL Subscriptions** | Typed, modern | Overkill, complex | Over-engineered |

Socket.io is the sweet spot for real-time collaboration.

---

## Why Centralized MongoDbCrudOpration vs ORM?

### Chosen: Centralized Abstraction
**Why:**

#### 1. Prevents Data Scoping Bugs
Single function enforces `companyId` in every query:
```javascript
// All queries go through ONE function
MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

If developer forgets companyId:
```javascript
// Using raw MongoDB
db.tasks.findOne({ taskId: 123 });  // ← Data leak, no validation!
```

#### 2. Consistent Error Handling
```javascript
// All errors handled the same way
MongoDbCrudOpration(...)
  .catch(error => {
    // Standard error format
    logger.error(error);
    req.errorMessageObject = { message: error.message };
    next();
  });
```

#### 3. Easy to Add Logging/Auditing
```javascript
// One place to log all database operations
function MongoDbCrudOpration(companyId, mongoObj, operation) {
  logger.info(`Database ${operation}`, { companyId, mongoObj });
  // ... actual operation
}
```

#### 4. Easy to Migrate
If switching databases:
```javascript
// Change ONE function, all queries work
// (Wasabi storage abstraction uses this pattern)
```

### Why Not Use Mongoose ORM?

**Mongoose Pros:**
- Type safety (with TypeScript)
- Built-in validation
- Hooks (before/after save)

**Mongoose Cons:**
- More overhead for simple CRUD
- Developers might bypass ORM (`Model.findOne()` without validation)
- No guarantee of companyId filtering
- Overkill for simple document operations

### Trade-offs:

| Aspect | Centralized | Mongoose ORM |
|--------|-------------|--------------|
| **Security** | ✅ Enforced companyId | ⚠️ Developer must remember |
| **Performance** | ✅ Direct queries | ⚠️ Overhead + hooks |
| **Type Safety** | ❌ No types (use JSDoc) | ✅ Full typing |
| **Flexibility** | ✅ Raw MongoDB power | ⚠️ ORM constraints |
| **Learning Curve** | ✅ Simple | ❌ More complex |

**Note:** Could switch to TypeScript + Mongoose for better type safety. Current approach prioritizes security over types.

---

## Multi-Tenant Architecture: Single DB vs Separate DBs

### Chosen: Single Database (Shared, Company-Scoped)
**Why:**

#### 1. Operational Simplicity
```env
MONGODB_URL="mongodb://cluster:27017"  # One cluster for all companies
```

- One backup strategy
- One monitoring dashboard
- One cluster to manage
- Easier disaster recovery

#### 2. Cost-Effective
Single cluster can handle hundreds of companies. Separate DBs would mean:
- N databases (expensive)
- N backups
- N monitoring instances

#### 3. Cross-Company Features (Easier)
If company A invites users from company B:
```javascript
// Check both companies' users in single query
const user = await User.findOne({ email, companyId: { $in: [companyA, companyB] } });
```

### Trade-offs:

| Aspect | Shared DB | Separate DBs |
|--------|-----------|--------------|
| **Data Isolation** | ✅ Logical (companyId) | ✅ Physical (separate DB) |
| **Compliance** | ⚠️ Risk if filtering fails | ✅ Guaranteed isolation |
| **Operational Cost** | ✅ Low (1 cluster) | ❌ High (N clusters) |
| **Backup/Recovery** | ✅ Simple | ❌ Complex |
| **Cross-Company Features** | ✅ Easy | ❌ Hard (federation needed) |
| **Performance per Customer** | ⚠️ Noisy neighbors | ✅ Isolated resources |

### Risk Mitigation:
- Enforce companyId in every query (centralized MongoDbCrudOpration)
- Regular security audits
- Test queries without companyId to catch bugs
- Monitoring for unusual access patterns

### Future Option:
As scale increases, could shard by companyId:
```javascript
// Shard key
db.tasks.shardCollection("tasks", { "companyId": 1 });
```

---

## API Versioning Rationale

### Chosen: Explicit Version in URL (`/api/v2/`)
**Why:**

#### 1. Backward Compatibility
Old clients keep using v1:
```
GET /api/v1/projects  → Old response format (always works)
GET /api/v2/projects  → New response format (enhanced)
```

Mobile apps don't break after server update.

#### 2. Clear Deprecation Path
```javascript
// v1 endpoint
app.get('/api/v1/projects', legacyCtrl.list);

// v2 endpoint (newer, better)
app.get('/api/v2/projects', ctrl.list);

// In 6 months: deprecate v1
// In 12 months: remove v1
```

#### 3. No Ambiguity
Client sees version in URL, knows exactly what response format to expect.

### Alternatives Not Chosen:

| Method | Pros | Cons |
|--------|------|------|
| **Header-based** (`Accept: application/vnd.alianhub.v2+json`) | No URL clutter | Clients forget to set header |
| **Query param** (`?version=2`) | Flexible | Easy to miss in requests |
| **Content negotiation** | Standard REST | Complex for clients |

URL-based versioning is explicit and hard to miss.

---

## Frontend State Management: Vuex/Pinia

### Chosen: Pinia (recommended) or Vuex
**Why:**

#### 1. Global State Without Prop Drilling
```javascript
// ❌ Without Pinia: pass through 10 levels of components
<ProjectHeader :project="project">
  <ProjectSidebar :project="project">
    <ProjectList :project="project">
      <TaskItem :project="project" />
    </ProjectList>
  </ProjectSidebar>
</ProjectHeader>

// ✅ With Pinia: components access directly
export default {
  setup() {
    const projectStore = useProjectStore();
    return { project: projectStore.currentProject };
  }
};
```

#### 2. Real-Time Updates
When Socket.io emits `PROJECT_UPDATED`, update store once:
```javascript
socket.on('PROJECT_UPDATED', (data) => {
  projectStore.updateProject(data.projectId, data.changes);
  // All components using this store re-render
});
```

#### 3. Reactive Computed Properties
```javascript
// Auto-updates when store changes
const incompleteTasks = computed(() => {
  return projectStore.tasks.filter(t => !t.completed);
});
```

### Trade-offs:

| Aspect | Vuex | Pinia | Context API |
|--------|------|-------|-------------|
| **Boilerplate** | ⚠️ High | ✅ Low | ✅ Low |
| **DevTools** | ✅ Excellent | ✅ Excellent | ❌ None |
| **Learning Curve** | ❌ Steep | ✅ Easy | ✅ Easy |
| **Performance** | ✅ Good | ✅ Better | ⚠️ Can be slow |
| **TypeScript** | ⚠️ Medium | ✅ Excellent | ✅ Excellent |

Pinia is the modern choice (essentially Vuex 5).

---

## Design Patterns Summary

| Pattern | Used | Why |
|---------|------|-----|
| **Module-Based** | ✅ Yes | Organize by feature, not by layer |
| **Middleware Chain** | ✅ Yes | Express pattern for request processing |
| **Dependency Injection** | ⚠️ Partial | Explicit imports instead of DI container |
| **Factory Pattern** | ⚠️ Partial | Used for creating schema instances |
| **Observer Pattern** | ✅ Yes | Socket.io event listeners |
| **Strategy Pattern** | ✅ Yes | Wasabi vs local storage abstraction |
| **Singleton** | ✅ Yes | Config, logger, database connection |

---

## Performance Considerations

### Caching Strategy
- **In-Memory (node-cache):** Frequent reads (project settings, user roles)
- **Database Indexes:** On companyId, userId, projectId
- **Lazy Loading:** Fetch only needed data

### Database Indexing
```javascript
// Recommended indexes (create in MongoDB)
db.tasks.createIndex({ companyId: 1, projectId: 1 });
db.tasks.createIndex({ companyId: 1, assigneeId: 1 });
db.projects.createIndex({ companyId: 1, createdBy: 1 });
```

### API Response Pagination
```javascript
// Don't return all tasks at once
GET /api/v2/tasks?page=1&limit=20
```

### Image Optimization
Sharp automatically:
- Resizes large uploads
- Converts to efficient formats (WebP)
- Generates thumbnails
