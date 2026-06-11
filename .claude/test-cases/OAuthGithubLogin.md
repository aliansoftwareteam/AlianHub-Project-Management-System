# OAuth — GitHub Login — Test Cases

**Location:** Login page & Invitation signup → "Or Continue With" → GitHub · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Provider App Setup (do this once before testing)

**Console:** https://github.com/settings/developers → **OAuth Apps → New OAuth App**

| Setting | Value (local dev) |
|---|---|
| Homepage URL | `http://localhost:8080` |
| Authorization callback URL | `http://localhost:8080` (the SPA reads `?code=` on return) |
| Flow | Full-page redirect to `https://github.com/login/oauth/authorize` |

Copy the **Client ID** and generate a **Client secret**, then set:

| File | Variable | Value |
|---|---|---|
| root `.env` | `GITHUB_CLIENT_ID` | the client id |
| root `.env` | `GITHUB_CLIENT_SECRET` | the client secret |
| root `.env` | `GITHUB_BASE_OAUTH_URL` | `https://github.com/login/oauth` |
| root `.env` | `GITHUB_OAUTH_REQUIRED` | `true` (requires server-side verify via GitHub `/user`) |
| `frontend/.env` | `VUE_APP_GITHUB_CLIENT_ID` | the **same** client id |
| `frontend/.env` | `VUE_APP_GITHUB_BASE_OAUTH_URL` | `https://github.com/login/oauth` |
| `frontend/.env` | `VUE_APP_IS_GITHUB_LOGIN` | `true` |

**Endpoints exercised:** `POST /api/v1/github/access-token` (code→token), `POST /api/v2/auth/login` (verify + session), `POST /api/v2/github-signup` (new user via invitation). GitHub identity is read from `https://api.github.com/user` + `/user/emails`.
**Restart** both servers after editing env (frontend env is build-time).

---

## Configuration & Visibility

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GHL_001 | Button hidden when disabled                   | `VUE_APP_IS_GITHUB_LOGIN='false'`             | 1. Open the Login page                                           | No GitHub button shown                                                 |               | ⏳     |
| GHL_002 | Button shows when enabled                     | Flag `'true'` + client id set; servers restarted | 1. Open the Login page                                        | GitHub button appears under the "Or Continue With" divider             |               | ⏳     |

## Login & Signup

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GHL_003 | Existing user logs in with GitHub             | A verified user whose email matches the GitHub primary email | 1. Click GitHub  2. Authorize on GitHub  3. Get redirected back | Returns to the app logged in; the `?code=` is cleared from the URL |               | ⏳     |
| GHL_004 | New user signs up via invitation              | An open company invitation for the GitHub email | 1. Open invitation link  2. Click GitHub  3. Authorize       | Account created (email pre-verified) then auto-logged-in              |               | ⏳     |
| GHL_005 | Primary verified email is used                | GitHub account with multiple emails           | 1. Log in with GitHub                                            | The primary, verified GitHub email is the one matched/created          |               | ⏳     |

## Security / Verification

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GHL_006 | accessToken verification enforced             | `GITHUB_OAUTH_REQUIRED='true'`                | 1. Attempt login without a valid GitHub access token            | Rejected ("accessToken is required" / verification failed); no session |               | ⏳     |
| GHL_007 | Blocked email cannot log in                   | Auth record `isBlocked = true`                | 1. Click GitHub and authorize that account                      | Rejected with the "email has been blocked" message                     |               | ⏳     |

## Coexistence

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GHL_008 | GitHub & GitLab don't collide on redirect     | Both GitHub and GitLab enabled                | 1. Start a GitHub login and complete it                         | Only the GitHub handler processes the `?code=` (GitLab ignores it); login succeeds |               | ⏳     |

---

**Total:** 8 test cases · **All status:** ⏳ Pending
