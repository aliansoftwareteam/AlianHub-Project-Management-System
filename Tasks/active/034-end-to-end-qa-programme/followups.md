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
| 14 | Some handlers still read user and company ids from the request body after login. | #600 (unauth routes) | Tracked by the tenant-scoping conventions baseline. |
| 15 | Webhooks to private or internal hosts are now refused, and self-hosted installs have no opt-out. Planned fix: an instance-owner allowlist, empty by default and rechecked when a webhook fires. | reports fix (REP-04) | Pending owner confirmation. Fixed by #647 (build 122). |
| 16 | `markUndone` in `Modules/Agents/undo.js` swallows its own failure. | Sprint 0 (#558) | Planned for Sprint 8. |
| 16a | `POST /api/v1/invoice/find` (subscription invoices) isn't scoped to the caller's company, so any signed-in user can query another company's invoices. Nothing in the repo calls the route. | time fix (TIM-05) | The field to scope by couldn't be confirmed. Fixed by #635 (build 120). |
| 16b | `refuseGuest` in `Modules/Milestone/controller/billing.js` checked roleType 4 instead of guest 0. | time fix | Fixed by #594 (fb1afc52). |
| 16c | Main timesheet reads (`/timesheet/user`, `project`, `workload`, `tracker`, `/timesheet`) trust filters sent by the client. | time fix | Outside TIM-04. Fixed by #635 (build 120). |
| 16d | `draft-from-milestone` still creates a draft on a project that has no billing contract. | time fix | Only `draft-from-month` was in TIM-06. Fixed by #635 (build 120). |
| 16e | The lint-staged pre-commit hook should run with `--no-stash`, so its automatic backup stops touching the shared stash. | several agents | Repo process change. Fixed by #634 (build 110). |
| 17 | Server-side permission-catalogue enforcement for browser sessions (defect 2). Role and membership gates are added per route, but the report-only rollout is still Sprint 8, task 031. | instance fix, project isolation | Belongs to Sprint 8. |

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
| 26 | Agents share one scratchpad and overwrote each other's `pr-body.md`. Future prompts should require a unique file prefix. | several agents |
| 27 | `e2e/specs/access.spec.js` "Two-factor and change-password screens render" is flaky: the second hash-only `page.goto` keeps the Two-Factor title for 15 s. It failed on #608 (flaky) and on #626 (both attempts), neither of which touches settings or the router. | CI on #608, #626 Fixed by #631 (build 107). |

## Found while fixing (task 035)

| # | Item | Source |
|---|---|---|
| 28 | Invite links in three of the four places in `Modules/Auth/controller/sendInvitation.js` end with a stray `)}`. | #633 Fixed by #640 (build 111). |
| 29 | Owners and admins can write any company field through the company update routes, including plan and subscription fields. | #633 Fixed by #643 (build 116). |
| 30 | `getRoleType` ignores whether a member row is deleted or pending; removed members are still stopped by the login membership check. | #633 Fixed by #652 (build 127). |
| 31 | `Login.vue` and `VerifyEmail.vue` still send `email` in the resend-verification request, which the server now ignores. | #633 Fixed by #641 (build 113). |
| 32 | Creating a project filter with another user's id answers 200 and stores it under the caller, while the task-filter side answers 403. | #632 |
| 33 | Settings → General logs `TypeError: Cannot read properties of undefined (reading 'isoCode')` in the test harness. | #634 Fixed by #641 (build 113). |
| 34 | Socket handshakes check only the JWT signature, not that the session is still live, so a logged-out access token can still open a socket until it expires. | #638 Fixed by #654 (build 131). |
| 35 | Auth cookies are readable by JavaScript (not `httpOnly`), tracked as P1-SEC-09. | #638 |
| 36 | `/timesheet/timelog`, `/timesheet/logDetail`, `/timesheet/milestone` and `POST /api/v1/estimatedTime` still trust client filters or pipelines; #635 scoped the five main timesheet reads only. | #635; read side fixed by #635 (build 120); fixed: reads #635 (build 120), writes #650 (build 125), per-task reads #656 (build 129) |
| 37 | The `invoices` (subscription) collection has no company field and nothing in the repo writes it; `POST /api/v1/invoice/find` is limited to the instance owner until its producer is known. | #635 |
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
| 55 | Timesheet approval and milestone billing resolved the actor as `req.uid || req.body.userData.id`, so a member could approve as an owner and a guest read billing as an admin. | #661 (build 136) |
| 56 | `TimesheetApproval.getStatus` and `listMine` still read `req.query.userId` (reviewer-queue behaviour; owner decision). | #661 (build 136) |
| 57 | Translators must supply the new keys: the reworded tracker sentence, the planner error, and the routing and providers namespaces (about 60 keys). | #659, #663, #664 |
| 58 | The workflow builder is reachable only from the AI sidebar's Workflows entry (`AiSidebar.vue`, owners and admins), and `WorkflowBuilderPage.vue` is the one AI-section screen that does not render that sidebar, so arriving there drops the section nav with no way back. The global rail's AI entry matches route names beginning with `Ai` (`components/organisms/Shell/navItems.js:38`), which `WorkflowBuilder`, `WorkflowRun` and `WorkflowLineage` do not, so the rail goes dark on all three. No AI hub card or button points at the builder either. | sprint 5 sweep (028) |

## Owner decisions recorded

- Refresh-token reuse grace window: `REFRESH_TOKEN_REUSE_GRACE_SECONDS`, default 10. The owner may set it to 0 for strict revocation.
- Agent creators do not keep delete rights; only owners and admins can delete an agent. Owner, 2026-09-11.
- PR #613 duplicates #612. Recommended: close #613 after #612 merges; the owner decides.
