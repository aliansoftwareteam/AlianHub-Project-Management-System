# Two-Factor Authentication (TOTP) — Test Cases

**Location:** Settings → Two-Factor Authentication (enroll / disable) · Login page (second step) · **Last updated:** 2026-06-16

> **Status legend:** ⏳ Pending · ✅ Pass · ❌ Fail · ⚠️ Blocked · 🔄 Flaky

---

## Setup (do this once before testing)

**You need an authenticator app:** Google Authenticator, Authy, Microsoft Authenticator, or 1Password.

| File | Variable | Value |
|---|---|---|
| root `.env` | `TWO_FACTOR_ENC_KEY` | *optional* — encrypts the TOTP secret at rest (derives from `JWT_SECRET` if unset) |
| root `.env` | `TWO_FACTOR_TEMP_SECRET` | *optional* — signs the login second-step token (derives from `JWT_SECRET` if unset) |
| root `.env` | `TWO_FACTOR_ISSUER` | *optional* — label shown in the authenticator app (default `AlianHub`) |

2FA works with all three blank. **Restart the backend** after installing deps / editing env.

**Endpoints exercised:** `GET /api/v2/auth/2fa/status`, `POST /api/v2/auth/2fa/setup`, `POST /api/v2/auth/2fa/verify`, `POST /api/v2/auth/2fa/disable` (authed); `POST /api/v2/auth/2fa/validate` (public, rate-limited).

**Reset escape hatch** (if locked out during testing): `mongosh` → `use global` → `db.userAuth.updateOne({ email: "you@example.com" }, { $unset: { twoFactor: "" } })`.

---

## Enrollment (Settings → Two-Factor Authentication)

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_001 | Section shows OFF status when not enrolled         | Logged in, 2FA never enabled                  | 1. Settings → Two-Factor Authentication                                                                 | Status reads "Two-factor authentication is OFF"; an **Enable** button is shown               |               | ⏳     |
| TFA_002 | Enable starts enrollment (QR + key + code field)   | On the 2FA settings page, status OFF          | 1. Click **Enable**                                                                                     | A QR code, a manual setup key, a 6-digit code field, and **Verify & Enable** / **Cancel** appear |               | ⏳     |
| TFA_003 | Enroll with QR scan + valid code                   | Enrollment started                            | 1. Scan the QR in the authenticator app  2. Enter the current 6-digit code  3. Click **Verify & Enable** | 2FA is enabled; the recovery-codes screen is shown                                           |               | ⏳     |
| TFA_004 | Enroll using the manual key                        | Enrollment started, can't scan                | 1. In the app choose "enter a setup key"  2. Paste the shown key  3. Enter the code  4. Verify & Enable  | Same as TFA_003 — works without scanning                                                     |               | ⏳     |
| TFA_005 | Invalid code during enrollment is rejected         | Enrollment started                            | 1. Enter a wrong 6-digit code  2. Click **Verify & Enable**                                             | Inline error shown; stays on the enroll screen; 2FA NOT enabled                              |               | ⏳     |
| TFA_006 | Cancel aborts enrollment                           | Enrollment started                            | 1. Click **Cancel**                                                                                     | Returns to the OFF state; no 2FA enabled; no recovery codes generated                        |               | ⏳     |
| TFA_007 | Status shows ON after enabling                     | 2FA just enabled (clicked Done)               | 1. Reopen Settings → Two-Factor Authentication                                                          | Status reads "Two-factor authentication is ON"; a **Disable** form is shown                  |               | ⏳     |
| TFA_008 | Re-enroll is blocked while enabled                 | 2FA already enabled                           | 1. Observe the 2FA settings page                                                                        | No Enable button (must Disable first); backend rejects a second setup                         |               | ⏳     |

---

## Recovery Codes

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_009 | Ten recovery codes shown once after enabling       | Completed TFA_003                             | 1. Observe the "Save your recovery codes" screen                                                        | Exactly 10 codes are listed (format `xxxxx-xxxxx`)                                            |               | ⏳     |
| TFA_010 | Copy recovery codes                                | On the recovery-codes screen                  | 1. Click **Copy**                                                                                       | Toast "Recovery codes copied to clipboard"; clipboard holds all 10 codes                     |               | ⏳     |
| TFA_011 | Download recovery codes                            | On the recovery-codes screen                  | 1. Click **Download**                                                                                   | A `.txt` file downloads containing the 10 codes                                              |               | ⏳     |
| TFA_012 | Done closes the codes screen                       | On the recovery-codes screen                  | 1. Click **Done**                                                                                       | Returns to the 2FA settings page showing status ON                                           |               | ⏳     |
| TFA_013 | Codes are not shown again                          | 2FA enabled, codes already dismissed          | 1. Reopen the 2FA settings page                                                                         | The recovery codes are NOT displayed again (shown only once at enrollment)                   |               | ⏳     |

---

## Login Second-Step (TOTP)

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_014 | Second step appears after password                 | 2FA-enabled account; logged out               | 1. Enter email + password  2. Submit                                                                    | The "Two-factor authentication" code screen appears; user is NOT yet logged in (no session)  |               | ⏳     |
| TFA_015 | Valid TOTP code completes login                    | On the code screen                            | 1. Enter the current 6-digit code from the app  2. Submit                                               | User is logged in and lands in the app exactly like a normal login                           |               | ⏳     |
| TFA_016 | Wrong code is rejected                             | On the code screen                            | 1. Enter an incorrect 6-digit code  2. Submit                                                           | Inline error "That code is not valid…"; stays on the code screen; not logged in              |               | ⏳     |
| TFA_017 | Empty code is blocked                              | On the code screen                            | 1. Leave the field empty  2. Submit                                                                     | "Please enter your code" message; no request made                                            |               | ⏳     |
| TFA_018 | Back to Login returns to password form             | On the code screen                            | 1. Click **Back to Login**                                                                              | Returns to the email/password form; tempToken is discarded                                   |               | ⏳     |

---

## Recovery-Code Login (single-use)

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_019 | Toggle to recovery-code mode                       | On the code screen                            | 1. Click "Use a recovery code instead"                                                                  | Label/placeholder switch to recovery-code; a "use authenticator app instead" link appears    |               | ⏳     |
| TFA_020 | Valid recovery code completes login                | On the code screen, recovery mode             | 1. Enter one saved recovery code  2. Submit                                                             | User is logged in                                                                            |               | ⏳     |
| TFA_021 | Recovery code is single-use                        | A recovery code was just used (TFA_020)       | 1. Log out  2. Log in  3. Enter the **same** recovery code                                              | Rejected as invalid — each code works only once                                              |               | ⏳     |
| TFA_022 | Code tolerates dashes/case                         | On the code screen, recovery mode             | 1. Enter a recovery code without the dash / in different case                                           | Accepted (normalised before checking)                                                        |               | ⏳     |

---

## Disable 2FA

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_023 | Disable with a current TOTP code                   | 2FA enabled                                   | 1. Settings → Two-Factor Authentication  2. Enter the current app code  3. Click **Disable**            | Toast "Two-factor authentication disabled"; status flips to OFF                              |               | ⏳     |
| TFA_024 | Disable with a recovery code                       | 2FA enabled, has unused recovery codes        | 1. Enter a recovery code instead of the app code  2. Click **Disable**                                  | 2FA disabled (recovery code accepted for disabling)                                          |               | ⏳     |
| TFA_025 | Disable with a wrong code is rejected              | 2FA enabled                                   | 1. Enter a wrong code  2. Click **Disable**                                                             | Inline error; 2FA stays enabled                                                              |               | ⏳     |
| TFA_026 | Login no longer prompts after disabling            | 2FA just disabled                             | 1. Log out  2. Log in with email + password                                                             | No second step — user logs in directly                                                       |               | ⏳     |

---

## Errors, Rate-Limit & Session

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_027 | Rate-limit on repeated wrong codes                 | On the code screen                            | 1. Submit wrong codes several times in quick succession                                                 | After the limit, a "too many requests" error is shown                                        |               | ⏳     |
| TFA_028 | Expired temp session sends user back to login      | On the code screen for > 5 minutes            | 1. Wait past the tempToken expiry  2. Submit a code                                                     | "Your verification session expired. Please sign in again."; returns to the password form     |               | ⏳     |

---

## Regression (must stay unchanged)

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_029 | Non-2FA account logs in normally                   | An account WITHOUT 2FA enabled                | 1. Log in with email + password                                                                         | Logs in directly — no second step; behaviour identical to before this feature                |               | ⏳     |
| TFA_030 | OAuth login unaffected (Phase 1 = password only)   | A Google/GitHub/GitLab account                | 1. Log in via an OAuth provider                                                                         | Logs in as usual; no 2FA step (gate applies to password login only in Phase 1)               |               | ⏳     |
| TFA_031 | Forgot/reset password still works                  | Any account                                   | 1. Use Forgot Password → reset flow                                                                     | Unchanged — reset email, link, and new password all work                                     |               | ⏳     |

---

## Navigation & UI

| ID      | Title                                              | Precondition                                  | Steps                                                                                                  | Expected Result                                                                              | Actual Result | Status |
|---------|----------------------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------|---------------|--------|
| TFA_032 | Settings menu label + page title render            | Logged in                                     | 1. Open Settings  2. Find the "Two-Factor Authentication" entry  3. Open it                             | Menu and header read "Two-Factor Authentication" (no raw `settingslider.*` key)              |               | ⏳     |
| TFA_033 | Secondary buttons are readable                     | On the enroll / recovery-codes screens        | 1. Inspect Cancel / Copy / Download buttons                                                             | Button text is white and clearly readable on the button background                           |               | ⏳     |

---

**Total:** 33 test cases · **All status:** ⏳ Pending
