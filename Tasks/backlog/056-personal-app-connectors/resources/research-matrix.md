# Connectors research matrix

Phase 0 of task 056. Sections 1–4 cover Google and Dropbox (task 061); each fact there cites a source from section 4 as `[S#]`. Sections 5–8 cover the new connectors, their Phase 3 ranking and Gmail (task 062), with sources per provider in section 8 and `*` marking a fact no official page confirms. Slack and GitHub are researched in tasks 074 and 075. All sources were checked on **2026-10-28** and re-checked on **2026-10-29** in review. Secondary sources are marked.

## 1. Pilot matrix: Google and Dropbox

| | Google — Calendar | Google — Meet | Google — Drive (`drive.file`) | Dropbox (attachment picker) |
|---|---|---|---|---|
| **Auth type** | OAuth 2.0 authorization code [S1]. PKCE `S256` supported [S3] | Same Google connection | Same Google connection | OAuth 2.0 authorization code with PKCE `S256` [S13]. Alternatively the Chooser, which uses only the app key and grants no direct access to the person's Dropbox [S14], [S15] |
| **Per-person support** | Yes, user authentication | Yes. User authentication only, no app-only auth [S6] | Yes | Yes, per Dropbox account [S13] |
| **Least scopes** | `calendar.events.readonly`, `calendar.events.owned`, `calendar.app.created` [S5] | `meetings.space.created`, `meetings.space.readonly` [S6] | `drive.file`: only files the app creates or opens, or that the person picks [S7] | `account_info.read`, `files.metadata.read`, `files.content.read` [S17] |
| **Scope sensitivity** | Not stated on Google's Calendar scope page [S5]. Google gives "reading Calendar events" as a sensitive example [S10] | `meetings.space.created` and `meetings.space.readonly` are **sensitive** [S6]. Downloading recordings and transcripts needs `drive.readonly`, which is **restricted** [S6]. `drive.meet.readonly` (also restricted [S7]) probably covers Meet files too; Google does not say so | **Non-sensitive** [S7] | No sensitivity tiers. Access type is App folder or Full Dropbox. Approval is per app [S14] |
| **Incremental consent** | `include_granted_scopes=true` keeps earlier scopes on the new token. The person may grant only some of the requested scopes; the token response's `scope` lists what was granted [S1] | Same | Same | Re-authorize later with more scopes [S13]. `include_granted_scopes=user` keeps earlier scopes [S17]; `team` is reported for team apps (secondary [S18]) |
| **Review needed** | If the scopes are sensitive: sensitive-scope verification (privacy policy, home page, domain ownership, demo video, per-scope justification), up to 10 days [S10]; Google's FAQ estimates 10 business days, 6 weeks for restricted scopes [S22]. Until verified, an unverified screen and a cap of 100 new users [S11] | Sensitive-scope verification [S6], [S10]. Recordings would add a yearly security assessment if the data is stored or transmitted server-side [S7], [S9] | None for `drive.file` [S7] | OAuth app: development status, up to 500 users. At 50 linked users the developer has two weeks to get production approval or linking freezes. Review starts only at 50 users [S14]. The Chooser needs no production approval [S14], [S15] |
| **Token life** | Access token: `expires_in` in seconds, about 1 hour in Google's sample [S1]. The refresh token is valid until revoked, but stops working when unused for 6 months, after 7 days if the app is in "Testing" status, past 100 refresh tokens per account per client ID (the oldest drops silently), under an admin session-length policy of 1–24 h, or, for tokens with Gmail scopes, after a password change [S2]. A refresh token is returned only with `access_type=offline`, on first consent or with `prompt=consent` [S1] | Same | Same | Short-lived access token; read `expires_in` [S13], [S16]. 14400 s (4 h) is widely reported (secondary [S18]). `token_access_type=offline` gives a refresh token that "doesn't expire automatically" [S16] |
| **Revoke** | `POST https://oauth2.googleapis.com/revoke`. Revoking the access token also revokes its refresh token. It removes every scope granted to the project, ends tokens for all clients in that project, and may take time to take effect [S1] | Same | Same | `POST https://api.dropboxapi.com/2/auth/token/revoke`. Revokes the access token and its refresh token [S16] |
| **Limits** | 10,000 requests/min per project, 600/min per user. 403 or 429 `usageLimits`. Truncated exponential backoff, max 32–64 s. Billing threshold 1,000,000 requests/day [S4] | Reads 6,000/min per project and 600/min per user. Writes 1,000 and 100. `spaces.create` 100 and 10. 429 [S19] | 1,000,000 quota units/min per project, 325,000 per user. 403 or 429 [S20] | Per-user limits with no published numbers. 429 with `Retry-After` in seconds [S21] |
| **Callback constraints** | HTTPS only (localhost exempt). No raw IP host except localhost. No fragment, userinfo, wildcard, path traversal or open redirect. Exact match with the client's registered list [S1] | Same | Same. The Picker also needs an API key and the Cloud project number as App ID [S12] | Exact match with a redirect URI registered in the App Console [S13]. Chooser: the domains the app is hosted on, registered in the App Console [S15] (field "Chooser / Saver / Embedder domains", bare hostnames, per `Modules/CloudStorage/helpers/cloudProviders.js`) |
| **Verdict** | **Go.** Confirm the tier of the three scopes in Google Cloud Console → Data Access before the hosted launch | **Go, meeting spaces only.** No recordings or transcripts (restricted scopes) | **Go.** `drive.file` with the Picker | **Go.** Keep the Chooser for picking; use OAuth only where the server must import a copy (contradiction 3) |

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
2. **Calendar sensitivity is undocumented (Phase 1 on the hosted instance).** If any of the three scopes is sensitive, the hosted app needs verification (up to 10 days [S10], [S22]) before more than 100 users can connect [S11]. Recommendation: read the tier in Google Cloud Console → Data Access, then start verification early.
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
| S22 | [Google Cloud Help — OAuth app verification FAQ](https://support.google.com/cloud/answer/13463817) (checked 2026-10-29) |

## 5. Phase 3 matrix: new connectors, ranked easiest first

Researched 2026-10-28 from provider docs, re-checked 2026-10-29 in review.

| Rank | Connector | Auth | Per-person | API reach and least scopes | App review | Token life | Limits | Callback constraints | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ClickUp | OAuth 2.0 code grant (personal `pk_` token as fallback) | Yes; user ticks the workspaces at consent | Read and write: tasks, lists, comments, time, docs. No scopes: token has the user's full access | None, no install cap | Access token does not expire; no refresh token | 100/min per token (Business Plus 1,000, Enterprise 10,000) | Redirect URLs registered per app; non-SSL may be dropped | **Build first.** Standard OAuth, no review, maps onto PM objects. Guard writes because there are no scopes |
| 2 | Outlook (Microsoft Graph) | OAuth 2.0, multi-tenant Entra app, delegated scopes | Yes, including personal Outlook.com. Tenant admin consent needed where user consent is off or limited to verified publishers | Read and write mail and calendar. Least: `Mail.Read`, `Calendars.ReadWrite`, `offline_access`, `User.Read` | None. Publisher verification (free, needs a Microsoft partner account) so locked-down tenants can consent | Access 60–90 min; refresh 90 days sliding (24 h if registered as SPA) | 10,000 per 10 min per app per mailbox (~1,000/min), 4 concurrent | https only, http for localhost; no wildcards with personal accounts; max 100 URIs | **Build.** No review, high limits, strong demand. Start publisher verification in parallel |
| 3 | Notion | OAuth 2.0 public connection | Yes; user picks the pages to share | Read and write pages, databases, comments. Least privilege via capabilities plus the page picker | The authorization URL appears only after the public connection is submitted for review; whether approval is also needed is not stated. Marketplace listing review 5–10 business days* | Refresh token rotates on each refresh; access lifetime not stated | 180/min per connection (600 on Business/Enterprise), plus a workspace-wide budget | Redirect URIs registered in portal; https rules not stated*. Notion MCP supports dynamic client registration for self-hosted | **Build.** Best least-privilege model. Submit for review early, since the authorization URL depends on it |
| 4 | Figma | OAuth 2.0 (personal access token as fallback) | Yes; never more than the user can reach | Read files, comments, versions, components. Write only comments (variables on Enterprise). Least: `current_user:read`, `file_content:read`, `file_metadata:read`, `file_comments:read`, `file_comments:write` (`files:read` is deprecated) | Private apps: none (own team/org only). Public: review; no official timeline, reported weeks to a month* | Access 90 days; refresh reusable; one access token per app per user | Per user and seat. Dev/Full seats: Tier 1 10 / 15 / 20 per min on Starter / Pro / Org. View/Collab seats: Tier 1 a few calls per month*, Tier 2 5/min, Tier 3 10/min | Redirect URLs registered per app; https/localhost rules not stated* | **Middle.** Small build but read-mostly, seat-gated limits and long public review |
| 5 | Supabase | OAuth 2.0 with PKCE, Management API | Yes; any Supabase user, optional org preselect | Projects, Database, Storage etc., read or write per area. Least: Projects:read, Organizations:read, Database:read. Database:write runs arbitrary SQL | None documented* | Access plus refresh; lifetimes not documented* | 120/min per user per endpoint; a few endpoints 10–30/min | Exact redirect match; `state` up to 4 kB; other rules not documented* | **Later.** Easy build, niche audience, all-or-nothing database write needs guardrails |
| 6 | Canva | OAuth 2.0 with PKCE (`S256`) | Yes, user-level tokens. Private integrations only for Canva Enterprise teams | Read and write designs, assets, folders, comments. Least: `design:meta:read`, `design:content:read`, `design:content:write`, `profile:read` | Public integration needs Canva review (timeline undocumented); developer account needs MFA*; no preview APIs | Access token lasts "a short period" (4 h reported*); refresh single-use, rotates | List 100/min*, create and export 20/min per user*; app-wide 5,000 exports/day* (third-party pages disagree) | Canva's example redirect is `http://127.0.0.1`; that `localhost` is refused and the entry must be removed before review is unconfirmed* | **Later.** Small code, but gated by review and an app-wide export cap |
| 7 | HubSpot | OAuth 2.0 | Partly: token is portal-level and reflects app scopes, not the user; installer must be a Super Admin | Read and write CRM objects. Least: `crm.objects.<object>.read`/`.write` per object needed | Unlisted apps capped at 25 installs (since 2025-09-22); above that, Marketplace listing and review (no official timeline; AI connectors have extra requirements) | Access 30 min; refresh token does not expire until uninstall* | 110 per 10 s per account (~660/min); search has its own stricter limit | https redirect required in production | **Later.** Good API, but not per-person, needs an admin and review past 25 installs |
| 8 | Upwork | OAuth 2.0, GraphQL API, key by application | Yes, after the key is approved; tenant header picks the organization | Read and write jobs, proposals, contracts, messages; permissions chosen on the key | Manual key approval, up to ~2 weeks*; commercial use may be barred*; responses may not be cached over 24 h | Unclear, possibly 24 h access plus refresh* | 10/s per IP (~600/min, shared across tenants on one IP); 40,000/day* | One callback fixed per key | **Later, possibly drop.** Ask Upwork whether a multi-tenant SaaS is allowed before any build |
| 9 | Shopify | OAuth 2.0 code grant | No: access is per store; owner or staff with the permissions installs | Read and write products, orders, inventory, customers. Least: `read_products`, `write_products`, `read_orders`, `read_inventory`; customer data needs Protected Customer Data approval* | App Store review: up to 14 business days*, reported 3–6 weeks; registration fee*; mandatory compliance webhooks*. Custom distribution is single-store only | Expiring offline: access 1 h, refresh 90 days, rotating (the old refresh token works up to 30 days or until the new one is used). Non-expiring offline tokens are already blocked for new public apps; existing public apps must switch by 2027-01-01. Online: 24 h, no refresh* | GraphQL cost buckets per second: 100 Standard, 200 Advanced, 1,000 Plus, 2,000 Enterprise | Exact redirect match; `shop` must match `*.myshopify.com` | **Last.** Store-level not per-person, heaviest review and compliance load |
| – | Wispr Flow | No public API for user data. Developer API is speech-to-text only; remote MCP server for any MCP client after the user signs in | MCP is per user | MCP is read-only: meeting notes, scratchpad, calendar. No dictation history, no export | Not applicable | Unknown | Unknown | Unknown | **Drop.** No supported way to read a user's dictations. Revisit only if AlianHub gets a generic remote-MCP connector |

## 6. Self-hosted callbacks for the Phase 3 connectors

Section 2 covers who gets reviewed. In addition, every provider in section 5 fixes redirect URIs per registered app. A self-hosted instance therefore either registers its own app per provider (credentials in `.env`, the company override), or relies on a callback relay run by the Alian-hosted instance. This is an owner decision that affects every Phase 3 task.

## 7. Gmail on the Alian-hosted instance

Gmail read scopes (`gmail.readonly`, `gmail.modify`, `gmail.metadata`) are restricted. A public app using them needs:

1. OAuth consent screen brand verification: verified domain, homepage, privacy policy, scope justification and a demo video.
2. Restricted scope verification by Google (estimated 6 weeks [S22]).
3. A CASA security assessment by an authorized lab at the assurance level Google assigns (AL1 or AL2; AL2 is the lab-tested level that replaced Tier 2), repeated every 12 months from the Letter of Assessment date.

A company's own Internal Google app on its Workspace domain skips this, which is why the supported production path is the company override.

Authorized labs, per the App Defense Alliance page as read on 2026-10-29: Bishop Fox, DEKRA, NetSentries Technologies and TAC Security clearly offer CASA. Leviathan Security sells CASA on its own site. NCC Group, Prescient Security and ValueMentor are listed, but their entries don't name CASA. Confirm CASA authorization with each lab before engaging it.

### CASA prices

These are published prices, read 2026-10-28. No lab has been contacted, and none of these is a written quote.

| Lab | Option | Level | Price | Includes | Source |
|---|---|---|---|---|---|
| TAC Security | Basic | Not stated* | $540 per application | One assessment, two revalidation cycles, letter of validation in 1–3 weeks; whether it renews yearly at this price is unconfirmed* | [casa.tacsecurity.com](https://casa.tacsecurity.com/site/home) |
| TAC Security | Premium | Not stated* | $720–$855 (pages differ)* | Unlimited revalidation | [tacsecurity.com CASA](https://tacsecurity.com/google-casa-cloud-application-security-assessment/) |
| TAC Security | Enterprise | Not stated* | $3,600 | Unlimited revalidation | same |
| Leviathan Security | No Rush | AL1 | $3,000 | Start within 30 days, one retest | [leviathansecurity.com CASA](https://leviathansecurity.com/programs/google-casa-cloud-application-security-assessment) |
| Leviathan Security | Standard | AL1 | $4,500 | Start within 10 days, one retest | same |
| Leviathan Security | Priority | AL1 | $6,000 | Start within 2 days, one retest | same |
| Leviathan Security | – | AL2 | Quote only | Contact form | same |

The TAC pages refused automated access on 2026-10-29, so their prices could not be re-checked. Published prices run from about $540 (TAC, level unstated) to $6,000 (Leviathan, AL1) a year. No AL2 price is published. Because Gmail's restricted scopes may be assigned AL2, the PRD's $500–$6,000 range is unproven until a lab quotes in writing. Developer time to fix what the scan finds comes on top. Premium firms quote far more (forum reports of $15,000–$40,000*).

## 8. Sources for sections 5–7 (read 2026-10-28, re-checked 2026-10-29)

- ClickUp: [authentication](https://developer.clickup.com/docs/authentication), [rate limits](https://developer.clickup.com/docs/rate-limits)
- Outlook: [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent), [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), [throttling](https://learn.microsoft.com/en-us/graph/throttling-limits), [redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- Notion: [authorization](https://developers.notion.com/guides/get-started/authorization), [capabilities](https://developers.notion.com/reference/capabilities), [request limits](https://developers.notion.com/reference/request-limits), [public connections](https://developers.notion.com/guides/get-started/public-integrations)
- Figma: [OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/), [scopes](https://developers.figma.com/docs/rest-api/scopes/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [platform updates](https://developers.figma.com/docs/updates-to-figmas-developer-platform)
- Supabase: [OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration), [Management API](https://supabase.com/docs/reference/api/introduction)
- Canva: [authentication](https://www.canva.dev/docs/apps/rest-apis/authentication.md), [scopes](https://www.canva.dev/docs/apps/rest-apis/scopes.md), [creating integrations](https://www.canva.dev/docs/connect/creating-integrations/)
- HubSpot: [usage limits](https://developers.hubspot.com/docs/api/usage-details), [OAuth quickstart](https://developers.hubspot.com/docs/api/oauth-quickstart-guide), [install limits](https://developers.hubspot.com/changelog/new-marketplace-distribution-app-install-limits)
- Upwork: [request an API key](https://support.upwork.com/hc/en-us/articles/115015857647-Request-an-API-Key), [request limits](https://support.upwork.com/hc/en-us/articles/115015933428-What-are-the-API-requests-limits)
- Shopify: [auth code grant](https://shopify.dev/docs/apps/build/authentication-authorization/get-access-tokens/auth-code-grant/implement-auth-code-grants-manually), [offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens), [distribution](https://shopify.dev/docs/apps/launch/distribution), [rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits), [App Store review](https://shopify.dev/docs/apps/launch/app-store-review/review-process)
- Wispr Flow: [developer API](https://api-docs.wisprflow.ai/quickstart), [remote MCP](https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server)
- Gmail and CASA: [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [CASA tiering](https://appdefensealliance.dev/casa/casa-tiering), [ADA authorized labs](https://www.appdefensealliance.org/certification/authorized-labs)
