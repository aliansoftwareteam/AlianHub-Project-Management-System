# Technology Stack

**[← Back to main guide](../CLAUDE.md)**

## Backend (Node.js + Express)

### Core Framework
| Package | Version | Purpose |
|---------|---------|---------|
| **Express** | 4.21.2 | HTTP server, routing, middleware |
| **Node.js** | 18+ | JavaScript runtime |

Express is lightweight and perfect for AlianHub's modular architecture with 50+ feature modules. It handles request routing, middleware chaining, and error handling.

### Database & ORM
| Package | Version | Purpose |
|---------|---------|---------|
| **MongoDB** | Latest | NoSQL document database |
| **Mongoose** | 8.17.2 | MongoDB ODM and schema management |

**Why MongoDB?** Document-based storage is ideal for AlianHub because:
- Schema flexibility for custom fields
- Easy sub-documents (tasks within projects)
- Strong multi-tenancy support (companyId scoping)
- Horizontal scaling capability

### Real-Time Communication
| Package | Version | Purpose |
|---------|---------|---------|
| **Socket.io** | 4.8.1 | WebSocket events for LiveSync |

Socket.io enables real-time updates when tasks/projects change. All connected clients instantly see mutations without polling.

### Authentication & Security
| Package | Version | Purpose |
|---------|---------|---------|
| **jsonwebtoken** | - | JWT creation and validation |
| **bcrypt** | 5.1.1 | Password hashing (one-way encryption) |
| **Firebase Admin SDK** | - | OAuth integration + push notifications |

Authentication flow:
1. User sends credentials → bcrypt hashes password
2. Credentials validated against stored hash
3. JWT generated with userId, companyId, role
4. JWT sent to client, stored in localStorage
5. Requests include JWT in Authorization header
6. Middleware validates JWT signature

### Logging & Monitoring
| Package | Version | Purpose |
|---------|---------|---------|
| **Winston** | 3.17.0 | Structured logging to multiple transports |

Winston writes to:
- `track.log` — application events
- `error.log` — errors only
- `combined.log` — all logs

Structured logging enables debugging and audit trails.

### Storage & Files
| Package | Version | Purpose |
|---------|---------|---------|
| **@aws-sdk/client-s3** | 3.864.0 | S3 API client (Wasabi-compatible) |
| **@aws-sdk/s3-request-presigner** | - | Generate presigned URLs |
| **Sharp** | 0.32.6 | Image resizing and optimization |
| **archiver** | 7.0.1 | ZIP file creation for exports |

Storage abstraction supports:
- **Wasabi:** S3-compatible cloud storage (production)
- **Local FS:** Server filesystem (development)

### Caching & Scheduling
| Package | Version | Purpose |
|---------|---------|---------|
| **node-cache** | 5.1.2 | In-memory caching (frequently accessed data) |
| **node-schedule** | 2.1.1 | Cron jobs and scheduled tasks |

Cache stores:
- Project lists
- User settings
- Frequently accessed data

Invalidated after mutations (see CONVENTIONS.md).

### Email & Communication
| Package | Version | Purpose |
|---------|---------|---------|
| **Nodemailer** | 6.9.16 | SMTP email (Gmail, custom SMTP) |
| **Resend** | - | HTTP API for cloud email (recommended) |

Use Resend in production for reliability. Nodemailer for development or self-hosted.

### Utilities
| Package | Version | Purpose |
|---------|---------|---------|
| **Luxon** | 3.5.0 | Timezone-aware date/time handling |
| **html-to-text** | 9.0.5 | Extract text from HTML |
| **extract-zip** | 2.0.1 | Unzip files |

---

## Frontend (Vue.js)

### Framework & Routing
| Package | Purpose |
|---------|---------|
| **Vue.js** | Reactive UI components |
| **Vue Router** | Client-side navigation (SPA routing) |

Vue.js is lightweight and ideal for real-time updates via Socket.io. Components reactively update when data changes.

### State Management
| Package | Purpose |
|---------|---------|
| **Vuex** or **Pinia** | Global state management |

Pinia is the recommended modern choice. Manages:
- Current project/task
- Authenticated user
- UI state (modals, notifications)
- Cached data from API

### Internationalization
| Package | Purpose |
|---------|---------|
| **vue-i18n** | Multi-language support |

Supports translation of UI text. Locale files stored in `frontend/src/locales/`.

### UI Utilities
Used for:
- Tour guides and interactive tutorials
- File import tools
- Modal/dialog management

### Build & Bundling
| Tool | Purpose |
|------|---------|
| **Webpack** | Module bundling via `vue.config.js` |
| **Babel** | JavaScript transpilation for older browsers |

Build outputs to `frontend/dist/` for production.

---

## Desktop (Electron)

| Package | Purpose |
|---------|---------|
| **Electron** | Cross-platform desktop app |

Electron wraps the Vue.js frontend in a native desktop shell. Supports Windows, Mac, Linux with the same codebase.

---

## API Documentation

| Package | Version | Purpose |
|---------|---------|---------|
| **swagger-jsdoc** | 6.2.8 | Extract API docs from code comments |
| **swagger-ui-express** | 5.0.1 | Render interactive API docs |

API docs accessible at `/api/docs` in development.

---

## Technology Decisions & Trade-offs

### MongoDB vs PostgreSQL
**Chosen:** MongoDB

**Pros:**
- Flexible schema for custom fields
- Document nesting (projects → tasks → subtasks)
- Strong multi-tenancy support
- Horizontal scaling with sharding

**Cons:**
- No ACID transactions (until MongoDB 4.0+, now available)
- Larger document size vs normalized SQL

### Socket.io vs WebSockets vs SSE
**Chosen:** Socket.io

**Pros:**
- Automatic fallbacks (WebSocket → HTTP polling)
- Room-based broadcasting (project-specific updates)
- Reconnection handling
- Cross-browser compatibility

**Cons:**
- Overhead vs raw WebSockets
- Requires persistent connection

### Centralized MongoDbCrudOpration vs ORM
**Chosen:** Centralized abstraction

**Pros:**
- Single query interface prevents bugs
- Consistent error handling
- Easy to add logging/auditing
- Prevents accidental queries without companyId

**Cons:**
- Less type safety than typed ORM (could add TypeScript)
- Custom operation handlers needed for complex queries

### Multi-Tenant DB vs Separate Databases
**Chosen:** Multi-tenant (single DB, companyId scoping)

**Pros:**
- Lower operational overhead
- Easier backup/restore
- Single database cluster
- Cost-effective for many customers

**Cons:**
- Risk if companyId filtering is missed (data leak)
- Harder to isolate customer data in incident

**Mitigation:**
- Centralized MongoDbCrudOpration enforces companyId
- All tests include company scoping
- Regular security audits

### JWT vs Session Cookies
**Chosen:** JWT (stateless)

**Pros:**
- Stateless (scales across multiple servers)
- Works with mobile/desktop clients
- Self-contained (no server-side session store)
- Easy to implement multi-instance deployments

**Cons:**
- Token stored in localStorage (XSS vulnerable)
- Can't revoke tokens instantly (TTL-based)

### Wasabi vs AWS S3
**Chosen:** Wasabi with S3-compatible abstraction

**Pros:**
- Cheaper than AWS S3 (~80% savings)
- Drop-in replacement (same S3 API)
- Can switch to other S3-compatible (MinIO, DigitalOcean Spaces)
- Local filesystem option for self-hosted

**Cons:**
- Smaller company, less ecosystem
- Fewer integrations than AWS

---

## Development & Testing

### Current Testing Setup
⚠️ **No test framework configured.** Recommended additions:
```bash
npm install --save-dev jest supertest
npm install --save-dev @testing-library/vue
```

### Recommended Test Stack
| Package | Purpose |
|---------|---------|
| **Jest** | Test runner and assertions |
| **Supertest** | HTTP endpoint testing |
| **@testing-library/vue** | Component testing |

---

## Environment & Deployment

### Development
- `npm run nodemon` — Dev server with hot-reload
- Port 4000 (configurable)
- Local MongoDB

### Production
- `npm start` — Run server.js (optimized entry point)
- Environment variables required (see SETUP.md)
- MongoDB in cloud or self-hosted
- Reverse proxy (nginx) recommended

### Containerization
- **Dockerfile:** Single-stage build for Node.js
- **docker-compose.yml:** Multi-service orchestration

---

## Key Dependency Vulnerabilities to Watch

1. **bcrypt:** Ensure version >= 5.0.0 (before: potential algorithm weaknesses)
2. **MongoDB:** Keep Mongoose updated for security patches
3. **Socket.io:** Monitor for XSS/CSRF issues
4. **JWT:** Don't use weak algorithms (use HS256 minimum)
5. **Sharp:** Image processing vulnerabilities (keep updated)

Always run `npm audit` and address HIGH/CRITICAL vulnerabilities.
