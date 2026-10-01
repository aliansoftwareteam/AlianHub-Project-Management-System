const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const store = require('../../../Config/secrets');
const logger = require('../../../Config/loggerConfig');
const { getRoleType } = require('../../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../../Config/roleTypes');
const { recordAudit } = require('../../Audit/recorder');
const flag = require('./flag');
const api = require('./googleApi');

/* One person's connection to their own Google account, one row per person and connector. The access and the
 * refresh token are kept in the secrets store under the kind `connector` and the row holds their handles only;
 * nothing here returns, logs, audits or emits a token, and no caller is handed anything but a handle. */

const T = SCHEMA_TYPE.CONNECTOR_CONNECTIONS;
const LOG = '[connectors]';
const SECRET_KIND = 'connector';
const CALLBACK_PATH = '/api/v1/connector-oauth/google/callback';
const STATE_AUDIENCE = 'alianhub:connector-oauth:google';
const STATE_TTL_SECONDS = 600;
const MAX_STATE_LENGTH = 2000;
const MAX_CODE_LENGTH = 2048;
const EXPIRY_SKEW_MS = 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const STATUS = Object.freeze({ PENDING: 'pending', CONNECTED: 'connected', BROKEN: 'broken', REVOKED: 'revoked' });
const BY = Object.freeze({ SELF: 'self', ADMIN: 'admin', MEMBER_REMOVED: 'member_removed' });
const SECRET_LABEL = Object.freeze({ refresh_token: 'refresh token', access_token: 'access token' });
const PROVIDER_REASONS = Object.freeze(['access_denied', 'interaction_required', 'server_error', 'temporarily_unavailable']);

const CONNECTORS = Object.freeze({
    google_calendar: Object.freeze({
        name: 'Google Calendar',
        scopes: Object.freeze([
            'openid',
            'email',
            'https://www.googleapis.com/auth/calendar.app.created',
            'https://www.googleapis.com/auth/calendar.events.readonly',
            'https://www.googleapis.com/auth/calendar.events.owned',
        ]),
    }),
});

class ConnectionError extends Error {
    constructor(status, message, code) { super(message); this.name = 'ConnectionError'; this.status = status; this.code = code || ''; }
}

const isConnector = (connector) => typeof connector === 'string' && Object.prototype.hasOwnProperty.call(CONNECTORS, connector);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const actorOf = (actor) => (actor && typeof actor === 'object' ? actor : { id: actor });
const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const challengeOf = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
const apiBase = () => String(process.env.APIURL || '').replace(/\/+$/, '');
const redirectUri = () => `${apiBase()}${CALLBACK_PATH}`;
const fallbackOrigin = () => String(process.env.WEBURL || '').split(',').map((entry) => entry.trim().replace(/\/+$/, '')).find(Boolean) || apiBase();
const stateSecret = () => {
    const secret = String(process.env.JWT_SECRET || '');
    if (!secret) throw new ConnectionError(503, 'The server has no signing key, so a connection cannot be started.', 'no_signing_key');
    return `${secret}::connector-oauth-state`;
};

const live = (userId, connector) => ({ connector: String(connector), userId: String(userId), deletedStatusKey: { $ne: 1 } });
const find = async (companyId, userId, connector) => plain(await MongoDbCrudOpration(companyId, { type: T, data: [live(userId, connector)] }, 'findOne'));
const update = async (companyId, row, change) => plain(await MongoDbCrudOpration(companyId, {
    type: T, data: [{ _id: row._id }, change, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));
const holdsToken = (row) => Boolean(row && row.secretHandles && row.secretHandles.refresh_token);

const audit = (companyId, actor, action, connector, meta = {}) => {
    const who = actorOf(actor);
    recordAudit(companyId, {
        actorId: String(who.id || 'system'), ...(who.ip ? { ip: String(who.ip) } : {}),
        action, entityType: 'connector', entityId: connector, entityName: CONNECTORS[connector].name, meta,
    });
};

/* A removed member keeps a row in the member list, so "has a row" is not "has a seat"; a seat that cannot be
 * read is treated as none. */
const hasSeat = async (companyId, userId) => {
    try {
        const role = await getRoleType(companyId, userId, { throwOnError: true });
        return role !== null && role !== undefined && role !== ROLE_GUEST;
    } catch (e) {
        return false;
    }
};

/* What the person sees of their own connection: the account it belongs to, never a token or its handle. */
const view = (connector, row) => {
    const connected = holdsToken(row);
    const broken = connected && row.status === STATUS.BROKEN;
    return {
        connector,
        connected,
        status: connected ? row.status || STATUS.CONNECTED : null,
        account: connected ? { email: String((row.account && row.account.email) || '') } : null,
        scopes: connected ? [...(row.scopes || [])] : [],
        connectedAt: connected ? row.connectedAt || null : null,
        lastUsedAt: connected ? row.lastUsedAt || null : null,
        brokenReason: broken ? row.brokenReason || '' : '',
        brokenAt: broken ? row.brokenAt || null : null,
    };
};

/* What an owner or admin sees of a member's connection: that it exists and what it may do, not whose Google
 * account it is. */
const memberView = (row) => ({
    userId: String(row.userId),
    connector: row.connector,
    status: row.status || STATUS.CONNECTED,
    scopes: [...(row.scopes || [])],
    connectedAt: row.connectedAt || null,
    lastUsedAt: row.lastUsedAt || null,
    brokenAt: row.status === STATUS.BROKEN ? row.brokenAt || null : null,
});

/* The view, with a connection whose refresh token was revoked from the stored-secrets screen shown as ended. */
const describe = async (companyId, userId, connector) => {
    const row = await find(companyId, userId, connector);
    if (!holdsToken(row)) return view(connector, null);
    const held = await store.describe({ companyId, handle: row.secretHandles.refresh_token }).then(() => true).catch(() => false);
    return view(connector, held ? row : null);
};

/* The state names the workspace, the person and the connector and is signed; what makes it single-use and
 * ties it to one session is the row, which keeps a hash of its id, the session that asked and the PKCE
 * verifier. Starting again replaces the earlier attempt. */
const start = async ({ companyId, userId, sessionId, connector, origin }) => {
    if (!sessionId) throw new ConnectionError(403, 'Sign in again before connecting an account.', 'no_session');
    if (!apiBase()) throw new ConnectionError(409, 'APIURL is not set on the server, so Google cannot be told where to return.', 'apiurl_missing');
    const secret = stateSecret();
    const jti = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const oauth = { stateHash: hash(jti), verifier, sessionId: String(sessionId), origin: String(origin || '') };
    const existing = await find(companyId, userId, connector);
    if (existing) await update(companyId, existing, { $set: { oauth } });
    else {
        await MongoDbCrudOpration(companyId, {
            type: T,
            data: { _id: new mongoose.Types.ObjectId(), connector, userId: String(userId), status: STATUS.PENDING, secretHandles: {}, oauth, createdBy: String(userId), deletedStatusKey: 0 },
        }, 'save');
    }
    const state = jwt.sign(
        { companyId: String(companyId), userId: String(userId), connector, jti },
        secret,
        { algorithm: 'HS256', audience: STATE_AUDIENCE, expiresIn: STATE_TTL_SECONDS },
    );
    return { url: api.consentUrl({ clientId: flag.googleClient().id, redirectUri: redirectUri(), scopes: CONNECTORS[connector].scopes, state, challenge: challengeOf(verifier) }) };
};

const readState = (state) => {
    if (typeof state !== 'string' || !state || state.length > MAX_STATE_LENGTH) return null;
    try {
        const claims = jwt.verify(state, stateSecret(), { algorithms: ['HS256'], audience: STATE_AUDIENCE });
        const whole = claims && OBJECT_ID.test(String(claims.companyId)) && OBJECT_ID.test(String(claims.userId)) && typeof claims.jti === 'string' && isConnector(claims.connector);
        return whole ? claims : null;
    } catch (e) {
        return null;
    }
};

const pendingFilter = (claims) => ({ ...live(claims.userId, claims.connector), 'oauth.stateHash': hash(claims.jti) });

/* Answers the row as it was and clears the attempt in one write, so two requests cannot both use a state. */
const consume = async (claims) => plain(await MongoDbCrudOpration(claims.companyId, { type: T, data: [pendingFilter(claims), { $unset: { oauth: 1 } }] }, 'findOneAndUpdate'));

/* Where the public callback sends the browser. It holds no session, so it exchanges nothing: it hands the code
 * to the page the person is signed in on, in the URL fragment, which no server or referrer ever receives. */
const returnFor = async ({ state, code, error }) => {
    const nowhere = (reason) => ({ origin: fallbackOrigin(), path: '/', query: { connector: 'google', result: 'error', reason } });
    const claims = readState(state);
    if (!claims) return nowhere('state');
    if (!flag.status(claims.connector).on) return nowhere('off');
    const row = plain(await MongoDbCrudOpration(claims.companyId, { type: T, data: [pendingFilter(claims)] }, 'findOne'));
    if (!row) return nowhere('state');
    const target = { origin: (row.oauth && row.oauth.origin) || fallbackOrigin(), path: `/${claims.companyId}/connections` };
    const given = typeof code === 'string' && code && code.length <= MAX_CODE_LENGTH ? code : '';
    if (error || !given) {
        await consume(claims);
        const reason = error ? (PROVIDER_REASONS.includes(error) ? error : 'provider_error') : 'no_code';
        return { ...target, query: { connector: claims.connector, result: 'error', reason } };
    }
    return { ...target, query: { connector: claims.connector, state, code: given } };
};

const refusedByGoogle = (out) => {
    if (api.isGrantRefused(out.error)) return new ConnectionError(400, 'Google did not accept this sign-in. Start again from the Connections page.', out.error);
    return new ConnectionError(502, `Google could not complete the connection (${out.error}${out.detail ? `: ${out.detail}` : ''}).`, out.error);
};

const keep = async ({ companyId, userId, connector, handle, key, value, actor }) => {
    if (handle) {
        try {
            return (await store.rotate({ companyId, handle, value, actor })).handle;
        } catch (error) {
            if (!['revoked', 'not_found'].includes(error.code)) throw error;
        }
    }
    const name = `${CONNECTORS[connector].name} connection of ${userId}: ${SECRET_LABEL[key]}`;
    return (await store.create({ companyId, name, kind: SECRET_KIND, value, actor })).handle;
};

const lifetimeOf = (seconds) => {
    const n = Number(seconds);
    return new Date(Date.now() + (Number.isFinite(n) && n > 0 ? n : 0) * 1000);
};

/* Another connection of the same person to the same Google account shares one grant with this one, and
 * revoking any token of a grant ends all of it. */
const sharesGrant = async (companyId, row) => {
    const sub = row.account && row.account.sub;
    if (!sub) return false;
    const others = ((await MongoDbCrudOpration(companyId, { type: T, data: [{ userId: String(row.userId), deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
    return others.some((other) => String(other._id) !== String(row._id) && holdsToken(other) && other.account && other.account.sub === sub);
};

const revokeAtGoogle = async ({ companyId, actor, row }) => {
    const token = holdsToken(row) ? await store.resolve({ companyId, handle: row.secretHandles.refresh_token }).catch(() => null) : null;
    if (!token) return 'skipped';
    if (await sharesGrant(companyId, row)) return 'shared';
    const out = await api.revoke({ companyId, actor: actorOf(actor).id, token });
    return out.ok ? 'revoked' : 'failed';
};

/* Only the session that started the attempt completes it. The state is used up before anything is checked
 * against it, so a refused attempt cannot be tried again. */
const complete = async ({ companyId, userId, sessionId, connector, state, code, actor }) => {
    const refused = (reason = 'state_invalid') => new ConnectionError(400, 'This connection attempt is no longer valid. Start again from the Connections page.', reason);
    const claims = readState(state);
    if (!claims || claims.companyId !== String(companyId) || claims.userId !== String(userId) || claims.connector !== connector) throw refused();
    const given = typeof code === 'string' ? code.trim() : '';
    if (!given || given.length > MAX_CODE_LENGTH) throw refused('no_code');
    const row = await consume(claims);
    if (!row) throw refused('state_used');
    const pending = row.oauth || {};
    if (!sessionId || pending.sessionId !== String(sessionId)) throw refused();
    if (!pending.verifier) throw refused('no_verifier');

    const who = actor || { id: String(userId) };
    const out = await api.exchange({ companyId, actor: userId, client: flag.googleClient(), code: given, verifier: pending.verifier, redirectUri: redirectUri() });
    if (!out.ok) throw refusedByGoogle(out);
    const answer = out.body;
    if (typeof answer.access_token !== 'string' || !answer.access_token) throw new ConnectionError(502, 'Google sent no access token.', 'no_access_token');
    if (typeof answer.refresh_token !== 'string' || !answer.refresh_token) {
        throw new ConnectionError(409, 'Google sent no refresh token, so the connection could not be kept. Start again and allow offline access.', 'no_refresh_token');
    }
    const account = api.accountOf(answer.id_token);
    const before = row.account && row.account.sub;
    if (holdsToken(row) && before && before !== account.sub) await revokeAtGoogle({ companyId, actor: who, row });

    const handles = {};
    for (const [key, value] of [['refresh_token', answer.refresh_token], ['access_token', answer.access_token]]) {
        // eslint-disable-next-line no-await-in-loop
        handles[key] = await keep({ companyId, userId, connector, handle: row.secretHandles && row.secretHandles[key], key, value, actor: who });
    }
    const scopes = api.scopesOf(answer.scope);
    const saved = await update(companyId, row, { $set: {
        status: STATUS.CONNECTED, secretHandles: handles, scopes, account, accessExpiresAt: lifetimeOf(answer.expires_in),
        connectedAt: new Date(), brokenReason: '', brokenAt: null, updatedBy: String(userId),
    } });
    audit(companyId, who, 'connector.connect', connector, { userId: String(userId), scopes });
    return view(connector, saved);
};

const close = (companyId, row, by, actor) => update(companyId, row, {
    $set: { status: STATUS.REVOKED, secretHandles: {}, deletedStatusKey: 1, disconnectedAt: new Date(), disconnectedBy: by, updatedBy: String(actorOf(actor).id || '') },
    $unset: { oauth: 1 },
});

/* Google is asked once to end the grant; whatever it answers, the tokens leave the store and the row closes. */
const disconnect = async ({ companyId, userId, connector, actor, by = BY.SELF }) => {
    const row = await find(companyId, userId, connector);
    const handles = Object.values((row && row.secretHandles) || {}).filter(Boolean);
    if (!row || !handles.length) throw new ConnectionError(404, 'There is no connection to end.', 'not_connected');
    const provider = await revokeAtGoogle({ companyId, actor, row });
    for (const handle of handles) {
        // eslint-disable-next-line no-await-in-loop
        await store.retire({ companyId, handle, actor });
    }
    await close(companyId, row, by, actor);
    audit(companyId, actor, 'connector.revoke', connector, { userId: String(userId), by, provider });
    return view(connector, null);
};

/* Called where a member is removed or deactivated. It never throws into that flow, and it reads nothing while
 * no Google connector is named. */
const memberDeparted = async (companyId, userId) => {
    const names = flag.requestedGoogle();
    if (!names.length || !OBJECT_ID.test(String(companyId || '')) || !userId) return 0;
    let ended = 0;
    try {
        const found = ((await MongoDbCrudOpration(String(companyId), { type: T, data: [{ userId: String(userId), connector: { $in: names }, deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
        for (const row of found) {
            const actor = { id: 'system' };
            // eslint-disable-next-line no-await-in-loop
            if (holdsToken(row)) await disconnect({ companyId: String(companyId), userId, connector: row.connector, actor, by: BY.MEMBER_REMOVED });
            // eslint-disable-next-line no-await-in-loop
            else await close(String(companyId), row, BY.MEMBER_REMOVED, actor);
            if (holdsToken(row)) ended += 1;
        }
    } catch (error) {
        logger.error(`${LOG} ending the Google connections of a departed member failed: ${(error && error.name) || 'Error'}`);
    }
    return ended;
};

const markBroken = async (companyId, row, reason) => {
    await update(companyId, row, { $set: { status: STATUS.BROKEN, brokenReason: String(reason || '').slice(0, 60), brokenAt: new Date() } });
    audit(companyId, null, 'connector.broken', row.connector, { userId: String(row.userId), reason: String(reason || '').slice(0, 60) });
};

/* What a later slice calls before each use: a handle to an access token that is good now, or the reason there
 * is none. The seat is checked every time, an expired token is refreshed with one attempt, and a connection
 * Google refused is not tried again until the person reconnects. */
const usableTokenHandle = async ({ companyId, userId, connector }) => {
    const none = (reason) => ({ handle: null, reason });
    if (!isConnector(connector) || !flag.status(connector).on) return none('off');
    if (!(await hasSeat(companyId, userId))) return none('no_seat');
    const row = await find(companyId, userId, connector);
    if (!holdsToken(row)) return none('not_connected');
    if (row.status === STATUS.BROKEN) return none('broken');
    const handles = row.secretHandles;
    // Revoking the refresh token from the stored-secrets screen ends the connection now, not when the access token runs out.
    const held = await store.describe({ companyId, handle: handles.refresh_token }).then(() => true).catch(() => false);
    if (!held) return none('token_unavailable');
    const fresh =handles.access_token && row.accessExpiresAt && new Date(row.accessExpiresAt).getTime() - EXPIRY_SKEW_MS > Date.now();
    if (fresh) {
        await update(companyId, row, { $set: { lastUsedAt: new Date() } });
        return { handle: handles.access_token, reason: '' };
    }
    const refreshToken = await store.resolve({ companyId, handle: handles.refresh_token }).catch(() => null);
    if (!refreshToken) return none('token_unavailable');
    const out = await api.refresh({ companyId, actor: userId, client: flag.googleClient(), refreshToken });
    if (!out.ok) {
        if (!api.isGrantRefused(out.error)) return none('refresh_failed');
        await markBroken(companyId, row, out.error);
        return none('broken');
    }
    if (typeof out.body.access_token !== 'string' || !out.body.access_token) return none('refresh_failed');
    const actor = { id: String(userId) };
    const next = { ...handles, access_token: await keep({ companyId, userId, connector, handle: handles.access_token, key: 'access_token', value: out.body.access_token, actor }) };
    if (typeof out.body.refresh_token === 'string' && out.body.refresh_token) {
        next.refresh_token = await keep({ companyId, userId, connector, handle: handles.refresh_token, key: 'refresh_token', value: out.body.refresh_token, actor });
    }
    await update(companyId, row, { $set: { secretHandles: next, accessExpiresAt: lifetimeOf(out.body.expires_in), lastRefreshedAt: new Date(), lastUsedAt: new Date() } });
    return { handle: next.access_token, reason: '' };
};

const membersWithConnections = async (companyId) => {
    const names = flag.requestedGoogle();
    const found = ((await MongoDbCrudOpration(companyId, { type: T, data: [{ connector: { $in: names }, deletedStatusKey: { $ne: 1 } }] }, 'find')) || []).map(plain);
    return found.filter(holdsToken).map(memberView);
};

module.exports = {
    CONNECTORS, CALLBACK_PATH, SECRET_KIND, STATUS, BY, STATE_TTL_SECONDS, ConnectionError,
    isConnector, fallbackOrigin, redirectUri, describe, start, returnFor, complete, disconnect, memberDeparted, usableTokenHandle, membersWithConnections,
};
