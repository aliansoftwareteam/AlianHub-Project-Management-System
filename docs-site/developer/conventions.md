# Conventions

The rules every change follows: naming, the response shape, error handling, comments, and commit messages. Most are checked by ESLint or by the `conventions` Jest project, so breaking one fails CI with the file that broke it.

## The four working rules

These come from the repository's `CLAUDE.md` and apply to people and AI assistants alike.

1. **Comments: minimal, or none.** See [Comments](#comments) below.
2. **Every user-visible string goes through i18n.** See [Translations (i18n)](./i18n).
3. **Every colour comes from a token.** See [Design tokens and styles](./design-tokens).
4. **Every merge to `staging` is a numbered build**, and commit and PR titles are Conventional Commits. See [Branches, versions and releases](./releases).

Scale the process to the change: a typo or a one-line fix is just done. A new feature, a cross-module change or anything ambiguous starts with a written `task.md` (goal, scope, out of scope, acceptance criteria) under `Tasks/`, confirmed before code is written, with progress kept in `progress.md`.

## Naming

| What | Rule | Example |
|---|---|---|
| Module folder | PascalCase | `Modules/MainChats/` |
| Route file | `routes.js`, always | `Modules/Tasks/routes.js` |
| Other files | camelCase | `helpers/reactionRules.js`, `Config/loggerConfig.js` |
| Variables and functions | camelCase | `companyId`, `toggleReaction` |
| Constants | UPPER_SNAKE_CASE | `SCHEMA_TYPE`, `REACTION_EMOJIS` |
| Classes | PascalCase | `TenantError` |
| Endpoints | Versioned, kebab-case | `/api/v2/api-tokens/ai-connection` |
| Frontend components | PascalCase `.vue` files | `ProjectHeader.vue` |

Prefer a clear name to a comment. If renaming makes a comment unnecessary, rename and delete the comment.

## Responses

Every endpoint answers with HTTP 200 and a body the web app reads by its `status`:

```js
// success
{ status: true, statusText: "...", data: { /* ... */ } }

// refusal or error
{ status: false, statusText: "..." }
```

Use the helpers in `Config/respond.js`: `ok(res, payload)` and `fail(res, statusText, statusCode)`. `fail` records the code in the body, and `Config/strictStatus.js` turns it into a real 4xx for API-token callers and for clients that send `Prefer: status-codes`. Some older routes still send `message` instead of `statusText`; new ones do not.

## Error handling

- Wrap an async handler in `asyncHandler` and let unexpected errors throw. They reach `Config/errorHandler.js`, which logs the stack with the request id and answers `{ status: false, statusText, requestId }`.
- Answer expected refusals with `fail(res, text, code)`: 400 for bad input, 403 for not allowed, 404 for something the caller cannot open (say "not found" for both a missing and a hidden thing, so the answer does not reveal what exists).
- `tenantOf(req)` throws a `TenantError` with `statusCode: 403`.
- Do not add to the legacy `req.errorMessageObject` + `next()` pattern in `Modules/Auth/`.

## Data access

- Every query goes through `MongoDbCrudOpration(companyId, mongoObj, method)`, with the company from `tenantOf(req)`. Never a raw Mongoose model, never a literal company id.
- Collection names come from `SCHEMA_TYPE`, never a string.
- After a write, emit the socket event and clear the cache that held the old value.
- Validate input at the route: type, length and allowed values.
- Read an environment variable once at module load (`process.env.NAME || default`) and describe it in `scripts/env-doc.meta.json`; `tests/conventions/env-doc.test.js` fails on an undescribed variable.

See [Multi-tenancy and data access](./multi-tenancy).

## Comments

Write a comment only when the code cannot carry the intent: a non-obvious **why**, such as a workaround, an outside constraint or a subtle invariant.

- Never narrate **what** the code does. No restating the line, no step-by-step play-by-play, no banner comments or decorative dividers, no "TODO for later" left in shipped code.
- When you edit a file, remove comments that only repeat the code. This overrides matching the surrounding comment density.
- No commented-out code. Git keeps the history.

A comment that earns its place, from `Modules/Reactions/controller.js`:

```js
// `timestamps: false`: a reaction is metadata about a message, not an edit
// of it. Without this Mongoose bumps `updatedAt`, and every UI that infers
// "edited" from `createdAt !== updatedAt` (the chat bubble and the comment
// renderer both do) labelled a message as edited the moment anyone reacted
// to it.
```

## What not to do

| Don't | Because | Do |
|---|---|---|
| `Task.findOne({ taskId })` | Reads an unscoped model | `MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, ... }, 'findOne')` |
| `{ type: 'projects' }` | A misspelt string fails silently | `SCHEMA_TYPE.PROJECTS` |
| `req.body.companyId` as the tenant | Trusts the client | `tenantOf(req)` |
| A write with no `socketEmitter.emit` | Other tabs, automations and webhooks never hear it | Emit with `module` and `companyId` |
| A write that leaves a cached value | People see stale data | `removeCache(key)` |
| A new `/api/v2` prefix with no guard | Unauthenticated access | Add it to `Config/setMiddleware.js` |
| A second road for an agent's change | Skips the registry, policy and audit | Go through `perform()`; see [Agent actions](./agent-actions) |
| An MCP tool that approves or undoes | A decision needs a signed-in person | Leave decisions to `personDecides()` routes |
| Bare text, `title` or `placeholder` in a template | Cannot be translated | `$t('Namespace.key')` |
| `#fff`, `white`, `bg-white` in a style | Breaks dark mode and themes | `var(--surface)` and `ah-` classes |

## Commit messages and PR titles

[Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint (`commitlint.config.js`) on every commit in a pull request and on its title:

```
<type>(<optional-scope>): <short description>
```

- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `test`, `ci`, `build`, `style`, `revert`.
- Lowercase type and scope; the subject does not start with a capital and does not end with a full stop; the header is at most 100 characters.
- The type decides the next version: `feat` is a minor bump, `!` or `BREAKING CHANGE` a major one, anything else a patch.

```
feat(workload-report): add weekly view
fix(auth): correct JWT expiry handling
docs(readme): add Docker quick start
```

Run `npm run lint:commits` to check your branch against `origin/staging` before you push.

## Related

- [Module layout](./module-layout)
- [Contributing](./contributing)
- [Testing](./testing)
