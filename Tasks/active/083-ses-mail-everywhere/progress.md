# Progress: Amazon SES mail everywhere

## Checklist

- [x] Owner approves this PRD
- [x] App: provider choice (SES → Resend → SMTP) in `Modules/service.js`, dead SES code removed
- [x] App: SES fields on the settings page, health, probe and schedule checks
- [x] App: `.env.example`, tests, i18n and style checks
- [x] Cloud: SES provider in `server/lib/mail.js`, config, instance `mailSettings()`
- [x] Cloud: docs, tests, lint and build
- [ ] Owner puts a working SES key in the `.env` files
- [ ] Real sends from the cloud portal and the app to harmit.mendapara@aliansoftware.net only
- [x] PRs: app #1745 into `chore/pre-staging`, cloud #14 into `main`

## Last step

PRs open (AlianHub #1745, alianhub-cloud #14); waiting for a working SES key for the real sends.

## Blockers

- The SES key sent on 2026-10-31 is rejected by AWS (`InvalidClientTokenId`). A fresh key is needed for the real sends (§3.3), not for building.

## Log

### 2026-10-31
- Task created. The owner asked for SES on the cloud portal, the instances the cloud builds, and wherever AlianHub is used, with harmit.mendapara@aliansoftware.net as the only test recipient.
- The pasted `AWS_SES_*` key fails `GetSendQuota` and IAM `GetUser` with `InvalidClientTokenId`; no mail sent, nothing written to any `.env`.
- Found that the app sends only through SMTP: the Resend settings never send and the SES modules are dead, so hosted instances (Resend key pushed, SMTP blocked on DigitalOcean) send no mail.
- Owner approved the PRD.
- App: `Modules/mailProvider.js` picks the provider and builds the Nodemailer transport (SES transport with `@aws-sdk/client-ses` `SendRawEmailCommand`; a small Resend transport over its HTTPS API; SMTP as before). `Modules/service.js` keeps its callbacks and the daily-cap queue. It reads `process.env` first and falls back to `config`, since saved settings update both and some code sets only `config`.
- App: removed `Modules/servicewithAWS.js`, `Modules/servicewithoutAWS.js` and the SES shim in `Config/aws.js` (the Wasabi keys there are still used by `Config/applyEnv.js`); updated `.claude/tests/test-bug-041.js`.
- App: settings page gets an "Amazon SES" section after SMTP and Resend; `AWS_SES_KEY` is stored as a secret, as the PRD says. Test uses read-only calls (`GetSendQuota`, `GetIdentityVerificationAttributes`): a send-only key answers AccessDenied, which still proves AWS accepted it, so those checks are skipped then. The English for `sec_mail_resend_note` and `managed_smtp_blocked` changed; other locales keep their older copy.
- App checks: new `tests/mail-provider.test.js` 19/19; the 86 test files that load the touched modules pass except `process-guards` (known Windows path failure on a clean base); frontend instance-settings specs 88/88; `i18n:check`, `style:check`, `env:doc:check` pass.
- Cloud (`feat/ses-mail`, commits `d5ba5df`, `2250e1d`): SES v2 provider in `server/lib/mail.js`, all-or-none `AWS_SES_*` and `INSTANCE_AWS_SES_*`, production accepts SES in place of Resend, `mailSettings()` pushes `AWS_SES_*`, decision 104. Lint clean; mail, config and adapter tests 75/75.
- Release order: an instance accepts the pushed `AWS_SES_*` keys only from an AlianHub image that has this task's settings fields, so `INSTANCE_AWS_SES_*` are set in the cloud only after that image is the release.
- Opened AlianHub #1745 (into `chore/pre-staging`) and alianhub-cloud #14 (into `main`, rebased on `130293e` after #6, #7, #8 and #13 merged; server 362/362, portal 50/50, ops 33/33, agent 25/25, lint and build clean).
- Renumbered from 082 to 083: the orchestrator hardening task took 082 first (AlianHub #1744, merged into `chore/pre-staging`). Commit messages written before the rename still say 082.
