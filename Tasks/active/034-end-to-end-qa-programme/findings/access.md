# Access and accounts — QA findings (task 034)

Area slug `access`, finding prefix `ACC`. Modules: Auth, SSO, Scim, OAuth, googleOAuth,
githubOAuth, gitlabOAuth, ApiTokens, Users, UserId, Setup, Company, Teams,
trackerUserPermission.

Swept live against the local server (http://localhost:4000, beta, company
`6a8ee973d625fca52e519a12` / Local360) as owner (in-app browser, Local PM), and as
admin (`rahul.manager`), two members (`priya.frontend`, `arjun.backend`) and guest
(`kabir.intern`) via one-hour demo tokens. OAuth flows checked only up to the redirect;
SSO/SCIM/OAuth settings of Local360 were read, never changed; no setup wizard was run on
the local server; the one API token created (`[QA access] temp`) was deleted again.

## Coverage

Routes registered by the area's modules: **101** (walked from each module's `routes.js`
plus `Modules/ApiTokens/publicApi.js`, classified against `Config/setMiddleware.js`).

| Role | Routes exercised | Notes |
|---|---|---|
| anon (no token) | 30 | every route classified auth-`NONE`, plus 401 controls on protected routes |
| owner | 14 (API) + 9 screens | in-app browser + `fetch` from the owner page |
| admin | 22 | full auth+company routes, SSO/SCIM config, api-tokens CRUD |
| member | 16 | refusals + shared reads (member RBAC gap is a known issue) |
| guest | 18 | refusals + the cross-scope reads that should refuse |

Screens (from `frontend/src/router/{auth,settings,team,people}`): the area owns **9**
authenticated screens — My Profile, Change Password, Two-Factor Auth, Members, SSO, SCIM,
Teams, Company, Integrations — plus the pre-auth screens (Login, SSO login, Forgot/Reset
password, Verify email, Verify invitation, Invitation, Create company, Setup wizard).
All 9 authenticated screens were opened as owner and rendered with **no console errors**.
Pre-auth screens other than Login were not driven (they need mail / an IdP, which is off).

Not fully exercisable, and why:
- OAuth login (`/api/v1/{google,github,gitlab}/access-token`, `google/github/gitlab-signup`)
  need a real provider token — checked only that they exist and reject junk.
- SSO OIDC/SAML initiate/callback/acs need a configured IdP — checked they 404 / return
  metadata when unconfigured, not a full round trip.
- Magic link, forgot/verify/invitation email delivery — SMTP is off locally.
- SCIM protocol CRUD needs a provisioning bearer token (SCIM disabled on Local360); checked
  only that every `/scim/v2/*` route rejects a missing bearer with 401.
- `POST /api/v2/setup/complete` — not called (area rule: no setup wizard on the local
  server); confirmed only via `GET /api/v2/setup/status` that the instance reports installed.

---

## ACC-01 — `POST /api/v1/mongoOpration` is a fully unauthenticated arbitrary MongoDB gateway

- **Severity:** critical (auth bypass, cross-tenant data leak, data loss)
- **Role:** anon (no token, no company header)
- **Request:** `POST /api/v1/mongoOpration` with `{ dbName, collection, methodName, dataObj }`
- **Expected:** the route requires a valid session and refuses an anonymous caller (401).
- **Actual:** the handler runs any Mongoose method against any database and collection with
  no authentication. Confirmed live as anon:
  - `{"dbName":"global","collection":"userAuth","methodName":"countDocuments","dataObj":[{}]}` → `200 {status:true, statusText:9}`
  - `{"dbName":"global","collection":"users","methodName":"find","dataObj":[{},{"Employee_Email":1}]}` → `200` returning all 9 users' emails.
  A caller can equally pass `deleteMany`, `updateMany`, `drop`, etc. against any tenant's
  database — read, tamper or destroy every company's data.
- **Reproduction:**
  ```bash
  curl -s -X POST http://localhost:4000/api/v1/mongoOpration \
    -H 'content-type: application/json' \
    -d '{"dbName":"global","collection":"users","methodName":"find","dataObj":[{},{"Employee_Email":1}]}'
  ```
- **Suspected file/line:** `Modules/Auth/routes.js` `initSignup` registers `POST /api/v1/mongoOpration`
  (~line 653) with no middleware; the path is absent from both lists in `Config/setMiddleware.js`.
- **Suggested fix:** remove this endpoint entirely (nothing in the shipped frontend calls it),
  or, if it must stay, put it behind `verifyJWTTokenWithCV2`, restrict `methodName` to a read
  allow-list, and force `dbName` to the caller's `req.aud`.

## ACC-02 — `POST /api/v1/generateToken` mints a valid session JWT for any user id, no password

- **Severity:** critical (authentication bypass / account takeover)
- **Role:** anon
- **Request:** `POST /api/v1/generateToken` `{ "uid": "<any user _id>" }`
- **Expected:** issuing a session token requires proof of identity (a password login, a valid
  refresh token, or an authenticated admin). An anonymous caller must be refused.
- **Actual:** returns `200 {status:true, token:<signed JWT with that uid + its companies>}`.
  The uid is trivially discoverable (ACC-01, or `GET /api/v1/user/find`). The minted token is a
  full session for that user, so anyone can log in as the instance owner. Confirmed live
  against the real owner id `6a8ee972d625fca52e519a05` (token value not recorded).
- **Reproduction:** `POST /api/v1/generateToken` with a real user `_id`; the response carries a
  usable `token`. (The v2 sibling `POST /api/v2/generateToken` is safe — it requires a valid
  `refresh-token` header.)
- **Suspected file/line:** `Modules/Auth/controller/createUser.js` `exports.generateToken` (~line 142),
  routed at `Modules/Auth/routes.js` `POST /api/v1/generateToken` (~line 697), unlisted in
  `Config/setMiddleware.js`.
- **Suggested fix:** delete the route, or require the caller to already hold a valid session
  and only mint a token for `req.uid`.

## ACC-03 — Session routes are unauthenticated: forge a session, or wipe everyone's sessions

- **Severity:** critical (auth bypass + availability / forced-logout DoS)
- **Role:** anon
- **Requests (all under `/api/v2/session`, none in either middleware list):**
  - `POST /api/v2/session/register` `{ "userId": "<id>" }` → creates a session row for that user
    and returns a fresh `refreshToken`. Paired with `POST /api/v2/generateToken` (uid +
    `refresh-token` header) this is a second, self-contained account-takeover chain.
  - `DELETE /api/v2/session/delete` (empty body) → `deleteSessionFun("")` runs `deleteMany({})`
    on the sessions collection: **every session of every user is deleted**, logging out the
    whole instance.
  - `DELETE /api/v2/session/delete/:id` → deletes all sessions for an arbitrary user id.
- **Expected:** all three require the caller's own valid session and act only on it.
- **Actual:** reachable with no token. `session/register` and `session/delete/:id` (with a bogus
  id, so nothing was actually deleted) were confirmed to reach their handlers as anon; the
  destructive empty-body `session/delete` was **not executed** against the live server — it
  would have logged out Local360 — and is reported from code.
- **Suspected file/line:** `Modules/Auth/routes.js` lines 285–298 (`session/register`,
  `session/delete`, `session/delete/:id`); handlers in `Modules/Auth/session.js`
  (`deleteSessionFun` builds `deleteMany` with an empty filter when no id is given).
- **Suggested fix:** register the `/api/v2/session` prefix under `verifyJWTTokenV2`, take the
  user from `req.uid` (never the body/params), and never issue `deleteMany({})`.

## ACC-04 — OAuth credentials endpoint is unauthenticated (reads secrets, rewrites server .env)

- **Severity:** critical (secret disclosure + unauthenticated config write)
- **Role:** anon
- **Requests:** `GET /api/v1/settings/oauth`, `POST /api/v1/settings/oauth`
- **Expected:** only the instance owner may read or change OAuth provider credentials; secrets
  should never be returned to an unauthenticated caller.
- **Actual:** `GET` returns `clientSecret`, `githubClientSecret`, `gitlabClientSecret` (empty on
  Local360, but the shape proves secrets are served with no auth). `POST` calls
  `updateEnvVariablesUtil(pathType, variables)` and rewrites the server `.env` for anyone —
  confirmed `200 {status:true}` as anon with an empty `variables` no-op. An attacker can point
  OAuth login at their own client id/secret and harvest logins.
- **Reproduction:** `curl -s http://localhost:4000/api/v1/settings/oauth` returns the credential
  block with no token.
- **Suspected file/line:** `Modules/OAuth/routes.js` lines 4–5; handlers
  `Modules/OAuth/controller.js` `getOAuthCred` / `updateOAuthCred`. Path absent from
  `Config/setMiddleware.js`.
- **Suggested fix:** put both behind `verifyJWTTokenWithCV2` and an owner/instance check;
  never return secret values (return only booleans / last-4).

## ACC-05 — User routes are jwt-only and unscoped: any role reads/edits any user

- **Severity:** critical (cross-tenant PII/secret read + horizontal & vertical privilege escalation)
- **Role:** guest (and any authenticated user)
- **Requests (registered under `verifyJWTToken` — a bare JWT check with no company scope and no
  ownership check):**
  - `GET /api/v1/user/:id` — guest read the owner's full user document, including
    `webTokens` (web-push/session tokens), `agentAccount.email`, `isProductOwner`, and the
    company list. Cross-user and cross-company.
  - `POST /api/v1/user/find` `{ query:{}, companyId }` — guest enumerated all 9 users of the
    instance with full documents.
  - `PUT /api/v1/user` `{ userId, updateObject }` — guest write to an arbitrary user by id.
    Confirmed `200 {status:true, statusText:"User Status Updated"}` (tested against a
    non-existent id `0000…` so no real record was changed). A caller can flip
    `isActive`, `isProductOwner`, `AssignCompany`, etc. on anyone.
- **Expected:** these must require the target to be the caller (`req.uid`) or an owner/admin of
  the same company, and must be company-scoped.
- **Suspected file/line:** `Modules/Users/routes.js` lines 5–8; handlers in
  `Modules/Users/controller.js` (`updateUserStatus`, `getUserById`, `getUserByQuey` take the id
  and company straight from the request). Listed under `verifyJWTToken` in
  `Config/setMiddleware.js`, which does not check company membership.
- **Suggested fix:** move these to `verifyJWTTokenWithCV2`, scope every query to `req.aud`,
  and gate writes/other-user reads behind an owner/admin permission check; never echo
  `webTokens`/token fields.

## ACC-06 — Admin company endpoints let any member or guest enumerate every company

- **Severity:** high (cross-tenant data disclosure; critical on a multi-company instance)
- **Role:** member, guest
- **Requests:** `POST /api/v1/admin/company` `{ fetchAllCompany:true }`,
  `POST /api/v1/admin/company/find` `{ findQuery:{…} }`
- **Expected:** "admin" company routes are instance-admin only.
- **Actual:** both sit under `verifyJWTToken` (jwt only, no role or company check). A guest read
  the full Local360 company document (owner id, `planFeature`, project counts, billing plan);
  `fetchAllCompany:true` / an aggregate returns **all** companies on the instance. On Local360
  there is only one company, so this reads as one company today, but the missing check is a
  cross-tenant leak on any real multi-tenant deployment.
- **Suspected file/line:** `Modules/Company/routes.js` lines 128–129, 131; handlers
  `Modules/Company/controller/updateCompany.js` `getCompany` / `getCompanyByAggregate`.
- **Suggested fix:** gate the `/api/v1/admin/*` company routes behind an instance-owner check,
  and scope non-admin company reads to the caller's `req.aud`.

## ACC-07 — `POST /api/v1/manageTrackerUserPermission` is unauthenticated

- **Severity:** high (unauthenticated mutation of company/member state)
- **Role:** anon
- **Request:** `POST /api/v1/manageTrackerUserPermission` `{ CompanyId, DataObj }`
- **Expected:** owner/admin of the company only.
- **Actual:** reaches its handler with no token (returned a body-validation refusal
  "Company Id is requried", not an auth refusal), so with a real `CompanyId`/`DataObj` it will
  `$inc` the company `trackerUsers` counter and flip a member's `isTrackerUser` flag for anyone.
  Not executed against real data.
- **Suspected file/line:** `Modules/trackerUserPermission/routes.js` line 40; handler
  `Modules/trackerUserPermission/controller.js` `handleTrackerUserPermission`. Path absent from
  `Config/setMiddleware.js`.
- **Suggested fix:** register under `verifyJWTTokenWithCV2` and add an owner/admin check.

## ACC-08 — `PATCH /api/v2/auth/:id/change-password` needs no session

- **Severity:** medium (missing authentication; still gated by knowing the old password)
- **Role:** anon
- **Request:** `PATCH /api/v2/auth/:id/change-password` `{ oldPassword, newPassword }`
- **Expected:** an authenticated session whose `req.uid` equals `:id`.
- **Actual:** the route is unlisted in `Config/setMiddleware.js`, so no JWT runs; the only guard
  is the bcrypt check of `oldPassword`. Confirmed it reaches the handler as anon (returned
  `400 "user not found"` for a bogus id, i.e. auth was never required). A stolen/guessed old
  password is enough, from anywhere, with no session and no rate-limit tie to the account.
- **Suspected file/line:** `Modules/Auth/routes.js` line 143; handler
  `Modules/Auth/controller/password.js` `changePassword`.
- **Suggested fix:** require `verifyJWTTokenWithCV2` and assert `req.uid === req.params.id`.

## ACC-09 — `POST /api/v1/checkSendInviatation` is an unauthenticated membership oracle

- **Severity:** medium (unauthenticated account/membership enumeration)
- **Role:** anon
- **Request:** `POST /api/v1/checkSendInviatation` `{ email, companyId }`
- **Expected:** only an owner/admin of the company checks invitation state.
- **Actual:** unauthenticated. For `priya.frontend@demo.test` + Local360 it returned
  `"User is already in the company."`; for a stranger it returns `furtherProceed:true`. Anyone
  can probe whether an email belongs to a given company. (`/api/v1/admin/checkSendInviatation`
  is correctly behind jwt.)
- **Suspected file/line:** `Modules/Auth/routes.js` line 564; handler
  `Modules/Auth/controller/sendInvitation.js` `checkSendInviatation`.
- **Suggested fix:** require a session + owner/admin gate, matching the `admin/` sibling.

---

## Related known issue (not re-filed)

The tracked `fix/unauthenticated-v1-routes` branch adds only `POST /api/v1/removeCache` to the
JWT list; it does **not** cover ACC-01/02/03/04/07/08/09, which are separate open routes.
Member RBAC gaps (`fix/member-permission-rules`) and the guest role-id mismatch
(`fix/guest-role-id`) are the reason member/guest checks here focus on refusals that should
hold regardless of the role catalogue.

## Checks that passed

- `GET /api/v2/setup/status` → installed (owner setup path not re-run, per area rule).
- `POST /api/v2/auth/login` mints a session for owner, admin, member and guest (demo tokens).
- SSO admin config (`GET/PUT /api/v2/sso/config`) is owner/admin only — member and guest get
  403 "Owner/admin only."; admin gets the config.
- SCIM admin config (`GET/PUT /api/v2/scim/config`, `POST /api/v2/scim/token`) is owner/admin
  only — guest 403; admin reads config.
- Every `/scim/v2/*` protocol route returns 401 with no/invalid bearer.
- `GET /api/public-v1/*` returns 401 without a valid `ahp_` token.
- API tokens (`/api/v2/api-tokens`): admin create → list → delete round-trip works
  (`[QA access] temp`, deleted); a member sees only their own tokens (count 0), never the
  admin's; PATs cannot manage tokens (jwt.js PAT block).
- `GET /api/v2/api-tokens/me` (whoami) resolves the effective role/permissions per role.
- `GET/POST/PUT /api/v1/teams` are company-scoped (jwt+company); `GET /api/v1/sso/discover`,
  `/oidc/initiate`, `/saml/metadata` behave correctly when no IdP is configured.
- Owner UI: My Profile, Change Password, Two-Factor Auth, Members, SSO, SCIM, Teams, Company
  and Integrations all render with no console errors.
