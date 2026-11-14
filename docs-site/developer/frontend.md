# Frontend

The web app is a Vue 3 single-page app in `frontend/`, built with Vue CLI into `frontend/dist`, which the Express server serves. This page maps `frontend/src`, shows how a screen is added, and explains the build and the installable app's service worker.

## Stack

| Piece | Version (from `frontend/package.json`) |
|---|---|
| Vue | 3.5 |
| Vue Router | 4.5, hash history (`createWebHashHistory`), so addresses look like `/#/<companyId>/...` |
| Vuex | 4.1 |
| vue-i18n | 9.14 |
| socket.io-client | 4.8.1 |
| Build | Vue CLI 5 (`vue-cli-service`) |
| Tests | Vitest 2 with `@vue/test-utils` in jsdom |

## The `frontend/src` tree

| Folder | What lives there |
|---|---|
| `main.js`, `App.vue` | App start-up (theme, i18n, plugins, the service worker) and the shell: `App.vue` connects the socket and draws the shell around routes that need sign-in |
| `views/` | One folder per area: `Projects/`, `Home/`, `Inbox/`, `Pages/`, `Goals/`, `Ai/`, `Settings/`, `Timesheet/`, `Automations/`, `Workflows/`, … Project views (List, Board, Table, Gantt, Calendar, Workload and more) are under `views/Projects/` |
| `components/` | Shared components in atomic layers: `atom/` (small pieces such as `EmptyState`, `Checkbox`), `molecules/`, `organisms/` (the shell in `organisms/Shell/`: `GlobalRail.vue`, `ContextSidebar.vue`, `MobileTabBar.vue`, `navItems.js`) and `templates/` |
| `router/` | `router/index.js` plus one file per area (`router/projects/`, `router/home/`, `router/settings/`, …). Pages are lazy-loaded with a webpack chunk name |
| `store/` | Vuex modules: `Settings`, `ProjectData`, `Users`, `MainChats`, `Everything`, `Goals`, `TaskSelection`, `brandSettings` |
| `composable/` | Shared composition functions (`socketHelper.js`, `projects.js`, `agentProposals.js`, …). `composables/` holds one more (`useClipRecorder.js`) |
| `services/` | The axios instances and `apiRequest()`, `apiRequestWithoutCompnay()` and `apiRequestWithoutSecure()`. `apiRequest` sends the `companyid` header |
| `locales/` | `en.js` (the source of every string), one file per other locale, and `<locale>.pending.json` lists of keys waiting for a translator. `main.js` creates the i18n instance |
| `assets/css/` | `tokens.css` (design tokens and the `ah-` classes) and the older utility sheets |
| `config/` | `env.js` (build-time `VUE_APP_*` values), public config, chunk recovery, Firebase |
| `plugins/` | Self-contained features (custom field views, dashboards, import tasks and users, OAuth, billing) |
| `offline/` | The app's offline store |
| `serviceWorker/` | The hand-written service worker (`worker.js`, `rules.js`) and its registration |
| `utils/` | Small helpers |

## Add a screen

1. Put the page under `frontend/src/views/<Area>/`.
2. Lazy-load it from `frontend/src/router/<area>/index.js`, with `meta.requiresAuth` and `meta.title`. A real route, from `router/home/index.js`:

   ```js
   {
       path: '/:cid/planner',
       name: 'Planner',
       meta: {
           title: 'Planner',
           requiresAuth: true
       },
       component: () => import(/* webpackChunkName: "planner" */ '@/views/Planner/Planner.vue')
   },
   ```

3. Add its text to `frontend/src/locales/en.js` under the area's namespace (see [Translations](./i18n)).
4. If the page is a destination, add a rail or More entry in `frontend/src/components/organisms/Shell/navItems.js`.
5. Build the UI from the shell's pieces (`ShellIcon`, panels), `views/Projects/components/ProjectHeader.vue` for project pages and `components/atom/EmptyState` for empty states. Style with tokens (see [Design tokens and styles](./design-tokens)).
6. Add a spec in `frontend/tests/` (see [Testing](./testing)).

## Data and real-time

Screens call the API through `services/index.js` and keep shared state in the Vuex store. Live updates arrive over the socket that `App.vue` opens; see [Real-time (Socket.io) events](./socket-events).

## Build and run

| Command (in `frontend/`) | What it does |
|---|---|
| `npm run serve` | Dev server on port 8080. `vue.config.js` proxies the API paths to `http://localhost:4000` |
| `npm run build` | Production build into `frontend/dist` (2 to 3 minutes) |
| `npm run build-report` | The build with a bundle report |
| `npm test` | Vitest, `tests/**/*.spec.js` |
| `npm run lint -- --no-fix` | ESLint without changing files |

The backend serves `frontend/dist`, so after a frontend change either use the dev server or rebuild. `node scripts/unused-components.js` (from the repository root) lists `.vue` files nothing imports and must print nothing.

## The installed app and its service worker

The web app can be installed (`frontend/public/manifest.webmanifest`) and its shell opens with no network.

- A production build writes `sw.js` (`frontend/shellWorkerPlugin.js`): the list of the build's files, then `frontend/src/serviceWorker/rules.js` and `worker.js` as they are. The worker is hand-written and has no dependency.
- The dev server has no worker. The app registers one only in a production build, in a browser, on a secure address (`registration.js`); the desktop app never does.
- At install it holds what a first paint needs (`index.html`, the manifest, entry and vendor scripts and styles, the sign-in chunk, fonts and icons). Other hashed files are kept the first time a page asks for them.
- It never answers a non-GET request, another origin, an address with a query string, a request carrying `Authorization`, `companyid` or similar headers, or any path the server answers itself (`RESERVED_SEGMENTS` in `rules.js`: `/api`, `/socket.io`, `/mcp`, `/oauth`, …). `tests/app-shell-worker.test.js` fails when a new top-level server path is missing from that list.
- On sign-out and on a workspace switch the app tells the worker to delete every cache except the builds'.
- A new build waits; a tab on the old build shows "A new version is ready" with Reload and Later. No tab reloads by itself.
- `APP_SHELL_WORKER=off` withdraws it: `/sw.js` then answers with a worker that deletes every cache and unregisters itself (`Config/appShellWorker.js`).

The full account, including why it cannot loop, is in `docs/DEVELOPER-GUIDE.md` under "The installed app and its service worker".

## The desktop time tracker

`time-tracker-app/` is a separate Electron app with its own `package.json` (`npm run dev`, `npm run build`, `npm run build:linux`). It talks to the same API.

## Related

- [Translations (i18n)](./i18n)
- [Design tokens and styles](./design-tokens)
- [Testing](./testing)
- [Desktop time tracker](/user-guide/time-tracker-app)
