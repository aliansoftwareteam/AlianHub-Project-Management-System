const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { recordAudit } = require('../Audit/recorder');
const socketEmitter = require('../../event/socketEventEmitter');
const registry = require('./registry');

/* A row means the app is off for the workspace; turning it back on deletes the row, so every connection, permission
 * and tool state that was there before comes back untouched. */

const db = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.CONNECTOR_SWITCHES, data }, method);

const offList = async (companyId) => ((await db(companyId, [{ companyId: String(companyId) }], 'find')) || []).map((row) => String(row.provider));

const isOff = async (companyId, provider) => Boolean(await db(companyId, [{ companyId: String(companyId), provider: String(provider) }], 'findOne'));

const set = async ({ companyId, provider, on, actor }) => {
    const definition = registry.get(provider);
    if (on) await db(companyId, [{ companyId: String(companyId), provider: String(provider) }], 'deleteMany');
    else {
        await db(companyId, [
            { companyId: String(companyId), provider: String(provider) },
            { $set: { setBy: String(actor.id), setAt: new Date() } },
            { upsert: true },
        ], 'updateOne');
    }
    recordAudit(String(companyId), {
        actorId: String(actor.id), ...(actor.ip ? { ip: String(actor.ip) } : {}),
        action: 'connector.app_switched', entityType: 'connector', entityId: String(provider), entityName: definition ? definition.name : String(provider), meta: { on: Boolean(on) },
    });
    socketEmitter.emit('update', {
        type: 'update', module: 'connector', companyId: String(companyId),
        data: { provider: String(provider), change: on ? 'app_on' : 'app_off' },
        actor: { kind: 'person' }, depth: 1,
    });
    return { off: await offList(companyId) };
};

module.exports = { offList, isOff, set };
