/* Sends a write through Mongoose and one real schema and hands back what reached the driver, which
 * is the form MongoDB would store. Nothing connects. fakeMongo is schemaless, so it keeps whatever
 * form a writer passed and cannot show what the schema converts. */
const mongoose = require('mongoose');

const DRIVER_CALLS = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'bulkWrite', 'find'];

const isObjectId = (value) => Boolean(value) && value._bsontype === 'ObjectId';

const realModelStore = (name, schema) => {
    const Model = mongoose.createConnection().model(name, schema, name);
    let sent = [];
    DRIVER_CALLS.forEach((op) => {
        Model.collection[op] = async (...args) => {
            sent.push({ op, args });
            if (op === 'find') return { toArray: async () => [] };
            return op === 'findOneAndUpdate' ? null : { acknowledged: true, insertedCount: 1, insertedIds: {}, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
        };
    });

    /* A save skips validation: the question is the stored form, not whether a partial document is complete. */
    const driverWrites = async (method, data) => {
        sent = [];
        const run = method === 'save' ? () => new Model(data).save({ validateBeforeSave: false }) : () => Model[method](...data);
        let error = null;
        await run().catch((e) => { error = e; });
        const writes = sent;
        sent = [];
        return { writes, error };
    };

    return { Model, driverWrites };
};

module.exports = { realModelStore, isObjectId };
