---
id: 082
title: Amazon SES mail for AlianHub Cloud, hosted instances and every AlianHub install
status: active
priority: high
depends_on: []
created: 2026-10-31
---

# 082 — Amazon SES mail everywhere (PRD)

Two repositories:

- **AlianHub** (this repo): the app every instance runs, hosted or self-hosted.
- **AlianHub Cloud** (`aliansoftwareteam/alianhub-cloud`, local `F:/Projects/alianhub-cloud`): the customer portal, back office and provisioning control plane.

## 1. Problem

The owner wants all AlianHub mail to go through the company's Amazon SES account (`us-east-1`, sender `noreply@alianhub.com`): the cloud portal, every instance the cloud provisions, and any other AlianHub install.

Today none of these can use SES, and hosted instances cannot send mail at all:

- **Cloud** — `server/lib/mail.js` sends only through the Resend HTTPS API, on purpose: DigitalOcean blocks outbound SMTP (25, 465, 587).
- **App** — `Modules/service.js` (`SendEmail`, `SendNotificationEmail` with BCC, `sendAttachMail` with attachments, `deliverQueued`) sends only through Nodemailer SMTP (`NODEMAILER_*`).
  - `RESEND_API_KEY` / `RESEND_FROM_EMAIL` are read by `Config/config.js`, shown on the Instance settings page ("When set, Resend is used instead of SMTP") and checked by the mail probe, but **nothing sends through Resend**.
  - `Modules/servicewithAWS.js` (SES via `AWS_SES_*`), `Modules/servicewithoutAWS.js` and the SES client in `Config/aws.js` are loaded by nothing: dead code.
- **Hosted instances** — the cloud's `mailSettings()` (`orchestrator/adapters/hosted.js`) pushes `RESEND_API_KEY` in the `config_pushed` provisioning step. The app ignores it for sending and SMTP is blocked on the droplet, so activation, invitation and password-reset mail never leaves a hosted instance.

## 2. Goal

With one SES key in each `.env`, the cloud portal and every AlianHub instance (hosted or self-hosted) send all their mail through the SES HTTPS API, attachments and BCC included, and the settings page and health checks say which provider is in use and whether it works.

## 3. Scope

### 3.1 AlianHub app (this repo)

1. **One mail provider choice** used by every send in `Modules/service.js` (including `deliverQueued`):
   **SES** when `AWS_SES_KEY`, `AWS_SES_SECRET` and `AWS_SES_REGION` are all set → else **Resend** when `RESEND_API_KEY` is set → else **SMTP** (`NODEMAILER_*`), as today.
   - SES goes through Nodemailer's SES transport with the installed `@aws-sdk/client-ses` v3 client, so the same message (HTML, BCC, attachments) is built once and only the transport changes. From: `APP_NAME <AWS_SES_FROM_DEFAULT>`.
   - Resend goes through its HTTPS API (attachments as base64). From: `RESEND_FROM_EMAIL`. This makes the existing setting do what the settings page already promises, and keeps the cloud's Resend fallback working.
   - Callback contract (`cb({ status, data | error })`), the "held for tomorrow" queue and every caller stay unchanged.
2. **Remove the dead SES code**: `Modules/servicewithAWS.js`, `Modules/servicewithoutAWS.js`, the SES client and shim in `Config/aws.js` (delete the file if nothing else uses it), and the stale `.claude/tests/test-bug-041.js` reference.
3. **Settings page** (`Modules/Instance/settingsCatalog.js`, `mail` group, so the cloud may push them): `AWS_SES_REGION`, `AWS_SES_KEY` (secret), `AWS_SES_SECRET` (secret), `AWS_SES_FROM_DEFAULT`, with an "Amazon SES" section in the Mail layout (link to the SES console). Labels and help text through i18n (CLAUDE.md Rule 3).
4. **Health and checks use the same choice**: `mailHealth()` in `Modules/Instance/controller.js` reports `ses | resend | smtp | null`; `probeMail()` in `Modules/Instance/probes.js` tests SES (a read-only call such as `GetSendQuota`, reporting a rejected key, an unverified sender or a sandboxed account in words); `mailConfigured()` in `Modules/Agents/schedules/delivery.js` and `schedulesController.js` accept SES and Resend, not only SMTP.
5. **`.env.example`**: an "EMAIL — Amazon SES (recommended for cloud hosting)" block with the four variables and the order SES → Resend → SMTP.
6. **Tests**: provider choice and precedence, each send function on each provider (SES and Resend clients mocked), probe answers, settings catalog fields.

### 3.2 AlianHub Cloud (alianhub-cloud repo)

1. **Portal and back-office mail** (`server/lib/mail.js`): an SES provider through `@aws-sdk/client-sesv2`, pinned to the same version as the other AWS clients (`3.1151.0`), sending HTML, text and reply-to. Order: SES → Resend → development outbox (unchanged). `emailLog` keeps `status` and `providerId` (the SES message id), and a delivery failure still logs `failed` without throwing.
2. **Config** (`server/config.js`): `AWS_SES_KEY`, `AWS_SES_SECRET`, `AWS_SES_REGION`. All three or none; a partial set refuses to boot with a clear message. The From address stays `MAIL_FROM`.
3. **Hosted instances**: `INSTANCE_AWS_SES_KEY`, `INSTANCE_AWS_SES_SECRET`, `INSTANCE_AWS_SES_REGION`. When set, `mailSettings()` pushes `AWS_SES_KEY`, `AWS_SES_SECRET`, `AWS_SES_REGION` and `AWS_SES_FROM_DEFAULT` (the address part of `INSTANCE_MAIL_FROM`) instead of the Resend keys; otherwise Resend as today. The local Docker adapter keeps its SMTP catcher.
4. **Docs**: `.env.example`, `docs/hosting-setup.md` (an Amazon SES row: what to create in AWS and which variables to fill), a new entry in `docs/decisions.md`.
5. **Tests**: provider choice, the SES request shape (client mocked), the partial-config boot error, `mailSettings()` with and without the instance SES keys.

### 3.3 Verification with a real key

Once the owner has put a working key in the `.env` files: one real send from the cloud portal and one from the AlianHub app (with an attachment), both **only to `harmit.mendapara@aliansoftware.net`**. No real mail may reach any other address while testing; the test databases hold made-up addresses, and bounces would hurt the production sender.

## 4. Out of scope

- SES bounce and complaint handling (SNS topics, a suppression list), configuration sets, open/click tracking. Worth a follow-up task once real volume starts.
- Creating the IAM user, verifying `alianhub.com` in SES, DKIM/SPF/DMARC records, or asking AWS to leave the sandbox: done by the owner in the AWS console.
- Re-pushing mail settings to instances that already exist: there are no hosted instances yet.
- Changing any email template or wording.
- Removing SMTP or Resend support.

## 5. Acceptance criteria

1. App, SES set: `SendEmail`, `SendNotificationEmail` (BCC) and `sendAttachMail` (attachment) each send through SES. Unit tests with a mocked client, plus one real send with an attachment to the test address.
2. App: SES beats Resend beats SMTP when several are set; with none set, sending fails exactly as it does today.
3. App, Instance settings: the Mail group shows the Amazon SES section; Test answers "accepted" for a working key and a plain-language error for a rejected key, an unverified sender or a sandboxed account; the health page shows the provider.
4. App: scheduled agent deliveries treat SES or Resend as configured mail.
5. App: the dead SES modules are gone; `npm run i18n:check`, `npm run style:check` and the new and touched tests pass.
6. Cloud, SES set: verification, password-reset and invitation mails are sent through SES and logged `sent` with the SES message id; a rejected send is logged `failed` and the request still succeeds.
7. Cloud: setting only some of `AWS_SES_KEY`, `AWS_SES_SECRET`, `AWS_SES_REGION` stops boot with a message naming the missing ones.
8. Cloud: a newly provisioned hosted instance receives `AWS_SES_*` in `config_pushed` when the instance SES keys are set, and Resend keys otherwise.
9. Cloud: `npm run lint`, `npm test` and `npm run build` pass; `.env.example`, `docs/hosting-setup.md` and `docs/decisions.md` are updated.
10. A real email from each of the cloud portal and the AlianHub app has reached `harmit.mendapara@aliansoftware.net` through SES, and no other address got real mail during testing.

## 6. Constraints & notes

- **Key**: the key pasted in chat on 2026-10-31 (`AKIA36HK…`) is rejected by AWS (`InvalidClientTokenId` from SES and IAM: deleted, deactivated or mistyped). Its secret is in a chat transcript, so it should not be reactivated. The owner creates a fresh key and writes it into the `.env` files; it is never committed or pasted.
- **Least privilege**: the IAM policy allows only `ses:SendEmail` and `ses:SendRawEmail`, ideally with a `ses:FromAddress` condition on `noreply@alianhub.com`. The instance key is pushed to every hosted instance, so a **separate IAM user for instances** lets it be revoked without stopping portal mail.
- **Sandbox**: if the SES account is still in the sandbox it can only send to verified addresses, so the test address would need verifying in SES first. The probe reports this.
- **Delivery**: one PR per repo. App PR into `chore/pre-staging` (the cloud programme's integration branch). Open PR 1742 (task 075) also changes `settingsCatalog.js` and adds the Mail layout in `settingsLayout.js`, so the app work builds on it if it is not merged by then. Cloud PR into `main` on its own branch; it does not overlap PR 6 or PR 8.
- The code can be built and unit-tested without a key; only §3.3 waits for it.

## 7. Resources

None yet.
