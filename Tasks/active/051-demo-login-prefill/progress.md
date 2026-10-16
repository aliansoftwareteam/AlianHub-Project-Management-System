# Progress: Demo login — fill in the demo account and add a one-click "Try the demo" button

## Checklist

- [x] Add a `brand` watcher to `Login.vue` that fills in the demo email and password, applying the precedence rules
- [x] Add the **Try the demo** button in its own row below `.auth__actions`, wired to fill the form and then call `handleSubmit`
- [x] Add `Demo.try_demo` to `en.js` and run `npm run i18n:backfill`
- [x] Frontend unit spec: late-arriving brand settings, already-loaded settings, email only, demo mode off, different remembered email, typed text kept
- [x] Frontend unit spec: button visibility, one-click sign-in after the fields were edited, disabled while busy, Enter still runs Sign in
- [x] Backend unit test: `getBrandSettingsData` sends the demo keys only when `DEMO_MODE=true`
- [x] Update the `.env.example` comment (including the lockout note) and `scripts/env-doc.meta.json`, then regenerate `docs/ENV.md`
- [x] Check by hand on a local instance with `DEMO_MODE="true"`, at desktop and mobile widths
- [x] Open a `feat(auth)` PR into `staging`

## Last step

Committed on `feat/demo-login-prefill` (from `origin/staging`), pushed, and opened as a `feat(auth)` PR into `staging`. Left: review and merge. Then the follow-up docs PR (`npm run version:log`, `docs/BETA-LOG.md`) and moving this task to `done/`.

## Blockers

None.

## Log

### 2026-10-16
- Task created from the user's request. The existing demo-mode plumbing is listed in task.md.
- Assumption: "if email and password are prefilled" was read as "if `DEMO_EMAIL` / `DEMO_PASSWORD` are set", and each field is filled on its own (email only if only the email is set).
- Assumption: a remembered email, the `ForgotEmail` hand-off or typed text wins over the demo value, and the demo password is filled only next to the demo email.
- Scope change (user request): added a one-click **Try the demo** button below **Sign in**. It was out of scope before.
- Decision: the button gets its own full-width row under `.auth__actions` instead of going inside it. That row is a two-column grid, so inside it the button would sit beside **Sign in**.
- Decision: the button reuses `handleSubmit` rather than its own login call, so 2FA, the workspace picker, redirects and errors stay identical. It shows only when both the demo email and the demo password are set.
- Moved to active. Created the local branch `feat/demo-login-prefill` from `origin/staging` and removed its upstream, so nothing can be pushed to staging by accident.
- `Login.vue`: the remembered-email read moved from `onMounted` into the initial form state. The demo watcher runs during setup with `immediate: true`, and the old `onMounted` would have overwritten an already-filled demo email afterwards, pairing the demo password with another address. The precedence is unchanged (remembered email, then `ForgotEmail`).
- `Login.vue`: the demo values are lowercased, matching what the email input does to typed text. The watcher fills the form at most once per mount.
- Button: rendered as a second `.auth__actions` row with one child, so it spans both columns and gets the same 40/44 px height as Sign in. The only CSS added is `.auth__actions + .auth__actions { margin-top: 10px; }` in `AuthShell/style.css` (spacing, no colour).
- i18n: added `Demo.try_demo`; the backfill filled 10 locales and their pending files. `i18n:check` passes.
- Tests: `frontend/tests/unit/loginDemoAccount.spec.js` (15 cases) and `tests/admin-brand-demo-credentials.test.js` (6 cases) pass, along with the existing Login specs.
- Docs: updated `.env.example` and `scripts/env-doc.meta.json`, then regenerated `docs/ENV.md`. Staging's `docs/ENV.md` was already stale (missing `WORKSPACE_GUIDE_AUTO_CREATE`), so `env:doc:check` failed before this change too. The regenerated file adds that row as well.
- Environment note: this machine had no frontend `node_modules`, so I ran `npm ci` in `frontend/`. Running jest with the default worker pool alongside the install ran the machine out of memory; `--runInBand` / `--maxWorkers=2` works.
- Browser check: this machine has no `.env` and no MongoDB, so I ran the frontend dev server against a throwaway stub API (scratchpad only) that answers setup status, brand settings with demo values, public config, and a login that always rejects. I drove it with headless Playwright Chromium, with non-localhost requests blocked; the in-app browser hung on Google's sign-in script. All 21 checks passed:
  - Fields filled in, password masked, eye still works.
  - Desktop: the button is 10 px under Sign in, the same 400 px width and 40 px height. With magic links on, it spans both buttons.
  - Phone (375 px): it is 44 px tall and causes no horizontal scroll.
  - A remembered other email is kept with the password left empty.
  - One click sends one login call with the demo account, and both buttons are disabled while it runs.
  - A wrong password shows the usual mismatch message, and Enter still signs in with the typed values.
- The login page doesn't follow the system colour scheme, so the dark-mode run rendered light. Dark mode is not separately verified, but the button only uses the existing `ah-btn` tokens.
- Checks: `i18n:check`, `style:check` and `env:doc:check` pass.
  - The conventions project has 6 failing suites, and the full frontend suite has 47 failing tests in 13 files. With my changes stashed, the same 13 frontend files fail the same way. The backend failures are Windows-only (backslash paths, CRLF baselines) in files this task does not touch.
  - The full backend unit suite (1,175 files) was not run to the end on this machine for lack of memory. This task changes no backend code.
- `core.autocrlf=true` here: after git rewrites `.env.example` / `docs/ENV.md` with CRLF, `env:doc:check` reports them out of date. `node scripts/env-doc.js` writes LF again, with no content change.
- The user approved pushing. Committed as harmit001, pushed `feat/demo-login-prefill` and opened the PR into `staging`. `frontend/.env.example` (line endings only) and the separate backlog task 050 were left out of the commit.
