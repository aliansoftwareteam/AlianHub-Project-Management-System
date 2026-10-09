const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const backoff = require('./backoff');

const DUPLICATE_KEY = 11000;
const T = SCHEMA_TYPE.INTEGRATION_CONNECTIONS;

const inSync = (fields) => Object.fromEntries(Object.entries(fields).map(([name, value]) => [['sync', name].join('.'), value]));
const path = (name) => ['sync', name].join('.');

const record = (companyId, id, fields) => MongoDbCrudOpration(companyId, {
    type: T, data: [{ _id: id }, { $set: inSync(fields) }, { returnDocument: 'after' }],
}, 'findOneAndUpdate');

/* A lease on the row, so two servers (or a slow run and the next tick) never poll the same connection together. */
const lease = async (companyId, connection, now) => {
    const held = await MongoDbCrudOpration(companyId, {
        type: T,
        data: [{ _id: connection._id, deletedStatusKey: { $ne: 1 }, $or: [{ [path('lockUntil')]: { $exists: false } }, { [path('lockUntil')]: null }, { [path('lockUntil')]: { $lt: new Date(now) } }] },
            { $set: inSync({ lockUntil: new Date(now + backoff.LEASE_MS) }) }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    return held || null;
};

/* Whoever inserts the event's row first acts; the unique key turns every later try away, however old the event. */
const claimer = (companyId, connection) => async (key, taskId) => {
    try {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.APP_CONNECTION_EVENTS, data: { key: String(key), connectionId: String(connection._id), taskId: taskId ? String(taskId) : undefined },
        }, 'save');
        return true;
    } catch (error) {
        if (error && (error.code === DUPLICATE_KEY || /E11000/.test(String(error.message)))) return false;
        throw error;
    }
};

module.exports = { record, lease, claimer };
