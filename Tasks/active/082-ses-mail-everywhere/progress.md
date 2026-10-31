# Progress: Amazon SES mail everywhere

## Checklist

- [ ] Owner approves this PRD
- [ ] App: provider choice (SES → Resend → SMTP) in `Modules/service.js`, dead SES code removed
- [ ] App: SES fields on the settings page, health, probe and schedule checks
- [ ] App: `.env.example`, tests, i18n and style checks
- [ ] Cloud: SES provider in `server/lib/mail.js`, config, instance `mailSettings()`
- [ ] Cloud: docs, tests, lint and build
- [ ] Owner puts a working SES key in the `.env` files
- [ ] Real sends from the cloud portal and the app to harmit.mendapara@aliansoftware.net only
- [ ] PRs: app into `chore/pre-staging`, cloud into `main`

## Last step

PRD written; waiting for the owner's approval and a working SES key.

## Blockers

- The SES key sent on 2026-10-31 is rejected by AWS (`InvalidClientTokenId`). A fresh key is needed for the real sends (§3.3), not for building.

## Log

### 2026-10-31
- Task created. The owner asked for SES on the cloud portal, the instances the cloud builds, and wherever AlianHub is used, with harmit.mendapara@aliansoftware.net as the only test recipient.
- The pasted `AWS_SES_*` key fails `GetSendQuota` and IAM `GetUser` with `InvalidClientTokenId`; no mail sent, nothing written to any `.env`.
- Found that the app sends only through SMTP: the Resend settings never send and the SES modules are dead, so hosted instances (Resend key pushed, SMTP blocked on DigitalOcean) send no mail.
