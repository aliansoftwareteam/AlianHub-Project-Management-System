# Progress: Redesign stage 1

## Checklist
- [x] Confirm direction (handoff tokens supersede kiln) and scope with user — decided 2026-09-03: handoff wins; build everything stage by stage; branch feat/redesign-stage1
- [x] Tokens + fonts
- [x] Login + auth states (Login.vue, SsoLogin.vue, AuthShell; magic-link + SSO discover backend)
- [x] Global rail shell + More menu + mobile tab bar (Shell/*, App.vue; old header behind localStorage ah.legacyNav=1)
- [x] Home / Today & Overdue + first run
- [x] Task detail overlay
- [x] Personal List
- [x] Build + tests

## Last step
Stage 1 complete and verified in the running app: build green, 776 backend tests pass, login/rail/Home/AI all render against real data.

## Blockers
None. Kiln tokens retired (aliases kept in tokens.css until Pages is restyled).

## Log

### 2026-09-03
- Task created from `Alianhub UI mockups and redesign.zip`.
- Found: handoff is ~120 HTML-drawn screens; README names seven stage-1 screens (5a, 5b, 5c, 5d, 12a, 12b) and a 5-stage build order (turn 23).
- Found: repo is Vuex 4 not Pinia; header is a 58px top bar (`organisms/Header`, `NavLinks`) currently mid-restyle to the kiln theme; login is `views/Authentication/Login` (583 lines + 473 css); task detail is a route (`views/TaskDetail`).
- Found: backend already has `Modules/Agents`, `Audit`, `SSO`, `Milestone`, `Invoice`, `Pages` — later stages mostly need UI, not new models, except Provenance of Done (turn 29).

### 2026-09-03 (build)
- tokens.css rewritten to handoff tokens + `ah-*` primitives; fonts → Inter Tight / JetBrains Mono; theme via `data-theme`.
- Shell: `components/organisms/Shell/{GlobalRail,MobileTabBar,ShellPanels,ShellIcon,ContextSidebar?,navItems,shellState,style.css}`; App.vue renders `.ah-app`; `Dashboards` route added for the old card dashboard.
- Login 5a + states 5b in `Login.vue`; SSO 6a in `views/Authentication/Sso`; provider buttons labelled; `plugins/oauth/ProviderButton.vue`.
- Backend: `POST /api/v2/auth/magic-link`, `GET /api/v2/auth/magic-link/verify` (MAGIC_LINK_ENABLED), `GET /api/v2/sso/discover?email=`; ssoConfigs +displayName/domains/enforcement; `checkUserAndCompany` now returns `companies` for the workspace switcher; `finalizeSession` takes an `onSuccess`.
- Gotcha: vue-i18n treats `@` as linked-message syntax — a raw `@` in en.js blanked the whole app ("Invalid linked format"). Escape as `{'@'}`.

### 2026-09-03 (integration)
- Nine build agents ran; all but one were cut off mid-task by a usage limit. Their finished work was integrated by hand.
- Repaired what the interrupted agents left: `Modules/Mcp` (referenced by index.js and ApiTokens but never written — the API would not boot without it), `views/Chat/CallNotes.vue` (routed but missing), `views/Planner/style.css`, duplicate `ShellIcon` keys, duplicate `ChatV2` locale keys, an unused import, a single-word component name.
- Fixed two failing tests: `sso-rules` (my deliberate publicSsoView change — now asserts displayName + enforcement and still asserts no secret leak) and `share-rules` (pre-existing: `page` had been added to the shareable types without updating the test).
- Verified live, logged in: login inline errors, rail + More + profile popovers, dark theme, Home Today & Overdue with sidebar and Planner, AI Hub, agent wizard creating a real agent, AI Inbox approve/decline with the queue-clear state.
- Verified the safety boundary against the live API, not just unit tests: `task.delete` → "Agents cannot perform task.delete"; `status.set("Done")` → refused; `task.comment` → accepted.
- Dark-theme bug found and fixed during verification: the compatibility rule that keeps legacy pages readable was also forcing light ink onto redesigned pages, so their text was near-invisible in dark mode. `.ah-page` now sets `var(--ink)` explicitly, and the redesigned pages built before that convention existed (Docs, Settings, Inbox, Chat, Approvals, Timesheet, Capacity, Variance) were given the class.
