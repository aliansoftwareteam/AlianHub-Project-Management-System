# Developer guide

How to run, test and change AlianHub. Operators read [ADMIN-GUIDE.md](ADMIN-GUIDE.md) instead; the variable reference is [ENV.md](ENV.md).

## Run it

Node 20 (`engines` in `package.json`) and a MongoDB you can reach.

```bash
npm ci && (cd frontend && npm ci)
cp .env.example .env            # MONGODB_URL, JWT_SECRET, APIURL, STORAGE_TYPE at least
npm run nodemon                 # API on :4000 with reload
cd frontend && npm run serve    # SPA on :8080, proxies /api to :4000
```

`npm run setup` does the install and `.env` steps for you and starts the server. A fresh database lands on `/setup`, the in-app first run (see the admin guide).

The backend serves the built SPA from `frontend/dist`; `cd frontend && npm run build` produces it (2–3 minutes).

## Test it

| Command | What runs |
|---|---|
| `npm test` | Jest, two projects: `unit` (`tests/*.test.js`, helpers and rules) and `conventions` (`tests/conventions/*.test.js`, repository-wide checks) |
| `npm run test:unit` / `npm run test:conventions` | one project |
| `npm run lint` | ESLint over the backend (`.eslintrc.cjs`); 0 errors is the gate, warnings are allowed |
| `cd frontend && npm test` | Vitest + `@vue/test-utils` in jsdom (`frontend/tests/*.spec.js`) |
| `cd frontend && npm run lint -- --no-fix` | Vue CLI ESLint |
| `node scripts/unused-components.js` | `.vue` files nothing imports (must print nothing) |
| `node scripts/env-doc.js --check` | env variables described and docs regenerated |

`.github/workflows/ci.yml` runs all of that on every pull request to `beta`, `staging` and `main`. The conventions project is the place for a rule that must hold everywhere: it reads the tree and fails with the offending file, so a new rule needs no per-module wiring.

The conventions in place:

- `v2-guard` — every `/api/v2/*` prefix is in the JWT guard list of `Config/setMiddleware.js`, public by design, or guards itself.
- `tenant-scoping` — tenant ids are not read from `req.body`/`req.query`; a per-file baseline may only fall.
- `i18n-namespaces` — no `*V2` locale namespace, and every static `t('A.b')` key exists in `frontend/src/locales/en.js`.
- `env-doc` — every `process.env.*` and `VUE_APP_*` read is described in `scripts/env-doc.meta.json`.
- `unused-components` — no orphaned single-file component.
- `naming-conventions` — module folder and file naming.

Writing a frontend spec: mount with `@vue/test-utils`; `frontend/tests/setup.js` installs i18n, `$t`, and the shell provides (`$userId`, `$companyId`, `$clientWidth`, `$socket`). Mock `@/services` and heavy children with `vi.mock`; keep shared mocks in `vi.hoisted`. `frontend/tests/TaskDetailPanel.spec.js` is the template for a large component, `useProjectTree.spec.js` for a composable.

## Change it

### Requests and tenants

Every request carries the company in the `companyid` header; `Config/jwt.js` verifies the JWT or API token and sets `req.uid` and `req.aud` (the companies the token may act for). In a handler:

```js
const { tenantOf, tenantDb } = require('../../Config/tenant');
const { ok, fail, asyncHandler } = require('../../Config/respond');

exports.listPages = asyncHandler(async (req, res) => {
    const companyId = tenantOf(req);            // validated ObjectId, checked against req.aud, throws TenantError
    const db = tenantDb(req);                   // (mongoObj, method) => MongoDbCrudOpration(companyId, mongoObj, method)
    const rows = await db({ type: SCHEMA_TYPE.PAGES, data: [{ deletedStatusKey: 0 }] }, 'find');
    return ok(res, { data: rows });
});
```

Rules the lint and tests enforce: a query's first argument is a tenant id from the request, never a literal (`'global'` for the global database is the one exception) and never `undefined`; collection names come from `SCHEMA_TYPE`; after a write, emit the socket event and clear the cache (`removeCache`) that served the old value.

Responses stay `{ status, statusText, data }` with HTTP 200 — the SPA reads `status`. `fail(res, text, statusCode)` records the code in the body so `Config/strictStatus.js` can send a real 4xx to API-token callers and to anyone sending `Prefer: status-codes`. An uncaught error or `next(err)` reaches `Config/errorHandler.js`, which logs the stack with the request id and answers `{ status: false, statusText, requestId }`.

Every response carries `X-Request-Id`; `Config/requestLog.js` writes one line per request (`id method url status ms uid aud`) and winston prefixes the id to anything logged inside that request, so `grep <id> log/*.log` reconstructs a failure.

### Add a module

1. `Modules/<Name>/routes.js` exporting `init(app)` that registers `/api/v2/<name>/...` routes; `controller.js` (or `controller/`) for handlers; `helpers/` for logic that has no `req`.
2. `Modules/<Name>/init.js` — `exports.init = (app) => require('./routes').init(app)` — and a `require('./Modules/<Name>/init').init(app)` line inside `initializeControllers()` in `index.js`.
3. Add the prefix to the `verifyJWTToken` list in `Config/setMiddleware.js`, or add it to `PUBLIC_BY_DESIGN` / `SELF_GUARDED` in `tests/conventions/v2-guard.test.js` with a reason. The test fails until you choose.
4. New collections go in `Config/schemaType.js`, `Config/collections.js` and `utils/mongo-handler/schema.js` together.
5. A `tests/<name>-rules.test.js` for the helpers; controllers are covered by conventions.

### Add a view

1. The page under `frontend/src/views/<Area>/`, lazy-loaded from `frontend/src/router/<area>/index.js` (`requiresAuth`, `meta.title`).
2. Copy in `frontend/src/locales/en.js` under the area's namespace (`Projects`, `Settings`, …) — never a new `*V2` twin; other locales fall back to English until translated.
3. A rail or More entry in `frontend/src/components/organisms/Shell/navItems.js` when the page is a destination.
4. Shared UI comes from `components/organisms/Shell` (`ShellIcon`, panels), `ProjectHeader` for project pages, `atom/EmptyState` for empty states.

### Environment variables

Read them once at module load (`process.env.NAME || default`), describe the key in `scripts/env-doc.meta.json`, run `node scripts/env-doc.js` to regenerate `docs/ENV.md`, `.env.example` and `frontend/.env.example`. The conventions test fails on an undescribed variable.

### Locale keys

`t('Namespace.key')` with a literal key; when the key is built at run time, end the literal with `_` or `.` (`t('Inbox.tab_' + kind)`) so the audit can resolve the prefix. `node scripts/i18n-rename-namespace.js <From> <To>` moves a namespace and rewrites every reference.

## Where things are

`.claude/ARCHITECTURE.md` (request pipeline, multi-tenancy, sockets), `.claude/CONVENTIONS.md` (naming, module layout, response shape), `.claude/FOLDER-STRUCTURE.md` (the tree), `BRANCHING.md` and `CONTRIBUTING.md` (how a change lands).
