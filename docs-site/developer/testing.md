# Testing

AlianHub has five layers of checks: backend unit tests, repository-wide convention tests, API integration tests against a real server, browser tests in Playwright, and a screenshot check of the core screens. This page says what each covers, how to run it, and the rules that keep tests steady.

## The layers

| Layer | Runner | Files | Command |
|---|---|---|---|
| Unit | Jest project `unit` | `tests/*.test.js` | `npm run test:unit` |
| Conventions | Jest project `conventions` | `tests/conventions/*.test.js` | `npm run test:conventions` |
| API integration | Jest project `integration` | `tests/integration/<area>.int.test.js` | `npm run test:integration` |
| Browser | Playwright (Chromium) | `e2e/specs/<area>.spec.js` | `npm run e2e` |
| Frontend unit | Vitest + `@vue/test-utils` in jsdom | `frontend/tests/**/*.spec.js` | `cd frontend && npm test` |
| Screenshots | Playwright `toHaveScreenshot` | `e2e/visual/`, `e2e/visual-baseline/` | `npm run visual` (CI only) |

`npm test` runs `unit` and `conventions` only. The projects are defined in `jest.config.js`.

## Before you push

Run the same gate CI runs:

```bash
npm run lint && npm test && (cd frontend && npm run lint -- --no-fix && npm test && npm run build)
```

| Also useful | What it checks |
|---|---|
| `npm run i18n:check` | Locales complete, no new bare template text |
| `npm run style:check` | No new hard-coded colours or legacy classes |
| `node scripts/unused-components.js` | `.vue` files nothing imports (must print nothing) |
| `node scripts/env-doc.js --check` | Every environment variable the code reads is described |
| `npm run api:doc:check` | `docs/API.md` and `docs/api/openapi.json` match the routes. Not run in CI; the docs pull request after a merge regenerates them |
| `npm run lint:commits` | Your commits are Conventional Commits |

## CI

`.github/workflows/ci.yml` runs on every pull request to `staging` and `main`:

- backend `npm run lint` and `npm test`; frontend lint, `npm test` and `npm run build`;
- the frontend built once, then the browser tests (`npm run e2e`, three shards) and the API tests (`npm run test:integration`, two shards), each shard with its own database and server. The check named `e2e` passes only when all of them did. A failing shard keeps its report as the artifact `e2e-report-shard-<n>` or `integration-logs-shard-<n>`.

A pull request that only changes files under `Tasks/` or Markdown under `.claude/` skips the suites, and so does a draft pull request until it is marked ready for review.

The `Clock` workflow (`.github/workflows/clock.yml`) runs weekly and on demand: the backend unit suite and the frontend suite with the clock moved forward by 3, 40 and 400 days, to catch code that reads the real clock against fixed test dates. Run one offset locally with `CLOCK_SHIFT_DAYS=40 npx jest --selectProjects unit tests/some.test.js` or `cd frontend && CLOCK_SHIFT_DAYS=40 npx vitest run tests/some.spec.js`.

## Unit tests

One file per module's helpers, `tests/<module>-rules.test.js`. No database, no network: require the helper and assert. `tests/reaction-rules.test.js` tests `Modules/Reactions/helpers/reactionRules.js` this way.

## Convention tests

`tests/conventions/` holds rules that must hold everywhere. Each reads the tree and fails with the offending file, so a new rule needs no wiring per module. A rule the tree does not satisfy yet gets a baseline file that may only shrink. Among them:

| Test | Rule |
|---|---|
| `v2-guard` | Every `/api/v2/*` prefix is guarded in `Config/setMiddleware.js`, public by design, or guards itself |
| `tenant-scoping` | Tenant ids are not read from `req.body` or `req.query`; a per-file baseline may only fall |
| `socket-events-name-company` | Relayed socket events carry `companyId` |
| `i18n-check`, `i18n-namespaces` | Locales complete; no `*V2` namespace; every static `t('A.b')` key exists in `en.js` |
| `style-check` | Hard-coded colours and legacy classes against `scripts/style-baseline.json` |
| `env-doc` | Every `process.env.*` and `VUE_APP_*` read is described in `scripts/env-doc.meta.json` |
| `api-doc` | `scripts/api-doc.meta.json` is well formed and the API reference generates the same on every run |
| `unused-components` | No orphaned single-file component |
| `naming-conventions` | Module folder and file naming |
| `ai-core-boundary` | No vendor AI SDK outside `Modules/AICore/` |
| `mcp-tool-visibility`, `mcp-tool-scopes`, `mcp-tool-annotations`, `mcp-prompts` | Every MCP tool declares visibility, a scope and annotations |

## Frontend specs

Mount with `@vue/test-utils`. `frontend/tests/setup.js` installs i18n, `$t` and the shell's injections (`$userId`, `$companyId`, `$clientWidth`, `$socket`). Mock `@/services` and heavy children with `vi.mock`, and keep shared mocks in `vi.hoisted`. `frontend/tests/TaskDetailPanel.spec.js` is the template for a large component, `frontend/tests/useProjectTree.spec.js` for a composable.

## Integration and browser tests

Both run against a real server (`node index.js`), a real MongoDB and, for the browser layer, the built frontend in Chromium.

```bash
npm install && (cd frontend && npm install)   # once per checkout
cd frontend && npm run build && cd ..         # once, and again after frontend changes
npm run e2e:db                                # starts alianhub-e2e-mongo on port 27018
export E2E_MONGODB_URL=mongodb://127.0.0.1:27018
npx playwright install chromium               # once per machine
npm run test:integration
npm run e2e
npm run e2e:db:stop                           # when you are done
```

::: danger The suite wipes its database
Every run drops every database on the instance in `E2E_MONGODB_URL`, because the setup wizard only runs on an empty instance. Global setup refuses to start without that variable, or when it points at port 27017 outside CI. Never point it at data you care about, and never run both layers at once against the same database.
:::

- Run integration tests serially (`--runInBand`, as the npm script does): every suite shares one server, and one of them turns maintenance mode on while it runs.
- The server starts with an environment built from scratch and never reads your `.env`, so your mail, AI and OAuth credentials are never used.
- The harness in `e2e/support/` creates an owner (through the setup wizard), an admin, a member and a guest, two projects and three tasks, all through the real APIs. `loginAs(role)` signs in for real and returns an API client; `asRole(role)` in a Playwright spec opens the page already signed in.
- Every browser spec runs under a console guard (`e2e/support/consoleGuard.js`): an uncaught page error or an unexpected `console.error` fails the test. Name an error you provoke on purpose with `test.use({ expectedConsoleErrors: [...] })`.
- The HTML report is in `e2e/report` (`npx playwright show-report e2e/report`); server output is in `e2e/.state/`.

Which of the 30 most-used flows have a browser spec is tracked in `docs/E2E-FLOWS.md`; a new spec for a flow updates that list in the same pull request. The full harness guide, with examples for a new area, is `docs/TESTING-E2E.md`.

### Rules for every test

1. **Create your own data.** The shared fixtures are read-only context. A test that changes something creates it first, with `uniqueSuffix()` in its name.
2. **Never depend on order.** Every test passes alone and in parallel.
3. **Assert through the product.** Sign in and use the API or the page; never write to MongoDB from a test.
4. **Keep selectors stable.** Use the English copy from `en.js` or a `data-test` attribute.
5. **Keep a known bug visible.** Write the right assertion and mark it `it.failing(...)` or `test.fail(...)` with a reason; it fails once the bug is fixed, which is the reminder to flip it.

## Tests that pass by chance

A test that fails one run in ten is wrong, not unlucky. Common causes here: a spec mocking a module that `frontend/tests/setup.js` also mocks; a real timer, an unawaited promise or an assertion before the next tick (use fake timers and `await flushPromises()`); state shared between tests (reset it in `beforeEach`); a fixed date near today, or data another test changes.

Never fix it with a longer timeout, a retry or a looser assertion. Show it steady: run it 20 times with `npx vitest run --no-file-parallelism <file>` and with `--maxWorkers=4`, under CPU load.

## Screenshots

- `npm run atlas` screenshots every screen in `scripts/atlas-manifest.js` in light and dark, at desktop and phone sizes, into `artifacts/atlas/` with an `index.html` gallery, read-only against a running app. `npm run atlas:compare` puts two atlases side by side.
- The `Visual` workflow (`.github/workflows/visual.yml`) compares the core screens with PNGs in `e2e/visual-baseline/` after every merge to `staging`. It runs only in CI, inside the Playwright container, so fonts and browser are identical. A screen with no baseline yet is skipped, and its first screenshot is uploaded for you to accept. To accept an intended change, run `npm run visual:accept -- <run id>` and commit the new PNGs in the same pull request. The job is not a required check yet.

## Related

- [Local setup](./local-setup)
- [Contributing](./contributing)
- [Conventions](./conventions)
