---
id: 051
title: Demo login — fill in the demo account and add a one-click "Try the demo" button
status: done
priority: medium
depends_on: []
created: 2026-10-16
---

# Demo login — fill in the demo account and add a one-click "Try the demo" button

## Goal
On a public demo instance (`DEMO_MODE="true"`), a visitor should get into the product without typing anything. Today they have to copy the email and password from the demo banner and type them into the form. When `DEMO_EMAIL` / `DEMO_PASSWORD` are set:
1. The login form should already hold those values.
2. A **Try the demo** button below **Sign in** should sign into the demo account in one click.

## What already exists (no new plumbing needed)
- `.env.example` has `DEMO_MODE`, `DEMO_EMAIL`, `DEMO_PASSWORD`.
- `getBrandSettingsData` in `Modules/Admin/common/controller.js` (around line 69) adds `demoMode` to the public, pre-login brand-settings response. Only when `DEMO_MODE === 'true'` does it also add `demoEmail` and `demoPassword`. When demo mode is off, neither key is sent.
- The frontend keeps that response in the `brandSettingTab/brandSettings` getter, and `DemoBanner.vue` already shows the credentials from it.
- `Login.vue` (`frontend/src/views/Authentication/Login/Login.vue`) already reads the same getter as `brand`.
- `handleSubmit` in `Login.vue` already handles everything after the click: validation, the login call, 2FA, the workspace picker, `redirect_url` and every error message.

So the credentials already reach the browser. This task only puts them into the form and adds the button.

## Scope

### 1. Fill in the form
- **`Login.vue`**: watch `brand` with `immediate: true`. The first time `brand.demoMode === true`, fill in the form:
  - `form.email` ← `brand.demoEmail`, if the email field is empty.
  - `form.password` ← `brand.demoPassword`, if the password field is empty **and** `form.email` equals `demoEmail` (case-insensitive).
  - Apply it only once per page mount, so later brand-settings updates never overwrite what the visitor typed.
- **Timing**: this has to be a watcher, not code in `onMounted`. `Login.vue` mounts before `App.vue`'s `onMounted` sends the `setBrandSettings` request, so `brand` is usually still `{}` when the login page mounts.
- **Precedence**: a value that is already there wins over the demo value. That covers an email remembered by "keep signed in" (`readRememberedEmail`), the `ForgotEmail` hand-off and anything the visitor has typed. The password is never paired with an email other than the demo one.

### 2. "Try the demo" button
- **When it shows**: only when `brand.demoMode === true` **and** both `demoEmail` and `demoPassword` are non-empty. One click is impossible without both.
- **Where**: in its own full-width row directly below the `.auth__actions` row (**Sign in**, plus **Email me a link** when magic links are on), and above **Keep me signed in**. It cannot go inside `.auth__actions`, because that row is a two-column grid (`AuthShell/style.css`) and the button would sit beside **Sign in** instead of under it.
- **Markup**: `<button type="button" class="ah-btn ah-btn--secondary ah-btn--block">` with the label `$t('Demo.try_demo')` ("Try the demo"). It stays `type="button"` so Enter in the form still runs **Sign in**.
- **On click**: set `form.email` and `form.password` to the demo values, overwriting whatever is in the fields (the visitor has chosen the demo account). Clear `errors`, then call the existing `handleSubmit()`. There is no separate login path, so 2FA, workspace choice, `redirect_url`, "keep signed in" and error messages behave exactly as they do for **Sign in**.
- **While signing in**: disabled while `busy`, like the other buttons in the form.

### 3. Docs and tests
- **Docs**: update the `DEMO MODE` comment block in `.env.example`, and the `DEMO_EMAIL` / `DEMO_PASSWORD` / `DEMO_MODE` descriptions in `scripts/env-doc.meta.json`, to say the login form is filled in and offers **Try the demo**. Then regenerate `docs/ENV.md` (`npm run env:doc:check` must pass).
- **Tests**:
  - A frontend unit spec next to `frontend/tests/unit/loginInvitationRedirect.spec.js` that mounts `Login.vue` with a mocked `brandSettingTab/brandSettings` getter and covers both the filling and the button.
  - A backend unit test for `getBrandSettingsData` that checks the demo keys are present when `DEMO_MODE=true` and absent otherwise.

## Out of scope
- Signing in automatically on page load without a click.
- Moving the demo credentials from brand settings to `/api/v2/instance/public-config`.
- Any change to the demo banner's text, layout or links.
- Prefilling, or a demo button, on other auth screens (sign-up, SSO, forgot-password, invitation).
- Filling the password back in after **Back** from the 2FA or verify-email step. The demo account is not expected to use either step.
- Resetting or protecting the demo account's data (a throwaway demo database is assumed, as `.env.example` already says).
- Exempting the demo account from the failed-attempt lockout.

## Acceptance criteria

**Filling in the form**
- [x] With `DEMO_MODE="true"` and both `DEMO_EMAIL` and `DEMO_PASSWORD` set, a fresh visit to `/login` (cleared localStorage) shows both fields filled in. Pressing **Sign in** signs into the demo account.
- [x] Filling in works whether brand settings arrive after the login page mounts (first load) or are already in the store (going back to `/login` inside the app).
- [x] With `DEMO_MODE="true"` and only `DEMO_EMAIL` set, only the email field is filled in. The password stays empty.
- [x] If the email field already holds a different address (remembered email or `ForgotEmail`), it is kept and the password field stays empty.
- [x] Text the visitor typed before brand settings arrived is never overwritten.
- [x] The password field stays masked (`type="password"`), and the show/hide eye works as before.
- [x] Both filled fields can be edited and cleared like normal input. Validation and error messages behave as they do today.

**Try the demo button**
- [x] With `DEMO_MODE="true"` and both `DEMO_EMAIL` and `DEMO_PASSWORD` set, **Try the demo** shows directly below **Sign in** (and below **Email me a link** when that is shown), full width, on desktop and on mobile widths.
- [x] One click signs into the demo account and lands where **Sign in** would, including `redirect_url`, the workspace picker and 2FA if the account has it. This holds even when the visitor has edited or cleared the fields first.
- [x] While the sign-in is running, the button is disabled. A wrong `DEMO_PASSWORD` shows the usual "email or password is incorrect" message under the password field.
- [x] Pressing Enter in the form still runs **Sign in**, not **Try the demo**.
- [x] The button is hidden when `DEMO_MODE` is not `"true"`, or when either `DEMO_EMAIL` or `DEMO_PASSWORD` is empty.

**Demo mode off and checks**
- [x] With `DEMO_MODE="false"`, or the variable unset or set to any value other than `true`, both fields stay empty, the button is hidden, and the brand-settings response has no `demoEmail` / `demoPassword`.
- [x] The new frontend spec and backend test pass. `npm test`, `cd frontend && npm test`, `npm run i18n:check`, `npm run style:check` and `npm run env:doc:check` all pass.

## Constraints & notes
- **i18n (Rule 3)**: the only new string is `Demo.try_demo: "Try the demo"`, added to the existing `Demo` namespace in `frontend/src/locales/en.js`. Run `npm run i18n:backfill` afterwards and commit the locale files and the `.pending.json` files. Adding the key must not push `Login.vue` past its baseline in `scripts/i18n-allowlist.json`.
- **Styles (Rule 5)**: the button reuses the existing `ah-btn` classes. If the row needs spacing from `.auth__actions`, put it in `AuthShell/style.css` with spacing only, no colours. `npm run style:check` must not report anything new.
- **Security**: this does not expose anything new. The password is already sent to every anonymous visitor and printed in the banner while demo mode is on. It must still never be sent when demo mode is off, and the backend test above locks that in. Do not log the values or add them to the URL.
- **Lockout**: the demo account is shared, so repeated failed clicks with a wrong `DEMO_PASSWORD` can lock it through the existing attempt limit. Operators must keep `DEMO_PASSWORD` in step with the demo account. Add one line about this to the `.env.example` comment.
- The visitor's browser password manager may fill over the demo values. That's acceptable.
- **PR**: one `feat(auth): …` PR into `staging`. No route is added, so no `api:doc` regeneration is needed (Rule 4).

## Resources
- None yet.
