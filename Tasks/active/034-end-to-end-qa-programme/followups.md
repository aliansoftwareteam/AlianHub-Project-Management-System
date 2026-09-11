# Follow-ups from the QA programme (task 034)

Items the fix PRs found and deliberately left out, plus bugs and harness problems the suites exposed. Each needs its own change; none is scheduled yet unless the row says so.

## Security and correctness

| # | Item | Source | Why it was left |
|---|---|---|---|
| 1 | Any company member can update the company document through `PUT /api/v1/admin/company` and `PUT /api/v1/company`. | #615 (access) | A role gate there would affect how member counts are updated, so it needs its own change. |
| 2 | Project filters in `Modules/Project/controller/manageGlobalFilter.js` aren't bound to their owner, the same hole as TSK-07. | #610 (visibility) | They live in the project module, which the project-edit fix owned. |
| 3 | `GET /api/v1/task/:id` reads any task in the company without a project-visibility check. | #606 (task query) | Outside the allowlist fix. |
| 4 | Tasks in a private sprint are still returned when the member can see the project. | #606 (task query) | Existing behaviour, left as it was. |
| 5 | `storage/uploadFile` saves the file before its access check, and doesn't check live membership. | #611 (storage) | Out of scope. |
| 6 | Any logged-in user can overwrite or delete any `USER_PROFILES` image. | #611 (storage) | Binding images to their owner needs a path layout that includes the user id. |
| 7 | The bucket-size cron has a syntax slip, `then(` without a dot, so its update never succeeds. | #611 (storage) | It isn't on a route. |
| 8 | The access token payload still embeds the plaintext refresh token. | #609 (refresh token) | Changing it touches every guard. |
| 9 | `TrackerLogin.vue` passes the refresh token in a URL. | #609 (refresh token) | Out of scope. |
| 10 | Old tracker builds that don't send `userId` can no longer log in with a legacy refresh token. | #609 (refresh token) | Upgrade note: new-format tokens work without it. |
| 11 | The invitation preview endpoint should require the invite link token. | #616 (mongo gateway) | It changes the invitation link format. |
| 12 | `sendVerificationEmail` sends the link to any email given in the request. Invite and verification tokens are 8 `Math.random` characters. | #600 (unauth routes) | Left with a stated reason in the PR. |
| 13 | `setPresetCompany` and `/connections` take the preset key in the URL, so it can end up in logs. | #600 (unauth routes) | Left with a stated reason in the PR. |
| 14 | Some handlers still read user and company ids from the request body after login. | #600 (unauth routes) | Tracked by the tenant-scoping conventions baseline. |
| 15 | Webhooks to private or internal hosts are now refused, and self-hosted installs have no opt-out. Planned fix: an instance-owner allowlist, empty by default and rechecked when a webhook fires. | reports fix (REP-04) | Pending owner confirmation. |
| 16 | `markUndone` in `Modules/Agents/undo.js` swallows its own failure. | Sprint 0 (#558) | Planned for Sprint 8. |
| 16a | `POST /api/v1/invoice/find` (subscription invoices) isn't scoped to the caller's company, so any signed-in user can query another company's invoices. Nothing in the repo calls the route. | time fix (TIM-05) | The field to scope by couldn't be confirmed. |
| 16b | `refuseGuest` in `Modules/Milestone/controller/billing.js` checked roleType 4 instead of guest 0. | time fix | Fixed by #594 (fb1afc52). |
| 16c | Main timesheet reads (`/timesheet/user`, `project`, `workload`, `tracker`, `/timesheet`) trust filters sent by the client. | time fix | Outside TIM-04. |
| 16d | `draft-from-milestone` still creates a draft on a project that has no billing contract. | time fix | Only `draft-from-month` was in TIM-06. |
| 16e | The lint-staged pre-commit hook should run with `--no-stash`, so its automatic backup stops touching the shared stash. | several agents | Repo process change. |
| 17 | Server-side permission-catalogue enforcement for browser sessions (defect 2). Role and membership gates are added per route, but the report-only rollout is still Sprint 8, task 031. | instance fix, project isolation | Belongs to Sprint 8. |

## Product bugs found by the tests

| # | Item | Source |
|---|---|---|
| 18 | `POST /api/v1/createproject` returns before it creates the default "List" sprint, so a task created straight after it can find no sprint. Tests wait for the sprint since #619; the product still races. | #612, #604, #619 |
| 19 | A task-created event reaches automation rules without being awaited. Runs go `queued`, `running`, `success` after the response returns. Tests now poll for the result. | integration isolation |
| 20 | Settings → General returns 404 for its three priority icons on the local server; not confirmed in the harness. | instance QA |
| 21 | `/firebase-messaging-sw.js` is gitignored and only created by `frontend/config.sh`, so a plain build serves a 404 on every page. | #604 |

## Test harness and process

| # | Item | Source |
|---|---|---|
| 22 | Jest ignored the integration project's `testTimeout: 60000`, so tests ran with the 5 s default. | Fixed by #619 (build 90). |
| 23 | `instance.int.test.js` turns maintenance mode on for the shared server, which breaks parallel local runs with `--maxWorkers>1`. CI runs `--runInBand`. Document this in `docs/TESTING-E2E.md`. | several agents |
| 24 | `@playwright/test` isn't installed in the main checkout's `node_modules`, so a fresh local checkout can't run Playwright until `npm install`. | several agents |
| 25 | The lint-staged pre-commit hook makes its own `git stash` backup, which briefly hides uncommitted files from parallel test runs. Some agents then committed with `--no-verify` and ran the checks by hand. | several agents |
| 26 | Agents share one scratchpad and overwrote each other's `pr-body.md`. Future prompts should require a unique file prefix. | several agents |
| 27 | `e2e/specs/access.spec.js` "Two-factor and change-password screens render" is flaky: the second hash-only `page.goto` keeps the Two-Factor title for 15 s. It failed on #608 (flaky) and on #626 (both attempts), neither of which touches settings or the router. | CI on #608, #626 |

## Found while fixing (task 035)

| # | Item | Source |
|---|---|---|
| 28 | Invite links in three of the four places in `Modules/Auth/controller/sendInvitation.js` end with a stray `)}`. | #633 |
| 29 | Owners and admins can write any company field through the company update routes, including plan and subscription fields. | #633 |
| 30 | `getRoleType` ignores whether a member row is deleted or pending; removed members are still stopped by the login membership check. | #633 |
| 31 | `Login.vue` and `VerifyEmail.vue` still send `email` in the resend-verification request, which the server now ignores. | #633 |
| 32 | Creating a project filter with another user's id answers 200 and stores it under the caller, while the task-filter side answers 403. | #632 |

## Owner decisions recorded

- Refresh-token reuse grace window: `REFRESH_TOKEN_REUSE_GRACE_SECONDS`, default 10. The owner may set it to 0 for strict revocation.
- Agent creators do not keep delete rights; only owners and admins can delete an agent. Owner, 2026-09-11.
- PR #613 duplicates #612. Recommended: close #613 after #612 merges; the owner decides.
