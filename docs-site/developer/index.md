# Developer guide

This guide is for people who change AlianHub's code: contributors, maintainers, and anyone building a fork. It explains how the server and the web app are put together, the rules the test suite enforces, and how a change gets from your branch to a release.

If you run an instance rather than change it, read the [Admin guide](/admin/). If you call AlianHub from your own code, read the [API reference](/api/) or the [MCP server reference](/ai/mcp-server).

## The repository at a glance

AlianHub is one repository: a Node 20 / Express / MongoDB / Socket.io backend, a Vue 3 web app, and an Electron desktop time tracker.

| Folder | What lives there |
|---|---|
| `index.js`, `server.js` | The Express app: middleware, module registration (`initializeControllers()` in `index.js`), and the HTTP and Socket.io server |
| `Config/` | Cross-cutting server code: JWT checks (`jwt.js`), tenant resolution (`tenant.js`), response helpers (`respond.js`), the guard lists (`setMiddleware.js`), `SCHEMA_TYPE` (`schemaType.js`), logging, rate limits, permissions |
| `Modules/` | Feature modules, one PascalCase folder each (`Tasks/`, `Pages/`, `Agents/`, `Mcp/`, …), each registered with `init(app)` |
| `utils/` | Shared helpers. `utils/mongo-handler/` holds `MongoDbCrudOpration` and the Mongoose schemas |
| `middlewares/mongoConnector/` | Opens and pools one MongoDB connection per company database |
| `event/` | The in-process event emitter every mutation fires (`socketEventEmitter.js`) and the domain event bus for automations |
| `socket/` | The Socket.io server (`socketinit.js`), room access checks and one relay per feature in `socket/controller/` |
| `common-storage/` | The file storage drivers: `common-server.js` (local disk), `common-wasabi.js`, `common-s3.js` |
| `cron.js` | Scheduled jobs on `node-schedule` |
| `migrations/` | Numbered data migrations, run at boot or with `npm run migrate` |
| `frontend/` | The Vue 3 single-page app, built with Vue CLI into `frontend/dist` |
| `time-tracker-app/` | The Electron desktop time tracker |
| `tests/` | Jest: `tests/*.test.js` (unit), `tests/conventions/` (repository-wide rules), `tests/integration/` (API against a real server) |
| `e2e/` | Playwright browser tests, the shared harness and the screenshot check |
| `scripts/` | Repository tooling: i18n, style and API-doc checks, build info, demo seeds, the screenshot atlas |
| `docs/` | Long-form references (`DEVELOPER-GUIDE.md`, `MCP-AGENT-GUIDE.md`, `API.md`, ADRs) |
| `docs-site/` | This documentation site |
| `Tasks/` | Task PRDs and progress notes (`task.md`, `progress.md`) |
| `deploy/` | Deployment material for managed hosting |

## Start contributing

1. Read [Local setup](./local-setup) and get the API and the web app running.
2. Skim [Architecture](./architecture) and [Multi-tenancy and data access](./multi-tenancy). The company id decides which database every query touches; getting it wrong is the one mistake that leaks data.
3. Read [Conventions](./conventions). Four rules are checked by tests: minimal comments, every string through i18n, every colour from a token, and Conventional Commits.
4. Pick an issue, branch from `staging`, and follow [Contributing](./contributing).
5. Before you push, run the same gate CI runs (see [Testing](./testing)).

## Related

- [Architecture](./architecture)
- [Writing a module](./writing-a-module)
- [Contributing](./contributing)
- [Branches, versions and releases](./releases)
