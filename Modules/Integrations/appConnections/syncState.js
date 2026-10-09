const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const backoff = require('./backoff');

const HANDLED_KEPT = 2000;
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

/* The claim is one conditional write: whoever pushes the key first acts, and every later try finds it there. */
const claimer = (companyId, connection) => async (key) => {
    const won = await MongoDbCrudOpration(companyId, {
        type: T,
        data: [{ _id: connection._id, [path('handled')]: { $ne: key } }, { $push: { [path('handled')]: { $each: [key], $slice: -HANDLED_KEPT } } }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
    return !!won;
};

module.exports = { record, lease, claimer, HANDLED_KEPT };
