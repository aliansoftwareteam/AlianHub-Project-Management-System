# Enterprise SSO (SAML / OIDC) — Test Cases

**Feature:** SEC-02 — per-company OIDC/SAML SSO with JIT provisioning
**Backend:** `Modules/SSO/` — `sso_configs` collection, config CRUD, `oidc.js` (openid-client), `saml.js` (samlify), `provisioning.js` (JIT), `ssoSession.js` (reuses login session/JWT)
**Frontend:** `Settings → SSO` (`SsoSettings.vue`) admin config page
**Setup:** server needs `npm install` (openid-client, samlify, @authenio/samlify-node-saml2 — lazy-required) + `APIURL` env; test against a local Keycloak/Authentik
**Unit tests:** `tests/sso-rules.test.js` (13 cases, all green)
**Legend:** ✅ Pass · ❌ Fail · ⬜ Not run

| ID | Title | Precondition | Steps | Expected | Actual | Status |
|----|-------|--------------|-------|----------|--------|--------|
| SSO-01 | Configure OIDC (no code) | Owner/admin | Settings → SSO → provider OIDC, fill discovery/clientId/secret, Enable, Save | Config saved; login/redirect/metadata URLs shown | | ⬜ |
| SSO-02 | Admin-only config | Member (roleType ≥ 3) | `GET /api/v2/sso/config` | 403 (owner/admin only) | | ⬜ |
| SSO-03 | OIDC login | OIDC configured + enabled; user exists at IdP | Visit `/api/v2/sso/oidc/initiate?companyId=…` → authenticate at IdP | Redirected back logged in (cookies set); lands in the workspace | | ⬜ |
| SSO-04 | JIT provisioning | New IdP user, autoProvision on | First OIDC login | global user + company_users membership created with defaultRoleType | | ⬜ |
| SSO-05 | Auto-provision off | autoProvision off, unknown user | OIDC login | Denied (no JIT); known users still log in | | ⬜ |
| SSO-06 | State/replay protection | — | Replay a used callback `state` | Rejected (single-use, 5-min TTL) | | ⬜ |
| SSO-07 | Configure + login SAML | SAML IdP (cert + entryPoint) | Configure SAML, give IdP the ACS + metadata URLs, log in | Signed assertion validated; user logged in | | ⬜ |
| SSO-08 | Public config leaks no secret | SSO configured | `GET /api/v2/sso/public?companyId=…` | Only `{provider, isEnabled}` — no clientSecret/cert | | ⬜ |
| SSO-09 | Role change immediate | Change a member's role | retry | Applies at once (role cache invalidated) | | ⬜ |

**Total:** 9 cases (API/UI — run with a real IdP). SSO rules covered by 13 automated unit tests.
