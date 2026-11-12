# Google connector setup

Each member connects their own Google account on the Connections page (**My connections**) and ticks the products they want: **Calendar**, **Meet** and **Drive**. Agents and MCP clients then act with that person's Google token, and only on that person's behalf:

| Tool | Product | Reads or writes |
|---|---|---|
| `google.calendar.events.list` | Calendar | Reads the person's events in a time window |
| `google.calendar.events.get` | Calendar | Reads one event |
| `google.calendar.events.create` | Calendar | Creates an event, after the person approves it |
| `google.calendar.events.update` | Calendar | Changes an event, after the person approves it |
| `google.meet.spaces.get` | Meet | Reads one meeting space |
| `google.meet.spaces.create` | Meet | Creates a meeting space, after the person approves it |
| `google.drive.files.list` | Drive | Lists the files the person picked for AlianHub |
| `google.drive.files.get` | Drive | Reads one picked file's details |
| `google.drive.files.read` | Drive | Reads the text of one picked file |

Every write waits in the person's Inbox until they approve the exact change. Drive uses the `drive.file` scope, so neither the AI nor the picker can see a file the person did not pick.

The same connection backs the **attachment picker**. With Drive ticked, a member picks a Drive file from a task's attachment menu and attaches it as a link or imports a copy. The picker gets a short-lived access token for the member's own session only. No route hands a token to anyone else, and none takes another person's id.

## 1. Create the Google Cloud project

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project, or pick the one you use for AlianHub.
2. Under **APIs & Services** › **Library**, enable the **Google Calendar API**, the **Google Meet REST API**, the **Google Drive API** and the **Google Picker API**.
3. Under **Google Auth Platform** › **Branding** and **Audience**, set up the consent screen. Choose **Internal** if every member is in your Google Workspace, and **External** otherwise. An external app in testing allows only the test users you list. A published external app that asks for the Calendar scopes needs Google's verification.
4. Under **Data Access**, add these scopes: `openid`, `email`, `.../auth/calendar.events.readonly`, `.../auth/calendar.events.owned`, `.../auth/calendar.app.created`, `.../auth/meetings.space.created`, `.../auth/meetings.space.readonly` and `.../auth/drive.file`.

## 2. Create the OAuth client

1. Under **Clients**, choose **Create client** › **Web application**.
2. Under **Authorized redirect URIs**, add `<APIURL>/api/v1/connector-oauth/google/callback`, for example `https://pm.example.com/api/v1/connector-oauth/google/callback`. Google accepts `http://localhost:4000/...` for local development.
3. Copy the **Client ID** and the **Client secret**.

Use a separate client from the sign-in one. Never reuse `GOOGLE_CLIENT_ID`: the sign-in exchange answers to the browser, and connector tokens must never leave the server.

## 3. Picker key and project number

The Drive picker needs two values that are not part of OAuth and are safe for the browser:

1. Under **APIs & Services** › **Credentials**, choose **Create credentials** › **API key**. Under **API restrictions**, restrict it to the **Google Picker API**; under **Application restrictions** › **Websites**, add your AlianHub web address. This is `CONNECTOR_GOOGLE_PICKER_API_KEY`.
2. On the project's **Dashboard**, copy the **Project number**. This is `CONNECTOR_GOOGLE_APP_ID`. Without it a `drive.file` grant never reaches a picked file, so its preview and import fail with "File not found".

## 4. Configure AlianHub

```env
CONNECTORS=google
CONNECTOR_GOOGLE_CLIENT_ID="1234567890-abc.apps.googleusercontent.com"
CONNECTOR_GOOGLE_CLIENT_SECRET="…"
CONNECTOR_GOOGLE_PICKER_API_KEY="AIza…"
CONNECTOR_GOOGLE_APP_ID="1234567890"
APIURL="https://pm.example.com/"
SECRETS_STORE=on
SECRETS_KEY="…at least 32 characters…"
AGENT_TAINT_ROUTING=on
```

Name any other connectors in the same list, for example `CONNECTORS=google,slack,dropbox`. Without `CONNECTOR_GOOGLE_CLIENT_ID` and `CONNECTOR_GOOGLE_CLIENT_SECRET`, Google is offered only to a workspace that set its own Google app, and the server says so in one startup log line. If `AGENT_EGRESS_ALLOWLIST` is on and the workspace has a host list, add `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` and `meet.googleapis.com` to it.

## 5. A company's own Google app

A workspace owner or admin can set the company's own Google app under **Connections** › **Company OAuth apps**. It replaces the instance app for that workspace, and members connected through the instance app reconnect once. Register the redirect URI the screen shows with that app.

The screen sets the client ID and secret only. To give the company app its own picker key and project number, send them as `extra` with the same request:

```http
PUT /api/v2/connectors/apps/google
{ "clientId": "…", "clientSecret": "…", "extra": { "pickerApiKey": "AIza…", "appId": "1234567890" } }
```

Without them the picker falls back to `CONNECTOR_GOOGLE_PICKER_API_KEY` and `CONNECTOR_GOOGLE_APP_ID`.

## 6. Moving from the old paths

- **Google Calendar connector.** `CONNECTORS=google_calendar` no longer switches anything on. Name `google` instead. Migrations `080-connectors-google-calendar-to-google` and `083-connectors-finish-legacy-cutover` move every old Calendar connection onto the Google provider with Calendar ticked, keeping its grant, so nobody reconnects. The redirect URI did not change, so the existing OAuth client keeps working. A person who had also connected the same Google account on My connections keeps that connection; the duplicate's tokens are retired.
- **Per-person cloud-storage apps.** The old Drive and Dropbox settings under Settings › Integrations are gone. Migrations `082-cloud-storage-to-connectors` and `083-connectors-finish-legacy-cutover` delete the client secrets each person stored there and close their old grants. Each person connects Google once on My connections and ticks Drive. Files already attached as links keep opening, and imported copies are ordinary uploads.
