# Connectors research matrix

Phase 0 of task 056. The Google and Dropbox rows come from task 061. Each fact cites a source from the list at the end as `[S#]`. All sources were checked on **2026-10-28**. Secondary sources are marked.

## 1. Matrix

| | Google — Calendar | Google — Meet | Google — Drive (`drive.file`) | Dropbox (attachment picker) |
|---|---|---|---|---|
| **Auth type** | OAuth 2.0 authorization code [S1]. PKCE `S256` supported [S3] | Same Google connection | Same Google connection | OAuth 2.0 authorization code with PKCE `S256` [S13]. Alternatively the Chooser, which uses only the app key and no OAuth [S15] |
| **Per-person support** | Yes, user authentication | Yes. User authentication only, no app-only auth [S6] | Yes | Yes, per Dropbox account [S13] |
| **Least scopes** | `calendar.events.readonly`, `calendar.events.owned`, `calendar.app.created` [S5] | `meetings.space.created`, `meetings.space.readonly` [S6] | `drive.file`: only files the app creates or opens, or that the person picks [S7] | `account_info.read`, `files.metadata.read`, `files.content.read` (secondary [S17], [S18]) |
| **Scope sensitivity** | Not stated on Google's Calendar scope page [S5]. Google gives "reading Calendar events" as a sensitive example [S10] | `meetings.space.created` and `meetings.space.readonly` are **sensitive** [S6]. Recordings and transcripts need `drive.readonly` or `drive.meet.readonly`, which are **restricted** [S6], [S7] | **Non-sensitive** [S7] | No tiers. Approval is per app [S14] |
| **Incremental consent** | `include_granted_scopes=true` keeps earlier scopes on the new token. The person may grant only some of the requested scopes; the token response's `scope` lists what was granted [S1] | Same | Same | Re-authorize later with more scopes [S13]. `include_granted_scopes` takes `user` or `team` (secondary [S18]) |
| **Review needed** | If the scopes are sensitive: sensitive-scope verification (privacy policy, home page, domain ownership, demo video, per-scope justification), typically 3–5 business days [S10]. Until verified, an unverified screen and a cap of 100 new users [S11] | Sensitive-scope verification [S6], [S10]. Recordings would add a yearly security assessment [S7], [S9] | None for `drive.file` [S7] | OAuth app: development status, up to 500 users. At 50 linked users the developer has two weeks to get production approval or linking freezes. Review starts only at 50 users [S14]. The Chooser needs no production approval [S14], [S15] |
| **Token life** | Access token: `expires_in` in seconds, about 1 hour in Google's sample [S1]. The refresh token is valid until revoked, but stops working when unused for 6 months, after 7 days if the app is in "Testing" status, past 100 refresh tokens per account per client ID (the oldest drops silently), or under an admin session-length policy of 1–24 h [S2]. A refresh token is returned only with `access_type=offline`, on first consent or with `prompt=consent` [S1] | Same | Same | Short-lived access token; read `expires_in` [S13]. 14400 s (4 h) is widely reported (secondary [S18]). `token_access_type=offline` gives a refresh token that "doesn't expire automatically" [S16] |
| **Revoke** | `POST https://oauth2.googleapis.com/revoke`. Revoking the access token also revokes its refresh token. It removes every scope granted to the project, ends tokens for all clients in that project, and may take time to take effect [S1] | Same | Same | `POST https://api.dropboxapi.com/2/auth/token/revoke`. Revokes the access token and its refresh token [S16] |
| **Limits** | 10,000 requests/min per project, 600/min per user. 403 or 429 `usageLimits`. Truncated exponential backoff, max 32–64 s [S4] | Reads 6,000/min per project and 600/min per user. Writes 1,000 and 100. `spaces.create` 100 and 10. 429 [S19] | 1,000,000 quota units/min per project, 325,000 per user. 403 or 429 [S20] | Per-user limits with no published numbers. 429 with `Retry-After` in seconds [S21] |
| **Callback constraints** | HTTPS only (localhost exempt). No raw IP host except localhost. No fragment, userinfo, wildcard, path traversal or open redirect. Exact match with the client's registered list [S1] | Same | Same. The Picker also needs an API key and the Cloud project number as App ID [S12] | Exact match with a redirect URI registered in the App Console [S13]. Chooser: bare hostnames under "Chooser / Saver / Embedder domains" [S15] |
| **Verdict** | **Go.** Confirm the tier of the three scopes in Google Cloud Console → Data Access before the hosted launch | **Go, meeting spaces only.** No recordings or transcripts (restricted scopes) | **Go.** `drive.file` with the Picker | **Go.** Keep the Chooser for picking; use OAuth only where the server must import a copy (gap 3) |

## 2. Self-hosted and company apps: who gets reviewed

- **Google review belongs to the OAuth client's Cloud project, not to the product** [S8], [S10], [S11]. Whoever registers the app owns its verification:
  - **Alian-hosted instance default (External):** needs sensitive-scope verification for Meet, and for Calendar if those scopes are sensitive [S10], [S11].
  - **Self-hosted instance default:** the operator verifies their own app, or stays Internal (one Workspace org, no verification), or stays under 100 personal users [S8].
  - **Company override as an Internal app:** no verification, but only that org's accounts can connect [S8].
  - **Testing status:** refresh tokens expire after 7 days [S2], so connections break weekly.
  - Google's pages do not cover self-hosted products where each operator brings their own client ID. The nearest text is an exemption for "OAuth-based plugins" [S11]; treat it as unconfirmed.
- **Dropbox approval is per app** [S14]. A self-hosted operator's own OAuth app freezes at 50 linked users until approved. The Chooser avoids this [S15].
- **Google needs an HTTPS hostname for the callback** [S1]. An instance on plain HTTP or a bare IP cannot connect Google, except on localhost.

## 3. Contradictions with the PRD, for the owner

1. **Meet (decision 15, Phase 1 "Meet tools").** The PRD lists Meet next to `drive.file` as if it were light. Meet's scopes are **sensitive** and need verification on the hosted app. Recordings and transcripts need **restricted** scopes and a yearly security assessment [S6], [S7], [S9]. Recommendation: Meet tools in the pilot cover meeting spaces only.
2. **Calendar sensitivity is undocumented (Phase 1 on the hosted instance).** If any of the three scopes is sensitive, the hosted app needs verification (3–5 business days [S10]) before more than 100 users can connect [S11]. Recommendation: read the tier in Google Cloud Console → Data Access, then start verification early.
3. **Dropbox (FR-39 and the acceptance line "disconnecting revokes at the provider").** Today's picker is the Dropbox **Chooser**, which has no OAuth and no token, so there is nothing to revoke (code: `Modules/CloudStorage/helpers/cloudProviders.js`). An OAuth Dropbox connection brings production approval after 50 users [S14]. Recommendation: keep the Chooser for linking, and use OAuth only for "import a copy".
4. **Company app form (FR-5).** The PRD asks only for client id and secret. The Google Picker also needs an **API key** and the **project number** (App ID) of the same Cloud project [S12]. Recommendation: the Google company app form takes all four; only the secret is secret.
5. **Revoke reach (FR-12).** A Google revoke removes every scope of the project's grant and ends tokens for all clients in that project [S1]. The same Google account on the same app in two workspaces is one grant: disconnecting in one ends the other. Recommendation: FR-12's "shares the grant" check covers the person's connections across workspaces, not just one.

## 4. Sources (all checked 2026-10-28)

| # | Source |
|---|---|
| S1 | [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server) |
| S2 | [Using OAuth 2.0 to Access Google APIs — refresh token expiration](https://developers.google.com/identity/protocols/oauth2) |
| S3 | [OAuth 2.0 for iOS & Desktop Apps — PKCE parameters](https://developers.google.com/identity/protocols/oauth2/native-app) |
| S4 | [Calendar API — Manage quotas](https://developers.google.com/workspace/calendar/api/guides/quota) |
| S5 | [Calendar API — Choose scopes](https://developers.google.com/workspace/calendar/api/auth) |
| S6 | [Meet REST API — Authenticate and authorize](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize) |
| S7 | [Drive API — Choose scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) |
| S8 | [Google Cloud Help — When is verification not needed](https://support.google.com/cloud/answer/13464323?hl=en) |
| S9 | [Google Cloud Help — Verification requirements](https://support.google.com/cloud/answer/13464321) |
| S10 | [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) |
| S11 | [Google Cloud Help — Unverified apps](https://support.google.com/cloud/answer/7454865) |
| S12 | [Google Picker — Web apps](https://developers.google.com/workspace/drive/picker/guides/web-picker) |
| S13 | [Dropbox — OAuth guide](https://docs.dropboxapi.com/dropbox-api/docs/oauth) |
| S14 | [Dropbox — Developer guide (production approval)](https://docs.dropboxapi.com/dropbox-api/docs/developer-resources/developer-guide) |
| S15 | [Dropbox — Chooser](https://docs.dropboxapi.com/dropbox-api/docs/pre-built-components/chooser) |
| S16 | [Dropbox tech blog — Using OAuth 2.0 with offline access](https://dropbox.tech/developers/using-oauth-2-0-with-offline-access) |
| S17 | [Dropbox tech blog — Customizing scopes in the OAuth flow](https://dropbox.tech/developers/customizing-scopes-in-oauth-flow) |
| S18 | Secondary: [Dropbox Python SDK — oauth](https://dropbox-sdk-python.readthedocs.io/en/latest/api/oauth.html), [django-storages Dropbox backend](https://django-storages.readthedocs.io/en/1.13/backends/dropbox.html) |
| S19 | [Meet REST API — Usage limits](https://developers.google.com/workspace/meet/api/guides/limits) |
| S20 | [Drive API — Usage limits](https://developers.google.com/workspace/drive/api/guides/limits) |
| S21 | [Dropbox — Error handling guide](https://developers.dropbox.com/error-handling-guide) |
