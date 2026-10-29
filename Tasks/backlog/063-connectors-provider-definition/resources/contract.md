# Connectors — the two-track contract

Task 063. Track A (connections) and track B (tools) both build against this file. Signed by both on 2026-10-29 (section 8). A change now needs both interns to agree, recorded in 063's `progress.md`.

## 1. Who owns which file

| Path | Owner |
|---|---|
| `Modules/Connectors/providers/<id>/index.js` — provider definition | A |
| `Modules/Connectors/providers/<id>/tools.js` — the provider's tools | B |
| `Modules/Connectors/validate.js`, `Modules/Connectors/registry.js` | A |
| `Modules/Connectors/resolveConnection.js` | A builds, B calls |
| Tool loading, agent registry and MCP registration (068) | B |

The two tracks never edit the same file.

## 2. Provider definition — `providers/<id>/index.js`

```js
module.exports = {
    id: 'google',                       // lower case; the name in CONNECTORS and in CONNECTOR_<ID>_CLIENT_ID
    name: 'Google',
    auth: {
        authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenUrl: 'https://oauth2.googleapis.com/token',
        revokeUrl: 'https://oauth2.googleapis.com/revoke',   // optional
        pkce: 'S256',                                        // or null
        extraParams: { access_type: 'offline' },             // optional, strings only
        baseScopes: ['openid', 'email'],                     // optional, always requested
    },
    products: {                                              // one entry per tick; a provider without ticks has one
        calendar: ['…calendar.events.readonly'],
        drive: ['…drive.file'],
    },
    readAccount: ({ tokenResponse }) => ({ id, label }),      // id is stable at the provider (Google: sub)
    egressHosts: ['accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'],
    rateLimit: { statuses: [403, 429] },                     // optional
    deadGrantErrors: ['invalid_grant'],                      // optional; on refresh → `broken` (FR-17)
};
```

`validate.js` refuses a definition, and the registry skips it with one log line naming the provider and the problem, when:

- `id` is not lower-case letters, digits and `_`, or `name` is empty
- an `auth` URL is not `https`, or its host is not in `egressHosts`
- `auth.pkce` is anything but `S256` or empty
- `auth` holds a client id or secret (those come from env or the company app, never from the file)
- `products` is empty, or a product has no scopes
- `readAccount` is not a function

## 3. Tool definition — `providers/<id>/tools.js` (track B)

```js
module.exports = [{
    key: 'google.calendar.events.list',  // <provider>.<object>.<verb>
    label: 'Connectors.tool.googleCalendarEventsList',
    kind: 'read',                        // 'read' | 'write'; a write is proposeOnly at every level
    product: 'calendar',                 // must be a key of the definition's products
    scope: '…calendar.events.readonly',  // must be one of that product's scopes
    input: { /* JSON schema */ },
    caps: { maxItems: 50, maxChars: 8000 },
    run: async ({ input, connection }) => '…text…',
}];
```

Track B loads and checks tools in 068. Track A reads nothing from `tools.js`.

## 4. Registry — `registry.js` (track A)

| Function | Returns |
|---|---|
| `list()` | every valid definition |
| `get(id)` | one definition, or `null` |
| `isOffered(id, { companyApps })` | `true` when `id` is named in `CONNECTORS` **and** has an app: the instance's `CONNECTOR_<ID>_CLIENT_ID` and `_CLIENT_SECRET`, or `id` is in `companyApps` |
| `offered({ companyApps })` | the definitions `isOffered` accepts |
| `scopesFor(id, products)` | `baseScopes` ∪ the ticked products' scopes, no duplicates, in definition order. Throws on an unknown provider or product |

`companyApps` is the list of provider ids the workspace has its own app for. 065 reads it from `connector_apps` and passes it in, so the registry never touches the database.

Adding a provider is adding one folder under `providers/`. There is no list to edit.

## 5. `resolveConnection` — built by A, called by B

```js
resolveConnection({ companyId, userId, provider })
// → { connectionId, scopes, getAccessToken }   getAccessToken(): Promise<string>, refreshes on use
// → throws ConnectorError
```

| `ConnectorError.code` | When | Shown to the person or the AI |
|---|---|---|
| `not_connected` | no live connection | "connect <Provider> on My connections" |
| `not_member` | guest, removed or deactivated member (FR-13) | refused, no detail |
| `broken` | refresh failed with a dead-grant error | "reconnect <Provider> on My connections" |
| `scope_missing` | the tool's scope is not in `scopes` (B checks, FR-9) | "tick <product> on your <Provider> connection" |
| `provider_off` | not offered here | "<Provider> is not switched on here" |

- Only the person's own connection is ever returned (FR-19).
- The access token stays inside the caller of `getAccessToken()`: never returned by a route, logged, emitted or audited (FR-15).
- `connectionId` is the only id B stores (audit, proposals, usage).
- Until 066 lands, `resolveConnection.js` is a stub with this signature that throws `provider_off` or `not_connected`, so B can build and test against it.

## 6. Data fields (built in 064, track A)

`connector_connections`

| Field | Notes |
|---|---|
| `_id` | the connection id |
| `companyId`, `userId` | owner |
| `provider`, `products[]` | |
| `account { id, label }` | label shown to the owner only |
| `scopes[]` | as granted, not as requested |
| `status` | `pending` · `connected` · `broken` · `reauth_required` · `revoked` |
| `lastError`, `brokenAt` | |
| `app { source: 'instance' \| 'company', appId }` | |
| `handles { access, refresh }` | secrets store, kind `connector` |
| `accessExpiresAt`, `connectedAt`, `lastUsedAt`, `disconnectedAt`, `disconnectedBy` | |
| `oauth { stateHash, verifier, sessionId, origin }` | in-flight connect only |
| `backoffUntil` | set by B on a rate-limit signal |

Indexes: unique (`companyId`, `userId`, `provider`, `account.id`); partial unique (`companyId`, `userId`, `provider`) on live rows.

`connector_apps`: `companyId`, `provider`, `clientId`, `secretHandle`, `extra` (Google Picker: `apiKey`, `appId` — 061 gap 4), `setBy`, `createdAt`, `updatedAt`.

`connector_usage`: `companyId`, `connectionId`, `userId`, `actor { type: 'agent' | 'mcp', id }`, `day` (`YYYY-MM-DD`), `reads`, `writeProposals`. B writes it; A's screens (072) read it.

## 7. Open points to settle on day 1

1. `connector_usage` as its own collection, or counters on the connection row (PRD section 8 allows both).
2. `CONNECTORS=google_calendar` on existing instances: the new registry knows `google`. Either the Calendar migration (073) renames it, or `Modules/Agents/connectors/flag.js` learns `google` in 066. Until then, naming `google` makes `flag.js` log it as unknown at startup.

## 8. Signed

| Track | Name | Date |
|---|---|---|
| A — connections | Hetvi | 2026-10-29 |
| B — tools | Prinsa | 2026-10-29 |
