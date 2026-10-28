# Connectors research matrix

Phase 0 output for task 056. Rows for the new connectors and Gmail come from task 062; the pilot and migration providers (Google, Dropbox, Slack, GitHub) are added by task 061.

Researched 2026-10-28 from provider docs. `*` marks a fact that could not be confirmed from an official page; check it before relying on it.

## Phase 3 matrix (ranked, easiest first)

| Rank | Connector | Auth | Per-person | API reach and least scopes | App review | Token life | Limits | Callback constraints | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| 1 | ClickUp | OAuth 2.0 code grant (personal `pk_` token as fallback) | Yes; user ticks the workspaces at consent | Read and write: tasks, lists, comments, time, docs. No scopes: token has the user's full access | None, no install cap | Access token does not expire; no refresh token | 100/min per token (Business Plus 1,000, Enterprise 10,000) | Redirect URLs registered per app; non-SSL may be dropped | **Build first.** Standard OAuth, no review, maps onto PM objects. Guard writes because there are no scopes |
| 2 | Outlook (Microsoft Graph) | OAuth 2.0, multi-tenant Entra app, delegated scopes | Yes, including personal Outlook.com. Tenant admin consent needed where user consent is off or limited to verified publishers | Read and write mail and calendar. Least: `Mail.Read`, `Calendars.ReadWrite`, `offline_access`, `User.Read` | None. Publisher verification (free, needs a Microsoft partner account) so locked-down tenants can consent | Access 60–90 min; refresh 90 days sliding (24 h if registered as SPA) | 10,000 per 10 min per app per mailbox (~1,000/min), 4 concurrent | https only, http for localhost; no wildcards with personal accounts; max 100 URIs | **Build.** No review, high limits, strong demand. Start publisher verification in parallel |
| 3 | Notion | OAuth 2.0 public connection | Yes; user picks the pages to share | Read and write pages, databases, comments. Least privilege via capabilities plus the page picker | Docs conflict: authorization URL may appear only after submitting for review*; Marketplace listing review 5–10 business days* | Refresh token rotates on each refresh; access lifetime not stated* | 180/min per connection (600 on Business/Enterprise) | Redirect URIs registered in portal; https rules not stated*. Notion MCP supports dynamic client registration for self-hosted | **Build.** Best least-privilege model. Confirm the review gate first |
| 4 | Figma | OAuth 2.0 (personal access token as fallback) | Yes; never more than the user can reach | Read files, comments, versions, components. Write only comments (variables on Enterprise). Least: `current_user:read`, `file_content:read`, `file_metadata:read`, `file_comments:read`, `file_comments:write` | Private apps: none (own team/org only). Public: review, stated 5–10 business days, reported weeks to a month | Access 90 days; refresh reusable; one access token per app per user | Per user and seat: Tier 1 10–20/min on Dev/Full seats, near zero on View/Collab* | Redirect URLs registered per app; https/localhost rules not stated* | **Middle.** Small build but read-mostly, seat-gated limits and long public review |
| 5 | Supabase | OAuth 2.0 with PKCE, Management API | Yes; any Supabase user, optional org preselect | Projects, Database, Storage etc., read or write per area. Least: Projects:read, Organizations:read, Database:read. Database:write runs arbitrary SQL | None documented* | Access plus refresh; lifetimes not documented* | 120/min per user per endpoint (some database endpoints 10/min) | Exact redirect match; `state` up to 4 kB; other rules not documented* | **Later.** Easy build, niche audience, all-or-nothing database write needs guardrails |
| 6 | Canva | OAuth 2.0 with PKCE | Yes, user-level tokens. Private integrations only for Canva Enterprise teams | Read and write designs, assets, folders, comments. Least: `design:meta:read`, `design:content:read`, `design:content:write`, `profile:read` | Public integration needs Canva review (timeline undocumented); developer account needs MFA; no preview APIs | Access 4 h; refresh single-use, rotates | List 100/min, create and export 20/min per user; app-wide 5,000 exports/day | `127.0.0.1` for local dev (not `localhost`), removed before review | **Later.** Small code, but gated by review and an app-wide export cap |
| 7 | HubSpot | OAuth 2.0 | Partly: token is portal-level and reflects app scopes, not the user; installer must be a Super Admin* | Read and write CRM objects. Least: `crm.objects.<object>.read`/`.write` per object needed | Unlisted apps capped at 25 installs; above that, Marketplace listing and review (no official timeline; AI connectors have extra requirements) | Access 30 min; refresh token does not expire until uninstall | 110 per 10 s per account (~660/min); search stricter | https redirect required in production | **Later.** Good API, but not per-person, needs an admin and review past 25 installs |
| 8 | Upwork | OAuth 2.0, GraphQL API, key by application | Yes, after the key is approved; tenant header picks the organization | Read and write jobs, proposals, contracts, messages; permissions chosen on the key | Manual key approval, up to ~2 weeks; commercial use may be barred*; responses may not be cached over 24 h | Unclear, possibly 24 h access plus refresh* | 10/s per IP (~600/min, shared across tenants on one IP); 40,000/day | One callback fixed per key | **Later, possibly drop.** Ask Upwork whether a multi-tenant SaaS is allowed before any build |
| 9 | Shopify | OAuth 2.0 code grant | No: access is per store; owner or staff with the permissions installs | Read and write products, orders, inventory, customers. Least: `read_products`, `write_products`, `read_orders`, `read_inventory`; customer data needs Protected Customer Data approval* | App Store review: stated up to 14 business days, reported 3–6 weeks; registration fee; three mandatory compliance webhooks. Custom distribution is single-store only | Expiring offline: access 1 h, refresh 90 days, rotating. Online: 24 h, no refresh | GraphQL cost buckets: 100–2,000 points/s by plan | Exact redirect match; `shop` must match `*.myshopify.com` | **Last.** Store-level not per-person, heaviest review and compliance load |
| – | Wispr Flow | No public API for user data. Developer API is speech-to-text only; remote MCP server for its own clients | MCP is per user, but third-party use is unconfirmed* | MCP is read-only: meeting notes, scratchpad, calendar. No dictation history, no export | Not applicable | Unknown | Unknown | Unknown | **Drop.** No supported way to read a user's dictations. Revisit only if AlianHub gets a generic remote-MCP connector |

## Self-hosted note

Every provider above fixes redirect URIs per registered app. A self-hosted instance therefore either registers its own app per provider (credentials in `.env`, the company override), or relies on a callback relay run by the Alian-hosted instance. This is an owner decision that affects every Phase 3 task.

## Gmail on the Alian-hosted instance

Gmail read scopes (`gmail.readonly`, `gmail.modify`) are restricted. A public app using them needs:

1. OAuth consent screen brand verification: verified domain, homepage, privacy policy, scope justification and a demo video.
2. Restricted scope verification by Google.
3. A CASA Tier 2 security assessment by an authorized lab, repeated every 12 months.

A company's own Internal Google app on its Workspace domain skips this, which is why the supported production path is the company override.

Authorized CASA labs (App Defense Alliance directory): Bishop Fox, DEKRA, KPMG, Leviathan Security, NCC Group, NetSentries Technologies, Orange Cyberdefense South Africa, Prescient Security, TAC Security.

### CASA Tier 2 quotes

Published prices, read 2026-10-28. No lab has been contacted; ask both labs for a written quote before the owner decides.

| Lab | Option | Price | Includes | Source |
|---|---|---|---|---|
| TAC Security | Basic | $540 per application | One Tier 2 assessment, two revalidation cycles, letter of validation in 1–3 weeks; whether it renews yearly at this price is unconfirmed* | [casa.tacsecurity.com](https://casa.tacsecurity.com/site/home) |
| TAC Security | Premium | $720–$855 (pages differ)* | Unlimited revalidation | [tacsecurity.com CASA](https://tacsecurity.com/google-casa-cloud-application-security-assessment/) |
| TAC Security | Enterprise | $3,600 | Unlimited revalidation | [tacsecurity.com CASA](https://tacsecurity.com/google-casa-cloud-application-security-assessment/) |
| Leviathan Security | No Rush | $3,000 | Start within 30 days, one retest | [leviathansecurity.com CASA](https://leviathansecurity.com/programs/google-casa-cloud-application-security-assessment) |
| Leviathan Security | Standard | $4,500 | Start within 10 days, one retest | same |
| Leviathan Security | Priority | $6,000 | Start within 2 days, one retest | same |

Yearly lab cost lands between about $540 and $6,000, matching the PRD's indicative range, plus developer time to fix what the scan finds. Premium firms quote far more (forum reports of $15,000–$40,000).

## Sources

- ClickUp: [authentication](https://developer.clickup.com/docs/authentication), [rate limits](https://developer.clickup.com/docs/rate-limits)
- Outlook: [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent), [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens), [throttling](https://learn.microsoft.com/en-us/graph/throttling-limits), [redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url)
- Notion: [authorization](https://developers.notion.com/guides/get-started/authorization), [capabilities](https://developers.notion.com/reference/capabilities), [request limits](https://developers.notion.com/reference/request-limits), [public connections](https://developers.notion.com/guides/get-started/public-integrations)
- Figma: [OAuth apps](https://developers.figma.com/docs/rest-api/oauth-apps/), [scopes](https://developers.figma.com/docs/rest-api/scopes/), [rate limits](https://developers.figma.com/docs/rest-api/rate-limits/), [platform updates](https://developers.figma.com/docs/updates-to-figmas-developer-platform)
- Supabase: [OAuth integration](https://supabase.com/docs/guides/integrations/build-a-supabase-oauth-integration), [Management API](https://supabase.com/docs/reference/api/introduction)
- Canva: [authentication](https://www.canva.dev/docs/apps/rest-apis/authentication.md), [scopes](https://www.canva.dev/docs/apps/rest-apis/scopes.md), [creating integrations](https://www.canva.dev/docs/connect/creating-integrations/)
- HubSpot: [usage limits](https://developers.hubspot.com/docs/api/usage-details), [OAuth quickstart](https://developers.hubspot.com/docs/api/oauth-quickstart-guide), [install limits](https://developers.hubspot.com/changelog/new-marketplace-distribution-app-install-limits)
- Upwork: [request an API key](https://support.upwork.com/hc/en-us/articles/115015857647-Request-an-API-Key), [request limits](https://support.upwork.com/hc/en-us/articles/115015933428-What-are-the-API-requests-limits)
- Shopify: [auth code grant](https://shopify.dev/docs/apps/build/authentication-authorization/get-access-tokens/auth-code-grant/implement-auth-code-grants-manually), [offline tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-token-types/offline-access-tokens), [distribution](https://shopify.dev/docs/apps/launch/distribution), [rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)
- Wispr Flow: [developer API](https://api-docs.wisprflow.ai/quickstart), [remote MCP](https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server)
- Gmail: [restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [CASA assessors](https://appdefensealliance.dev/casa/casa-assessors)
