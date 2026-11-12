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
recordHealth({ companyId, connectionId, lastUsedAt, lastError })   // → Promise<void>; B calls it after a provider call; a field left out is not changed, `lastError: ''` clears it
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
- B never writes `connector_connections` directly: `markBackoff` and `recordHealth` are its only writes to it. B may read a row's `backoffUntil`.
- `connector.connect`, `connector.products_changed`, `connector.broken` and `connector.revoke` are audited by A, where those events happen; `connector.call` is audited by B.
- Until 066 lands, `resolveConnection` is a stub with this signature that throws `provider_off` or `not_connected`, so B can build and test against it. `getAccessToken`, `markBackoff` and `recordHealth` arrive with 066.

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

## 9. MCP providers (PRD v2.0, task 092, 2026-11-12)

The owner approved PRD v2.0 on 2026-11-12. These additions are optional, so Google, Slack and Dropbox are unchanged. Both tracks read them before building on MCP (094, 095, 100).

**Provider definition.** A provider that is reached through the app's own MCP server adds two fields:

```js
module.exports = {
    id: 'notion',
    name: 'Notion',
    transport: 'mcp',                         // 'api' when left out: the provider calls its own API, as today
    mcp: { url: 'https://mcp.notion.com/mcp' },
    auth: { /* as in section 2; task 100 adds discovery and self-registration */ },
    products: { workspace: [] },              // an MCP product may list no scopes
    readAccount: ({ tokenResponse }) => ({ id, label }),
    egressHosts: ['mcp.notion.com'],
};
```

`validate.js` also refuses a definition when:
- `transport` is anything but `api` or `mcp`
- `transport` is `mcp` and `mcp.url` is not `https`, or its host is not in `egressHosts`
- `mcp` is set on a provider whose transport is not `mcp`
- a product of an `api` provider has no scopes (unchanged)

**Tool definition.** An MCP provider's `tools.js` lists its tools as data, through `Modules/Connectors/mcpTools.js`:

```js
const { mcpTool } = require('../../mcpTools');

module.exports = [mcpTool({
    key: 'notion.pages.search',          // AlianHub's own name; it never changes when the server renames its tool
    label: 'Connectors.tool.notionPagesSearch',
    kind: 'read',                        // AlianHub decides read or write; the server's hints are not trusted
    product: 'workspace',
    // no scope: the product lists none
    input: { /* JSON schema, as in section 3 */ },
    caps: { maxItems: 10, maxChars: 8000 },
    tool: 'notion-search',               // the server's tool
    shape: '<sha256>',                   // mcpClient.shapeOf() of the tool as reviewed; null until someone reviews it
    args: (input) => input,              // optional: AlianHub's input as the server's arguments
})];
```

- `run` comes from `mcpTool` and calls `connection.mcp(tool, args)`. An MCP tool is handed `connection.mcp` and never `connection.request`; an API tool is handed `request` as before.
- `tools.js` refuses an MCP tool with no `mcp.tool`, a `shape` that is not a sha256 or `null`, or a `scope` its product does not list; and an API provider's tool that sets `mcp`.
- A tool whose `shape` is `null` is never on: `isOn()` is false, so agents, MCP and skill runs never see it.
- At call time `mcpClient` lists the server's tools (kept ten minutes per provider) and calls a tool only while its shape still equals `shape`. A changed tool is refused as `tool_changed` and logged; a withdrawn one as `tool_missing`.
- Every MCP request leaves through `agentFetch.callMcp`: only the connector's hosts, HTTPS, no redirect, the member's token set there and only the protocol's own headers passed on.
- Server answers become the same refusals as an API provider's: 429 holds the connection (`markBackoff`), 401 marks it broken (`markBroken`, reason `mcp_unauthorized`), anything else fails that one call. A tool's own error text never reaches the model.

## 10. Signing in without a registered app (task 100, 2026-11-12)

Optional fields, so every built provider is unchanged:

```js
auth: {
    // as in section 2, plus:
    registration: 'dynamic',                                  // the server signs clients up itself (RFC 7591); needs pkce: 'S256'
    registrationUrl: 'https://auth.notion.example/register',  // https, host in egressHosts
    personalToken: true,                                      // a member may paste a token of their own
},
account: {                                                    // the account a token belongs to, read with one GET
    url: 'https://api.github.com/user',                       // https, host in egressHosts
    read: (body) => ({ id, label }),
},
// readAccount is optional when account is given; a pasted token needs account
```

- `registry.signIns(id, { companyApps })` answers `['oauth']`, `['token']` or both; `isOffered` is true when there is at least one. `GET /api/v2/connectors` lists it per provider as `signIn`.
- A `dynamic` provider with no company or instance app gets a client registered once per workspace (`connector_registrations`, `Modules/Connectors/registrations.js`) and reused by every member; `apps.resolveApp` answers it with `source: 'registered'` and an empty secret, which the token calls leave out. A token answer of `invalid_client` drops the registration and the person starts again; a changed `APIURL` registers again.
- `POST /api/v2/connectors/:provider/token` keeps a pasted token after one `account.url` read succeeds; the row has `signIn: 'personal_token'`, `handles.access` only, all the definition's scopes, and is never refreshed or revoked at the provider.
- Every connection row now records `signIn` (`registered_app`, `self_register`, `personal_token`) and `kind` (`api`, `mcp`).
- `Modules/Connectors/mcpAuth.js` `discover({ url, companyId, actor })` reads a server's protected-resource and authorization-server metadata and answers its endpoints, registration and hosts, for custom servers (096).

## 11. Tools a person turns off for their own use (task 101, 2026-11-12)

Additive; nothing above changes.

- `connector_connections.toolsOff[]`: catalog tool keys of the row's provider that its owner turned off for their own use. Absent means none. A new connection (after a disconnect) starts with none; a reconnect keeps the list.
- `resolveConnection` answers `{ connectionId, scopes, toolsOff, getAccessToken }`.
- B's tool runner refuses a tool in `toolsOff` at admission, for a read and for a write (proposal and send), before the provider is called: code `tool_turned_off`, "You turned this <Provider> tool off for yourself…".
- `PUT /api/v2/connectors/connections/:id/tools`, body `{ toolsOff: [key] }`: the connection's owner only (anyone else, owners and admins included, gets 404), every key a catalog tool of that provider (else 400 `unknown_tool`), agents refused, audited `connector.tools_changed`. Answers the connection's view, which now carries `toolsOff`.
- `GET /api/v2/connectors/:provider/tools` (any member with a seat): `{ tools: [{ key, label, kind, on }] }`, `on` being `tools.isOn()`. No shape, input or server text.
- `GET /api/v2/connectors` also answers `unavailable: [{ provider }]`: named in `CONNECTORS` but with no way to sign in on this install yet.

## 12. Custom MCP servers (task 096, 2026-11-12)

Additive: every catalog provider, tool and route is unchanged.

**A custom server is a provider.** Someone holding "Add custom apps" (`Config/aiRights.js`, `ai_custom_apps`) adds a server for the workspace by name and address (`POST /api/v2/connectors/servers`). It is stored in `connector_servers` and is the provider `custom_<row id>`: its definition is built from the row (`customServers.definitionOf`), never read from `providers/`, and is never in the registry's list.

```js
{
    id: 'custom_6f…',              // matches the id rule of section 2
    name: 'Team notes',            // the name its adder gave it
    custom: true, serverId: '6f…',
    signIn: 'self_register' | 'registered_app' | 'personal_token',
    signIns: ['oauth'] | ['token'],
    transport: 'mcp', mcp: { url },
    auth: { authorizeUrl, tokenUrl, revokeUrl?, pkce?, registration?, registrationUrl? } | { personalToken: true },
    products: { server: [scopes the server published] },
    readAccount,                   // the token answer's sub/user_id/account_id/id, else one account per member
    checkToken,                    // personal tokens only: one listing of the server's tools checks a pasted token
    egressHosts: ['mcp.example.com', 'auth.example.com'],
}
```

- `connection.definitionFor(companyId, provider)` answers a catalog definition from the registry, or a custom one from the caller's own workspace only. The lifecycle uses it wherever it needs a definition (`start`, `setProducts`, `complete`, `accessTokenFor`, `disconnect`, `revokeAtProvider`, `saveToken`); `isOffered`, `list`, `membersWithConnections`, `endForMember` and the sweep include custom servers. The registry's sync API stays as it was; `registry.scopesIn(definition, products)` answers what `scopesFor(id, products)` answers, from a definition.
- `apps.resolveApp` answers a custom server's own app: the client it registered for the workspace (`registrations.js`, `source: 'registered'`) or the client id and secret its adder entered (`source: 'company'`, secret by handle). No instance, company or hosted app signs in to a custom server.
- Adding checks every host the server and its sign-in name: https, a host name rather than a number, and not resolving to a private, loopback or link-local address (`safeFetch.resolvePublic`). `mcpAuth.discover({ …, unlisted: true })` reads the metadata before the hosts are on the workspace egress list; with `AGENT_EGRESS_ALLOWLIST` on and a list in use, the hosts are then added to it, and taken off with the server.
- A server with sign-in metadata and a registration address registers itself; one without a registration address waits (`status: 'needs_app'`) until its client id and secret are entered, since the callback to register names the new row; one with no metadata takes members' own tokens.
- Members connect through the generic routes with the provider `custom_<id>`.
- Removing a server ends every connection to it (`disconnectedBy: 'server_removed'`), retires its client secret and registration, and deletes its `connector_tools` rows.

**Its tools are reviewed rows.** A custom server's tools are rows of `connector_tools` under its provider id, with `access` (read or write), `enabled`, the reviewer-accepted `label` and `description`, and the reviewed `inputSchema` (the server's, bounded, with no `pattern`). Listing them for review (`GET /api/v2/connectors/servers/:id/tools`) reads the server through the reviewer's own connection and shows the server's own text as outside content; saving one (`PUT …/tools/:tool`) needs the `shape` the reviewer saw. A reviewed tool whose shape changes is turned off (`toolReviews.noteChanged`).

**Three generic tools, registered once** (`Modules/Connectors/customTools.js`), on while `CONNECTORS_CUSTOM` is not `off` and the module is on:

| Key | Kind | Takes | Does |
|---|---|---|---|
| `custom.tools.list` | read | nothing | the workspace's active servers and their reviewed, switched-on tools: accepted label, description, input schema, read or write. Reaches no server, so no connection, quota or run read; it marks the run |
| `custom.tool.read` | read | `{ server, tool, arguments }` | runs a reviewed read on the caller's own connection |
| `custom.tool.write` | write | `{ server, tool, arguments }` | files a proposal; the card names the app, the tool and the exact arguments |

- `tools.all()` holds them beside the catalog's (`custom: true`), so the agent registry and AlianHub's MCP server register them; skills do not declare them.
- `tools.bound(tool, { companyId, input })` turns a call into that server's reviewed tool: the tool must be enabled, reviewed as that kind, still of the reviewed shape, and `arguments` must fit the reviewed schema. From there `toolRunner` runs it as any MCP tool: own connection, caps, quotas, taint `custom_<id>`, audit, `connection_owner` approval and one send.
