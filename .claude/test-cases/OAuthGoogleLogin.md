# OAuth — Google Login — Test Cases

**Location:** Login page & Invitation signup → "Or Continue With" → Google · **Last updated:** 2026-06-11

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Provider App Setup (do this once before testing)

**Console:** https://console.cloud.google.com/apis/credentials → **Create Credentials → OAuth client ID → Web application**

| Setting | Value (local dev) |
|---|---|
| Authorized JavaScript origins | `http://localhost:8080` (your `WEBURL` in prod) |
| Flow | GSI popup (`initCodeClient`, `ux_mode: popup`) — no redirect URI needed |

Copy the **Client ID** and **Client secret**, then set:

| File | Variable | Value |
|---|---|---|
| root `.env` | `GOOGLE_CLIENT_ID` | the client id |
| root `.env` | `GOOGLE_CLIENT_SECRET` | the client secret |
| root `.env` | `GOOGLE_OAUTH_URL` | `https://oauth2.googleapis.com/token` |
| root `.env` | `GOOGLE_OAUTH_REQUIRED` | `true` (rejects logins that fail id-token verification) |
| `frontend/.env` | `VUE_APP_GOOGLE_CLIENT_ID` | the **same** client id |
| `frontend/.env` | `VUE_APP_IS_GOOGLE_LOGIN` | `true` |

**Endpoints exercised:** `POST /api/v1/google/access-token` (code→token), `POST /api/v2/auth/login` (verify + session), `POST /api/v2/google-signup` (new user via invitation).
**Restart** both servers after editing env (frontend env is build-time).

---

## Configuration & Visibility

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GGL_001 | Button hidden when disabled                   | `VUE_APP_IS_GOOGLE_LOGIN='false'`             | 1. Open the Login page                                           | No Google button; "Or Continue With" divider hidden if no other provider |               | ⏳     |
| GGL_002 | Button shows when enabled                     | Flag `'true'` + client id set; servers restarted | 1. Open the Login page                                        | Google button appears under the "Or Continue With" divider             |               | ⏳     |

## Login & Signup

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GGL_003 | Existing user logs in with Google             | A verified user whose email matches a Google account | 1. Click Google  2. Pick the account in the popup           | Popup closes; user is logged in and lands in the app (company selected) |               | ⏳     |
| GGL_004 | New user signs up via invitation              | An open company invitation for the Google email | 1. Open the invitation link  2. Click Google  3. Pick account | Account created (email pre-verified), then auto-logged-in              |               | ⏳     |
| GGL_005 | googleId linked on first login                | First Google login for an existing email user | 1. Complete GGL_003 once                                        | The user's auth record now carries the googleId (subsequent logins skip linking) |               | ⏳     |

## Security / Verification

| ID     | Title                                          | Precondition                                  | Steps                                                            | Expected Result                                                        | Actual Result | Status |
|--------|------------------------------------------------|-----------------------------------------------|------------------------------------------------------------------|------------------------------------------------------------------------|---------------|--------|
| GGL_006 | Unverified id-token is rejected               | `GOOGLE_OAUTH_REQUIRED='true'`                | 1. Attempt a login where the id-token can't be verified (wrong/expired token) | Login rejected with a clear error; no session issued       |               | ⏳     |
| GGL_007 | Blocked email cannot log in                   | A user whose auth record `isBlocked = true`   | 1. Click Google and pick that account                           | Rejected with the "email has been blocked" message                     |               | ⏳     |

---

**Total:** 7 test cases · **All status:** ⏳ Pending
