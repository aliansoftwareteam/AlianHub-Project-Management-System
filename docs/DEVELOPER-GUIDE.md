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
| `npm run visual` | the screenshot check of the core screens; CI only, see [Screenshot check](#screenshot-check) |

`.github/workflows/ci.yml` runs all of that on every pull request to `beta`, `staging` and `main`, except the screenshot check, which has a workflow of its own. The conventions project is the place for a rule that must hold everywhere: it reads the tree and fails with the offending file, so a new rule needs no per-module wiring.

The conventions in place:

- `v2-guard` — every `/api/v2/*` prefix is in the JWT guard list of `Config/setMiddleware.js`, public by design, or guards itself.
- `tenant-scoping` — tenant ids are not read from `req.body`/`req.query`; a per-file baseline may only fall.
- `i18n-namespaces` — no `*V2` locale namespace, and every static `t('A.b')` key exists in `frontend/src/locales/en.js`.
- `env-doc` — every `process.env.*` and `VUE_APP_*` read is described in `scripts/env-doc.meta.json`.
- `unused-components` — no orphaned single-file component.
- `naming-conventions` — module folder and file naming.

Writing a frontend spec: mount with `@vue/test-utils`; `frontend/tests/setup.js` installs i18n, `$t`, and the shell provides (`$userId`, `$companyId`, `$clientWidth`, `$socket`). Mock `@/services` and heavy children with `vi.mock`; keep shared mocks in `vi.hoisted`. `frontend/tests/TaskDetailPanel.spec.js` is the template for a large component, `useProjectTree.spec.js` for a composable.

### Screenshot atlas

Unit specs cannot show what a visual change did. `npm run atlas` opens every screen in `scripts/atlas-manifest.js` in a headless Chromium and saves one PNG per screen, theme and size, plus an `index.html` gallery that opens from disk. `npm run atlas:compare` puts two atlases side by side.

```bash
ATLAS_TOKEN=$(npm run -s demo:token -- --email rahul.manager@demo.test 2>/dev/null | tail -1) npm run atlas
npm run atlas -- --only home,project-board --themes dark --sizes 1440x900   # a few screens
npm run atlas:compare -- artifacts/atlas/<before> artifacts/atlas/<after>
```

| Option | Default | Meaning |
|---|---|---|
| `--base-url` | `http://localhost:4000` | the running app |
| `--out` | `artifacts/atlas/<UTC timestamp>/` (git-ignored) | output folder; a second run into the same folder replaces only the shots it retakes |
| `--only` | every screen | comma-separated screen names from the manifest |
| `--core` | off | only the screens marked `core` in the manifest, at the sizes the screenshot check takes them |
| `--themes` | `light,dark` | written to `localStorage 'ah.theme'` before the app loads |
| `--sizes` | `1440x900,390x844` | viewport sizes |
| `--variant a\|b\|c` | none | written to `localStorage 'ah.variant'` |
| `--company`, `--project` | the account's only workspace; the project with the most views | which workspace and project the `:cid` and `:projectId` routes open |
| `--token-file` | `ATLAS_TOKEN_FILE` | file holding the session token when `ATLAS_TOKEN` is unset |

- **Session.** The app keeps its session in the `accessToken` cookie and in `localStorage` (`userId`, `selectedCompany`, `isLogging`); the atlas sets those from the token, so it never types a password. A demo token lasts an hour ([QA-DEMO-TEAM.md](QA-DEMO-TEAM.md)). The token is never printed or written to the output.
- **Read-only.** Every request that is not a GET is answered with a 403 inside the browser and never reaches the server, except the POSTs the app reads with, listed with their reasons in `scripts/atlas/readOnly.js`. The script's own lookups pass through the same filter. Setup steps in the manifest may only press a shortcut, open a menu, hover, scroll and wait. Two things follow: the Personal List shows its error state (opening it creates the list on a first visit, so that call stays blocked), and AI summaries stay empty. The refused requests are listed at the end of the run and in `atlas.json`.
- **Rate limit.** The server allows 1000 API requests a minute per address (`GLOBAL_RATE_LIMIT_PER_MIN`), and on one machine the atlas shares that count with every open tab. It reads the `RateLimit-*` headers, pauses while fewer than 300 are left and retakes a screen a 429 cut short, so a full run can stop for up to a minute at a time.
- **Add a screen** with one line in `scripts/atlas-manifest.js`; `tests/atlas-manifest.test.js` fails when its route is not one the router declares. Routes left out, and why, are in `LEFT_OUT` in the same file.
- **Compare** writes `before/`, `after/` and `diff/` images and an `index.html` ordered by the share of pixels that changed. It decodes PNGs with `sharp`, already a dependency; `--threshold` (default 8 of 255 per channel) sets how far a pixel must move to count.
- Chromium comes from Playwright: `npx playwright install chromium` once (the e2e suite needs the same).

### Screenshot check

The atlas shows a look; this check holds one. On every pull request to `beta` the `Visual` workflow (`.github/workflows/visual.yml`, job **Core screens**) opens the core screens, compares each with a PNG in `e2e/visual-baseline/` using Playwright's `toHaveScreenshot`, and fails when one differs. It is a workflow of its own, so a changed look never hides a failing functional test.

**What it covers.** The screens marked `core: true` in `scripts/atlas-manifest.js`: Home, Everything, the command palette, Docs, a doc, a dashboard, project List, Board and Table, the task panel and My settings, in light and dark at 1440x900. Those also marked `phone: true` (Home, List, Board, task panel) are taken at 390x844 too: 30 screenshots, viewport only. The data is the e2e harness seed (`e2e/support/fixtures.js`) plus one doc and one dashboard (`e2e/visual/global-setup.js`), in a database made for the run.

**Where it runs.** In CI only, inside `mcr.microsoft.com/playwright:v<version>-noble`, the image of the `@playwright/test` version in `package.json`; `tests/visual-report.test.js` fails when the two differ. Operating system, fonts and browser build are the same on every run. A screenshot made on macOS or Windows never matches, so `npm run visual` refuses to run outside CI. `VISUAL_LOCAL=1 npm run visual` runs it anyway, against a baseline in `e2e/.state/` that is never committed, which is how to debug the check itself (it needs `npm run e2e:db`, `E2E_MONGODB_URL` and a built frontend, like `npm run e2e`).

**Accept an intended change.** The failing run names the screens in its summary and uploads two artifacts: `visual-report` (the Playwright report with expected, actual and diff for each) and `visual-baseline` (the new screenshot of every changed or missing screen). Look at the diff, then:

```bash
npm run visual:accept -- <run id>   # the number in the run's address; needs `gh auth status` to pass
git add e2e/visual-baseline && git commit -m "test(visual): new baseline for <what changed>"
```

A pull request that changes a core screen on purpose carries the new PNGs in the same pull request.

**A screen with no baseline** is skipped, not failed, and its first screenshot is in the same `visual-baseline` artifact. That is how the baseline starts and how a new screen joins: add `core: true` (and `phone: true` if it matters at 390 px) to its manifest entry, push, accept the run. A route with a parameter the seed has no record for needs that record added in `e2e/visual/global-setup.js`. Removing the mark means deleting the screen's PNGs; `tests/visual-core.test.js` fails on a PNG that belongs to no core screen, and on a baseline over 10 MB (it is about 2 MB).

**What holds a screen still.**

- Clock: the page runs at 2026-01-14 10:00 UTC, `en-US` (`e2e/visual/freeze.js`), through Playwright's clock. Time moves on from there, because a frozen `Date` stops every debounce in the app.
- Dates from the server: the seed is stamped with the real time of the run. Every ISO date in an API response that falls inside the run is rewritten to 08:00 that morning, plus a millisecond per real second so records keep their order. Dates outside the run pass through. Socket messages are not rewritten.
- Writes: every request that is not a read is refused in the browser, with the atlas's list (`scripts/atlas/readOnly.js`), so one screenshot cannot change what the next one sees.
- Motion: animations and transitions off, reduced motion on, carets and focus outlines hidden, scrollbars hidden (`captureCss` in `e2e/visual/masks.js`). A screenshot is taken only once two in a row are identical.
- Fonts and images: the check waits for `document.fonts.ready` and for every image, and fails with its own message when Inter Tight did not load. The fonts come from Google Fonts, so that failure is the network, not the design.
- A screen that opens on "not found", "no access" or "offline" fails instead of becoming a baseline.

**What is masked or hidden** is listed with a reason each in `e2e/visual/masks.js`. Masked (painted over): the presence dot on avatars. Hidden (taken out of the layout): the live strip of running agents and timers, the running-agents count in the rail, toasts. Add an entry only for something the list above cannot hold still.

**Tolerance.** `THRESHOLD` (how far a pixel may move) and `MAX_DIFF_PIXEL_RATIO` (how much of a screenshot may) are in `e2e/visual/settings.js`. To measure the noise, re-run the job on one commit: with the baseline committed, any screen it reports is noise. `npm run visual -- --update` (the `update` input of the workflow, which GitHub offers once the workflow is on the default branch) goes further and proposes every screenshot whose bytes differ at all; `npm run atlas:compare -- e2e/visual-baseline <downloaded artifact>` then shows by how much.

The job is not a required check yet (`continue-on-error: true`). To make it one: commit the baseline, tune the tolerance, remove that line from the workflow and add **Core screens** to the required checks of `beta`.

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
