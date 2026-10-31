const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const secrets = require('../../Config/secrets');
const { recordAudit } = require('../Audit/recorder');
const registry = require('./registry');

const SECRET_KIND = 'connector_app';
const MAX_CLIENT_ID = 400;
const MAX_CLIENT_SECRET = secrets.MAX_VALUE_LENGTH;
const MAX_EXTRA_KEYS = 20;
const MAX_EXTRA_VALUE = 400;

const CODE = Object.freeze({
    INVALID: 'invalid_app',
    UNKNOWN_PROVIDER: 'unknown_provider',
    NOT_FOUND: 'app_not_found',
    CONFLICT: 'app_conflict',
    SECRET_UNREADABLE: 'app_secret_unreadable',
});
const STATUS_BY_CODE = { invalid_app: 400, unknown_provider: 404, app_not_found: 404, app_conflict: 409, app_secret_unreadable: 503 };

const isDuplicateKey = (error) => !!error && (error.code === 11000 || /E11000|duplicate key/i.test(String(error.message || '')));

class AppError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.statusCode = STATUS_BY_CODE[code] || 500;
    }
}

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const appsDb = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_APPS, data }, method);
const connectionsDb = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_CONNECTIONS, data }, method);

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/* The instance default (FR-4). `google` reads CONNECTOR_GOOGLE_CLIENT_*, the same names the Google connector
 * already uses, so an existing instance keeps working without renaming anything. */
const instanceApp = (provider) => {
    const prefix = `CONNECTOR_${String(provider || '').toUpperCase()}_CLIENT_`;
    const clientId = text(process.env[`${prefix}ID`]);
    const clientSecret = text(process.env[`${prefix}SECRET`]);
    return clientId && clientSecret ? { source: 'instance', appId: null, clientId, clientSecret } : null;
};

const row = async (companyId, provider) => plain(await appsDb(companyId, [{ companyId: String(companyId), provider: String(provider) }], 'findOne'));

/* The provider ids a workspace has its own app for; registry.offered uses it to add providers the instance
 * does not set but a company does. */
const companyProviders = async (companyId) => ((await appsDb(companyId, [{ companyId: String(companyId) }, { provider: 1 }], 'find')) || []).map(plain).map((r) => r.provider);

const publicApp = (r) => ({ provider: r.provider, clientId: r.clientId, extra: r.extra || {}, setBy: r.setBy, createdAt: r.createdAt, updatedAt: r.updatedAt });

const describeApps = async (companyId) => ((await appsDb(companyId, [{ companyId: String(companyId) }, { secretHandle: 0 }, { sort: { provider: 1 } }], 'find')) || []).map(plain).map(publicApp);

/* Server-internal: the only path that yields the client secret, for 066's authorize and token calls. Company
 * app wins over the instance default (FR-5). */
const resolveApp = async ({ companyId, provider } = {}) => {
    const existing = await row(companyId, provider);
    if (existing) {
        const clientSecret = await secrets.resolve({ companyId, handle: existing.secretHandle });
        if (clientSecret === null) throw new AppError(CODE.SECRET_UNREADABLE, `The ${provider} app secret cannot be read.`);
        return { source: 'company', appId: String(existing._id), clientId: existing.clientId, clientSecret, extra: existing.extra || {} };
    }
    const instance = instanceApp(provider);
    if (!instance) throw new AppError(CODE.NOT_FOUND, `No OAuth app is set for ${provider}.`);
    return instance;
};

const extraProblems = (extra) => {
    if (extra === undefined || extra === null) return [];
    if (typeof extra !== 'object' || Array.isArray(extra)) return ['extra must be an object of browser-safe values'];
    const keys = Object.keys(extra);
    if (keys.length > MAX_EXTRA_KEYS) return [`extra has more than ${MAX_EXTRA_KEYS} values`];
    return keys.some((k) => typeof extra[k] !== 'string' || extra[k].length > MAX_EXTRA_VALUE) ? ['each extra value is a string of at most 400 characters'] : [];
};

const appProblems = ({ provider, clientId, clientSecret, extra }) => {
    const problems = [];
    if (!registry.get(provider)) problems.push(`unknown provider ${provider}`);
    const id = text(clientId);
    if (!id) problems.push('clientId is required');
    else if (id.length > MAX_CLIENT_ID) problems.push(`clientId is longer than ${MAX_CLIENT_ID} characters`);
    const secret = text(clientSecret);
    if (!secret) problems.push('clientSecret is required');
    else if (secret.length > MAX_CLIENT_SECRET) problems.push(`clientSecret is longer than ${MAX_CLIENT_SECRET} characters`);
    problems.push(...extraProblems(extra));
    return problems;
};

/* A company app that changes or goes away can no longer mint tokens for the connections it issued, so they are
 * sent back through connect (FR-6). Rows issued by the instance app are left alone. */
const markReauth = async (companyId, provider) => {
    await connectionsDb(companyId, [
        { provider: String(provider), 'app.source': 'company', status: 'connected', deletedStatusKey: { $ne: 1 } },
        { $set: { status: 'reauth_required' } },
    ], 'updateMany');
};

const actorIdOf = (actor) => String((actor && typeof actor === 'object' ? actor.id : actor) || '');

/* Set or replace a workspace's own OAuth app for one provider. The secret goes to the secrets store by handle
 * and is never written to this row, returned or logged; without a usable store the create refuses (FR-16). */
const setApp = async ({ companyId, provider, clientId, clientSecret, extra, actor } = {}) => {
    const problems = appProblems({ provider, clientId, clientSecret, extra });
    if (problems.length) throw new AppError(CODE.INVALID, problems.join('; '));
    const id = String(companyId);
    const name = `${provider} OAuth app`;
    const existing = await row(id, provider);
    const now = new Date();
    const cleanExtra = extra && Object.keys(extra).length ? { ...extra } : undefined;

    let secretHandle;
    if (existing) {
        secretHandle = existing.secretHandle;
        await secrets.rotate({ companyId: id, handle: secretHandle, value: clientSecret, actor });
        // An omitted `extra` on replace clears the old one, so the row only ever holds what was last sent.
        const set = { clientId: text(clientId), setBy: actorIdOf(actor), updatedAt: now };
        const change = cleanExtra ? { $set: { ...set, extra: cleanExtra } } : { $set: set, $unset: { extra: '' } };
        await appsDb(id, [{ _id: existing._id }, change], 'updateOne');
    } else {
        const meta = await secrets.create({ companyId: id, name, kind: SECRET_KIND, value: clientSecret, actor });
        secretHandle = meta.handle;
        // The unique index closes the window between the read above and this write; a racing create would
        // leave this secret behind, so it is retired before the conflict is reported.
        try {
            await appsDb(id, { companyId: id, provider: String(provider), clientId: text(clientId), secretHandle, ...(cleanExtra ? { extra: cleanExtra } : {}), setBy: actorIdOf(actor), createdAt: now, updatedAt: now }, 'save');
        } catch (error) {
            await secrets.retire({ companyId: id, handle: secretHandle, actor }).catch(() => {});
            if (isDuplicateKey(error)) throw new AppError(CODE.CONFLICT, `An app for ${provider} was just set; try again.`);
            throw error;
        }
    }

    await markReauth(id, provider);
    recordAudit(id, { actorId: actorIdOf(actor), actorName: String((actor && actor.name) || ''), ...(actor && actor.ip ? { ip: String(actor.ip) } : {}), action: 'connector.app_set', entityType: 'connector_app', entityId: String(provider), entityName: name, meta: { provider: String(provider), op: existing ? 'replace' : 'set', secretHandle } });
    return { provider: String(provider), op: existing ? 'replace' : 'set' };
};

/* Remove a workspace's own app; its connections go back to the instance default and must reconnect (FR-6). */
const removeApp = async ({ companyId, provider, actor } = {}) => {
    const id = String(companyId);
    const existing = await row(id, provider);
    if (!existing) throw new AppError(CODE.NOT_FOUND, `No ${provider} app is set for this workspace.`);
    await secrets.retire({ companyId: id, handle: existing.secretHandle, actor });
    await appsDb(id, [{ _id: existing._id }], 'deleteOne');
    await markReauth(id, provider);
    recordAudit(id, { actorId: actorIdOf(actor), actorName: String((actor && actor.name) || ''), ...(actor && actor.ip ? { ip: String(actor.ip) } : {}), action: 'connector.app_removed', entityType: 'connector_app', entityId: String(provider), entityName: `${provider} OAuth app`, meta: { provider: String(provider) } });
    return { provider: String(provider), op: 'remove' };
};

module.exports = { CODE, AppError, instanceApp, resolveApp, companyProviders, describeApps, appProblems, setApp, removeApp };
