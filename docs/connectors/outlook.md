# Outlook connector setup

Each member connects their own Microsoft account: a work or school account, or a personal Outlook.com account. Agents and MCP clients then act with that person's token, and only on that person's behalf:

- `outlook.mail.search` searches the person's mail, newest first: date, sender, subject and a short preview of each message. With no query it lists the latest messages in the Inbox.
- `outlook.mail.read` reads one email in full, as plain text. HTML formatting, scripts, styles, images and links are removed.
- `outlook.calendar.events.list` lists the events on the person's calendar in a time window (by default, the next 7 days), with times in UTC.
- `outlook.mail.reply.draft` proposes a reply to one email. Once the person approves it in the Inbox, it is saved as a draft in their Drafts folder. It is never sent: the person opens the draft in Outlook and sends it from there.
- `outlook.calendar.events.create` proposes an event on the person's default calendar. Nobody is invited, so Outlook sends no invitation. The person can invite people from Outlook afterwards.

Each read is capped and marks the run, and the run makes no web fetch after it. Nothing is written until the person who owns the connection approves exactly what goes out. An owner or admin cannot approve it for them.

AlianHub never asks for `Mail.Send`, so it has no permission to send mail. Teams, OneDrive and SharePoint are not part of this connector.

## 1. Register the Microsoft Entra app

1. In the [Microsoft Entra admin center](https://entra.microsoft.com), open **Identity** › **Applications** › **App registrations** › **New registration**.
2. Name it, for example "AlianHub".
3. Under **Supported account types**, choose **Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)**. This lets people from any organisation, and people with a personal Outlook.com account, connect.
4. Under **Redirect URI**, pick the platform **Web** and enter `<APIURL>/api/v1/connector-oauth/outlook/callback`, for example `https://pm.example.com/api/v1/connector-oauth/outlook/callback`. It must use https. The only exception is `http://localhost`. Wildcards do not work when personal accounts are allowed.
5. Choose **Register**. Copy the **Application (client) ID** from the **Overview** page.
6. Open **Certificates & secrets** › **Client secrets** › **New client secret**. Copy its **Value** (not its ID) at once, because it is shown only once. A secret expires (after 24 months at most). Note the date and create a new one before then.
7. Open **API permissions** › **Add a permission** › **Microsoft Graph** › **Delegated permissions**, and add:
   - `Mail.ReadWrite`: read mail and save draft replies. Graph needs it to create a draft (`Mail.Read` cannot), and it does not allow sending.
   - `Calendars.ReadWrite`: read the calendar and create events.
   - `offline_access`, `openid` and `profile`: keep the connection after the first hour, and name the account.

   Do not add `Mail.Send`. The `User.Read` permission that a new registration has by default is not used, and you may remove it.

## 2. Admin consent

Many organisations let only an admin approve apps that read mail. A person in such an organisation sees Microsoft's **Need admin approval** (or **Approval required**) page when they connect. If they go back to AlianHub, Microsoft answers `access_denied`, and the Connections page explains that an admin may need to approve AlianHub first.

An admin of that organisation can grant consent for everyone in it in either of these ways:

- In the Entra admin center of **their own** tenant, open **Enterprise applications**, find AlianHub (it appears after the first person in the tenant tries to connect), and choose **Permissions** › **Grant admin consent**.
- Or open this address once, signed in as an admin of their tenant: `https://login.microsoftonline.com/<their tenant id or domain>/adminconsent?client_id=<Application (client) ID>`.

A personal Outlook.com account never needs admin consent.

## 3. Publisher verification

Many organisations allow people to consent only to apps from a verified publisher (Microsoft's recommended setting). In those organisations, an app whose publisher is not verified always needs an admin (see section 2). Once the publisher is verified, people there can consent themselves to these permissions. Verification is free. It needs a Microsoft AI Cloud Partner Program (partner) account, and the partner account and the app's tenant must share a verified domain. Set it under **Branding & properties** › **Publisher verification** in the app registration. Alian's shared app should be verified. A self-hosted install that serves only its own organisation can do without verification, and an admin grants consent once instead.

## 4. Configure AlianHub

```env
CONNECTORS=google,slack,outlook
CONNECTOR_OUTLOOK_CLIENT_ID="11112222-bbbb-3333-cccc-4444dddd5555"
CONNECTOR_OUTLOOK_CLIENT_SECRET="…"
APIURL="https://pm.example.com/"
SECRETS_STORE=on
SECRETS_KEY="…at least 32 characters…"
AGENT_TAINT_ROUTING=on
```

Without `SECRETS_STORE`, a usable `SECRETS_KEY` and `AGENT_TAINT_ROUTING`, the connector stays off, and the server says why in one startup log line. A workspace owner or admin can set the company's own Microsoft app instead (`PUT /api/v2/connectors/apps/outlook`). It then replaces the instance app for that workspace, and its own redirect URI must be the same callback. If `AGENT_EGRESS_ALLOWLIST` is on and the workspace has a host list, add `login.microsoftonline.com` and `graph.microsoft.com` to that list.

For local development, `http://localhost:4000/api/v1/connector-oauth/outlook/callback` works as a redirect URI with `APIURL="http://localhost:4000/"`, because Microsoft allows http for localhost.

## 5. Disconnecting

Microsoft has no endpoint for an app to end a person's grant. Disconnecting in AlianHub deletes the person's tokens from the secrets store, so AlianHub can no longer use the connection. To remove AlianHub from the account as well, the person removes it at [myapps.microsoft.com](https://myapps.microsoft.com) (work or school account) or [account.live.com/consent/Manage](https://account.live.com/consent/Manage) (personal account).

## 6. Limits

Microsoft Graph allows about 10,000 requests per 10 minutes per app and mailbox. When Graph answers 429, AlianHub holds the connection until the time Graph names in `Retry-After`. A refresh token lasts 90 days without use. If a refresh needs the person to sign in again (for example, a new multi-factor rule), the connection is marked as needing attention and the person reconnects.
