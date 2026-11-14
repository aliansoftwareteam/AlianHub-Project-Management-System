const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const secrets = require('../../Config/secrets');
const { recordAudit } = require('../Audit/recorder');
const api = require('./providerApi');

const SECRET_KIND = 'connector_app';
const MAX_CLIENT_ID = 400;
const METHOD = Object.freeze({ DCR: 'dcr' });

const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const db = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_REGISTRATIONS, data }, method);
const find = async (companyId, provider) => plain(await db(companyId, [{ companyId: String(companyId), provider: String(provider) }], 'findOne'));

const audit = (companyId, actor, action, definition, meta = {}) => recordAudit(String(companyId), {
    actorId: String(actor || 'system'), action, entityType: 'connector', entityId: String(definition.id), entityName: definition.name, meta,
});

const appOf = async (companyId, row) => {
    const clientSecret = row.secretHandle ? await secrets.resolve({ companyId: String(companyId), handle: row.secretHandle }) : '';
    if (clientSecret === null) return null;
    return { source: 'registered', appId: String(row._id), clientId: row.clientId, clientSecret };
};

/* An MCP server that signs clients up itself is asked once per workspace, and every member and session reuses that
 * client: registering per member or per session leaves the server holding orphaned grants and signs people out.
 * The server checks the callback against the one registered, so a changed APIURL registers again. */
const resolve = async ({ companyId, definition, redirectUri, actor }) => {
    const existing = await find(companyId, definition.id);
    if (existing && existing.redirectUri === redirectUri) {
        const app = await appOf(companyId, existing);
        if (app) return { ok: true, app };
    }
    const out = await api.register({ definition, companyId, actor, redirectUri });
    if (!out.ok) return { ok: false, error: out.error };
    const clientId = typeof out.body.client_id === 'string' ? out.body.client_id.trim() : '';
    if (!clientId || clientId.length > MAX_CLIENT_ID) return { ok: false, error: api.ERROR.BAD_RESPONSE };
    const secret = typeof out.body.client_secret === 'string' ? out.body.client_secret : '';
    const who = { id: String(actor || 'system') };
    const secretHandle = secret
        ? (await secrets.create({ companyId: String(companyId), name: `${definition.name} registered client`, kind: SECRET_KIND, value: secret, actor: who })).handle
        : '';
    if (existing && existing.secretHandle) await secrets.retire({ companyId: String(companyId), handle: existing.secretHandle, actor: who }).catch(() => {});
    const fields = {
        companyId: String(companyId), provider: definition.id, clientId, secretHandle, method: METHOD.DCR, redirectUri,
        registeredBy: who.id, registeredAt: new Date(),
    };
    const saved = plain(await db(companyId, [{ companyId: String(companyId), provider: definition.id }, { $set: fields }, { upsert: true, returnDocument: 'after' }], 'findOneAndUpdate'));
    audit(companyId, who.id, 'connector.app_registered', definition, { method: METHOD.DCR });
    return { ok: true, app: { source: 'registered', appId: String(saved._id), clientId, clientSecret: secret } };
};

/* A server that no longer knows our client answers invalid_client; the registration is dropped so the next connect
 * registers once more instead of failing for good. */
const forget = async ({ companyId, definition, actor }) => {
    const existing = await find(companyId, definition.id);
    if (!existing) return false;
    const who = { id: String(actor || 'system') };
    if (existing.secretHandle) await secrets.retire({ companyId: String(companyId), handle: existing.secretHandle, actor: who }).catch(() => {});
    await db(companyId, [{ _id: existing._id }], 'deleteOne');
    audit(companyId, who.id, 'connector.app_registration_dropped', definition, {});
    return true;
};

module.exports = { resolve, forget, METHOD };
