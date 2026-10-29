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
    id: 'google',                       // lower case; the folder name, the name in CONNECTORS and in CONNECTOR_<ID>_CLIENT_ID
    name: 'Google',                     // for logs and tests; screens show $t('Connectors.provider.<id>') instead (Rule 3)
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

`validate.js` refuses a definition, and the registry skips it with one log line naming the provider and every problem, when:

- the file does not export an object, or fails to load
- `id` is not lower-case letters, digits and `_`, or differs from its folder name
- `name` is empty
- `egressHosts` is empty
- an `auth` URL is not `https`, or its host is not in `egressHosts`
- `auth.pkce` is anything but `S256` or empty
- `auth.extraParams` holds a value that is not a string, or `auth.baseScopes` is not a list of scopes
- `auth` holds a client id or secret (those come from env or the company app, never from the file)
- `products` is empty, or a product has a name that is not lower case or has no scopes
- `readAccount` is not a function
- `rateLimit.statuses` is not a list of HTTP statuses, or `deadGrantErrors` is not a list of error codes

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

## 5. `resolveConnection.js` — built by A, called by B

```js
resolveConnection({ companyId, userId, provider })
// → { connectionId, scopes, getAccessToken }
// → throws ConnectorError

getAccessToken()                       // → Promise<string>; refreshes on use; throws ConnectorError `broken`
markBackoff({ companyId, connectionId, until })   // → Promise<void>; B calls it on a rate-limit signal
```

`ConnectorError` is exported by `resolveConnection.js` with the codes as `CODE`. Each error carries:

| Field | Value |
|---|---|
| `name` | `'ConnectorError'` |
| `code` | one of the codes below |
| `provider` | the provider id asked for |

| `code` | Thrown by | When | Shown to the person or the AI |
|---|---|---|---|
| `not_connected` | `resolveConnection` | no live connection | "connect <Provider> on My connections" |
| `not_member` | `resolveConnection` | guest, removed or deactivated member (FR-13) | refused, no detail |
| `broken` | `resolveConnection`, `getAccessToken` | the row is `broken`, or a refresh failed with one of the provider's `deadGrantErrors` | "reconnect <Provider> on My connections" |
| `scope_missing` | B's tool runner | the tool's scope is not in `scopes` (FR-9) | "tick <product> on your <Provider> connection" |
| `provider_off` | `resolveConnection` | not offered here | "<Provider> is not switched on here" |

- Only the person's own connection is ever returned (FR-19).
- The access token stays inside the caller of `getAccessToken()`: never returned by a route, logged, emitted or audited (FR-15).
- `connectionId` is the only id B stores (audit, proposals, usage).
- B never writes `connector_connections` directly; `markBackoff` is the one write B makes to it.
- Until 066 lands, `resolveConnection` is a stub with this signature that throws `provider_off` or `not_connected`, so B can build and test against it. `getAccessToken` and `markBackoff` arrive with 066.

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
| `app { source: 'instance' \| 'company', appId }` | `appId` is the `connector_apps` id for a company app, `null` for the instance app |
| `handles { access, refresh }` | secrets store, kind `connector` |
| `accessExpiresAt`, `connectedAt`, `lastUsedAt`, `disconnectedAt`, `disconnectedBy` | |
| `oauth { stateHash, verifier, sessionId, origin }` | in-flight connect only |
| `backoffUntil` | set through `markBackoff` |

Indexes: unique (`companyId`, `userId`, `provider`, `account.id`); partial unique (`companyId`, `userId`, `provider`) on live rows.

`connector_apps`: `companyId`, `provider`, `clientId`, `secretHandle`, `extra` (Google Picker: `apiKey`, `appId` — 061 matrix, contradiction 4), `setBy`, `createdAt`, `updatedAt`.

`connector_usage`: `companyId`, `connectionId`, `userId`, `actor { type: 'agent' | 'mcp', id }`, `day` (`YYYY-MM-DD`), `reads`, `writeProposals`. B writes it; A's screens (072) read it.

## 7. Decisions

1. **`connector_usage` is its own collection**, not counters on the connection row. FR-28 and FR-29 count per day **and** per agent or MCP client, and quotas run per person across connections; counters on one row cannot hold that. One document per (`companyId`, `connectionId`, `actor`, `day`), incremented in place.
2. **`google_calendar` and `google`.** Existing instances keep `CONNECTORS=google_calendar` until the Calendar migration (073), which renames it to `google`. Until then `Modules/Agents/connectors/flag.js` stays as it is, and naming `google` in `CONNECTORS` makes it log `google` as unknown at startup; that log is expected on a test instance and harmless, since nothing offers the new registry's providers before 066.

## 8. Signed

| Track | Name | Date |
|---|---|---|
| A — connections | Hetvi | 2026-10-29 |
| B — tools | Prinsa | 2026-10-29 |
