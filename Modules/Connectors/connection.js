const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const store = require('../../Config/secrets');
const logger = require('../../Config/loggerConfig');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { recordAudit } = require('../Audit/recorder');
const { named } = require('../Agents/connectors/flag');
const socketEmitter = require('../../event/socketEventEmitter');
const { removeCache } = require('../../utils/commonFunctions');
const registry = require('./registry');
const apps = require('./apps');
const api = require('./providerApi');

/* One person's connection to their own account at one provider, one live row per person and provider. The access
 * and refresh tokens are kept in the secrets store under the kind `connector` and the row holds their handles
 * only; nothing here returns, logs, audits or emits a token, and no caller is handed anything but a handle or,
 * from `accessTokenFor`, the access token it needs for one call. */

const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const LOG = '[connectors]';
const SECRET_KIND = 'connector';
const STATE_AUDIENCE = 'alianhub:connector-oauth';
const STATE_TTL_SECONDS = 600;
const MAX_STATE_LENGTH = 2000;
const MAX_CODE_LENGTH = 2048;
const EXPIRY_SKEW_MS = 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const ERROR_CODE = /^[a-z0-9_]{1,60}$/;
const STATUS = Object.freeze({ PENDING: 'pending', CONNECTED: 'connected', BROKEN: 'broken', REAUTH: 'reauth_required', REVOKED: 'revoked' });
const BY = Object.freeze({ SELF: 'self', ADMIN: 'admin', MEMBER_REMOVED: 'member_removed' });
const SECRET_LABEL = Object.freeze({ refresh: 'refresh token', access: 'access token' });

class ConnectionError extends Error {
    constructor(status, message, code) { super(message); this.name = 'ConnectionError'; this.status = status; this.code = code || ''; }
}

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const actorOf = (actor) => (actor && typeof actor === 'object' ? actor : { id: actor });
const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const challengeOf = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');
const callbackPath = (provider) => `/api/v1/connector-oauth/${provider}/callback`;
const redirectUri = (provider) => `${apiBase()}${callbackPath(provider)}`;
const fallbackOrigin = () => String(process.env.WEBURL || '').split(',').map((entry) => entry.trim().replace(/\/+$/, '')).find(Boolean) || apiBase();
const stateSecret = () => {
    const secret = String(process.env.JWT_SECRET || '');
    if (!secret) throw new ConnectionError(503, 'The server has no signing key, so a connection cannot be started.', 'no_signing_key');
    return `${secret}::connector-oauth-state`;
};

const companyAppsOf = (companyId) => apps.companyProviders(companyId).then((list) => ({ companyApps: list }));
const definitionOf = (provider) => registry.get(provider);

/* Offered needs a definition, a name in CONNECTORS, and an app. The name is checked first and the instance app
 * next, both without the database, so a provider that is off or set by the instance is answered without a company
 * app lookup; only a named provider with no instance app reads `connector_apps`. */
const isOffered = async (companyId, provider) => {
    if (!definitionOf(provider) || !named().includes(String(provider))) return false;
    if (registry.isOffered(provider, { companyApps: [] })) return true;
    const { companyApps } = await companyAppsOf(companyId);
    return companyApps.includes(String(provider));
};

const live = (userId, provider) => ({ provider: String(provider), userId: String(userId), deletedStatusKey: { $ne: 1 } });
const find = async (companyId, userId, provider) => plain(await MongoDbCrudOpration(companyId, { type: T, data: [live(userId, provider)] }, 'findOne'));
const byId = async (companyId, connectionId) => (OBJECT_ID.test(String(connectionId || ''))
    ? plain(await MongoDbCrudOpration(companyId, { type: T, data: [{ _id: connectionId, deletedStatusKey: { $ne: 1 } }] }, 'findOne'))
    : null);
const update = async (companyId, row, change) => plain(await MongoDbCrudOpration(companyId, {
    type: T, data: [{ _id: row._id }, change, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));
const holdsToken = (row) => Boolean(row && row.handles && row.handles.refresh);

const audit = (companyId, actor, action, provider, meta = {}) => {
    const who = actorOf(actor);
    recordAudit(companyId, {
        actorId: String(who.id || 'system'), ...(who.ip ? { ip: String(who.ip) } : {}),
        action, entityType: 'connector', entityId: String(provider), entityName: (definitionOf(provider) || {}).name || String(provider), meta,
    });
};

const CACHE_KEY = (companyId, userId) => `connectors:${companyId}:${userId}`;

/* A change to a person's connections is pushed to their own sessions and clears their cached list, like a sibling
 * route. The relay to the client and the My-connections screen land with 072; the event name, module and cache
 * key are fixed here for it to read. No token or account id is ever in the payload. */
const announce = (companyId, userId, provider, change) => {
    removeCache(CACHE_KEY(String(companyId), String(userId)));
    socketEmitter.emit('update', {
        type: 'update', module: 'connector', companyId: String(companyId),
        data: { userId: String(userId), provider: String(provider), change },
        actor: { kind: 'person' }, depth: 1,
    });
};

/* A removed member keeps a row in the member list, so "has a row" is not "has a seat". Three answers, not two: a
 * seat, no seat, or a read that failed. The daily sweep must tell "no seat" from "could not tell", or a database
 * blip would make every member look departed and revoke them all; `hasSeat` keeps the two-value, fail-closed form
 * its callers want, where anything but a seat refuses one call. */
const SEAT = Object.freeze({ YES: 'yes', NO: 'no', UNKNOWN: 'unknown' });
const seatOf = async (companyId, userId) => {
    try {
        const role = await getRoleType(companyId, userId, { throwOnError: true });
        return role !== null && role !== undefined && role !== ROLE_GUEST ? SEAT.YES : SEAT.NO;
    } catch (e) {
        return SEAT.UNKNOWN;
    }
};
const hasSeat = async (companyId, userId) => (await seatOf(companyId, userId)) === SEAT.YES;

/* What the person sees of their own connection: the account it belongs to, never a token or its handle. */
const view = (provider, row) => {
    const connected = holdsToken(row);
    const broken = connected && row.status === STATUS.BROKEN;
    return {
        provider,
        connectionId: connected ? String(row._id) : null,
        connected,
        status: connected ? row.status || STATUS.CONNECTED : null,
        account: connected ? { label: String((row.account && row.account.label) || '') } : null,
        products: connected ? [...(row.products || [])] : [],
        scopes: connected ? [...(row.scopes || [])] : [],
        connectedAt: connected ? row.connectedAt || null : null,
        lastUsedAt: connected ? row.lastUsedAt || null : null,
        brokenReason: broken ? row.lastError || '' : '',
        brokenAt: broken ? row.brokenAt || null : null,
    };
};

/* What an owner or admin sees of a member's connection: that it exists and what it may do, not whose account it is. */
const memberView = (row) => ({
    userId: String(row.userId),
    provider: row.provider,
    connectionId: String(row._id),
    status: row.status || STATUS.CONNECTED,
    products: [...(row.products || [])],
    scopes: [...(row.scopes || [])],
    connectedAt: row.connectedAt || null,
    lastUsedAt: row.lastUsedAt || null,
    brokenAt: row.status === STATUS.BROKEN ? row.brokenAt || null : null,
});

/* The view, with a connection whose refresh token was revoked from the stored-secrets screen shown as ended. */
const describe = async (companyId, userId, provider) => {
    const row = await find(companyId, userId, provider);
    if (!holdsToken(row)) return view(provider, null);
    const held = await store.describe({ companyId, handle: row.handles.refresh }).then(() => true).catch(() => false);
    return view(provider, held ? row : null);
};

const scopesForProducts = (provider, products) => registry.scopesFor(provider, Array.isArray(products) && products.length ? products : Object.keys(definitionOf(provider).products));

/* The state names the workspace, the person and the provider and is signed; what makes it single-use and ties it
 * to one session is the row, which keeps a hash of its id, the session that asked and the PKCE verifier. Starting
 * again replaces the earlier attempt. The app that will issue the token is recorded now (FR-6). */
const beginConsent = async ({ companyId, userId, sessionId, provider, products, origin, app, scopes }) => {
    const definition = definitionOf(provider);
    const jti = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const oauth = { stateHash: hash(jti), verifier, sessionId: String(sessionId), origin: String(origin || ''), products: [...products] };
    const existing = await find(companyId, userId, provider);
    // The products the person ticked ride on the attempt; a live connection keeps its own until `complete` applies them.
    const set = { oauth, provider: String(provider), app: { source: app.source, appId: app.appId } };
    if (existing) await update(companyId, existing, { $set: set });
    else {
        await MongoDbCrudOpration(companyId, {
            type: T,
            data: { _id: new mongoose.Types.ObjectId(), companyId: String(companyId), userId: String(userId), status: STATUS.PENDING, handles: {}, createdBy: String(userId), deletedStatusKey: 0, ...set },
        }, 'save');
    }
    const state = jwt.sign(
        { companyId: String(companyId), userId: String(userId), provider, jti },
        stateSecret(),
        { algorithm: 'HS256', audience: STATE_AUDIENCE, expiresIn: STATE_TTL_SECONDS },
    );
    return { url: api.consentUrl({ definition, clientId: app.clientId, redirectUri: redirectUri(provider), scopes, state, challenge: challengeOf(verifier) }) };
};

const start = async ({ companyId, userId, sessionId, provider, products, origin }) => {
    if (!sessionId) throw new ConnectionError(403, 'Sign in again before connecting an account.', 'no_session');
    if (!apiBase()) throw new ConnectionError(409, 'APIURL is not set on the server, so the provider cannot be told where to return.', 'apiurl_missing');
    if (!(await isOffered(companyId, provider))) throw new ConnectionError(404, 'This connector is not available.', 'provider_off');
    let scopes;
    try {
        scopes = scopesForProducts(provider, products);
    } catch (e) {
        throw new ConnectionError(400, 'Those products are not offered by this connector.', 'bad_products');
    }
    const app = await apps.resolveApp({ companyId, provider });
    return beginConsent({ companyId, userId, sessionId, provider, products: products || Object.keys(definitionOf(provider).products), origin, app, scopes });
};

/* Re-consents for the products the person ticked (incremental consent, FR-10). The live connection keeps its
 * current products, and is unchanged and unaudited, until the new consent completes; only the scopes the provider
 * grants are stored, so a product stays off until its consent comes back. */
const setProducts = async ({ companyId, userId, sessionId, provider, connectionId, products, origin }) => {
    if (!sessionId) throw new ConnectionError(403, 'Sign in again before changing products.', 'no_session');
    if (!(await isOffered(companyId, provider))) throw new ConnectionError(404, 'This connector is not available.', 'provider_off');
    const row = await find(companyId, userId, provider);
    if (!row || String(row._id) !== String(connectionId) || !holdsToken(row)) throw new ConnectionError(404, 'There is no such connection.', 'not_connected');
    let scopes;
    try {
        scopes = scopesForProducts(provider, products);
    } catch (e) {
        throw new ConnectionError(400, 'Those products are not offered by this connector.', 'bad_products');
    }
    const app = await apps.resolveApp({ companyId, provider });
    return beginConsent({ companyId, userId, sessionId, provider, products, origin, app, scopes });
};

const readState = (state) => {
    if (typeof state !== 'string' || !state || state.length > MAX_STATE_LENGTH) return null;
    try {
        const claims = jwt.verify(state, stateSecret(), { algorithms: ['HS256'], audience: STATE_AUDIENCE });
        const whole = claims && OBJECT_ID.test(String(claims.companyId)) && OBJECT_ID.test(String(claims.userId)) && typeof claims.jti === 'string' && !!definitionOf(claims.provider);
        return whole ? claims : null;
    } catch (e) {
        return null;
    }
};

/* Whether a callback state is one this lifecycle signed (its audience). Lets the legacy google callback answer
 * its own states while both share one redirect URI (routes.js, until 073). */
const ownsState = (state) => !!readState(state);

const pendingFilter = (claims) => ({ ...live(claims.userId, claims.provider), 'oauth.stateHash': hash(claims.jti) });

/* Answers the row as it was and clears the attempt in one write, so two requests cannot both use a state. */
const consume = async (claims) => plain(await MongoDbCrudOpration(claims.companyId, { type: T, data: [pendingFilter(claims), { $unset: { oauth: 1 } }] }, 'findOneAndUpdate'));

/* Where the public callback sends the browser. It holds no session, so it exchanges nothing: it hands the code to
 * the page the person is signed in on, in the URL fragment, which no server or referrer ever receives. */
const returnFor = async ({ provider, state, code, error }) => {
    const nowhere = (reason) => ({ origin: fallbackOrigin(), path: '/', query: { connector: String(provider || ''), result: 'error', reason } });
    const claims = readState(state);
    if (!claims || claims.provider !== provider) return nowhere('state');
    if (!(await isOffered(claims.companyId, provider))) return nowhere('off');
    const row = plain(await MongoDbCrudOpration(claims.companyId, { type: T, data: [pendingFilter(claims)] }, 'findOne'));
    if (!row) return nowhere('state');
    const target = { origin: (row.oauth && row.oauth.origin) || fallbackOrigin(), path: `/${claims.companyId}/connections` };
    const given = typeof code === 'string' && code && code.length <= MAX_CODE_LENGTH ? code : '';
    if (error || !given) {
        await consume(claims);
        // The provider's error is reflected to the page, so clamp it to a code's shape as the token call does.
        const reason = error ? (ERROR_CODE.test(String(error)) ? String(error) : 'provider_error') : 'no_code';
        return { ...target, query: { connector: provider, result: 'error', reason } };
    }
    return { ...target, query: { connector: provider, state, code: given } };
};

const refusedByProvider = (definition, out) => {
    if (api.isGrantRefused(definition, out.error)) return new ConnectionError(400, 'The provider did not accept this sign-in. Start again from the Connections page.', out.error);
    return new ConnectionError(502, `The provider could not complete the connection (${out.error}${out.detail ? `: ${out.detail}` : ''}).`, out.error);
};

const keep = async ({ companyId, userId, provider, handle, key, value, actor }) => {
    if (handle) {
        try {
            return (await store.rotate({ companyId, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    const name = `${(definitionOf(provider) || {}).name || provider} connection of ${userId}: ${SECRET_LABEL[key]}`;
    return (await store.create({ companyId, name, kind: SECRET_KIND, value, actor })).handle;
};

const lifetimeOf = (seconds) => {
    const n = Number(seconds);
    return new Date(Date.now() + (Number.isFinite(n) && n > 0 ? n : 0) * 1000);
};

/* Another live connection of the same person to the same account at the same provider shares one grant, and
 * revoking any token of a grant ends all of it. The live-row index keeps this to the transient reconnect window. */
const sharesGrant = async (companyId, row) => {
    const id = row.account && row.account.id;
    if (!id) return false;
    const others = ((await MongoDbCrudOpration(companyId, { type: T, data: [{ provider: String(row.provider), userId: String(row.userId), deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
    return others.some((other) => String(other._id) !== String(row._id) && holdsToken(other) && other.account && other.account.id === id);
};

/* Slack's auth.revoke takes no refresh token, so an expired access token is refreshed first, only to be revoked. */
const revokeToken = async ({ companyId, actor, provider, row, definition }) => {
    const refreshToken = await store.resolve({ companyId, handle: row.handles.refresh }).catch(() => null);
    if (definition.auth.revokeWith !== 'access') return refreshToken;
    const fresh = row.handles.access && row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() - EXPIRY_SKEW_MS > Date.now();
    if (fresh) return store.resolve({ companyId, handle: row.handles.access }).catch(() => null);
    const app = refreshToken ? await apps.resolveApp({ companyId, provider }).catch(() => null) : null;
    if (!app) return null;
    const out = await api.refresh({ definition, companyId, actor: actorOf(actor).id, client: app, refreshToken });
    return out.ok ? api.tokensOf(definition, out.body).access_token || null : null;
};

const revokeAtProvider = async ({ companyId, actor, provider, row }) => {
    const definition = definitionOf(provider);
    const token = holdsToken(row) ? await revokeToken({ companyId, actor, provider, row, definition }) : null;
    if (!token) return 'skipped';
    if (await sharesGrant(companyId, row)) return 'shared';
    const out = await api.revoke({ definition, companyId, actor: actorOf(actor).id, token });
    return out.ok ? (out.skipped ? 'no_endpoint' : 'revoked') : 'failed';
};

/* Only the session that started the attempt completes it. The state is used up before anything is checked against
 * it, so a refused attempt cannot be tried again. Only the scopes the provider actually granted are stored. */
const complete = async ({ companyId, userId, sessionId, provider, state, code, actor }) => {
    const refused = (reason = 'state_invalid') => new ConnectionError(400, 'This connection attempt is no longer valid. Start again from the Connections page.', reason);
    const definition = definitionOf(provider);
    if (!definition) throw new ConnectionError(404, 'This connector is not available.', 'provider_off');
    const claims = readState(state);
    if (!claims || claims.companyId !== String(companyId) || claims.userId !== String(userId) || claims.provider !== provider) throw refused();
    const given = typeof code === 'string' ? code.trim() : '';
    if (!given || given.length > MAX_CODE_LENGTH) throw refused('no_code');
    const row = await consume(claims);
    if (!row) throw refused('state_used');
    const pending = row.oauth || {};
    if (!sessionId || pending.sessionId !== String(sessionId)) throw refused();
    if (definition.auth.pkce === 'S256' && !pending.verifier) throw refused('no_verifier');

    const who = actor || { id: String(userId) };
    const app = await apps.resolveApp({ companyId, provider });
    const out = await api.exchange({ definition, companyId, actor: userId, client: app, code: given, verifier: pending.verifier, redirectUri: redirectUri(provider) });
    if (!out.ok) throw refusedByProvider(definition, out);
    const answer = out.body;
    const tokens = api.tokensOf(definition, answer);
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new ConnectionError(502, 'The provider sent no access token.', 'no_access_token');
    if (typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) {
        throw new ConnectionError(409, 'The provider sent no refresh token, so the connection could not be kept. Start again and allow offline access.', 'no_refresh_token');
    }
    let account;
    try {
        const read = definition.readAccount({ tokenResponse: answer }) || {};
        account = { id: String(read.id || ''), label: String(read.label || '').slice(0, 254) };
    } catch (e) {
        throw new ConnectionError(502, 'The provider did not identify the account.', 'no_account');
    }
    if (!account.id) throw new ConnectionError(502, 'The provider did not identify the account.', 'no_account');
    const before = row.account && row.account.id;
    if (holdsToken(row) && before && before !== account.id) await revokeAtProvider({ companyId, actor: who, provider, row });

    const handles = {};
    for (const [key, value] of [['refresh', tokens.refresh_token], ['access', tokens.access_token]]) {
        // eslint-disable-next-line no-await-in-loop
        handles[key] = await keep({ companyId, userId, provider, handle: row.handles && row.handles[key], key, value, actor: who });
    }
    const scopes = api.scopesOf(tokens.scope);
    const was = row.products || [];
    const products = Array.isArray(pending.products) ? pending.products : was;
    const saved = await update(companyId, row, { $set: {
        status: STATUS.CONNECTED, handles, scopes, account, app: row.app || { source: app.source, appId: app.appId }, accessExpiresAt: lifetimeOf(tokens.expires_in),
        products: [...products], connectedAt: new Date(), lastError: '', brokenAt: null, updatedBy: String(userId),
    } });
    audit(companyId, who, 'connector.connect', provider, { userId: String(userId), products: [...(saved.products || [])], scopes });
    announce(companyId, userId, provider, 'connected');
    // A re-consent that changed the products of an already-connected account is also a product change (FR-10).
    if (holdsToken(row) && (was.length !== products.length || products.some((product) => !was.includes(product)))) {
        audit(companyId, who, 'connector.products_changed', provider, { userId: String(userId), connectionId: String(row._id), products: [...products] });
        announce(companyId, userId, provider, 'products_changed');
    }
    return view(provider, saved);
};

const close = (companyId, row, by, actor) => update(companyId, row, {
    $set: { status: STATUS.REVOKED, handles: {}, deletedStatusKey: 1, disconnectedAt: new Date(), disconnectedBy: by, updatedBy: String(actorOf(actor).id || '') },
    $unset: { oauth: 1 },
});

/* The provider is asked once to end the grant; whatever it answers, the tokens leave the store and the row closes. */
const disconnect = async ({ companyId, userId, provider, connectionId, actor, by = BY.SELF }) => {
    const row = await find(companyId, userId, provider);
    const handles = Object.values((row && row.handles) || {}).filter(Boolean);
    if (!row || !handles.length) throw new ConnectionError(404, 'There is no connection to end.', 'not_connected');
    if (connectionId && String(row._id) !== String(connectionId)) throw new ConnectionError(404, 'There is no such connection.', 'not_connected');
    const providerResult = await revokeAtProvider({ companyId, actor, provider, row });
    for (const handle of handles) {
        // eslint-disable-next-line no-await-in-loop
        await store.retire({ companyId, handle, actor });
    }
    await close(companyId, row, by, actor);
    audit(companyId, actor, 'connector.revoke', provider, { userId: String(userId), by, provider: providerResult });
    announce(companyId, userId, provider, 'disconnected');
    return view(provider, null);
};

const markBroken = async (companyId, row, reason) => {
    await update(companyId, row, { $set: { status: STATUS.BROKEN, lastError: String(reason || '').slice(0, 60), brokenAt: new Date() } });
    audit(companyId, null, 'connector.broken', row.provider, { userId: String(row.userId), reason: String(reason || '').slice(0, 60) });
    announce(companyId, row.userId, row.provider, 'broken');
};

/* Without a refresh (resolveConnection): the row that may be used now, or the reason there is none. The seat is
 * checked every time; a connection the provider refused is not offered again until the person reconnects. */
const findUsable = async ({ companyId, userId, provider }) => {
    const none = (reason) => ({ row: null, reason });
    if (!(await isOffered(companyId, provider))) return none('off');
    if (!(await hasSeat(companyId, userId))) return none('no_seat');
    const row = await find(companyId, userId, provider);
    if (!holdsToken(row)) return none('not_connected');
    if (row.status === STATUS.BROKEN) return none('broken');
    if (row.status === STATUS.REAUTH) return none('reauth_required');
    return { row, reason: '' };
};

/* What a tool calls before each use through getAccessToken: an access token good now, or the reason there is
 * none. An expired token is refreshed with one attempt; a dead grant marks the connection `broken`. */
const accessTokenFor = async ({ companyId, userId, provider }) => {
    const none = (reason) => ({ token: null, reason });
    const found = await findUsable({ companyId, userId, provider });
    if (found.reason) return none(found.reason);
    const { row } = found;
    const handles = row.handles;
    const held = await store.describe({ companyId, handle: handles.refresh }).then(() => true).catch(() => false);
    if (!held) return none('token_unavailable');
    const fresh = handles.access && row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() - EXPIRY_SKEW_MS > Date.now();
    if (fresh) {
        const token = await store.resolve({ companyId, handle: handles.access }).catch(() => null);
        if (!token) return none('token_unavailable');
        await update(companyId, row, { $set: { lastUsedAt: new Date() } });
        return { token, reason: '' };
    }
    const refreshToken = await store.resolve({ companyId, handle: handles.refresh }).catch(() => null);
    if (!refreshToken) return none('token_unavailable');
    const definition = definitionOf(provider);
    const app = await apps.resolveApp({ companyId, provider }).catch(() => null);
    if (!app) return none('token_unavailable');
    const out = await api.refresh({ definition, companyId, actor: userId, client: app, refreshToken });
    if (!out.ok) {
        if (!api.isGrantRefused(definition, out.error)) return none('refresh_failed');
        await markBroken(companyId, row, out.error);
        return none('broken');
    }
    const tokens = api.tokensOf(definition, out.body);
    if (typeof tokens.access_token !== 'string' || !tokens.access_token) return none('refresh_failed');
    const actor = { id: String(userId) };
    const next = { ...handles, access: await keep({ companyId, userId, provider, handle: handles.access, key: 'access', value: tokens.access_token, actor }) };
    if (typeof tokens.refresh_token === 'string' && tokens.refresh_token) {
        next.refresh = await keep({ companyId, userId, provider, handle: handles.refresh, key: 'refresh', value: tokens.refresh_token, actor });
    }
    await update(companyId, row, { $set: { handles: next, accessExpiresAt: lifetimeOf(tokens.expires_in), lastRefreshedAt: new Date(), lastUsedAt: new Date() } });
    return { token: tokens.access_token, reason: '' };
};

/* A tool call the provider refused for a dead token (Slack answers `invalid_auth` on the call, not on a refresh). */
const markBrokenById = async ({ companyId, connectionId, reason }) => {
    const row = await byId(String(companyId), connectionId);
    if (row && holdsToken(row) && row.status !== STATUS.BROKEN) await markBroken(String(companyId), row, reason);
};

const markBackoff = async ({ companyId, connectionId, until }) => {
    if (!companyId || !connectionId) return;
    await MongoDbCrudOpration(String(companyId), { type: T, data: [{ _id: connectionId }, { $set: { backoffUntil: until ? new Date(until) : null } }] }, 'updateOne');
};

/* A call already in flight can finish after a refresh marked the row broken, and `lastError` on a broken row is the
 * reason the person is shown, so a broken row is left alone. */
const recordHealth = async ({ companyId, connectionId, lastUsedAt, lastError }) => {
    if (!companyId || !connectionId) return;
    const fields = {
        ...(lastUsedAt === undefined ? {} : { lastUsedAt: new Date(lastUsedAt) }),
        ...(lastError === undefined ? {} : { lastError: String(lastError).slice(0, 60) }),
    };
    if (!Object.keys(fields).length) return;
    await MongoDbCrudOpration(String(companyId), { type: T, data: [{ _id: connectionId, status: { $ne: STATUS.BROKEN } }, { $set: fields }] }, 'updateOne');
};

/* Every provider offered to this workspace, with the person's own connection on each (FR, GET /api/v2/connectors). */
const list = async (companyId, userId) => {
    const offered = registry.offered(await companyAppsOf(companyId));
    const connections = [];
    for (const definition of offered) {
        // eslint-disable-next-line no-await-in-loop
        connections.push(await describe(companyId, userId, definition.id));
    }
    return { providers: offered.map((d) => ({ provider: d.id, products: Object.keys(d.products) })), connections };
};

const membersWithConnections = async (companyId) => {
    const offered = registry.offered(await companyAppsOf(companyId)).map((d) => d.id);
    const found = ((await MongoDbCrudOpration(companyId, { type: T, data: [{ provider: { $in: offered }, deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
    return found.filter(holdsToken).map(memberView);
};

/* Called where a member is removed or deactivated. It never throws into that flow, and reads nothing while no
 * provider is offered. (The daily sweep and the removal hook are 067; this is the shared end-one-member path.) */
const endForMember = async (companyId, userId) => {
    if (!OBJECT_ID.test(String(companyId || '')) || !userId) return 0;
    let offered;
    try {
        offered = registry.offered(await companyAppsOf(companyId)).map((d) => d.id);
    } catch (e) {
        return 0;
    }
    if (!offered.length) return 0;
    let ended = 0;
    try {
        const found = ((await MongoDbCrudOpration(String(companyId), { type: T, data: [{ userId: String(userId), provider: { $in: offered }, deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
        for (const row of found) {
            const actor = { id: 'system' };
            // eslint-disable-next-line no-await-in-loop
            if (holdsToken(row)) { await disconnect({ companyId: String(companyId), userId, provider: row.provider, actor, by: BY.MEMBER_REMOVED }); ended += 1; }
            // eslint-disable-next-line no-await-in-loop
            else await close(String(companyId), row, BY.MEMBER_REMOVED, actor);
        }
    } catch (error) {
        logger.error(`${LOG} ending the connections of a departed member failed: ${(error && error.name) || 'Error'}`);
    }
    return ended;
};

/* The idempotent daily sweep (067): ends the connections of anyone in this company who still holds one but no
 * longer has a seat — the safety net for a removal whose end-one-member call never finished (the provider was
 * down, the process died). It reuses endForMember, so a closed row is not open on the next pass and a second run
 * ends nothing. A member who still has their seat is left alone. */
const sweepCompany = async (companyId) => {
    if (!OBJECT_ID.test(String(companyId || ''))) return 0;
    let offered;
    try {
        offered = registry.offered(await companyAppsOf(companyId)).map((d) => d.id);
    } catch (e) {
        return 0;
    }
    if (!offered.length) return 0;
    let ended = 0;
    try {
        const open = ((await MongoDbCrudOpration(String(companyId), { type: T, data: [{ provider: { $in: offered }, deletedStatusKey: { $ne: 1 } }, 'userId'] }, 'find')) || []).map(plain);
        const userIds = [...new Set(open.map((row) => String(row.userId)))];
        for (const userId of userIds) {
            // End only on a definite "no seat"; a read that failed is left for the next pass, never revoked on a blip.
            // eslint-disable-next-line no-await-in-loop
            if ((await seatOf(String(companyId), userId)) === SEAT.NO) ended += await endForMember(String(companyId), userId);
        }
    } catch (error) {
        logger.error(`${LOG} the departed-member connection sweep failed for a company: ${(error && error.name) || 'Error'}`);
    }
    return ended;
};

module.exports = {
    STATUS, BY, STATE_TTL_SECONDS, SECRET_KIND, ConnectionError,
    isOffered, fallbackOrigin, redirectUri, callbackPath, byId, ownsState,
    describe, list, membersWithConnections, start, setProducts, returnFor, complete, disconnect,
    findUsable, accessTokenFor, markBrokenById, markBackoff, recordHealth, endForMember, sweepCompany,
};
