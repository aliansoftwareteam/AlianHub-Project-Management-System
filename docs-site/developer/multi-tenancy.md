# Multi-tenancy and data access

One AlianHub instance serves many companies (workspaces). Each company's data lives in its own MongoDB database, and every query names that database as its first argument. This page shows how a handler finds the right company, how it queries, and what it must do after a write.

## One database per company

- Each company has a database named by its 24-character id. The `global` database holds users, companies, sessions, instance settings and the automation job queue.
- `middlewares/mongoConnector/mongoConnection.js` opens and pools one connection per database. `middlewares/mongoConnector/databaseName.js` accepts only `global` or a 24-hex id as a database name, because MongoDB creates whatever database it is asked for.
- A query against the wrong first argument reads another company's data. There is no shared collection with a `companyId` filter to fall back on: the first argument *is* the isolation.

## Find the company: `tenantOf(req)`

Every request names its company in the `companyid` header. `Config/tenant.js` resolves it and checks it against the token's audience (`req.aud`, set by `Config/jwt.js`):

```js
function tenantOf(req) {
    const headers = req.headers || {};
    const candidate = firstOf(
        headers.companyid,
        req.params && req.params.companyId,
        req.query && req.query.companyId,
        req.body && (req.body.companyId || req.body.CompanyId)
    );
    if (!OBJECT_ID.test(candidate)) throw new TenantError('A valid companyid header is required.');
    if (!inAudience(req, candidate)) throw new TenantError('You do not have access to this company');
    return candidate;
}
```

`TenantError` carries `statusCode: 403`. The same file exports:

| Function | Use it when |
|---|---|
| `tenantOf(req)` | Any handler. Returns the validated company id or throws |
| `tenantDb(req)` | You want a query function already bound to the tenant: `(mongoObj, method) => MongoDbCrudOpration(companyId, mongoObj, method)` |
| `sessionTenantOf(req)` | A signed-in route must refuse a request whose body or query names a different company from the header |
| `pinSessionTenant(req, res)` | A handler that reads its company from the body: answers 403 itself on a mismatch, and overwrites `req.body.companyId` with the verified one |

Never take the company from `req.body` or `req.query` alone. `tests/conventions/tenant-scoping.test.js` counts such reads per file against `tests/conventions/tenant-scoping.baseline.json`, and the count may only fall.

## Query: `MongoDbCrudOpration`

All data access goes through `MongoDbCrudOpration(companyId, mongoObj, method)` in `utils/mongo-handler/mongoQueries.js`:

- `companyId` picks the database (`'global'` for the global one).
- `mongoObj` is `{ type, data }`: `type` is a `SCHEMA_TYPE` value, `data` is the argument list passed to the Mongoose method.
- `method` is a Mongoose model method name (`find`, `findOne`, `findOneAndUpdate`, `updateMany`, `countDocuments`, `aggregate`, …) or `save`.

A real read and write, from `Modules/Reactions/controller.js`:

```js
const doc = await MongoDbCrudOpration(companyId, { type: schemaType, data: [{ _id: targetObjId }] }, 'findOne');

const updated = await MongoDbCrudOpration(companyId, {
    type: schemaType,
    data: [{ _id: targetObjId }, updateObj, { returnDocument: 'after', timestamps: false }],
}, 'findOneAndUpdate');
```

And a count, from `Modules/Pages/comments.js`:

```js
const liveCount = (companyId, page) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PAGE_COMMENTS,
    data: [{ pageId: oid(page._id), ...LIVE }],
}, 'countDocuments');
```

One guard is built in: a task write whose filter names an empty `_id` is rejected, because Mongoose drops an undefined id from a filter and the write would land on the first task.

### Checks that keep it honest

- ESLint (`.eslintrc.cjs`) rejects, in `Modules/**/controller*.js`, a `MongoDbCrudOpration` call whose first argument is a literal other than `'global'`, or `undefined`.
- `tests/conventions/tenant-scoping.test.js` holds the line on tenant ids read from the body or query.
- A helper that queries takes `companyId` as its first parameter and passes it through. It never looks the company up itself.

## Collection names: `SCHEMA_TYPE`

Collection names come from `SCHEMA_TYPE` in `Config/schemaType.js`, never from a string:

```js
const { SCHEMA_TYPE } = require('../../Config/schemaType');

await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: taskId }] }, 'findOne');
```

`MongoDbCrudOpration` maps the type to a collection (`tableType()`) and a schema (`checkType()`). An unknown string does not raise an error where you wrote it. A new collection is added in three places together: `Config/schemaType.js`, `Config/collections.js` and the schema in `utils/mongo-handler/`: the field definitions in `schema.js`, the Mongoose schema and its indexes in `createSchema.js`, and the mapping in `checkType()` of `mongoQueries.js`.

## After a write

A write is not done until the rest of the system knows:

1. **Emit the socket event**, with the company in the payload, so other open tabs update. The relays of `task`, `userIdNotification`, `generalReminder`, `project`, `sprints` and `folders` send an event only to sockets of the company it names, and `tests/conventions/socket-events-name-company.test.js` fails when an event of those modules leaves `companyId` out.
2. **Clear the cache** that served the old value, with `removeCache` from `utils/commonFunctions.js`.

From `Modules/Agents/projectPolicyController.js`, after a project's agent policy is saved:

```js
removeCache('UserProjectData:', true);
socketEmitter.emit('update', { type: 'update', companyId, data: saved.project, updatedFields: { agentPolicy: saved.agentPolicy }, module: 'project' });
```

`removeCache(key)` deletes one key; `removeCache(prefix, true)` deletes every key containing the prefix. The cache is `node-cache` in process memory (`myCache` in `Config/config.js`).

## Files and storage

Uploads are scoped by company too. With `STORAGE_TYPE=server` they are written under `storage/<companyId>`. The S3-compatible driver puts each company in a bucket named after its id, or, when `S3_BUCKET` is set, in one bucket under `S3_PREFIX` plus the company id. `common-storage/s3Layout.js` is the only module that names a bucket, and `tests/conventions/s3-layout.test.js` keeps it that way.

## Good to know

- `req.instanceAdmin === 'key'` (the instance admin key) is the one caller with no audience to check against.
- A migration reaches every company with `ctx.forEachCompany` and `ctx.company(companyId, mongoObj, method)`; see [Writing a module](./writing-a-module).

## Related

- [Architecture](./architecture)
- [Real-time (Socket.io) events](./socket-events)
- [Writing a module](./writing-a-module)
