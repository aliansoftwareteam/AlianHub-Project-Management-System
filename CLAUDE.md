# AlianHub Project Management System — Development Guide

## Project Overview

**AlianHub** is a full-stack, open-source project management system designed for teams requiring flexibility, transparency, and self-hosting capabilities without vendor lock-in.

- **Purpose:** Provides an extensible, customizable alternative to SaaS-only project management tools
- **Target Users:** Enterprises, startups, and teams needing control, customization, and self-hosting
- **Core Problem:** Teams want project/task management with real-time collaboration, but SaaS tools lack customization and require data residency compliance
- **Key Differentiators:** 
  - Self-hosted (no vendor lock-in)
  - Highly customizable (custom fields, templates, workflows)
  - Multi-tenant capable (single instance serves multiple companies)
  - Real-time collaboration (Socket.io LiveSync)
  - Open-source (MIT licensed)

---

## Tech Stack

### Backend
- **Runtime:** Node.js
- **Framework:** Express 4.21.2 — HTTP server, routing, middleware
- **Database:** MongoDB with Mongoose 8.17.2 — document-based storage
- **Real-time:** Socket.io 4.8.1 — live updates and event streaming
- **Authentication:** JWT + Firebase Admin SDK + OAuth (GitHub, Google)
- **Security:** bcrypt 5.1.1 — password hashing
- **Logging:** Winston 3.17.0 — structured logging (track.log, error.log, combined.log)

### Storage & Files
- **Primary:** Wasabi (S3-compatible object storage) or local file system
- **AWS SDK:** @aws-sdk/client-s3 v3.864.0 + @aws-sdk/s3-request-presigner
- **Image Processing:** Sharp 0.32.6 — image resizing/optimization
- **File Archive:** archiver 7.0.1 — ZIP creation for exports

### Communication
- **Email:** Nodemailer 6.9.16 (SMTP) or Resend HTTP API (recommended for cloud)
- **Push Notifications:** Firebase Admin SDK (optional, can disable)

### Data & Utilities
- **Date/Time:** Luxon 3.5.0 — timezone-aware date handling
- **Caching:** node-cache 5.1.2 — in-memory cache
- **Scheduling:** node-schedule 2.1.1 — cron jobs
- **Data Parsing:** html-to-text 9.0.5, extract-zip 2.0.1, chargebee 2.19.0
- **API Docs:** swagger-jsdoc 6.2.8 + swagger-ui-express 5.0.1

### Frontend
- **Framework:** Vue.js — reactive UI components
- **Routing:** Vue Router — client-side navigation
- **State Management:** Vuex/Pinia (expected, check frontend/src/store/)
- **Internationalization:** vue-i18n — multi-language support
- **Build Tool:** Webpack (via vue.config.js)

### Desktop
- **Platform:** Electron — cross-platform desktop app

---

## Architecture

### High-Level Design
```
┌─────────────────────────────────────────────────────────┐
│                    Web Clients (Vue.js)                 │
│                   Desktop (Electron)                    │
└───────────┬──────────────────────────────┬──────────────┘
            │                              │
    ┌───────▼───────────────────────────────▼──────┐
    │   API Server (Express.js) — /api/v1, /api/v2 │
    │   - Controllers (50+ modules)                 │
    │   - Routes, Middleware, Error Handling       │
    │   - Socket.io Event Emitter (LiveSync)       │
    │   - Scheduled Tasks (node-schedule)          │
    │   - Authentication (JWT, OAuth, Firebase)    │
    └───────┬──────────────────┬────────────────────┘
            │                  │
    ┌───────▼────────┐    ┌───▼──────────────┐
    │  MongoDB       │    │  Storage Layer   │
    │  (Multi-tenant)│    │  (Wasabi/Server) │
    │  (Company-scoped)   │  (S3-compatible) │
    └────────────────┘    └──────────────────┘
```

### Data Flow

1. **Request:** Client sends HTTP request to `/api/v{version}/endpoint`
2. **Route Matching:** Express routes request to module controller
3. **Business Logic:** Controller (or chained middleware) processes request
4. **Database:** MongoDB query via `MongoDbCrudOpration(companyId, mongoObj, operation)`
5. **Real-time:** Socket.io emits event for other connected clients
6. **Response:** Returns `{ status, statusText, data }`

### Design Patterns

- **Module-Based Organization:** 50+ feature modules, each with routes + controllers + helpers
- **Centralized MongoDB Abstraction:** Single `MongoDbCrudOpration()` function handles all CRUD
- **Company-Scoped Multi-Tenancy:** All queries include `companyId` for data isolation
- **Hybrid Async (Legacy):** Mix of callbacks and Promises (opportunity for modernization)
- **Middleware Chaining:** Routes can chain middleware: `app.post(route, middleware1, middleware2, controller)`
- **Error Propagation:** Errors set `req.errorMessageObject` and call `next()` for custom error middleware
- **Schema-Type Mapping:** Use `SCHEMA_TYPE` enum (not strings) to reference collections

### Key Architectural Decisions

1. **Multi-Tenancy:** Every operation scoped to `companyId` for data isolation and compliance
2. **Centralized Query Handler:** Single abstraction layer prevents SQL-injection-like vulnerabilities and inconsistent patterns
3. **API Versioning:** v1 and v2 endpoints allow backward compatibility during schema changes
4. **Socket.io for LiveSync:** Real-time updates when tasks/projects change (critical for multi-user experiences)
5. **Company-Based Multi-Instance:** Single deployment serves multiple companies (B2B SaaS capability)
6. **Stateless API:** All auth state via JWT (scalable to multiple server instances)
7. **Promise-Based Helpers:** Async business logic supports concurrent operations

---

## Folder Structure

```
AlianHub-Project-Management-System/
│
├── Config/                           # Central configuration
│   ├── config.js                    # Main config object (env variables)
│   ├── env.js                       # Environment variable setup
│   ├── aws.js                       # AWS/Wasabi S3 configuration
│   ├── firebaseConfig.js            # Firebase Admin SDK initialization
│   ├── loggerConfig.js              # Winston logger setup + transports
│   └── collections.js               # MongoDB collection definitions
│
├── Modules/                          # Feature-based modules (50+)
│   ├── auth/                        # Authentication (login, signup, JWT, OAuth)
│   │   ├── controller/              # Individual action handlers
│   │   ├── routes.js                # API endpoint definitions
│   │   ├── helper.js                # Auth utilities (hash, verify, etc.)
│   │   └── init.js                  # Module initialization
│   │
│   ├── Project/                     # Project management core
│   │   ├── controller/              # CRUD: getProjectById, updateProject, etc.
│   │   ├── routes.js                # /api/v2/project/* endpoints
│   │   └── helpers/                 # Shared utilities, MongoDB operations
│   │
│   ├── tasks/                       # Task/work item management
│   │   ├── controller/              # Task CRUD, checklist operations
│   │   ├── helpers/                 # task_class.js, notifications, MongoDB
│   │   ├── routes.js                # /api/v2/tasks/* endpoints
│   │   └── schema.js                # Task data model
│   │
│   ├── Teams/                       # Team collaboration, roles, permissions
│   ├── MainChats/                   # Project/task chat messages
│   ├── Comments/                    # Comments on tasks/projects
│   ├── sprints/                     # Sprint management
│   ├── TimeSheet/                   # Time tracking & time entries
│   ├── AI/                          # AI-powered features
│   ├── SaasAdmin/                   # Admin dashboard, subscriptions
│   ├── notification/                # Real-time notifications
│   ├── MediaFiles/                  # File management & uploads
│   ├── Admin/                       # System administration
│   │   └── common/controller.js     # Shared admin logic
│   │
│   └── [40+ more modules]           # Features: sprints, invoices, affiliate, apps, etc.
│
├── frontend/                         # Vue.js web UI
│   ├── src/
│   │   ├── components/              # Reusable Vue components
│   │   ├── composable/              # Vue 3 composables (stateful logic)
│   │   ├── services/                # API clients (axios instance + endpoints)
│   │   ├── store/                   # Vuex/Pinia state management
│   │   ├── router/
│   │   │   └── index.js             # Vue Router config (routes, guards)
│   │   ├── locales/                 # i18n translation files
│   │   ├── plugins/                 # Vue plugins (tour guides, import tools)
│   │   ├── utils/                   # Client-side utilities
│   │   ├── assets/                  # Images, icons, static files
│   │   ├── App.vue                  # Root component
│   │   └── main.js                  # Entry point
│   ├── public/                      # Static assets
│   ├── package.json
│   ├── vue.config.js
│   ├── babel.config.js
│   └── jsconfig.json
│
├── installation/                    # Installation wizard (Vue.js)
│   ├── src/                         # Setup form components
│   ├── package.json
│   ├── vue.config.js
│   └── babel.config.js
│
├── common-storage/                  # Storage abstraction layer
│   ├── common.js                    # Base storage interface
│   ├── common-server.js             # Server-side storage operations
│   └── common-wasabi.js             # Wasabi S3 implementation
│
├── event/                           # Real-time events
│   └── socketEventEmitter.js        # Socket.io event handlers (LiveSync)
│
├── middlewares/                     # Express middleware
│   └── mongoConnector/              # MongoDB connection handler
│
├── utils/                           # Shared utilities & static data
│   ├── aiPrompts.json               # AI prompt templates
│   ├── projectTemplates.json        # Default project templates
│   ├── currency.json                # Currency definitions
│   ├── timezone.json                # Timezone data
│   └── [other data files]
│
├── docs/                            # Documentation
│   └── qa-reports/                  # QA reports, audits, test results
│
├── .github/
│   └── PULL_REQUEST_TEMPLATE/       # PR templates (feature, bugfix, refactor)
│
├── index.js                         # Express server (development entry point)
├── server.js                        # Express server (production entry point)
├── installation.js                  # Setup & initialization script
├── cron.js                          # Scheduled tasks runner
├── check-version.js                 # Version checking utility
│
├── .env.example                     # Environment variables template (REQUIRED)
├── .gitignore
├── Dockerfile                       # Docker container config
├── docker-compose.yml               # Multi-service orchestration
├── package.json                     # Root dependencies
├── package-lock.json
│
└── README.md                        # Project overview & quick start
```

**Key Observations:**
- Modules use PascalCase folder names (`Auth/`, `Project/`, `Teams/`)
- Files within modules use camelCase (`controller.js`, `routes.js`, `helper.js`)
- Each module typically has: `controller/`, `routes.js`, `helpers/`
- Routes are registered via `exports.init(app)` pattern
- Config is centralized; all env vars go through Config/

---

## Setup & Commands

### Installation

```bash
# 1. Clone repository
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System

# 2. Install root dependencies (also installs frontend & installation UI)
npm install

# 3. Copy environment template and configure
cp .env.example .env
# Edit .env with your values (see Required Variables below)

# 4. Start MongoDB (if local)
# Ensure MongoDB is running on mongodb://localhost:27017 or set MONGODB_URL in .env

# 5. Start development server
npm run nodemon

# 6. Frontend will auto-serve from index.js
# Visit http://localhost:4000
```

### npm Scripts

| Command | Purpose |
|---------|---------|
| `npm start` | Run production server (node server.js) |
| `npm run nodemon` | Run dev server with hot-reload (node index.js) |
| `npm run check-version` | Check app version compatibility |
| `npm run basic-install` | One-shot: install dependencies + start server |

### Sub-Package Scripts

```bash
# Frontend (in frontend/ directory)
cd frontend
npm install
npm run build          # Build for production (creates dist/)
npm run serve          # Dev server (if configured)

# Installation UI (in installation/ directory)
cd installation
npm install
npm run build          # Build setup wizard (creates dist/)
```

### Required Environment Variables

Create a `.env` file (copy from `.env.example`) with these **critical** variables:

**Server Setup:**
```env
PORT=4000
NODE_ENV=development              # development | production
APP_NAME="AlianHub"
UNDER_MAINTENANCE="false"
```

**Database (Required):**
```env
MONGODB_URL="mongodb://localhost:27017"    # No trailing slash
```

**Authentication (Required):**
```env
JWT_SECRET="your_jwt_secret_here"         # Use a strong random string
JWT_EXP="24h"
JWT_ALGORITHM="HS256"
```

**URLs:**
```env
APIURL="http://localhost:4000/"
WEBURL="http://localhost:4000"
```

**Storage (Choose one):**
```env
# Option A: Wasabi S3-compatible storage (recommended)
STORAGE_TYPE="wasabi"
WASABI_ACCESS_KEY="..."
WASABI_SECRET_ACCESS_KEY="..."
WASABI_USERID="..."
WASABIENDPOINT="https://s3.wasabisys.com"
WASABI_REGION="us-east-1"
USERPROFILEBUCKET="your-bucket-name"
IAM_ENDPOINT="https://iam.wasabisys.com"

# Option B: Local file system
STORAGE_TYPE="server"
```

**Email (Choose one):**
```env
# Option A: SMTP (Nodemailer)
NODEMAILER_HOST="smtp.gmail.com"
NODEMAILER_PORT="587"
NODEMAILER_EMAIL="your@email.com"
NODEMAILER_EMAIL_PASSWORD="your_app_password"    # Gmail app password

# Option B: Resend HTTP API (recommended for cloud)
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="noreply@yourdomain.com"
```

**Firebase (Optional — for push notifications):**
```env
SERVICE_FILE="../firebase-adminsdk.json"
APIKEY="..."
PROJECTID="..."
STORAGEBUCKET="..."
MESSAGINGSENDERID="..."
APPID="..."
```

**AI Integration (Optional):**
```env
AI_API_KEY="..."
AI_MODEL="..."
```

**Other:**
```env
NOOFPRESETCOMPANY=10
PRECOMPANYKEY="your_preset_key"
ERRORRECIVEREMAIL="admin@yourdomain.com"
```

---

## Coding Conventions

### Folder Organization

**Module Structure:**
Each feature lives in a dedicated folder under `Modules/`:

```
Modules/[FeatureName]/
├── controller/                      # Request handlers
│   ├── action1.js
│   ├── action2.js
│   └── helper.js
├── routes.js                        # API endpoint registration
├── helpers/                         # Business logic (if complex)
│   ├── helper.js
│   ├── mongo_helper.js
│   └── task_class.js
├── schema.js                        # Mongoose schema (if needed)
└── init.js                          # Module initialization
```

**Rules:**
- Put HTTP request handlers in `controller/`
- Put business logic in `helpers/`
- Register all routes in `routes.js` via `exports.init(app) { ... }`
- Use `SCHEMA_TYPE` enum (in Config/collections.js) for MongoDB collection references

### File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Module folder | PascalCase | `Modules/Project/`, `Modules/MainChats/` |
| Controller file | camelCase | `getProjectById.js`, `updateTask.js` |
| Routes file | `routes.js` | (consistent across all modules) |
| Helper file | camelCase | `helper.js`, `mongo_operations.js` |
| Utility file | kebab-case or camelCase | `mongo-handler.js`, `taskHelper.js` |
| API endpoint | kebab-case + version | `/api/v2/tasks/create`, `/api/v1/projects/list` |

### Naming Conventions (Code)

```javascript
// Variables
const companyId = req.params.companyId;      // camelCase
const userData = { name: "John" };
let projectList = [];

// Functions
function loginAuth(req, res) { }             // camelCase
exports.updateProject = (req, res) => { };

// Constants
const SCHEMA_TYPE = { PROJECTS: 'projects' }; // UPPER_SNAKE_CASE
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// Exports
exports.loginAuth = ...;                     // Named exports
exports.verifyAuth = ...;

// Classes
class Task {                                  // PascalCase
  constructor(id, name) { }
}

// Routes
app.post('/api/v2/tasks/create', ctrl.createTask);   // kebab-case
app.get('/api/v2/projects/:id/details', ctrl.getProjectDetails);
```

### Module Organization Rules

1. **Always include companyId:** Every route handler must receive `companyId` (from req.params or req.body) and pass it to MongoDB queries.
2. **Use MongoDbCrudOpration():** Don't write raw Mongoose queries. All queries go through this abstraction:
   ```javascript
   const result = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
   ```
3. **Handle errors consistently:**
   ```javascript
   try {
     // ... logic
     res.status(200).json({ status: true, statusText: "Success", data: result });
   } catch (error) {
     req.errorMessageObject = { message: error.message, statusCode: 400 };
     next();  // Pass to error middleware
   }
   ```
4. **Emit Socket.io events for real-time updates:**
   ```javascript
   // After updating a project, notify other clients
   require('../event/socketEventEmitter').emitEvent('PROJECT_UPDATED', { projectId, data });
   ```

### State Management & Data Flow

**Frontend:**
- Vuex/Pinia stores for global state (one store per feature)
- Composables for reusable stateful logic
- API services (axios) for HTTP communication

**Backend:**
- Request handler (controller) → Business logic (helper) → MongoDB (via MongoDbCrudOpration)
- Cache invalidation via `removeCache(key)` after mutations
- Real-time via Socket.io event emission

### API/Data Fetching Patterns

**Express Controller Pattern:**
```javascript
exports.getProject = (req, res, next) => {
  try {
    const { companyId, projectId } = req.params;
    
    const mongoObj = {
      type: SCHEMA_TYPE.PROJECTS,
      data: [{ _id: projectId }]
    };
    
    MongoDbCrudOpration(companyId, mongoObj, 'findOne')
      .then(project => {
        res.status(200).json({
          status: true,
          statusText: "Project retrieved successfully",
          data: project
        });
      })
      .catch(error => {
        req.errorMessageObject = { message: error.message };
        next();
      });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

**Response Format (All Endpoints):**
```javascript
// Success (200)
{
  status: true,
  statusText: "Human-readable success message",
  data: { /* actual payload */ }
}

// Error (400/500)
{
  status: false,
  statusText: "Error description",
  message: "Alternative error message field"
}
```

**HTTP Status Codes:**
- `200` — Success (data returned)
- `400` — Client error (validation, missing fields)
- `401` — Unauthorized (invalid JWT)
- `403` — Forbidden (insufficient permissions)
- `500` — Server error (database, logic failures)

### Styling Approach

**Frontend:**
- Vue scoped styles (component-level CSS)
- Likely uses a CSS framework (Bootstrap, Tailwind, or custom)
- Responsive design (mobile-first)
- Class naming (BEM or utility-based)

**Backend:**
- No styling (API only)
- Winston logs styled for readability

---

## Key Files Reference

| File | Purpose |
|------|---------|
| **index.js** | Express server (dev), routes initialization, CORS setup |
| **server.js** | Express server (prod), optimized for deployment |
| **Config/config.js** | Global configuration object (all env vars) |
| **Config/collections.js** | MongoDB collection definitions + SCHEMA_TYPE |
| **Modules/auth/routes.js** | Auth API endpoints (/api/v2/auth/*) |
| **Modules/Project/controller/** | Project CRUD operations |
| **Modules/tasks/helpers/helper.js** | Task logic, history tracking, notifications |
| **event/socketEventEmitter.js** | Socket.io real-time event broadcasting |
| **common-storage/common.js** | Storage abstraction (S3/local file system) |
| **frontend/src/App.vue** | Root Vue component, main layout |
| **frontend/src/router/index.js** | Vue Router configuration (pages, guards) |

---

## Common Tasks

### Adding a New Feature/Module

1. **Create module folder:**
   ```bash
   mkdir Modules/MyFeature
   mkdir Modules/MyFeature/controller
   mkdir Modules/MyFeature/helpers
   ```

2. **Create controller** (`Modules/MyFeature/controller/action.js`):
   ```javascript
   exports.getMyData = (req, res, next) => {
     try {
       const { companyId } = req.params;
       const mongoObj = { type: SCHEMA_TYPE.MYFEATURE, data: [{}] };
       
       MongoDbCrudOpration(companyId, mongoObj, 'find')
         .then(data => res.json({ status: true, data }))
         .catch(err => { req.errorMessageObject = {...}; next(); });
     } catch (error) { /* ... */ }
   };
   ```

3. **Create routes** (`Modules/MyFeature/routes.js`):
   ```javascript
   const ctrl = require('./controller/action.js');
   
   exports.init = (app) => {
     app.get('/api/v2/myfeature/data', ctrl.getMyData);
     app.post('/api/v2/myfeature/create', ctrl.createMyData);
   };
   ```

4. **Register in server** (in `index.js` or `server.js`):
   ```javascript
   const myFeatureRoutes = require('./Modules/MyFeature/routes.js');
   myFeatureRoutes.init(app);
   ```

5. **Add MongoDB schema** (in `Config/collections.js` if needed):
   ```javascript
   const dbCollections = {
     // ... existing
     MYFEATURE: 'myfeature'
   };
   ```

### Adding a New API Route

1. Create controller function in appropriate module
2. Register route in module's `routes.js`
3. Follow response format: `{ status, statusText, data }`
4. Use try-catch with error middleware propagation

Example:
```javascript
// In Modules/tasks/controller/createTask.js
exports.createTask = (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { taskData } = req.body;
    
    const mongoObj = {
      type: SCHEMA_TYPE.TASKS,
      data: [{ ...taskData }]  // Mongoose will auto-generate _id
    };
    
    MongoDbCrudOpration(companyId, mongoObj, 'save')
      .then(task => {
        // Emit Socket.io event for real-time sync
        require('../event/socketEventEmitter').emitEvent('TASK_CREATED', { task });
        
        res.status(200).json({
          status: true,
          statusText: "Task created successfully",
          data: task
        });
      })
      .catch(error => {
        req.errorMessageObject = { message: error.message };
        next();
      });
  } catch (error) {
    req.errorMessageObject = { message: error.message };
    next();
  }
};
```

### Adding a New Database Model

1. **Define collection** in `Config/collections.js`:
   ```javascript
   const dbCollections = {
     // ... existing
     CUSTOMFIELDS: 'customFields'
   };
   
   const SCHEMA_TYPE = {
     CUSTOMFIELDS: 'CUSTOMFIELDS'
   };
   ```

2. **Create Mongoose schema** (e.g., `Modules/customField/schema.js`):
   ```javascript
   const mongoose = require('mongoose');
   
   const customFieldSchema = new mongoose.Schema({
     _id: mongoose.Schema.Types.ObjectId,
     name: String,
     type: String,  // text, number, dropdown, etc.
     companyId: mongoose.Schema.Types.ObjectId,
     projectId: mongoose.Schema.Types.ObjectId
   });
   
   module.exports = mongoose.model('customFields', customFieldSchema);
   ```

3. **Use in queries:**
   ```javascript
   const mongoObj = {
     type: SCHEMA_TYPE.CUSTOMFIELDS,
     data: [{ companyId, projectId }]
   };
   
   MongoDbCrudOpration(companyId, mongoObj, 'find');
   ```

### Adding Tests

**Current Status:** No test framework configured (see package.json).

**Recommendation:** Add Jest + Supertest
```bash
npm install --save-dev jest supertest
```

**Test Structure:**
```
tests/
├── unit/
│   └── auth.test.js
├── integration/
│   └── projects.test.js
└── fixtures/
    └── mockData.js
```

**Example Test:**
```javascript
const request = require('supertest');
const app = require('../index.js');

describe('Projects API', () => {
  test('GET /api/v2/projects should return list', async () => {
    const res = await request(app)
      .get('/api/v2/projects')
      .set('Authorization', 'Bearer ' + validToken);
    
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe(true);
    expect(res.body.data).toBeInstanceOf(Array);
  });
});
```

Add script in `package.json`:
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  }
}
```

---

## Gotchas & Non-Obvious Patterns

### 1. Multi-Tenancy is Pervasive ⚠️
Every MongoDB query **must** include `companyId`. Omitting it is a **security risk** — it will leak data across companies.

**Right:**
```javascript
const result = await MongoDbCrudOpration(companyId, mongoObj, 'findOne');
```

**Wrong (data leak!):**
```javascript
Task.findOne({ taskId: 123 });  // Missing company scoping
```

### 2. Mixed Async Patterns
Code uses both **callbacks** (legacy) and **Promises** (modern). Be aware when reading/refactoring.

**Legacy (callback):**
```javascript
exports.verifyAuth(req.body, (result) => { /* handle */ });
```

**Modern (Promise):**
```javascript
MongoDbCrudOpration(...).then(result => { /* ... */ });
```

**Modern (async-await):**
```javascript
const result = await MongoDbCrudOpration(...);
```

### 3. Schema Type Mapping
Don't hardcode collection names as strings. Use the `SCHEMA_TYPE` enum:

**Right:**
```javascript
const mongoObj = { type: SCHEMA_TYPE.PROJECTS, data: [...] };
```

**Wrong (fails silently):**
```javascript
const mongoObj = { type: 'projects', data: [...] };  // String not recognized
```

### 4. Error Handling via Middleware
Errors aren't thrown — they're set on `req.errorMessageObject` and `next()` is called:

```javascript
// Controller
try {
  // ... logic
} catch (error) {
  req.errorMessageObject = { message: error.message, statusCode: 400 };
  next();  // Passes to error middleware, which formats response
}
```

This pattern allows centralized error handling but differs from typical Express error-first callbacks.

### 5. Cache Invalidation
Many operations call `removeCache(key)` after mutations. Forgetting this causes stale data:

```javascript
// After updating a project
const cacheKey = `project:${projectId}`;
removeCache(cacheKey);  // Clear from in-memory cache
```

Check helper files for cache patterns.

### 6. Socket.io Real-Time Events
Updates to tasks/projects trigger Socket.io broadcasts. If you add a mutation, ensure you emit an event:

```javascript
// After task update
require('../event/socketEventEmitter').emitEvent('TASK_UPDATED', {
  taskId,
  projectId,
  changes: updatedFields
});
```

Failure to emit means other clients won't see the change (broken LiveSync).

### 7. API Versioning
AlianHub has **both v1 and v2 endpoints**. Don't mix versions in a single endpoint:

**Right:**
```javascript
app.get('/api/v2/projects/:id', ctrl.getProject);
```

**Wrong (mixing versions):**
```javascript
app.get('/api/v1/projects/:id', ctrl.getProject);  // Inconsistent
```

v2 is preferred for new routes.

### 8. Wasabi vs Local Storage
The `STORAGE_TYPE` config switches between Wasabi (S3) and local files. Different code paths for uploads/downloads. Check `common-storage/` for implementation.

```env
STORAGE_TYPE="wasabi"    # Use Wasabi (S3-compatible)
# OR
STORAGE_TYPE="server"    # Use local filesystem
```

### 9. Company Setup via Installation Wizard
When AlianHub is first deployed, the installation wizard creates an initial company. All subsequent operations must reference that company's ID. Don't hardcode company IDs — always use the one from the authenticated request.

### 10. No Test Suite (Currently)
Project has no automated tests configured. This is a gap. As you add features, consider adding Jest + Supertest tests to prevent regressions.

---

## What to Avoid

### Security & Data Integrity
- ❌ **Don't bypass companyId:** All queries must be scoped to prevent data leaks
- ❌ **Don't hardcode API URLs:** Use config values (`APIURL`, `WEBURL` from env)
- ❌ **Don't skip input validation:** Validate user input at API boundaries

### Code Patterns
- ❌ **Don't duplicate MongoDB logic:** Always use `MongoDbCrudOpration()` abstraction
- ❌ **Don't use string collection names:** Use `SCHEMA_TYPE` enum instead
- ❌ **Don't create global state:** Use proper state management (stores, modules)
- ❌ **Don't mix callback and Promise styles:** Standardize on async-await going forward

### Real-Time & Caching
- ❌ **Don't skip Socket.io events:** If data changes, emit an event for LiveSync
- ❌ **Don't skip cache invalidation:** Call `removeCache()` after mutations
- ❌ **Don't modify frontend without building:** Changes in `frontend/src/` need `npm run build`

### Code Quality
- ❌ **Don't write long controller functions:** Keep controllers thin, move logic to helpers
- ❌ **Avoid deprecated areas:** Check docs/ for deprecated endpoints/modules
- ❌ **Don't hardcode thresholds/limits:** Use config for MAX_FILE_SIZE, pagination limits, etc.

### Environment & Deployment
- ❌ **Don't ignore .env requirements:** Always check `.env.example` before deploying
- ❌ **Don't commit secrets:** Use env variables for API keys, credentials, tokens
- ❌ **Don't assume MongoDB is local:** Always reference MONGODB_URL from env

---

## Additional Resources

- **Official Documentation:** https://help.alianhub.com
- **Live Demo:** https://demo.alianhub.com
- **GitHub Repository:** https://github.com/aliansoftwareteam/AlianHub-Project-Management-System
- **Contributing Guide:** [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Security Policy:** [SECURITY.md](./SECURITY.md)
- **Code of Conduct:** [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

---

**Last Updated:** 2026-05-11  
**Version:** 14.0.26
