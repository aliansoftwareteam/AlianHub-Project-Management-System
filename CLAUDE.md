# AlianHub Project Management System

Quick reference for development. For detailed guides, see **See Also** section at the bottom.

---

## Working Agreement (Hard Rules for Claude) ⛔

These are **hard rules**. They override default behavior and must be followed exactly.

### Rule 1 — Comments: minimal, or none

- Write a comment **only** when the code cannot carry the intent by itself — a non-obvious **why** (a workaround, an external constraint, a gotcha, a subtle invariant).
- **Never** narrate **what** the code does. No restating the line, no step-by-step play-by-play, no section-banner comments, no decorative dividers, no "TODO for later" notes left in shipped code.
- Prefer a clear name over a comment. If a rename makes the comment redundant, rename and delete the comment.
- When editing existing code, **remove** comments that merely repeat the code. If a comment is not required, delete it.

### Rule 2 — Understand → PRD → implement (applies to *every* task)

For **every** task or defined piece of work, before writing implementation code:

1. **Evaluate** the request. Restate the goal in your own words.
2. **Interview** the user with focused questions whenever anything is unclear or ambiguous. Bundle questions into one turn; ask only what you genuinely cannot resolve yourself.
3. **Answer from the codebase/context first.** Anything directly answerable from the code, docs, or git history — look it up; do not ask the user what you can find.
4. **Write a PRD** once the task is understood — goal, scope, out-of-scope, acceptance criteria — and confirm it before building.
5. **Implement with progress tracking.** Use the `task-manager` skill (`Tasks/` → `task.md` + `progress.md`) to record the definition and update progress as work proceeds.

The `task-manager` skill in [.claude/skills/task-manager/](.claude/skills/task-manager/SKILL.md) is the mechanism for steps 4–5. Task tracking lives in [Tasks/](Tasks/README.md).

---

## What is AlianHub?

**AlianHub** is a self-hosted, open-source project management system designed for teams needing customization, transparency, and data control without vendor lock-in.

- **Self-hosted:** Run on your own servers
- **Highly customizable:** Custom fields, templates, workflows
- **Multi-tenant:** Single instance serves multiple companies
- **Real-time collaboration:** Socket.io LiveSync for instant updates
- **Open-source:** AGPL-3.0 licensed, community-driven

**Target Users:** Enterprises, startups, and teams requiring control, customization, and compliance with data residency requirements.

---

## Quick Start

### Install
```bash
git clone https://github.com/aliansoftwareteam/AlianHub-Project-Management-System.git
cd AlianHub-Project-Management-System
npm install
cp .env.example .env          # Edit .env with your config
npm run nodemon                # Start dev server on port 4000
```

### First Time?
Visit `http://localhost:4000` → Follow installation wizard → Create company & admin user

### Required .env
```env
PORT=4000
MONGODB_URL="mongodb://localhost:27017"
JWT_SECRET="your-random-secret-string"
APIURL="http://localhost:4000/"
STORAGE_TYPE="server"         # or "wasabi" for production
```

See [.env.example](.env.example) for complete configuration options.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│           Web (Vue.js) + Desktop (Electron)             │
└─────────────────────────┬───────────────────────────────┘
                          │
                ┌─────────▼──────────┐
                │  Express API       │
                │  /api/v2/*         │
                │  Socket.io Events  │
                │  JWT Auth          │
                └─────────┬──────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                  ▼
      MongoDB                           Storage
      (company-scoped)                  (Wasabi/Local)
```

**Key Principle:** All data scoped to `companyId` for multi-tenancy safety.

---

## Module Organization

Modules are organized by **feature, not layer**:

```
Modules/FeatureName/
├── controller/          # HTTP request handlers
├── helpers/             # Business logic
├── routes.js            # Endpoint definitions
└── schema.js            # MongoDB schema (if applicable)
```

**Registration pattern:** Each module exports `init(app)` function in routes.js.

---

## Critical Gotchas ⚠️

### 1. Always Include companyId in Queries
```javascript
// ✅ Correct: Company-scoped
MongoDbCrudOpration(companyId, mongoObj, 'findOne');

// ❌ WRONG: Data leak!
Task.findOne({ taskId: 123 });
```

### 2. Never Hardcode Collection Names
```javascript
// ✅ Correct: Use SCHEMA_TYPE enum
{ type: SCHEMA_TYPE.PROJECTS, data: [...] }

// ❌ WRONG: String fails silently
{ type: 'projects', data: [...] }
```

### 3. Emit Socket.io Events After Mutations
```javascript
// ✅ Correct: Broadcast for real-time updates
MongoDbCrudOpration(...).then(result => {
  emitEvent('PROJECT_UPDATED', { projectId: result._id });
  res.json({ status: true, data: result });
});

// ❌ WRONG: Other clients don't see the change
MongoDbCrudOpration(...).then(result => {
  res.json({ status: true, data: result });  // Missing emit
});
```

### 4. Clear Cache After Mutations
```javascript
// ✅ Correct: Remove stale cached data
removeCache(`project:${projectId}`);
removeCache(`projectList:${companyId}`);

// ❌ WRONG: Users see stale data
// (Cache still has old data, no removeCache call)
```

---

## Tech Stack (Quick Reference)

### Backend
- **Express 4.21.2** — HTTP framework
- **MongoDB + Mongoose** — Document database (why: flexible schema, nested documents)
- **Socket.io 4.8.1** — Real-time WebSocket events
- **JWT + bcrypt** — Stateless authentication
- **Winston** — Structured logging
- **Wasabi S3** — File storage (or local filesystem)
- **node-cache** — In-memory caching

### Frontend
- **Vue.js** — Reactive UI
- **Pinia/Vuex** — State management
- **Vue Router** — Client-side routing
- **vue-i18n** — Multi-language support

For detailed rationale, see [.claude/TECH-STACK.md](.claude/TECH-STACK.md).

---

## Common npm Scripts

| Command | Purpose |
|---------|---------|
| `npm run nodemon` | Dev server with hot-reload |
| `npm start` | Production server |
| `npm run check-version` | Check app version |
| `cd frontend && npm run build` | Build Vue.js frontend |

---

## File Organization

| Folder | Purpose |
|--------|---------|
| `Config/` | Configuration (env vars, collections) |
| `Modules/` | Feature modules (50+) |
| `frontend/` | Vue.js app |
| `common-storage/` | File storage abstraction |
| `event/` | Socket.io real-time events |
| `middlewares/` | Express middleware |
| `utils/` | Shared utilities & data files |
| `.claude/` | Claude Code documentation |

See [.claude/FOLDER-STRUCTURE.md](.claude/FOLDER-STRUCTURE.md) for detailed layout.

---

## Code Conventions

### Naming
- **Module folders:** PascalCase (`Modules/Project/`)
- **Files:** camelCase (`getProject.js`, `routes.js`, `helper.js`)
- **Functions:** camelCase (`loginAuth()`, `updateTask()`)
- **Constants:** UPPER_SNAKE_CASE (`SCHEMA_TYPE`, `MAX_FILE_SIZE`)
- **API endpoints:** kebab-case with version (`/api/v2/tasks/create`)

### Response Format (All Endpoints)
```javascript
// Success
{ status: true, statusText: "...", data: {...} }

// Error
{ status: false, statusText: "...", message: "..." }
```

### Error Handling Pattern
```javascript
try {
  // ... logic
} catch (error) {
  req.errorMessageObject = { message: error.message, statusCode: 400 };
  next();  // Passes to error middleware
}
```

See [.claude/CONVENTIONS.md](.claude/CONVENTIONS.md) for full naming guide.

---

## Security Essentials

1. **Always scope to companyId** — All queries must filter by company
2. **Hash passwords with bcrypt** — Never store plain text
3. **Validate input** — Check type, length, enum values at API boundary
4. **Use environment variables** — Never hardcode secrets
5. **Use HTTPS in production** — Protects JWT tokens
6. **Emit after mutations** — Socket.io events for real-time sync

See [.claude/SECURITY-PATTERNS.md](.claude/SECURITY-PATTERNS.md) for detailed practices.

---

## See Also

**Setup & Installation**
- [.claude/SETUP.md](.claude/SETUP.md) — Detailed installation, environment variables, MongoDB setup

**Architecture & Design**
- [.claude/ARCHITECTURE.md](.claude/ARCHITECTURE.md) — System design, data flow, patterns
- [.claude/DESIGN.md](.claude/DESIGN.md) — Why MongoDB? Why Socket.io? Trade-offs explained
- [.claude/TECH-STACK.md](.claude/TECH-STACK.md) — Technology choices and dependencies

**Development Guides**
- [.claude/CONVENTIONS.md](.claude/CONVENTIONS.md) — Code naming, module organization, patterns
- [.claude/FOLDER-STRUCTURE.md](.claude/FOLDER-STRUCTURE.md) — Project layout and file organization
- [.claude/COMMON-TASKS.md](.claude/COMMON-TASKS.md) — How to add features, routes, tests, files

**Best Practices**
- [.claude/SECURITY-PATTERNS.md](.claude/SECURITY-PATTERNS.md) — Security essentials (companyId scoping, JWT, validation)
- [.claude/ANTI-PATTERNS.md](.claude/ANTI-PATTERNS.md) — What NOT to do (with explanations)

**References & Resources**
- [.claude/REFERENCES.md](.claude/REFERENCES.md) — External links, documentation, tools
- [.claude/MEMORY.md](.claude/MEMORY.md) — Persistent memory index

**Historical QA & Audits**
- [.claude/archives/qa-reports/](../.claude/archives/qa-reports/) — QA reports and audits (historical)

---

## Project Stats

- **Tech Stack:** Node.js, Express, MongoDB, Socket.io, Vue.js
- **Modules:** 50+ feature modules
- **Database:** MongoDB (multi-tenant, company-scoped)
- **Authentication:** JWT + OAuth (GitHub, Google)
- **Real-time:** Socket.io with fallbacks
- **Storage:** Wasabi S3 or local filesystem
- **License:** AGPL-3.0 (open-source, copyleft)

---

## Quick Links

| What | Where |
|------|-------|
| **Contribute** | See [CONTRIBUTING.md](CONTRIBUTING.md) |
| **Security Policy** | See [SECURITY.md](SECURITY.md) |
| **GitHub** | https://github.com/aliansoftwareteam/AlianHub-Project-Management-System |
| **Issues** | https://github.com/aliansoftwareteam/AlianHub-Project-Management-System/issues |
| **Docs** | https://help.alianhub.com |

---

**Last Updated:** 2026-05-12  
**Version:** 14.0.26  
**Status:** ✅ Documentation reorganized for Claude Code
