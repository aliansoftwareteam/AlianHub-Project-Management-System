# Mail

AlianHub sends invitations, password resets, sign-in links, notifications, digests and scheduled reports by email. Without a mail provider none of these leave the server, so set one up before you invite your team.

## Pick a provider

| Provider | How it sends | Choose it when |
|---|---|---|
| **Amazon SES** | AWS HTTPS API | you have (or can create) an AWS account; cheap at any volume; works where outbound SMTP is blocked |
| **Resend** | HTTPS API | you want a quick start with a verified domain; works where SMTP is blocked |
| **SMTP** | Nodemailer over port 587 or 465 | you already have a mail server, Google Workspace, Microsoft 365 or a relay |

When more than one is configured, **SES wins, then Resend, then SMTP**: SES is used once `AWS_SES_KEY`, `AWS_SES_SECRET` and `AWS_SES_REGION` are all set; Resend once `RESEND_API_KEY` is set; SMTP once `NODEMAILER_HOST` is set. Attachments and BCC work on all three.

Configure it under **Settings › Instance › Settings › Mail** and press **Test**, which tries the values you typed before you save them. Or set the variables in `.env` and restart. The **Mail** card on **Settings › Instance › Health** shows which provider is in use, with a **Test mail** button.

Many cloud hosts (DigitalOcean among them) block outbound SMTP on ports 25, 465 and 587. If the SMTP test times out, use SES or Resend, or your provider's alternate port such as 2525.

## Amazon SES

1. In the AWS console, open **Amazon SES** in the region you want to send from (for example `us-east-1`).
2. Verify a sending identity: your domain (recommended; add the DKIM records it shows to your DNS) or a single address.
3. Create an IAM user with permission to send through SES (`ses:SendRawEmail`; add `ses:GetSendQuota` and `ses:GetIdentityVerificationAttributes` so the **Test** button can check the account) and create an access key for it.
4. Fill in the Amazon SES section of **Mail**:

   | Field | Key | Example |
   |---|---|---|
   | Region | `AWS_SES_REGION` | `us-east-1` |
   | Access key ID | `AWS_SES_KEY` | |
   | Secret access key | `AWS_SES_SECRET` | |
   | From address | `AWS_SES_FROM_DEFAULT` | `noreply@example.com` |

5. Press **Test**. It checks that AWS accepts the key, that the from address or its domain is verified, and whether the account is still in the SES sandbox.

Emails show your **Product name** (`APP_NAME`) as the sender name, in front of the SES from address.

::: warning The SES sandbox
A new SES account sends at most 200 emails a day, and only to verified addresses, until AWS grants production access. The **Test** result says when the account is still in the sandbox. Request production access from the SES console before you invite people.
:::

The same keys in `.env`:

```bash
AWS_SES_REGION=us-east-1
AWS_SES_KEY=<access key id>
AWS_SES_SECRET=<secret access key>
AWS_SES_FROM_DEFAULT=noreply@example.com
```

## Resend

1. Create an account at resend.com, add and verify your domain, and create an API key.
2. Set **Resend API key** (`RESEND_API_KEY`) and **Resend from address** (`RESEND_FROM_EMAIL`, an address on the verified domain).
3. Press **Test**.

`RESEND_FROM_EMAIL` defaults to `onboarding@resend.dev`, which Resend accepts only for sending to your own account. Use your verified domain in production.

## SMTP

| Field | Key | Notes |
|---|---|---|
| SMTP host | `NODEMAILER_HOST` | such as `smtp.gmail.com`, `smtp.office365.com`, `email-smtp.us-east-1.amazonaws.com` |
| SMTP port | `NODEMAILER_PORT` | `587` (STARTTLS, default) or `465` (TLS) |
| SMTP username | `NODEMAILER_USER` | only when the login differs from the from address, for example an Amazon SES Mail Manager endpoint ID or SES SMTP credentials |
| From address | `NODEMAILER_EMAIL` | also the login when no username is set |
| SMTP password | `NODEMAILER_EMAIL_PASSWORD` | |

The certificate of the SMTP server is checked. Only for a self-signed certificate on a server you control, set `NODEMAILER_ALLOW_SELF_SIGNED=true`; it exposes mail to interception otherwise.

### Gmail or Google Workspace

Google refuses your normal password over SMTP. Use an app password:

1. Turn on **2-Step Verification** for the Google account that will send.
2. In the Google account settings open **Security › App passwords**, create one (for example named "AlianHub") and copy the 16-character password.
3. Set:

   ```bash
   NODEMAILER_HOST=smtp.gmail.com
   NODEMAILER_PORT=587
   NODEMAILER_EMAIL=you@example.com
   NODEMAILER_EMAIL_PASSWORD=<the app password, without spaces>
   ```

4. Press **Test**.

Gmail limits how many messages an account may send a day (a few hundred for a personal account, more for Workspace). For a larger team use SES or Resend.

### Microsoft 365

Use `smtp.office365.com`, port 587, and a mailbox that has **Authenticated SMTP** enabled in the Microsoft 365 admin center. Tenants with security defaults turned on block SMTP basic authentication; use SES or Resend there.

## Other mail settings

| Key | Purpose |
|---|---|
| `EMAIL_IN_DOMAIN` | Domain of the inbound addresses that create tasks from email (default `inbox.alianhub.com`). Receiving mail needs an inbound mail route to the instance, set up outside AlianHub. |
| `ERRORRECIVEREMAIL` | Address that receives error alert emails from the server. |
| `SUPPORT_MAIL` | Mailbox that gets a copy of messages in the support project; unset sends nothing. |

## When mail does not arrive

1. Press **Test** under **Mail**. It names the problem: a refused login, an unverified sender, a blocked port, a sandboxed SES account.
2. Check **Settings › Instance › Logs** (the error log) for the send attempt.
3. Check the recipient's spam folder. Publish SPF, DKIM and DMARC records for the sending domain; SES and Resend show the records to add.
4. Make sure `WEBURL` is the public address, or the links in the emails point to the wrong place.

## Related

- [The Instance console](./instance-console)
- [Troubleshooting](./troubleshooting)
- [Environment variables](./env-reference#mail)
