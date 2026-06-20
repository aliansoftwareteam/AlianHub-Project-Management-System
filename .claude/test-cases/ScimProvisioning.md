# SCIM Provisioning — Test Cases

**Feature:** SEC-05 — SCIM 2.0 user provisioning/deprovisioning, paired with SSO
**Backend:** `Modules/Scim/*` (`helpers/scimRules.js`, `auth.js`, `provisioning.js`, `controller.js`, `discovery.js`, `routes.js`, `init.js`), `scim_configs` collection
**Endpoints:** admin `GET/PUT /api/v2/scim/config`, `POST /api/v2/scim/token` (JWT+owner/admin); protocol `/scim/v2/*` (bearer token)
**Frontend:** `frontend/src/views/Settings/Scim/ScimSettings.vue` (Settings → SCIM tab)
**Reuse:** SSO `jitProvisionUser` — a SCIM-created user and an SSO login for the same email resolve to the SAME global user.
**Unit-tested:** `tests/scim-rules.test.js` (token build/parse, email/filter parsing, PATCH ops, SCIM resource shaping) — in the Node suite (30 suites / 346 tests green).
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| SCIM-01 | Enable + mint token | Owner/admin | Settings → SCIM, toggle Enabled, click Generate token | Token shown once with the SCIM base URL; only last-4 retained after reload | | ⬜ |
| SCIM-02 | Token shown once | Token generated | Reload the page | Full token no longer shown; `•••• <last4>` displayed | | ⬜ |
| SCIM-03 | Rotate invalidates old | A token exists & is configured in an IdP | Click Regenerate token | Old token stops authenticating (401); new token works | | ⬜ |
| SCIM-04 | Provision (create) | SCIM enabled; valid token | `POST /scim/v2/Users` with `userName`, `name`, `active:true` | `201` with a SCIM User (id, userName, active:true); user appears as a company member with the default role | | ⬜ |
| SCIM-05 | Idempotent re-create | User already provisioned & active | `POST /scim/v2/Users` for the same userName | `409 Conflict` (no duplicate) | | ⬜ |
| SCIM-06 | Deactivate via PATCH | Provisioned active user | `PATCH /scim/v2/Users/{id}` `replace active:false` | `200`, `active:false`; member can no longer access the workspace (membership `status:0`/`isDelete:true`); role cache invalidated | | ⬜ |
| SCIM-07 | Deactivate via DELETE | Provisioned active user | `DELETE /scim/v2/Users/{id}` | `204`; membership deactivated (soft, not hard-deleted) | | ⬜ |
| SCIM-08 | Reactivate | Previously deactivated user | `POST` again, or `PATCH active:true` | User reactivated in the workspace | | ⬜ |
| SCIM-09 | Filter by userName | Users exist | `GET /scim/v2/Users?filter=userName eq "x@y.com"` | ListResponse with only the matching user; correct `totalResults` | | ⬜ |
| SCIM-10 | List + pagination | >1 user | `GET /scim/v2/Users?startIndex=1&count=10` | SCIM ListResponse envelope; `itemsPerPage`/`startIndex`/`totalResults` correct | | ⬜ |
| SCIM-11 | Update name | Provisioned user | `PUT`/`PATCH` with new `name.givenName`/`familyName` | Global user name updated; reflected in the SCIM response | | ⬜ |
| SCIM-12 | No/invalid token → 401 | — | Call any `/scim/v2/*` with a missing/garbage/disabled-workspace token | `401` with SCIM Error body; no data leaked | | ⬜ |
| SCIM-13 | Tenant isolation | Two companies with SCIM | Use company A's token to GET Users | Only company A's members; company B never visible (company is bound to the token) | | ⬜ |
| SCIM-14 | Discovery docs | SCIM enabled | `GET /scim/v2/ServiceProviderConfig`, `/ResourceTypes`, `/Schemas` | Valid SCIM metadata (patch supported, filter supported, oauthbearertoken scheme) | | ⬜ |
| SCIM-15 | scim+json content-type | — | POST with `Content-Type: application/scim+json` | Body parsed correctly (router-scoped parser); create succeeds | | ⬜ |
| SCIM-16 | Shared identity with SSO | SEC-02 SSO enabled for the same IdP | Provision a user via SCIM, then have them log in via SSO | Same global user (matched by email); no duplicate account | | ⬜ |
| SCIM-17 | Token stored hashed | DB access | Inspect `scim_configs` | Only `tokenHash` (bcrypt) + `tokenLast4` stored — never the plaintext token | | ⬜ |
| SCIM-18 | Rules (unit) | — | `npx jest tests/scim-rules.test.js` | All green — token round-trip (incl. colons in secret), email/filter parsing, Okta/Azure PATCH shapes, resource mapping | | ✅ |

**Total:** 18 cases (1 unit-automated, 17 runtime/manual). Scope per the AHE-3762 done-when: IdP create→provision, remove→deactivate. Groups/SCIM bulk are out of scope for this pass.
