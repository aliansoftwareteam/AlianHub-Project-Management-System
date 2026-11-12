# Dropbox connector setup

One Dropbox connection now backs both the attachment picker and the AI tools. Each member connects their own Dropbox account on the Connections page (**My connections**), and AlianHub uses that person's token only on their behalf:

- **Attachment picker.** A member picks files in the Dropbox Chooser from a task's attachment menu. The Chooser opens with the workspace's Dropbox app key and signs the person in itself, so attaching a link needs no connection. "Import a copy" downloads the file with the person's own connection, or through the one-time link the Chooser hands back, which is checked to be a Dropbox address before the server fetches it.
- **AI tools.** Agents and MCP clients reach Dropbox's own MCP server (`https://mcp.dropbox.com/mcp`) with the same Dropbox token: `dropbox.files.search` searches the person's Dropbox, and `dropbox.file.read` reads one file. Both stay off until their shapes are pinned against a test account (see [mcp-apps.md](mcp-apps.md#pinning-tool-shapes)).

Disconnecting revokes the token at Dropbox and deletes it from the secrets store.

## 1. Create the Dropbox app

1. At [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps), choose **Create app**, then **Scoped access** and **Full Dropbox**, and name it.
2. On the **Permissions** tab, tick `files.metadata.read`, `files.content.read` and `account_info.read`, and choose **Submit**.
3. On the **Settings** tab, under **OAuth 2** › **Redirect URIs**, add `<APIURL>/api/v1/connector-oauth/dropbox/callback`, for example `https://pm.example.com/api/v1/connector-oauth/dropbox/callback`. Dropbox accepts `http://localhost:4000/...` for local development.
4. On the same tab, under **Chooser / Saver / Embedder domains**, add the hostname of every address AlianHub is opened on, for example `pm.example.com`. The Chooser refuses to open anywhere else.
5. Copy the **App key** and the **App secret**. The app key is also the OAuth client ID and is safe for the browser; the app secret is not.

A new Dropbox app is in development status, which limits how many people can connect it. Apply for production on the **Settings** tab before you roll it out widely.

## 2. Configure AlianHub

```env
CONNECTORS=dropbox
CONNECTOR_DROPBOX_CLIENT_ID="abc123appkey"
CONNECTOR_DROPBOX_CLIENT_SECRET="…"
APIURL="https://pm.example.com/"
SECRETS_STORE=on
SECRETS_KEY="…at least 32 characters…"
AGENT_TAINT_ROUTING=on
```

Name any other connectors in the same list, for example `CONNECTORS=google,slack,dropbox`. Set both values: without either one, Dropbox is offered only to a workspace that set its own Dropbox app, and the Chooser does not open elsewhere. If `AGENT_EGRESS_ALLOWLIST` is on and the workspace has a host list, add `www.dropbox.com`, `api.dropboxapi.com`, `content.dropboxapi.com` and `mcp.dropbox.com` to it.

## 3. A company's own Dropbox app

A workspace owner or admin can set the company's own Dropbox app under **Connections** › **Company OAuth apps**: the app key as the client ID and the app secret as the client secret. It replaces the instance app for that workspace, the Chooser opens with its app key, and members connected through the instance app reconnect once. Register the redirect URI the screen shows, and the workspace's hostnames as Chooser domains, with that app.

## 4. Moving from the per-person Dropbox settings

The old Dropbox settings under Settings › Integrations, where each person typed their own app key and secret, are gone. Migrations `082-cloud-storage-to-connectors` and `083-connectors-finish-legacy-cutover` delete those stored secrets and close the old grants. Each person connects Dropbox once on My connections. Files already attached as links keep opening, and imported copies are ordinary uploads.
