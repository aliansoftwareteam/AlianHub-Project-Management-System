# OAuth — GitLab Login — Test Cases

**Location:** Login page & Invitation signup → "Or Continue With" → GitLab · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Provider App Setup (do this once before testing)

**Console:** https://gitlab.com/-/profile/applications → **Add new application**

| Setting | Value (local dev) |
|---|---|
| Redirect URI | `http://localhost:8080` (exact — no trailing slash) |
| Scopes | ✅ `read_user` |
| Confidential | ✅ Yes (the secret is used server-side) |
| Flow | Full-page redirect to `https://gitlab.com/oauth/authorize` (`response_type=code`) |

Copy the **Application ID** and **Secret**, then set:

| File | Variable | Value |
|---|---|---|
| root `.env` | `GITLAB_CLIENT_ID` | the application id |
| root `.env` | `GITLAB_CLIENT_SECRET` | the secret |
| root `.env` | `GITLAB_BASE_OAUTH_URL` | `https://gitlab.com/oauth` |
| root `.env` | `GITLAB_BASE_API_URL` | `https://gitlab.com/api/v4` (identity verify `/user`) |
| root `.env` | `GITLAB_OAUTH_REQUIRED` | `true` (requires server-side verify via GitLab `/user`) |
| `frontend/.env` | `VUE_APP_GITLAB_CLIENT_ID` | the **same** application id |
| `frontend/.env` | `VUE_APP_GITLAB_BASE_OAUTH_URL` | `https://gitlab.com/oauth` |
| `frontend/.env` | `VUE_APP_IS_GITLAB_LOGIN` | `true` |

**Endpoints exercised:** `POST /api/v1/gitlab/access-token` (code→token, sends `redirectUri`), `POST /api/v2/auth/login` (verify + session), `POST /api/v2/gitlab-signup` (new user via invitation). GitLab identity is read from `https://gitlab.com/api/v4/user`.
**Self-managed GitLab:** change the host in `GITLAB_BASE_OAUTH_URL` / `GITLAB_BASE_API_URL` / `VUE_APP_GITLAB_BASE_OAUTH_URL`.
**Restart** both servers after editing env (frontend env is build-time).

---

## Configuration & Visibility

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GLL_001 | Button hidden when disabled                   | `VUE_APP_IS_GITLAB_LOGIN='false'`             | 1. Open the Login page                                           | No GitLab button shown                                                 |               | ⏳     |
| GLL_002 | Button shows when enabled                     | Flag `'true'` + client id set; servers restarted | 1. Open the Login page                                        | GitLab (tanuki) button appears under the "Or Continue With" divider    |               | ⏳     |

## Login & Signup

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GLL_003 | Existing user logs in with GitLab             | A verified user whose email matches the GitLab account | 1. Click GitLab  2. Authorize on GitLab  3. Get redirected back | Returns to the app logged in; the `?code=` is cleared from the URL |               | ⏳     |
| GLL_004 | New user signs up via invitation              | An open company invitation for the GitLab email | 1. Open invitation link  2. Click GitLab  3. Authorize       | Account created (email pre-verified) then auto-logged-in              |               | ⏳     |
| GLL_005 | gitlabId linked on first login                | First GitLab login for an existing email user | 1. Complete GLL_003 once                                        | The user's auth record now carries the gitlabId                        |               | ⏳     |

## Security / Verification

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GLL_006 | accessToken verification enforced             | `GITLAB_OAUTH_REQUIRED='true'`                | 1. Attempt login without a valid GitLab access token            | Rejected ("accessToken is required" / verification failed); no session |               | ⏳     |
| GLL_007 | Blocked email cannot log in                   | Auth record `isBlocked = true`                | 1. Click GitLab and authorize that account                      | Rejected with the "email has been blocked" message                     |               | ⏳     |

## Coexistence

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GLL_008 | GitLab & GitHub don't collide on redirect     | Both GitLab and GitHub enabled                | 1. Start a GitLab login and complete it                         | Only the GitLab handler processes the `?code=` (GitHub ignores it); login succeeds |               | ⏳     |
| GLL_009 | All three providers visible together          | Google + GitHub + GitLab all enabled          | 1. Open the Login page                                          | All three buttons render in one row under the divider                  |               | ⏳     |

---

**Total:** 9 test cases · **All status:** ⏳ Pending
