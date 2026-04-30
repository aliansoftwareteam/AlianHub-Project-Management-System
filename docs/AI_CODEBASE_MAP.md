# AI Codebase Map

## Purpose
This document is an engineering traversal map for AlianHub. It is meant for developers and AI agents who need to understand where the code lives, how the system starts, and which files are most likely involved in a change.

This is not user documentation. It assumes the reader is navigating a multi-app repository with one shared backend and several auxiliary clients.

## System At A Glance
AlianHub is a multi-application project management platform for IT companies with a shared backend and separate delivery surfaces.

- Root backend: Node.js + Express + MongoDB + Socket.IO
- Main web frontend: Vue 3 + Vue Router + Vuex
- Installer: separate Vue application used during setup
- Desktop time tracker: Electron + Nextron/Next + React + Redux

Key operational integrations:

- JWT-based auth and refresh-token session flow
- MongoDB multi-database connection management via dynamic connection helpers
- Storage abstraction that switches between Wasabi and server-local implementations
- Firebase configuration plus service worker registration in the web frontend
- Real-time sockets for tasks, chat, comments, companies, and notification counts
- AI prompt generation and AI model management endpoints
- Subscription and billing modules including Chargebee-related flows

## How The App Starts
The main runtime path is controlled from the repository root.

1. `server.js`
   - Starts `index.js` as a child process.
   - If `index.js` exits, it falls back to restarting through `server.js` again.

2. `index.js`
   - Creates the Express app.
   - Loads environment values and copies `.env` values into runtime config objects.
   - Serves static files from `frontend/dist` and `installation/dist` when not in maintenance mode.
   - Switches to `under-maintenance/` when `UNDER_MAINTENANCE` is enabled.
   - Starts Mongo connection lifecycle management through `middlewares/mongoConnector/helper.js`.
   - Chooses the storage provider dynamically through `common-storage/common-${process.env.STORAGE_TYPE}.js`.
   - Registers nearly all backend modules explicitly with `require(...).init(app)`.
   - Loads cron jobs in production through `cron.js`.
   - Registers Swagger through `Modules/swaggerAPI/init`.
   - Starts Socket.IO through `socket/socketinit.js`.

Important bootstrap behaviors to know before editing:

- `.env` is watched; changing it causes `initializeControllers()` to run again.
- Maintenance mode changes static serving and blocks most routes behind the maintenance page.
- Route initialization is centralized in `index.js`, not auto-discovered.
- Storage behavior depends on `STORAGE_TYPE`, so file changes may need both Wasabi and server storage paths checked.
- The app mixes old and new APIs, especially `v1`, `v2`, and some `v4` endpoints.

## Curated Repository Tree
The tree below is intentionally curated. It highlights the high-value engineering paths and omits low-signal assets such as most images and generated static resources.

```text
/
|-- index.js                          # Main backend bootstrap and module registration
|-- server.js                         # Process supervisor for index.js
|-- cron.js                           # Production cron entry
|-- package.json                      # Root runtime dependencies and scripts
|-- Config/                           # Runtime config, JWT middleware mapping, logger, env helpers
|   |-- config.js
|   |-- setMiddleware.js
|   `-- collections.js
|-- Modules/                          # Main backend business modules
|   |-- auth/                         # Login, registration, password, verification, invitation, sessions
|   |-- Company/                      # Company creation, deletion, update, invite and setup flows
|   |-- Project/                      # Project read/update/filter/tag/checklist flows
|   |-- tasks/                        # Task create/update/find/import flows
|   |-- sprints/                      # Sprint endpoints
|   |-- milestone/                    # Milestone operations
|   |-- settings/                     # Company-scoped settings, roles, permissions, templates, date formats
|   |-- Comments/                     # Comment APIs
|   |-- MainChats/                    # Main chat listing and find flows
|   |-- notification/                 # Notification middleware, preparation, email, app notifications
|   |-- TimeSheet/                    # Timesheet aggregations and reporting views
|   |-- logTime/                      # Manual log time and tracker capture endpoints
|   |-- trackerDownload/              # Time tracker download/distribution endpoints
|   |-- trackerUserPermission/        # Tracker access control
|   |-- subscription/                 # Subscription tab data and subscription lookup
|   |-- SubscriptionPlan/             # Subscription plan management
|   |-- Invoice/                      # Invoice operations
|   |-- SaasAdmin/                    # SaaS admin APIs
|   |-- AI/                           # Prompt generation, chat, AI model configuration
|   |-- oAuth/                        # OAuth base flows
|   |-- githubOAuth/                  # GitHub auth integration
|   |-- googleOAuth/                  # Google auth integration
|   |-- storage/                      # Provider-specific storage APIs
|   |   |-- wasabi/
|   |   `-- server/
|   `-- swaggerAPI/                   # Swagger init
|-- middlewares/                      # Shared infrastructure middleware
|   `-- mongoConnector/               # Connection cache, interval cleanup, connection creation
|-- socket/                           # Socket.IO bootstrap and namespace handlers
|   |-- socketinit.js
|   `-- controller/
|-- event/                            # Event emitter support
|   `-- socketEventEmitter.js
|-- common-storage/                   # Dynamic storage behavior and multer helpers
|   |-- common-wasabi.js
|   |-- common-server.js
|   `-- common.js
|-- frontend/src/                     # Main Vue web application
|   |-- main.js                       # Vue app bootstrap
|   |-- router/                       # Route grouping by auth, projects, chat, settings, reports, timesheet
|   |-- views/                        # Screen-level views
|   |-- components/                   # Shared Vue UI components
|   |-- store/                        # Vuex modules for project, settings, users, chats, tours
|   |-- services/                     # Axios wrappers, auth refresh, request cancellation
|   |-- composable/                   # Shared composition helpers
|   `-- plugins/                      # Feature plugins such as dashboard, import/export, OAuth, custom fields
|-- installation/src/                # Separate installer Vue app
|   |-- main.js
|   |-- router/
|   |-- views/InstallStep/
|   `-- services/
|-- time-tracker-app/                # Electron desktop tracker
|   |-- main/                         # Electron main process, preload, window helpers
|   |-- renderer/pages/               # Next pages such as login, home, trackerRunning, logentry
|   |-- renderer/components/          # React tracker UI components
|   |-- renderer/store/               # Redux store and slices
|   `-- renderer/controller/          # Tracker-side API/domain controllers
|-- public/                           # Static root assets served by backend
|-- utils/                            # Shared backend helpers, mongo connectors, general utilities
`-- under-maintenance/                # Maintenance mode static site
```

## Subsystem Map
### Authentication And Session Flow
- Responsibility: login, register, change password, refresh token behavior, invitation acceptance, email verification, logout.
- Primary entry files: `Modules/auth/init.js`, `Modules/auth/routes.js`, `Modules/auth/routes2.js`, `Modules/auth/session.js`, `frontend/src/services/index.js`, `frontend/src/router/index.js`.
- Key dependencies: JWT middleware in `Config/setMiddleware.js`, refresh token handling in frontend services, cookie storage, user/company bootstrap logic.
- Common changes: login API behavior, forgot password flow, tracker login flow, redirect-after-login behavior, refresh token handling.

### Company And User Management
- Responsibility: company creation, deletion, updates, member invitation, user-company assignment, preset company setup.
- Primary entry files: `Modules/Company/routes.js`, `Modules/Company/controller.js`, `Modules/Company/controller/updateCompany.js`, `Modules/usersModule/`, `Modules/settings/Members/`.
- Key dependencies: Wasabi bucket/user provisioning, company event streams, company-scoped JWT middleware, settings collections.
- Common changes: create company onboarding, company profile updates, invitation workflows, member administration.

### Project And Task Domain
- Responsibility: project browsing, project views, task creation/update/import, sprint/folder/project filters, tags, checklists.
- Primary entry files: `Modules/Project/routes.js`, `Modules/tasks/routes.js`, `Modules/createProject/`, `Modules/projectSetting/`, `frontend/src/router/projects/index.js`, `frontend/src/views/Projects/Projects.vue`, `frontend/src/store/ProjectData/`.
- Key dependencies: Mongo task helpers, global filter helpers, frontend project views, socket refresh behavior.
- Common changes: task creation/update logic, project detail behavior, board/list/table/calendar/workload view issues, filter bugs, task import.

### Timesheet And Tracker Domain
- Responsibility: manual log time, tracker capture, timesheet aggregates, workload, user/project/tracker timesheets, desktop tracker workflows.
- Primary entry files: `Modules/logTime/routes.js`, `Modules/TimeSheet/routes.js`, `Modules/trackerDownload/`, `Modules/trackerUserPermission/`, `time-tracker-app/main/background.js`, `time-tracker-app/renderer/pages/home.jsx`, `time-tracker-app/renderer/store/store.js`.
- Key dependencies: task endpoints, file capture/storage, tracker permissions, Electron IPC, screenshot and keyboard listeners.
- Common changes: manual time entry, tracker start/stop, screenshot capture, timesheet report bugs, tracker permission rules.

### Notifications And Chat
- Responsibility: notification preparation, delivery, unread counts, app notifications, main chats, email notifications.
- Primary entry files: `Modules/notification/notification-middleware/`, `Modules/notification/prepare-notification-data/`, `Modules/notification/sendEmail/`, `Modules/notification/app-notification/`, `Modules/MainChats/routes.js`, `socket/controller/chatSocket.js`, `socket/controller/userNotificationCount.js`.
- Key dependencies: sockets, email templates, notification settings, mentions/comments/task events.
- Common changes: unread notification counts, chat loading, delivery fan-out, notification email logic.

### Settings, Templates, And Customization Layer
- Responsibility: company configuration, roles, permissions, task/project status templates, date formats, custom fields, project tabs, templates.
- Primary entry files: `Modules/settings/`, `Modules/customField/`, `Modules/ProjectTemplates/`, `Modules/projectTabs/`, `frontend/src/plugins/customFieldView/`, `frontend/src/views/Settings/`.
- Key dependencies: settings collection doc IDs in `Config/collections.js`, frontend settings views, project/task rendering plugins.
- Common changes: role permissions, custom field behavior, template defaults, project tab configuration, company settings screens.

### Storage And Files
- Responsibility: file upload/download/delete, presigned URLs, profile image retrieval, local vs Wasabi storage behavior.
- Primary entry files: `common-storage/common-wasabi.js`, `common-storage/common-server.js`, `Modules/storage/wasabi/routes.js`, `Modules/storage/server/routes.js`, `Modules/MediaFiles/`.
- Key dependencies: `STORAGE_TYPE`, multer handlers, bucket configuration, Wasabi credentials, thumbnail generation.
- Common changes: upload bugs, presigned URL issues, profile images, file previews, storage provider switching.

### Billing And Subscriptions
- Responsibility: plan management, invoices, subscription fetch/update flows, referral and plan feature logic, SaaS admin management.
- Primary entry files: `Modules/subscription/`, `Modules/SubscriptionPlan/`, `Modules/Invoice/`, `Modules/PlaneFeature/`, `Modules/SaasAdmin/`, `frontend/src/plugins/chargebee/`, `frontend/src/plugins/paddle/`.
- Key dependencies: billing provider integration, admin/company APIs, frontend billing screens.
- Common changes: plan display, invoice retrieval, subscription update flow, admin billing controls.

### AI Features
- Responsibility: prompt generation, AI chat history, AI categories/models, AI-assisted template/task generation.
- Primary entry files: `Modules/AI/routes.js`, `Modules/AI/controller.js`, `Modules/AI/helper.js`, `frontend/src/composable/aiHelper.js`, `frontend/src/views/Settings/Template/CreateTemplateWithAI.vue`.
- Key dependencies: AI model config in env, SSE event flow for prompt generation, frontend feature entrypoints.
- Common changes: prompt generation behavior, model selection, AI template generation, AI chat persistence.

### Sockets And Real-Time Updates
- Responsibility: namespace setup, auth for socket connections, task/chat/comment/company/notification live updates.
- Primary entry files: `socket/socketinit.js`, `socket/controller/taskSocket.js`, `socket/controller/chatSocket.js`, `socket/controller/commentSocket.js`, `socket/controller/companiesSocket.js`, `socket/controller/userNotificationCount.js`, `frontend/src/store/index.js`, `frontend/src/composable/socketHelper.js`.
- Key dependencies: JWT secret, frontend socket instance in store, backend event emission paths.
- Common changes: stale live data, reconnect behavior, unread count updates, task detail realtime refresh.

## Where To Look For Common Changes
- Login or token issues: `Modules/auth/routes.js`, `Modules/auth/routes2.js`, `Modules/auth/session.js`, `frontend/src/services/index.js`, `frontend/src/router/index.js`
- Registration, invitation, or email verification: `Modules/auth/controller/`, `Modules/auth/routes2.js`, `frontend/src/views/Authentication/`
- Task creation or update behavior: `Modules/tasks/routes.js`, `Modules/tasks/helpers/task_class_Mongo.js`, `Modules/tasks/helpers/getTasksData.js`, `frontend/src/store/ProjectData/actions.js`
- Project views or navigation: `frontend/src/router/projects/index.js`, `frontend/src/views/Projects/`, `frontend/src/components/organisms/ProjectDetailRightSide/`, `Modules/Project/routes.js`
- Chat or notifications: `Modules/MainChats/routes.js`, `Modules/notification/`, `socket/controller/chatSocket.js`, `socket/controller/userNotificationCount.js`, `frontend/src/store/MainChats/`
- Custom fields: `Modules/customField/`, `frontend/src/plugins/customFieldView/`, `frontend/src/views/Settings/Template/`
- Time logging: `Modules/logTime/routes.js`, `Modules/TimeSheet/routes.js`, `frontend/src/views/TimeLog/`, `frontend/src/views/Timesheet/`
- Installer flow: `installation/src/main.js`, `installation/src/router/index.js`, `installation/src/views/InstallStep/`, `Modules/checkinstallstep/`
- Desktop tracker behavior: `time-tracker-app/main/background.js`, `time-tracker-app/renderer/pages/home.jsx`, `time-tracker-app/renderer/components/`, `Modules/trackerUserPermission/`
- Storage upload or download: `Modules/storage/wasabi/routes.js`, `Modules/storage/server/routes.js`, `common-storage/`, `frontend/src/components/organisms/ImagePreviewer/`
- Company settings and permissions: `Modules/settings/`, `Modules/Company/routes.js`, `frontend/src/views/Settings/`, `frontend/src/store/Settings/`
- Billing and plans: `Modules/subscription/`, `Modules/SubscriptionPlan/`, `Modules/Invoice/`, `Modules/SaasAdmin/`, `frontend/src/plugins/chargebee/`
- AI features: `Modules/AI/`, `frontend/src/composable/aiHelper.js`, `frontend/src/views/Settings/Template/CreateTemplateWithAI.vue`

## Cross-Cutting Patterns
- Backend modules usually follow `init.js` plus `routes.js` and `controller.js` or `controller/` helpers.
- Most backend route mounting is done centrally in `index.js`, not through a plugin loader or framework convention.
- Frontend API access is centralized through `frontend/src/services/index.js`, including auth refresh and cancellation behavior.
- Frontend state is centralized in Vuex modules under `frontend/src/store/`, with socket-sensitive reload behavior wired in `frontend/src/store/index.js`.
- The Vue frontend mixes classic view directories with feature plugins under `frontend/src/plugins/`, so a UI feature may live outside `views/`.
- Socket behavior is isolated in `/socket`, but frontend updates often appear indirectly through Vuex watchers and composables rather than direct component calls.
- Storage behavior is dynamic: backend code commonly imports `common-${process.env.STORAGE_TYPE}.js`, so file changes may require verifying both Wasabi and server providers.
- Environment values materially shape runtime behavior, especially storage type, maintenance mode, API URLs, AI model selection, and Mongo connectivity.

## Known Architectural Risks
- `index.js` is a large concentration point. Startup, routing, storage selection, cron loading, Swagger, and socket bootstrapping are all coupled there. A change in bootstrap behavior can break multiple surfaces at once.
- Route registration is manual and centralized. Missing a new `require(...).init(app)` or registering a route in the wrong module can silently make a feature unreachable.
- API versioning is inconsistent. `v1`, `v2`, and even `v4` endpoints coexist, so behavior changes can leave older clients partially broken if only one version is updated.
- Automated test coverage appears minimal to absent. `package.json` has no real test runner, and repository-wide test files were not found in the current tree. Manual verification is part of every meaningful change.
- The frontend tree is asset-heavy. Discovery noise is high, especially under `frontend/src/assets` and component directories, so changes should start from routes, stores, and views, not broad file browsing.
- Some backend update paths dispatch dynamically by action name, such as task patch behavior calling `taskMongo[req.body.action](req.body)`. That increases runtime risk from naming drift and partial refactors.
- Environment-driven behavior can hide production-only failures. Storage provider, cron activation, maintenance mode, and external integrations may work differently across local, staging, and production environments.

Before editing, future agents should verify:

- whether the target behavior is powered by API routes, sockets, or both
- whether the affected path is web-only or also used by installer or tracker
- whether the storage provider changes code paths
- whether there is a second API version serving the same feature

## Working Assumptions For Future AI
- Start from entrypoints first: `server.js`, `index.js`, frontend `main.js`, installer `main.js`, tracker `main/background.js`.
- For backend changes, go from module `init.js` to `routes.js` to controller/helper files.
- For frontend changes, go from router entry to top-level view, then Vuex store, then service layer.
- For task, chat, comment, notification, and time-tracking changes, inspect both API routes and socket handlers.
- For file and media changes, check `common-storage/` and the active provider under `Modules/storage/`.
- Verify whether the requested change also touches the installer or the desktop tracker before assuming the web app is the only client.
- Expect weak automated safety nets. Plan manual validation steps as part of implementation.
