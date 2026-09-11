# End-to-end testing

AlianHub has two end-to-end layers on top of the unit and convention tests. Both run against a real server (`node index.js`), a real MongoDB and, for the UI layer, the real built frontend in Chromium.

| Layer | Runner | Files | Command |
|-------|--------|-------|---------|
| API integration | Jest project `integration` | `tests/integration/<area>.int.test.js` | `npm run test:integration` |
| UI | Playwright (Chromium) | `e2e/specs/<area>.spec.js` | `npm run e2e` |

Neither layer runs in `npm test`, which stays unit + conventions only. CI runs both in the `e2e` job on every pull request to `beta`, `staging` and `main`.

## Running locally

Requirements: Node 20, Docker, and a frontend build (the server serves `frontend/dist`).

```bash
cd frontend && npm run build && cd ..   # once, and again after frontend changes
npm run e2e:db                          # starts alianhub-e2e-mongo on port 27018 (safe to re-run)
export E2E_MONGODB_URL=mongodb://127.0.0.1:27018
npx playwright install chromium         # once per machine
npm run test:integration
npm run e2e
npm run e2e:db:stop                     # when you are done
```

The Playwright HTML report lands in `e2e/report` (`npx playwright show-report e2e/report`). Server output for each run is in `e2e/.state/integration-server.log` and `e2e/.state/e2e-server.log`.

### The suite never touches your data

- It only talks to the database in `E2E_MONGODB_URL`. Global setup refuses to start when that variable is missing, or when it points at port 27017 (where the `alianhub-mongo` development container listens) outside CI.
- Every run **drops every database** on that instance before it starts, because the setup wizard only runs on an empty instance. Never point `E2E_MONGODB_URL` at a database you care about.
- The server is started with an environment built from scratch and does not read the repository `.env`, so your mail, AI and OAuth credentials are never used.
- Uploaded files go to `storage/<companyId>` (local storage has no configurable root). Teardown deletes the folders of every company in the test database; nothing else under `storage/` is touched.
- Do not run both layers at the same time against the same database: each run wipes it.

## How the harness works

`e2e/support/` holds everything both layers share:

| File | What it does |
|------|--------------|
| `env.js` | Resolves `E2E_MONGODB_URL` and enforces the port rule. |
| `database.js` | Drops the test databases before a run; lists companies for cleanup. |
| `server.js` | Starts `node index.js` on a free port with a random `JWT_SECRET`, `STORAGE_TYPE=server`, a temp log/backup directory, migrations on, cron off, the automation engine on its inline queue, rate limits off, no AI keys, and mail pointed at a closed port. Waits for `/health` to return 200, and kills the process on teardown. |
| `harness.js` | One run = reset database, start one server, create fixtures, write `e2e/.state/run.json`. |
| `fixtures.js` | Fixture creation and the helpers tests use: `loginAs`, `createProject`, `createTask`, `inviteMember`, `readState`, `storageStatePath`. |
| `api.js` | `createApiClient`, a small wrapper over the built-in `fetch`. Calls resolve to `{ status, body, headers }` and never throw on 4xx/5xx. |
| `pages.js` | Shared UI steps: `signInThroughForm`, `settingsNav`. |
| `test.js` | The Playwright `test` to import in specs, with `state`, `loginAs` and `asRole`. |
| `global-setup.js` | Playwright global setup: starts the harness, then signs every role in through the real login form and saves its storage state. |

Jest uses `tests/integration/globalSetup.js` / `globalTeardown.js`, which call the same `startHarness`.

### Fixtures and roles

Everything is created through the real HTTP APIs, in this order:

1. **Owner** — `POST /api/v2/setup/complete`, the setup wizard, with `sampleData: false`. This creates the owner (`users.isProductOwner`, the instance owner) and the company.
2. **Admin, member, guest** — through the same calls the invitation page makes, without mail:
   1. the owner calls `POST /api/v2/sendInvitationEmail` with the role; the `company_users` row is saved and returned even though delivery fails (mail points at a closed port);
   2. the invitee registers with `POST /api/v2/createUser` and `isInvitation: true`, which is what marks the email verified and assigns the company;
   3. signed in as the invitee, `PUT /api/v1/root-members` links the row and sets `status: 2`, then `POST /api/v1/importSettingsNotification` and `POST /api/v1/removeUserNotification` finish what `Invitation.vue` does.
3. **Projects** — `POST /api/v1/createproject` with the Blank template: `E2E Shared Project` (every role assigned) and `E2E Owner Only` (private, owner only).
4. **Tasks** — three tasks in the shared project through `POST /api/v2/tasks`.

| Role | `roleType` | Email | Notes |
|------|-----------|-------|-------|
| `owner` | 1 | `owner@e2e.alianhub.test` | Instance owner; sees the Instance section |
| `admin` | 2 | `admin@e2e.alianhub.test` | |
| `member` | 3 | `member@e2e.alianhub.test` | |
| `guest` | 0 | `guest@e2e.alianhub.test` | Most restricted role |

Every account uses the password in `PASSWORD` (`fixtures.js`). The run state (`readState()` / the Playwright `state` fixture) holds `baseURL`, `companyId`, `password`, `users.<role>` (`email`, `userId`, `roleType`), `projects.shared` / `projects.restricted` and `tasks`.

## Rules for every test

1. **Create your own data.** The shared fixtures (company, the four users, two projects, three tasks) are read-only context. If a test changes something, it creates that thing first with `createProject`, `createTask` or `inviteMember`, and uses `uniqueSuffix()` for names and codes.
2. **Never depend on test order.** Any test must pass when run alone (`npx playwright test -g "<title>"`, `npx jest -t "<title>"`) and in parallel with every other test. No test reads what another test wrote.
3. **Assert through the product.** Sign in with `loginAs` or a role's storage state; do not write to MongoDB from a test.
4. **Keep strings stable.** UI assertions use the English copy from `frontend/src/locales/en.js` or a `data-test` attribute. Add a `data-test` to the component when a selector would otherwise depend on layout.
5. **A known product bug stays visible.** Write the correct assertion and mark it `it.failing(...)` (Jest) or `test.fail(...)` (Playwright) with a one-line reason. It passes while the bug exists and fails once fixed, which is the reminder to flip it.

## Adding a feature area

Say the area is `timesheets`.

### 1. API tests: `tests/integration/timesheets.int.test.js`

```js
const { createProject, createTask, loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();

describe('timesheets', () => {
    it('lets a member log time on a task in their project', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid, member.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });

        const res = await member.api.post('/api/v2/...', { taskId: task._id /* ... */ });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('refuses a guest', async () => {
        const guest = await loginAs('guest');
        const res = await guest.api.get('/api/v2/...');
        expect(res.status).toBe(403);
    });
});
```

- `loginAs(role)` performs a real `POST /api/v2/auth/login` and returns `{ uid, accessToken, refreshToken, companyId, email, roleType, api }`. `api` sends `authorization: Bearer <token>` and `companyid` on every call; use `api.withCompany(otherId)` to aim at another company.
- For an unauthenticated call use `createApiClient({ baseURL: state.baseURL })` from `e2e/support/api.js`.
- Run just your file: `npx jest --selectProjects integration tests/integration/timesheets.int.test.js`.

### 2. UI tests: `e2e/specs/timesheets.spec.js`

```js
const { test, expect, asRole } = require('../support/test');

test.describe('timesheets as a member', () => {
    test.use(asRole('member'));

    test('shows the week grid', async ({ page, state }) => {
        await page.goto(`/#/${state.companyId}/timesheet`);
        await expect(page.getByRole('heading', { name: 'Timesheet' })).toBeVisible();
    });
});

test.describe('timesheets as the owner', () => {
    test.use(asRole('owner'));

    test('shows a task created for this test', async ({ page, state, loginAs }) => {
        const owner = await loginAs('owner');
        // create what the test needs through owner.api, then drive the page
        await page.goto(`/#/${state.companyId}/timesheet`);
    });
});
```

- `asRole(role)` sets `storageState` to the session global setup saved by signing that role in through the real login form, so the page opens already signed in. Without it a test starts signed out; use `signInThroughForm` from `../support/pages` when the sign-in itself is under test.
- `baseURL` is already the harness server; navigate with hash routes (`/#/<companyId>/...`).
- The `state` and `loginAs` fixtures are the same as in the API layer, so a UI test can prepare data through the API first.
- Run just your file: `npm run e2e -- e2e/specs/timesheets.spec.js`, or add `--headed` / `--debug` to watch it.

### 3. Before you open the PR

- `npm run test:integration` and `npm run e2e` pass locally.
- The new tests pass on their own and with the whole suite.
- If you needed a new fixture helper, add it to `e2e/support/fixtures.js` (or `pages.js` for UI steps) and document it in the tables above instead of copying setup code between files.
