# Folder Structure

**[← Back to main guide](../CLAUDE.md)**

## Project Root Layout

```
AlianHub-Project-Management-System/
│
├── Config/                              # Central configuration
│   ├── config.js                        # Main config object (loads .env)
│   ├── env.js                           # Environment variable setup
│   ├── aws.js                           # AWS/Wasabi S3 configuration
│   ├── firebaseConfig.js                # Firebase Admin SDK init
│   ├── loggerConfig.js                  # Winston logger setup
│   └── collections.js                   # MongoDB collection definitions + SCHEMA_TYPE enum
│
├── Modules/                             # Feature-based modules (50+)
│   ├── auth/                            # Authentication & JWT
│   │   ├── controller/
│   │   │   ├── loginAuth.js
│   │   │   ├── registerAuth.js
│   │   │   └── helper.js
│   │   ├── routes.js
│   │   ├── routes2.js
│   │   ├── helpers/
│   │   ├── schema.js
│   │   └── init.js
│   │
│   ├── Project/                         # Project management
│   │   ├── controller/
│   │   ├── routes.js
│   │   ├── helpers/
│   │   └── schema.js
│   │
│   ├── tasks/                           # Task/work item management
│   │   ├── controller/
│   │   ├── routes.js
│   │   ├── helpers/
│   │   ├── schema.js
│   │   └── task_class.js
│   │
│   ├── Teams/                           # Team & role management
│   ├── MainChats/                       # Project/task chat
│   ├── Comments/                        # Comments on items
│   ├── sprints/                         # Sprint management
│   ├── TimeSheet/                       # Time tracking
│   ├── AI/                              # AI features
│   ├── SaasAdmin/                       # Admin dashboard
│   ├── notification/                    # Notifications
│   ├── MediaFiles/                      # File management
│   ├── Admin/                           # System administration
│   │   └── common/controller.js
│   │
│   └── [40+ more modules]               # Features: templates, invoices, apps, etc.
│
├── frontend/                            # Vue.js web UI (SPA)
│   ├── src/
│   │   ├── components/                  # Reusable Vue components
│   │   ├── composable/                  # Vue 3 composables
│   │   ├── services/                    # API clients (axios)
│   │   ├── store/                       # Vuex/Pinia state management
│   │   ├── router/
│   │   │   └── index.js                 # Route definitions & guards
│   │   ├── locales/                     # i18n translations
│   │   ├── plugins/                     # Vue plugins
│   │   ├── utils/                       # Client-side helpers
│   │   ├── assets/                      # Images, icons, fonts
│   │   ├── App.vue                      # Root component
│   │   └── main.js                      # Entry point
│   ├── public/                          # Static assets (served as-is)
│   ├── dist/                            # Built output (gitignored)
│   ├── package.json
│   ├── vue.config.js
│   ├── babel.config.js
│   └── jsconfig.json
│
├── installation/                        # Setup wizard (separate Vue app)
│   ├── src/                             # Setup form components
│   ├── dist/                            # Built output (gitignored)
│   ├── package.json
│   ├── vue.config.js
│   └── babel.config.js
│
├── common-storage/                      # Storage abstraction layer
│   ├── common.js                        # Base interface
│   ├── common-server.js                 # Local filesystem implementation
│   └── common-wasabi.js                 # Wasabi S3 implementation
│
├── event/                               # Real-time events
│   └── socketEventEmitter.js            # Socket.io event handlers
│
├── middlewares/                         # Express middleware
│   └── mongoConnector/                  # MongoDB connection handler
│
├── utils/                               # Shared utilities & data
│   ├── aiPrompts.json                   # AI prompt templates
│   ├── projectTemplates.json            # Default project templates
│   ├── currency.json                    # Currency definitions
│   ├── timezone.json                    # Timezone data
│   └── [other data files]
│
├── docs/                                # Documentation
│   └── qa-reports/                      # QA audit reports
│
├── .github/
│   ├── PULL_REQUEST_TEMPLATE/           # PR templates
│   └── workflows/                       # CI/CD pipelines
│
├── .claude/                             # Claude Code context
│   ├── ARCHITECTURE.md                  # Architecture guide
│   ├── CONVENTIONS.md                   # Coding conventions
│   ├── TECH-STACK.md                    # Technology stack
│   ├── SETUP.md                         # Installation guide
│   ├── FOLDER-STRUCTURE.md              # This file
│   ├── COMMON-TASKS.md                  # How-to guides
│   ├── SECURITY-PATTERNS.md             # Security best practices
│   ├── ANTI-PATTERNS.md                 # What NOT to do
│   ├── DESIGN.md                        # Design philosophy
│   ├── REFERENCES.md                    # External links
│   ├── MEMORY.md                        # Memory files index
│   ├── memory/                          # Persistent memory
│   ├── archives/qa-reports/             # Historical QA reports
│   ├── tests/                           # Test result records
│   ├── settings.local.json              # Local project settings
│   └── launch.json                      # Dev server config (if needed)
│
├── index.js                             # Express server (dev entry point)
├── server.js                            # Express server (prod entry point)
├── installation.js                      # Setup & initialization script
├── cron.js                              # Scheduled tasks runner
├── check-version.js                     # Version checking utility
│
├── .env.example                         # Environment template (REQUIRED)
├── .gitignore                           # Git ignore rules
├── Dockerfile                           # Docker image config
├── docker-compose.yml                   # Docker multi-service setup
├── package.json                         # Root dependencies
├── package-lock.json                    # Locked dependency versions
│
├── README.md                            # Project overview
├── CLAUDE.md                            # Claude Code project guide
├── CONTRIBUTING.md                      # Contribution guidelines
├── SECURITY.md                          # Security policy
├── LICENSE                              # AGPL-3.0 license
└── COPYRIGHT                            # Copyright notice
```

## Key Folder Purposes

### Config/
**Purpose:** Centralized configuration management  
**Rule:** All environment variables loaded here, exported globally  
**Never put:** Secrets (use .env instead), temporary files, test data

**Key file:** `collections.js` defines SCHEMA_TYPE enum — all MongoDB queries reference this

### Modules/
**Purpose:** Feature-based organization (one feature = one folder)  
**Structure:** Each module has controller/, routes.js, helpers/, schema.js  
**Rule:** PascalCase folder names, camelCase files  
**Never put:** Global utilities (use utils/ instead), configuration (use Config/)

### frontend/
**Purpose:** Vue.js single-page application  
**Build output:** frontend/dist/ (created by `npm run build`)  
**Never modify:** dist/ (auto-generated), node_modules/  
**Rule:** Use environment variables for API URLs (avoid hardcoding)

### installation/
**Purpose:** Separate Vue app for initial setup wizard  
**Run when:** App first starts (user not yet configured)  
**Never put:** Production code here (it's only for setup)

### common-storage/
**Purpose:** Storage abstraction layer  
**Implementations:** Wasabi (cloud), local filesystem (dev)  
**How to use:** Import and use without caring which backend is active  
**Rule:** All file uploads/downloads go through this

### event/
**Purpose:** Real-time event broadcasting  
**Key file:** socketEventEmitter.js (Socket.io emits)  
**Rule:** After mutations, emit corresponding event for LiveSync

### middlewares/
**Purpose:** Express middleware (request processing)  
**Examples:** Authentication, logging, error handling, CORS  
**Rule:** Middleware is chained in routes before controller

### utils/
**Purpose:** Shared utilities and static data  
**Examples:** Currency definitions, timezone data, AI prompts  
**Never put:** Business logic (use Modules/), configuration (use Config/)

---

## What NOT to Put Where

| Item | ❌ Wrong | ✅ Right |
|------|---------|---------|
| Environment vars | Hardcoded in code | Config/config.js (load from .env) |
| Secrets | Committed to Git | .env file (in .gitignore) |
| Business logic | In routes.js | In helpers/ folder |
| HTTP handlers | In helpers/ | In controller/ folder |
| Constants | Hardcoded | UPPER_SNAKE_CASE in collections.js |
| Utilities | In modules | In utils/ folder |
| Global middleware | In module | In middlewares/ folder |
| Static data | In code | In utils/ JSON files |

---

## Runtime-Generated Folders (Should be .gitignored)

These folders are created at runtime and should NOT be committed:

| Folder | Purpose | gitignore Status |
|--------|---------|------------------|
| `node_modules/` | Installed dependencies | ✅ Ignored |
| `frontend/dist/` | Built frontend | ✅ Ignored |
| `installation/dist/` | Built setup wizard | ✅ Ignored |
| `log/` | Runtime logs (track.log, error.log) | ⚠️ Should be ignored |
| `wasabiUploads/` | Local file cache | ⚠️ Should be ignored |
| `wasabiUploadsLocal/` | Wasabi file cache | ⚠️ Should be ignored |
| `thumbnails/` | Generated image thumbnails | ⚠️ Should be ignored |

**Recommendation:** Add to .gitignore:
```
log/
wasabiUploads/
wasabiUploadsLocal/
thumbnails/
```

---

## File Naming Summary

| Type | Convention | Examples |
|------|-----------|----------|
| Module folder | PascalCase | Project/, Tasks/, Teams/ |
| Controller file | camelCase | loginAuth.js, getProject.js |
| Routes file | routes.js | Consistent name |
| Helper file | camelCase | helper.js, task_class.js |
| Config file | camelCase | config.js, loggerConfig.js |
| API endpoint | kebab-case | /api/v2/tasks/create |

---

## Finding Code Patterns

**Need to find something?**

| What | Where to Look |
|------|----------------|
| API endpoint | Modules/*/routes.js |
| Request handler | Modules/*/controller/*.js |
| Business logic | Modules/*/helpers/*.js |
| MongoDB schema | Modules/*/schema.js or Config/collections.js |
| Configuration | Config/ folder |
| Authentication | Modules/auth/ |
| Frontend component | frontend/src/components/ |
| Socket.io events | event/socketEventEmitter.js |
| Error handling | Middleware chain in index.js / server.js |
