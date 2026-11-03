# Writing a module

This page walks through adding a backend feature module from an empty folder to a merged, documented route. The running example is a module called `Foo` with one list route and one create route. The helpers it calls (`tenantOf`, `fail`, `asyncHandler`, `MongoDbCrudOpration`, `socketEmitter`, `removeCache`) are the real ones; copy the patterns, not the names.

Before you start, read [Module layout](./module-layout) and [Multi-tenancy and data access](./multi-tenancy). If the change is non-trivial, write the task's `task.md` first (see [Contributing](./contributing)).

## 1. Create the folder

```
Modules/Foo/
├── init.js
├── routes.js
├── controller.js
└── helpers/
    └── fooRules.js
```

The folder is PascalCase and the route file is always `routes.js` (`tests/conventions/naming-conventions.test.js`).

## 2. Write the rules first

Put everything that does not need `req` or `res` in `helpers/`: validation, calculations, the shape of a change. Keep it pure so a unit test can call it directly. `Modules/Reactions/helpers/reactionRules.js` is a good model: it exports a fixed list, a validator that returns `{ valid, reason }`, and a function that builds the Mongo update.

```js
const validateFooInput = ({ name }) => {
    if (typeof name !== 'string' || !name.trim()) return { valid: false, reason: 'A name is required.' };
    if (name.length > 100) return { valid: false, reason: 'A name is at most 100 characters.' };
    return { valid: true, reason: '' };
};

module.exports = { validateFooInput };
```

## 3. Write the handlers

Take the company from `tenantOf(req)`, query through `MongoDbCrudOpration`, and answer with `{ status, statusText, data }`. `Config/respond.js` gives you `ok`, `fail` and `asyncHandler`:

```js
const ok = (res, payload = {}) => res.send({ status: true, ...payload });

const fail = (res, statusText, statusCode = 400, extra = {}) => res.send({ status: false, statusText, statusCode, ...extra });

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```

A handler built on them:

```js
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { tenantOf } = require('../../Config/tenant');
const { ok, fail, asyncHandler } = require('../../Config/respond');
const { removeCache } = require('../../utils/commonFunctions');
const socketEmitter = require('../../event/socketEventEmitter');
const logger = require('../../Config/loggerConfig');
const { validateFooInput } = require('./helpers/fooRules');

exports.listFoos = asyncHandler(async (req, res) => {
    const companyId = tenantOf(req);
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.FOOS, data: [{ deletedStatusKey: 0 }] }, 'find');
    return ok(res, { data: rows });
});

exports.createFoo = asyncHandler(async (req, res) => {
    const companyId = tenantOf(req);
    const check = validateFooInput(req.body || {});
    if (!check.valid) return fail(res, check.reason, 400);

    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.FOOS,
        data: { name: req.body.name.trim(), createdBy: String(req.uid) },
    }, 'save');

    removeCache(`fooList_${companyId}`);
    try {
        socketEmitter.emit('insert', { type: 'insert', data: saved, updatedFields: {}, module: 'foos', companyId });
    } catch (error) {
        logger.error(`ERROR emitting foo insert: ${error.message}`);
    }
    return ok(res, { statusText: 'Foo created.', data: saved });
});
```

What each line is for:

- **`tenantOf(req)`** throws a `TenantError` (403) when the `companyid` header is missing, malformed or outside the token's audience. Never read the company from the body alone.
- **`SCHEMA_TYPE.FOOS`**, never a string. See step 4.
- **`removeCache`** clears whatever cached the old value. If nothing caches it, there is nothing to clear; do not invent a cache.
- **`socketEmitter.emit`** with `module` and `companyId`, so other tabs, automations and webhooks hear the change. A failed emit must not fail the request.

### Errors

- Answer an expected refusal with `fail(res, text, statusCode)`. The body stays `{ status: false, statusText }` with HTTP 200 for the web app; `Config/strictStatus.js` sends the real 4xx to API-token callers and to anyone sending `Prefer: status-codes`.
- Let anything unexpected throw. `asyncHandler` passes it to `next(err)`, and `Config/errorHandler.js` logs the stack under the request id and answers `{ status: false, statusText, requestId }`.
- Many older handlers `try`/`catch` and send `{ status: false, statusText: error.message }` themselves (`Modules/Pages/comments.js` does, through `fail`). That still works.
- `req.errorMessageObject` followed by `next()` is a legacy pattern left in `Modules/Auth/`. Do not add to it.

## 4. Add a collection if you need one

A new collection goes in three places in the same change:

1. `Config/schemaType.js`: `FOOS: "foos",` in `SCHEMA_TYPE`.
2. `Config/collections.js`: the same entry in `dbCollections`.
3. `utils/mongo-handler/`: the field definitions in `schema.js`, the Mongoose schema and indexes in `createSchema.js`, and the `SCHEMA_TYPE.FOOS` case in `checkType()` of `mongoQueries.js`.

Schemas are strict: a field that is not declared is dropped silently on save. Declare every field before code writes it.

If existing data must change, add a migration in `migrations/NNN-name.js`. The runner applies it at boot (or `npm run migrate`) and records it in `global.schema_versions`. A company-wide one, as `migrations/008-agent-run-expiry.js` does:

```js
module.exports = {
    id: 'NNN-example',
    scope: 'company',
    async up(ctx) {
        await ctx.forEachCompany(async (companyId) => {
            await ctx.company(companyId, { type: ctx.SCHEMA_TYPE.TASKS, data: [{ /* filter */ }, { $set: { /* ... */ } }] }, 'updateMany');
        });
    },
};
```

`id` must equal the file name, with `NNN` the next free number after the highest one in `migrations/`. `npm run migrate -- up --dry-run` shows what it would write without writing.

## 5. Register the routes

`routes.js`:

```js
const ctrl = require('./controller');

exports.init = (app) => {
    app.get('/api/v2/foos', ctrl.listFoos);
    app.post('/api/v2/foos', ctrl.createFoo);
};
```

`init.js`:

```js
exports.init = (app) => require('./routes').init(app);
```

Then:

1. Add `require('./Modules/Foo/init').init(app);` inside `initializeControllers()` in `index.js`.
2. Guard the prefix. Add `"/api/v2/foos"` to the `verifyJWTTokenWithCRoute` list in `Config/setMiddleware.js` (routes that act inside a company). If the route is public by design or checks the session itself, add it to `PUBLIC_BY_DESIGN` or `SELF_GUARDED` in `tests/conventions/v2-guard.test.js` with a reason instead. The test fails until you choose.
3. If agents must not call the route, put `agentsRefused('<action>')` from `Modules/Agents/guard.js` in front of the handler, as `Modules/Pto/routes.js` does. To let agents do it on purpose, add an agent action instead (see [Agent actions and MCP tools](./agent-actions)).
4. If the route reads an environment variable, describe it in `scripts/env-doc.meta.json` and run `node scripts/env-doc.js`.

## 6. Add the screen text

Every string a person sees goes through i18n: add keys under the feature's namespace in `frontend/src/locales/en.js`, use `$t('Foo.key')` in templates, then run `npm run i18n:backfill`. Error text the server sends (`statusText`) is shown as it is, so keep it short and plain. See [Translations (i18n)](./i18n).

## 7. Test it

- `tests/foo-rules.test.js` for the helpers (Jest project `unit`, no database).
- `tests/integration/foo.int.test.js` for the routes against a real server, if the behaviour matters across roles (see [Testing](./testing)).
- A `frontend/tests/*.spec.js` for any new component.

Run `npm run lint && npm test` before you push.

## 8. Document the route in the docs pull request

A feature pull request leaves `docs/API.md` and `docs/api/openapi.json` alone. After it is merged into `staging`, the follow-up docs pull request describes the new route in `scripts/api-doc.meta.json`, runs `npm run api:doc`, and commits both generated files; `npm run api:doc:check` fails while they are stale. Until then the route is listed as undocumented. See [Branches, versions and releases](./releases).

## Checklist

- [ ] `Modules/Foo/` with `init.js`, `routes.js`, handlers and pure helpers
- [ ] Every query takes the company from `tenantOf(req)` and the collection from `SCHEMA_TYPE`
- [ ] Writes emit a socket event with `module` and `companyId`, and clear any cache they invalidate
- [ ] The prefix is guarded, or declared in `v2-guard.test.js`
- [ ] Text through i18n, colours through tokens
- [ ] A unit test for the helpers
- [ ] Comments only where the code cannot say why

## Related

- [Module layout](./module-layout)
- [Multi-tenancy and data access](./multi-tenancy)
- [Real-time (Socket.io) events](./socket-events)
- [Conventions](./conventions)
