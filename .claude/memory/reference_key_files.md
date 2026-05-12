---
name: AlianHub Key Files Reference
description: Important file paths and their purposes for quick lookup
type: reference
---

# Key Files & Purposes

## Entry Points
- `index.js` — Development server entry point (port 4000, hot-reload)
- `server.js` — Production server entry point
- `installation.js` — Setup wizard initialization
- `cron.js` — Scheduled tasks runner

## Configuration
- `Config/config.js` — Main configuration object (loads .env)
- `Config/collections.js` — MongoDB collection definitions + SCHEMA_TYPE enum
- `Config/aws.js` — Wasabi/AWS S3 configuration
- `Config/firebaseConfig.js` — Firebase Admin SDK setup
- `Config/loggerConfig.js` — Winston logger configuration
- `.env.example` — Environment variables template (REQUIRED to copy)

## Modules (50+)
- `Modules/auth/routes.js` — Authentication endpoints (login, register, forgot password)
- `Modules/auth/routes2.js` — Additional auth (OAuth, email verification)
- `Modules/Project/` — Project management
- `Modules/tasks/` — Task/work item management
- `Modules/Teams/` — Team & role management
- `Modules/MainChats/` — Project/task chat messages
- `Modules/Comments/` — Comments on tasks/projects
- `Modules/TimeSheet/` — Time tracking

## Critical Utilities
- `middlewares/mongoConnector/` — MongoDB connection handler + MongoDbCrudOpration function
- `event/socketEventEmitter.js` — Socket.io real-time event broadcaster
- `common-storage/common.js` — File upload abstraction (Wasabi/local)
- `common-storage/common-server.js` — Local filesystem implementation
- `common-storage/common-wasabi.js` — Wasabi S3 implementation

## Frontend (Vue.js)
- `frontend/src/App.vue` — Root component
- `frontend/src/main.js` — Webpack entry point
- `frontend/src/router/index.js` — Vue Router configuration (routes, guards)
- `frontend/src/store/` — Vuex/Pinia store (global state)
- `frontend/src/components/` — Reusable Vue components
- `frontend/src/services/` — API client (axios instances)
- `frontend/src/locales/` — i18n translation files
- `frontend/src/utils/` — Client-side helper functions
- `frontend/vue.config.js` — Webpack configuration
- `frontend/package.json` — Frontend dependencies

## Installation UI
- `installation/src/` — Setup wizard Vue components
- `installation/vue.config.js` — Wizard Webpack build config
- `installation/package.json` — Wizard dependencies

## Documentation
- `README.md` — Project overview & quick start
- `CONTRIBUTING.md` — How to contribute
- `SECURITY.md` — Security policy & vulnerability reporting
- `CLAUDE.md` — Claude Code project guide (main entry point)

## Utilities & Data
- `utils/aiPrompts.json` — AI prompt templates
- `utils/projectTemplates.json` — Default project templates
- `utils/currency.json` — Currency definitions
- `utils/timezone.json` — Timezone data

## Logs (Runtime-Generated)
- `log/track.log` — Application events
- `log/error.log` — Errors only
- `log/combined.log` — All logs

## Package Management
- `package.json` — Root dependencies (Express, Mongoose, Socket.io, etc.)
- `package-lock.json` — Locked dependency versions
- `frontend/package.json` — Frontend dependencies (Vue.js, Vue Router, Pinia, etc.)
- `installation/package.json` — Setup wizard dependencies

## Docker
- `Dockerfile` — Container image configuration
- `docker-compose.yml` — Multi-service setup (app + MongoDB)

## .claude Folder (Project Context)
- `.claude/CLAUDE.md` — Replaced by modular structure below
- `.claude/ARCHITECTURE.md` — System design & data flow
- `.claude/CONVENTIONS.md` — Code naming & organization
- `.claude/TECH-STACK.md` — Technology decisions
- `.claude/SETUP.md` — Installation guide
- `.claude/FOLDER-STRUCTURE.md` — Project layout
- `.claude/COMMON-TASKS.md` — How-to guides
- `.claude/SECURITY-PATTERNS.md` — Security best practices
- `.claude/ANTI-PATTERNS.md` — What NOT to do
- `.claude/DESIGN.md` — Design philosophy
- `.claude/REFERENCES.md` — External links
- `.claude/MEMORY.md` — Memory index (this file)
- `.claude/memory/` — Persistent memory files
- `.claude/settings.local.json` — Local Claude settings

## Quick File Lookups
| What | Where |
|------|-------|
| API endpoint | Modules/*/routes.js |
| HTTP handler | Modules/*/controller/*.js |
| Business logic | Modules/*/helpers/*.js |
| MongoDB schema | Modules/*/schema.js |
| Configuration | Config/ folder |
| Storage logic | common-storage/ folder |
| Real-time events | event/socketEventEmitter.js |
| Error handling | Middleware chain (index.js/server.js) |
| Frontend component | frontend/src/components/ |
| Frontend store | frontend/src/store/ |
