# Follow-ups from the QA programme (task 034)

Items the fix PRs found and deliberately left out, plus bugs and harness problems the suites exposed. Each needs its own change; none is scheduled yet unless the row says so.

## Security and correctness

| # | Item | Source | Why it was left |
|---|---|---|---|
| 1 | Any company member can update the company document through `PUT /api/v1/admin/company` and `PUT /api/v1/company`. | #615 (access) | A role gate there would affect how member counts are updated, so it needs its own change. Fixed by #633 (build 109). |
| 2 | Project filters in `Modules/Project/controller/manageGlobalFilter.js` aren't bound to their owner, the same hole as TSK-07. | #610 (visibility) | They live in the project module, which the project-edit fix owned. Fixed by #632 (build 108). |
| 3 | `GET /api/v1/task/:id` reads any task in the company without a project-visibility check. | #606 (task query) | Outside the allowlist fix. Fixed by #632 (build 108). |
| 4 | Tasks in a private sprint are still returned when the member can see the project. | #606 (task query) | Existing behaviour, left as it was. Fixed by #656 (build 129). |
| 5 | `storage/uploadFile` saves the file before its access check, and doesn't check live membership. | #611 (storage) | Out of scope. Fixed by #639 (build 121). |
| 6 | Any logged-in user can overwrite or delete any `USER_PROFILES` image. | #611 (storage) | Binding images to their owner needs a path layout that includes the user id. Fixed by #639 (build 121). |
| 7 | The bucket-size cron has a syntax slip, `then(` without a dot, so its update never succeeds. | #611 (storage) | It isn't on a route. Fixed by #639 (build 121). |
| 8 | The access token payload still embeds the plaintext refresh token. | #609 (refresh token) | Changing it touches every guard. Fixed by #638 (build 115). |
| 9 | `TrackerLogin.vue` passes the refresh token in a URL. | #609 (refresh token) | Out of scope. Fixed by #638 (build 115). |
| 10 | Old tracker builds that don't send `userId` can no longer log in with a legacy refresh token. | #609 (refresh token) | Upgrade note: new-format tokens work without it. Fixed by #638 (build 115). |
| 11 | The invitation preview endpoint should require the invite link token. | #616 (mongo gateway) | It changes the invitation link format. Fixed by #654 (build 131). |
| 12 | `sendVerificationEmail` sends the link to any email given in the request. Invite and verification tokens are 8 `Math.random` characters. | #600 (unauth routes) | Left with a stated reason in the PR. Fixed by #633 (build 109). |
| 13 | `setPresetCompany` and `/connections` take the preset key in the URL, so it can end up in logs. | #600 (unauth routes) | Left with a stated reason in the PR. Fixed by #655 (build 130). |
| 14 | Some handlers still read user and company ids from the request body after login. | #600 (unauth routes) | Tracked by the tenant-scoping conventions baseline. | Sampled 2026-09-20: the residue is transport fallbacks (MCP transports, SSO redirects, direct links, tracker clients that cannot set headers) and defended header-first reads with mismatch refusal (e.g. `getUserByQuey`); each needs a product decision per client, not a blind sweep — owner review queue.
| 15 | Webhooks to private or internal hosts are now refused, and self-hosted installs have no opt-out. Planned fix: an instance-owner allowlist, empty by default and rechecked when a webhook fires. | reports fix (REP-04) | Pending owner confirmation. Fixed by #647 (build 122). |
| 16 | `markUndone` in `Modules/Agents/undo.js` swallows its own failure. | Sprint 0 (#558) | Planned for Sprint 8. | Fixed by #770 (build 242).
| 16a | `POST /api/v1/invoice/find` (subscription invoices) isn't scoped to the caller's company, so any signed-in user can query another company's invoices. Nothing in the repo calls the route. | time fix (TIM-05) | The field to scope by couldn't be confirmed. Fixed by #635 (build 120). |
| 16b | `refuseGuest` in `Modules/Milestone/controller/billing.js` checked roleType 4 instead of guest 0. | time fix | Fixed by #594 (fb1afc52). |
| 16c | Main timesheet reads (`/timesheet/user`, `project`, `workload`, `tracker`, `/timesheet`) trust filters sent by the client. | time fix | Outside TIM-04. Fixed by #635 (build 120). |
| 16d | `draft-from-milestone` still creates a draft on a project that has no billing contract. | time fix | Only `draft-from-month` was in TIM-06. Fixed by #635 (build 120). |
| 16e | The lint-staged pre-commit hook should run with `--no-stash`, so its automatic backup stops touching the shared stash. | several agents | Repo process change. Fixed by #634 (build 110). |
| 17 | Server-side permission-catalogue enforcement for browser sessions (defect 2). Role and membership gates are added per route, but the report-only rollout is still Sprint 8, task 031. | instance fix, project isolation | Belongs to Sprint 8. | Fixed by #743 (build 218) and #754 (build 228).
## Product bugs found by the tests

| # | Item | Source |
|---|---|---|
| 18 | `POST /api/v1/createproject` returns before it creates the default "List" sprint, so a task created straight after it can find no sprint. Tests wait for the sprint since #619; the product still races. | #612, #604, #619 Fixed by #637 (build 118). |
| 19 | A task-created event reaches automation rules without being awaited. Runs go `queued`, `running`, `success` after the response returns. Tests now poll for the result. | integration isolation Fixed by #642 (build 112). |
| 20 | Settings → General returns 404 for its three priority icons on the local server; not confirmed in the harness. | instance QA Fixed by #634 (build 110). |
| 21 | `/firebase-messaging-sw.js` is gitignored and only created by `frontend/config.sh`, so a plain build serves a 404 on every page. | #604 Fixed by #634 (build 110). |

## Test harness and process

| # | Item | Source |
|---|---|---|
| 22 | Jest ignored the integration project's `testTimeout: 60000`, so tests ran with the 5 s default. | Fixed by #619 (build 90). |
| 23 | `instance.int.test.js` turns maintenance mode on for the shared server, which breaks parallel local runs with `--maxWorkers>1`. CI runs `--runInBand`. Document this in `docs/TESTING-E2E.md`. | several agents Fixed by #634 (build 110). |
| 24 | `@playwright/test` isn't installed in the main checkout's `node_modules`, so a fresh local checkout can't run Playwright until `npm install`. | several agents Fixed by #634 (build 110). |
| 25 | The lint-staged pre-commit hook makes its own `git stash` backup, which briefly hides uncommitted files from parallel test runs. Some agents then committed with `--no-verify` and ran the checks by hand. | several agents Fixed by #634 (build 110). |
| 26 | Agents share one scratchpad and overwrote each other's `pr-body.md`. Future prompts should require a unique file prefix. | several agents | Fixed by this log PR: unique scratchpad prefixes recorded in HANDOFF Things learned.
| 27 | `e2e/specs/access.spec.js` "Two-factor and change-password screens render" is flaky: the second hash-only `page.goto` keeps the Two-Factor title for 15 s. It failed on #608 (flaky) and on #626 (both attempts), neither of which touches settings or the router. | CI on #608, #626 Fixed by #631 (build 107). |

## Found while fixing (task 035)

| # | Item | Source |
|---|---|---|
| 28 | Invite links in three of the four places in `Modules/Auth/controller/sendInvitation.js` end with a stray `)}`. | #633 Fixed by #640 (build 111). |
| 29 | Owners and admins can write any company field through the company update routes, including plan and subscription fields. | #633 Fixed by #643 (build 116). |
| 30 | `getRoleType` ignores whether a member row is deleted or pending; removed members are still stopped by the login membership check. | #633 Fixed by #652 (build 127). |
| 31 | `Login.vue` and `VerifyEmail.vue` still send `email` in the resend-verification request, which the server now ignores. | #633 Fixed by #641 (build 113). |
| 32 | Creating a project filter with another user's id answers 200 and stores it under the caller, while the task-filter side answers 403. Decision (owner, 2026-09-21): refuse with 403, matching task filters. | #632 |
| 33 | Settings → General logs `TypeError: Cannot read properties of undefined (reading 'isoCode')` in the test harness. | #634 Fixed by #641 (build 113). |
| 34 | Socket handshakes check only the JWT signature, not that the session is still live, so a logged-out access token can still open a socket until it expires. | #638 Fixed by #654 (build 131). |
| 35 | Auth cookies are readable by JavaScript (not `httpOnly`), tracked as P1-SEC-09. | #638 | Fixed by #780 (build 251).
| 36 | `/timesheet/timelog`, `/timesheet/logDetail`, `/timesheet/milestone` and `POST /api/v1/estimatedTime` still trust client filters or pipelines; #635 scoped the five main timesheet reads only. | #635; read side fixed by #635 (build 120); fixed: reads #635 (build 120), writes #650 (build 125), per-task reads #656 (build 129) |
| 37 | The `invoices` (subscription) collection has no company field and nothing in the repo writes it; `POST /api/v1/invoice/find` is limited to the instance owner until its producer is known. Decision (owner, 2026-09-21): keep it instance-owner only; remove the route if nothing writes the collection by the next release. | #635 |
| 38 | Profile images under `USER_PROFILES/` can be read by any signed-in user, including the credit-note PDFs stored in `USER_PROFILES/InvoiceAndCreditNotes/`. | #639 Fixed by #651 (build 126). |
| 39 | `PUT /api/v1/user` accepts any value for `Employee_profileImage`, so a user can point their profile at another user's image path. | #639 Fixed by #651 (build 126). |
| 40 | `Modules/LogTime/routes.js` uses the same upload storage without the early access check #639 added to `storage/uploadFile`. | #639; being fixed in #639 after review Fixed by #639 (build 121). |
| 41 | `POST /api/v2/generateToken` answers 400 with the raw `users` document (including `verificationToken`) when a refresh token belongs to an account that became unverified. | #644 Fixed by #649 (build 124). |
| 42 | `POST /api/v2/createUser` and the Google, GitHub and GitLab sign-up routes return the saved `users` document unfiltered to the registrant; no secret is in it today, but it should go through `toSelfView`. | #644 Fixed by #649 (build 124). |
| 43 | The tracker sign-in code from #638 is not bound to the tracker that asked for it (no PKCE or state): an app that claims the `myapp://` scheme can redeem an intercepted code, and a crafted link can sign a signed-out tracker into another account. | review of #638 Fixed by #653 (build 128). |
| 44 | No test proves the access-token session lookup is bound to the token's `uid`; removing the `userId` filter in `Config/jwt.js` leaves every suite green. | review of #638 Fixed by #653 (build 128). |
| 45 | `getRoleType` in `Config/permissionGuard.js` matches deleted and pending `company_users` rows; #643 checks the active seat itself in `updateCompany`, but other callers still trust the stale role. | #643 Fixed by #652 (build 127). |
| 46 | `PUT /api/v1/admin/company` and `/api/v1/company-invitation` skip the live membership re-check, and `requireCompanyAud` in `Config/jwt.js` checks the body company before the header. | #643 Fixed by #652 (build 127). |
| 47 | An invited owner who accepts through `/verify-invitation` or an OAuth sign-up is never recorded as the company owner. | #643 Fixed by #655 (build 130). |
| 48 | A private sprint assigned to a team (`AssigneeUserId` holding `tId_` ids) is not recognised for members of that team; no existing filter expands team ids. | #656 (build 129) Fixed by #662 (build 137). |
| 49 | The scrum board, reports, public shares, dashboards and the `?count=true` task path still guard at project level only, not per sprint. | #656 (build 129) Fixed by #662 (build 137). |
| 50 | `Auth.tracker_body` was reworded in `en.js` under the same key, so the other 13 locales still carry the old sentence. | #653 (build 128) Fixed by #659 (build 134). |
| 51 | The estimate planner's success toast fires before its saves settle. | #650 (build 125) Fixed by #659 (build 134). |
| 52 | The team list was cached under a bare `teams` key with no company, so one company's teams could be served to another. | review of #662. Fixed by #665 (build 139). |
| 53 | `/api/v1/agile/velocity`, `/cfd` and `/milestones` had no project guard. | review of #662. Fixed by #665 (build 139). |
| 54 | The token-authenticated `/api/public-v1/*` reads ignored the token owner's task and project visibility. | review of #662. Fixed by #665 (build 139). |
| 55 | Timesheet approval and milestone billing resolved the actor as `req.uid || req.body.userData.id`, so a member could approve as an owner and a guest read billing as an admin. | #661 (build 136) | Fixed by #661 (build 136) itself.
| 56 | `TimesheetApproval.getStatus` and `listMine` still read `req.query.userId` (reviewer-queue behaviour; owner decision). Decision (owner, 2026-09-21): only reviewers may pass another user's id; everyone else gets their own. | #661 (build 136) |
| 57 | Translators must supply the new keys: the reworded tracker sentence, the planner error, and the routing and providers namespaces (about 60 keys). | #659, #663, #664 |
| 58 | The workflow builder is reachable only from the AI sidebar's Workflows entry (`AiSidebar.vue`, owners and admins), and `WorkflowBuilderPage.vue` is the one AI-section screen that does not render that sidebar, so arriving there drops the section nav with no way back. The global rail's AI entry matches route names beginning with `Ai` (`components/organisms/Shell/navItems.js:38`), which `WorkflowBuilder`, `WorkflowRun` and `WorkflowLineage` do not, so the rail goes dark on all three. No AI hub card or button points at the builder either. | sprint 5 sweep (028) | Fixed by #772 (build 244); the rail half was already fixed via `isAiSectionRoute`.
| 59 | White text on `var(--brand)` is 2.55:1 in dark mode, because dark `--brand` is a light lavender. `tokens.css:152-156` already overrides it to dark ink for `.ah-btn--primary`, `.ah-tbtn--primary` and `.hc-setup__cta`, but app classes that paint the same brand fill are not on that list: `.view-count` (`views/Projects/style.css:187`), `.wv__fill` (`WorkloadView/style.css:74`) and `.gv-owner` (`GanttView/style.css:120`). Widening the override is a design decision about which surfaces carry brand, not a token swap. | UI programme (#696, #706-#711) |
| 60 | `frontend/src/views/Projects/helper.js:892` reads `[].grouped_hits.map(...)` — an empty array literal left behind when the typesense call above it was commented out. Every call throws into its catch, so assignee grouping silently returns nothing. | UI programme sweep | Fixed by #768 (build 240).
| 61 | `Modules/Webhooks/dispatcher.js` debounces on a sliding window keyed by company+task+event, clearing the pending timer on every emit — the same shape #690 (build 165) fixed in the domain event bus, where it collapsed distinct writes as well as the echoes the window exists for. Webhook deliveries very likely coalesce distinct writes the same way. | review of #690 | Fixed by #771 (build 243).
| 62 | `frontend/src/plugins/tasklistDashboard/views/DashBoardList/DashBoardList.vue:163` reimplements the task empty state inline and picks its copy from `project.lastTaskId`, so it blames a filter that was never set — the failure #697 (build 172) fixed on the other task empty states. | #697 (build 172) | Fixed by #768 (build 240).
| 63 | The workspace's `project_tab_components` catalogue holds only 3 of 20 rows, so Board, Table, Calendar, Comments, Activity, Workload, Docs and Forms are permanently absent from that workspace's "+ View" menu. Cause unknown; no application code deletes from that collection. | UI programme sweep | Fixed by #772 (build 244).
| 65 | SSO sign-in (`Modules/SSO/ssoSession.js:16`) inserts the session row before `generateTokenV2Fun` checks the account, so an SSO match on an existing unverified account still leaves a session row behind its refusal. #733 moved the check ahead of the session only in `finalizeSession`. | review of #733 (build 208) | Fixed by #770 (build 242).
| 66 | Desktop-tracker sign-in (`loginAuthTracker`, `Modules/Auth/controller/loginSession.js:203`) inserts its session before `generateTokenV2Fun` checks the account. Low risk: its sign-in code is issued from an existing session. | review of #733 (build 208) | Fixed by #770 (build 242).
| 67 | `TagChip.vue` (about lines 161-164) passes a Boolean prop that defaults to false into `checkPermission`, so its tag edit and delete controls don't follow a project's own rules. | review of #740 (build 214) | Fixed by #768 (build 240).
| 68 | The vitest permission parity scan misses settings keys held in variables, so a web-app check written that way escapes the parity fixture. | review of #740 (build 214) | Fixed by #771 (build 243).
| 69 | A bulk task update route applies the fields a request sends without an allowlist; details are in the owner's notes. Candidate for Sprint 8 slice 3. | #738 (build 213) |
| 70 | `tests/fixtures/fakeMongo.js` implements `$text` by matching every string field rather than the indexed ones, so a unit test can find matches MongoDB would not return. | review of #739 (build 215) | Fixed by #769 (build 241).
| 71 | With `KNOWLEDGE_RETRIEVAL` on, Ask source refs read `kind:id` instead of the task key, and task keys are not in the text index, so a question naming a key such as OPS-12 does not match that task. | #739 (build 215) |
| 72 | The integration suite has an order dependency: `invited-owner` creates a second owner, which lets `instance-fixes` delete the harness owner and fail every later suite. | #747 (build 223) Fixed by #766 (build 238): `invited-owner` demotes the owners it creates in `afterAll`; the pointer restore was never enough because the last-owner guard counts owner-role rows. |
| 73 | `MEMBERSHIP_CACHE_TTL_SECONDS=0` in the test harness makes node-cache keep entries forever rather than not caching. | review of #743 (build 218) | Fixed by #769 (build 241).
| 74 | `POST /api/v1/recurring-tasks/run-due` has no permission key; cross-project merge and convert-to-subtask are judged on the source project only; `ListBulkBar.vue` offers sprint move and tags behind the status permission, so report mode records those as would-be denials; the help text in `Modules/Instance/settingsCatalog.js` still says API tokens are always enforced. | #749 (build 222) | Parts c+d fixed by #772 (build 244); parts a+b fixed by #773 (build 247) with rule-removal proof on #775.
| 75 | Removing a member through SCIM sends no departure or rejoin event, so the knowledge index is only corrected by the next re-check; tombstoned chunks are never purged and an erasure cannot be lifted yet. | #745, #747 (builds 221, 223) |
| 76 | Audit chain: changing `AUDIT_CHAIN_KEY` is not supported (older rows read broken); verification progress is per server; the `meta.idempotencyKey` index is never used for lookups; the head mirror has a crash-only window of at most 5 s. | #750 (build 225) | The idempotencyKey index does serve `findByIdempotencyKey` (Sprint 5), so that part is stale; key rotation is accepted per the upgrade notes; verification-progress locality and the 5 s mirror window stay open as perf/crash tradeoffs.
| 77 | Sprint 7 and 8 screens still to sweep as owner and member: Ask's "why this answer" panel with retrieval on and off (#742), Accounts → tokens under strict mode (#744), the audit log's integrity states and refusals filter (#750). | interface rows |
| 78 | Three unit files fail now and then when the machine is loaded and pass alone: `workflow-step-types`, `telemetry` and `session-token-access`. Each needs its timing assumption found and removed. | Sprint 8 gate runs (2026-09-19) |
| 79 | The instruction guard's patterns (#757) are a first list. They need review against real inbound mail and form text, with a way to add patterns without a release. | Sprint 8 slice 6 (#757) |
| 80 | History and notification text for task changes is composed in the web app. Compose it on the server from typed fields instead; the detail is in the owner's private notes. | Sprint 8 slice 3c review (#756) |
| 81 | A task created by `form.submitted` can reach the workflow trigger before it has an `_id`; the trigger should wait for the stored task. | Sprint 8 slice 6 review (#757) |
| 82 | Replay rows written by tool calls, as opposed to model calls, do not carry the tainted-run marker yet. | Sprint 8 slice 6 review (#757) | Fixed by #771 (build 243).
| 83 | Sprint 8 screens still to sweep as owner: Instance console → Enforcement (#754), the workspace token-expiry list (#753), the run view's "Read external content" mark (#757). | interface rows |
| 84 | Scope stored-file downloads to records the caller may open, and validate attachment metadata on write. Details in the owner's private notes. | #783 review |
| 85 | Address ranges the private-address check does not yet cover, and names ending in a dot passing the name check (same with the egress flag on or off). | #784 |
| 86 | Egress console: refuse exact hosts that encode a private address at save time; older admin-key saves show the actor as `key`; a pending removal is dropped on a stale-save refusal. | #784 |
| 87 | Step credentials: two renewals completing during one check's row read can refuse an action; with the flag on, two failed heartbeats in a row lose the step. | #782 |
| 88 | Brand logos from `/api/v1/getlogo` go out with their real type and without `nosniff` or the sandbox policy (operator-supplied files). | #785 review |
| 89 | The report endpoint's per-address cap and rate limit use `req.ip`; behind a proxy that is not on loopback, set `TRUST_PROXY`. | #785 review |
| 90 | Knowledge console figures read every chunk document; an index-only count needs a stored size field. | #788 |
| 91 | A re-index file step over many attachments can outlive the walk lease (duplicate extraction only). | #788 |
| 92 | Agent notes: on a repeat sighting by another starter the first starter stays on the note while the second's references merge in. | #787 |
| 93 | Files: non-ASCII names inside spreadsheets are misread by the parser; the API-token and MCP caller paths for file passages are not yet reviewed. | #783 |
| 94 | Owner sweeps for the new Sprint 7 and 8 screens: the Knowledge tab (#788) and the security policy card (#785), in addition to follow-up 83. | interface rows |
| 95 | A local full integration run shows an order dependency between the egress allowlist suite and the declared-reads suite; each passes alone and CI passes. | #795 run |
| 96 | Audit hash format v2 (a per-value salt stored outside the hash, per-row format version, dual-format verification) would let user ids and free text in future audit rows be erased; existing chains keep them. Owner decision. | #801 |
| 97 | Stored-file downloads: `/api/v1/importTasks` attachments are not validated on write; merged tasks keep attachments judged under the soft-deleted source; switch `STORAGE_DOWNLOAD_SCOPE` to enforce once report logs are clean. | #794 |
| 98 | MCP: under `MCP_OAUTH=both` personal tokens are still accepted (one-release decision); discovery methods need no scope; a client id stored as `actorId` needs a label in the UI and audit filters. | #802 |

## Owner decisions recorded

- Refresh-token reuse grace window: `REFRESH_TOKEN_REUSE_GRACE_SECONDS`, default 10. The owner may set it to 0 for strict revocation.
- Agent creators do not keep delete rights; only owners and admins can delete an agent. Owner, 2026-09-11.
- PR #613 duplicates #612. Recommended: close #613 after #612 merges; the owner decides.
| 64 | The per-skill and per-agent model pin is stored and validated but never reaches the provider. `AICore/modelCall.js` `askModel` builds its request from `getProvider()` and never reads `skill.model`. The router already accepts a pinned model (`decision.js` `pin_dropped`). | Sprint 6 (#714) | Honouring the pin at the call, against a priced allowlist, is the cost-and-routing half of ADR 003 phase 3, not the migration half. |
