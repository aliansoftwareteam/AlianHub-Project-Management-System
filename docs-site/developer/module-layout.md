# Module layout

The backend is organised by feature, not by layer. Each feature is a folder under `Modules/` that owns its routes, handlers and rules, and registers itself with one `init(app)` call. This page shows the shape of a module using a real, small one, and the naming rules the tests check.

## The shape of a module

```
Modules/<Name>/
├── init.js          exports.init(app): the one entry point index.js calls
├── routes.js        exports.init(app): registers the /api/v2/<name>/... routes
├── controller.js    request handlers (or controller/ with one file per concern)
└── helpers/         logic with no req or res: rules, validation, calculations
```

Not every module has every part. Bigger modules split `controller.js` into a `controller/` folder (for example `Modules/Milestone/controller/` has `crud.js`, `query.js`, `status.js`, `billing.js` and more) and keep a thin `controller.js`. Mongoose schemas are not kept in the module: they live together in `utils/mongo-handler/` (see [Writing a module](./writing-a-module)).

## A real example: `Modules/Reactions/`

Emoji reactions on tasks and comments are one route, which makes this a good module to read first.

```
Modules/Reactions/
├── init.js
├── routes.js
├── controller.js
└── helpers/
    └── reactionRules.js
```

`init.js` hands the app to the routes:

```js
const routes = require('./routes');

exports.init = (app) => {
    routes.init(app);
}
```

`routes.js` registers the route with the guards it needs in front of the handler:

```js
const ctrl = require('./controller');
const { chatGuard } = require('../Agents/guard');
const { reactedTo } = require('../Comments/helpers/namedThread');
const { asked, every } = require('../Comments/helpers/askedWrites');

exports.init = (app) => {
    app.post('/api/v2/reactions', chatGuard(reactedTo), asked(reactedTo, every('reaction.set')), ctrl.toggleReaction);
}
```

`helpers/reactionRules.js` is pure: it validates input and computes the change, with no database or network, so `tests/reaction-rules.test.js` can test it directly. `controller.js` reads the target with `MongoDbCrudOpration`, checks the caller can read it, applies the change, and emits the socket event (shown in [Real-time events](./socket-events)).

## Registration

`index.js` calls every module's `init` inside `initializeControllers()`. The order matters only where a module must stand in front of others: `Modules/Agents/init` is first, so its perimeter (`Modules/Agents/guard.js`) runs before every module's routes.

```js
function initializeControllers() {
    // ...
    require('./Modules/Agents/init').init(app);
    require('./Modules/Auth/init').init(app);
    // ...
    require('./Modules/Reactions/init').init(app);
    require('./Modules/RecentVisits/init').init(app);
    // ...
}
```

The route prefix must also be guarded. `Config/setMiddleware.js` holds two lists:

- `verifyJWTTokenWithCRoute`: routes that act inside a company. `jwt.verifyJWTTokenWithCV2` requires the `companyid` header, verifies the JWT or API token, checks the company is in the token's audience and re-checks membership. `/api/v2/reactions` is here.
- `verifyJWTToken`: signed-in routes that may not name a company (creating a workspace, the profile). `jwt.verifyJWTTokenV2` then `jwt.requireCompanyAud` run on them.

`tests/conventions/v2-guard.test.js` fails for any `/api/v2/*` prefix that is in neither list, nor in the test's own `PUBLIC_BY_DESIGN` or `SELF_GUARDED` list with a reason.

## Naming rules

| What | Rule | Example |
|---|---|---|
| Module folder | PascalCase, never snake_case | `Modules/RecentVisits/` |
| Route file | Always `routes.js` (no `routes2.js`) | `Modules/Pto/routes.js` |
| Entry point | `init.js` exporting `init(app)` | `Modules/Notes/init.js` |
| Other files | camelCase | `helpers/reactionRules.js`, `goalStore.js` |
| Constants | UPPER_SNAKE_CASE | `SCHEMA_TYPE`, `REACTION_EMOJIS` |
| Endpoints | Versioned, kebab-case | `/api/v2/api-tokens/ai-connection` |
| Unit test | `tests/<module>-rules.test.js` for a module's helpers | `tests/reaction-rules.test.js` |

`tests/conventions/naming-conventions.test.js` checks the folder and route-file rules, and that `Config/config.js`, `Config/env.js`, `Config/collections.js` and `Config/schemaType.js` exist.

Some older lowercase folders remain (`Modules/notification/`, `Modules/settings/`, `Modules/storage/` and others). Do not add new ones.

## Where code goes

| Code | Put it in |
|---|---|
| A handler that reads `req` and writes `res` | `controller.js` or `controller/` |
| A rule, validation or calculation | `helpers/`, with a unit test |
| A query | Through `MongoDbCrudOpration` in the handler or a helper that takes `companyId` as its first argument |
| A collection name | `Config/schemaType.js` and `Config/collections.js` |
| Something every module needs | `Config/` (request-level) or `utils/` (pure helpers) |
| A new agent action | `Modules/Agents/registry/` and a `*Requests.js` executor; see [Agent actions and MCP tools](./agent-actions) |

## Related

- [Writing a module](./writing-a-module)
- [Multi-tenancy and data access](./multi-tenancy)
- [Conventions](./conventions)
