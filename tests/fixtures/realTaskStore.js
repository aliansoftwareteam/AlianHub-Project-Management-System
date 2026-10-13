/* Sends a task write through Mongoose and the real task schema and hands back what reached the
 * driver, which is the form MongoDB would store. Nothing connects. fakeMongo is schemaless, so it
 * keeps whatever form a writer passed and cannot show what the schema converts. */
const mongoose = require('mongoose');
const { taskSchema } = require('../../utils/mongo-handler/createSchema');

const DRIVER_CALLS = ['insertOne', 'insertMany', 'updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'bulkWrite', 'find'];

const Task = mongoose.createConnection().model('tasks', taskSchema, 'tasks');
let sent = [];
DRIVER_CALLS.forEach((op) => {
    Task.collection[op] = async (...args) => {
        sent.push({ op, args });
        if (op === 'find') return { toArray: async () => [] };
        return op === 'findOneAndUpdate' ? null : { acknowledged: true, insertedCount: 1, insertedIds: {}, matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
    };
});

/* A save skips validation: the question is the stored form, and a writer's partial document would
 * otherwise stop before the driver. A save the stub answered can still reject afterwards. */
const driverWrites = async (method, data) => {
    sent = [];
    const run = method === 'save' ? () => new Task(data).save({ validateBeforeSave: false }) : () => Task[method](...data);
    let error = null;
    await run().catch((e) => { error = e; });
    const writes = sent;
    sent = [];
    return { writes, error };
};

const isObjectId = (value) => Boolean(value) && value._bsontype === 'ObjectId';

/* Every sprintArray a driver payload writes: whole objects, and the dotted id paths of an update. */
const sprintArraysIn = (payload, found = []) => {
    if (!payload || typeof payload !== 'object' || isObjectId(payload) || payload instanceof Date) return found;
    if (Array.isArray(payload)) { payload.forEach((item) => sprintArraysIn(item, found)); return found; }
    const doc = payload._doc && typeof payload.$__ === 'object' ? payload._doc : payload;
    Object.entries(doc).forEach(([key, value]) => {
        if (key === 'sprintArray' && value && typeof value === 'object') found.push(value);
        else if (key === 'sprintArray.id') found.push({ id: value });
        else if (key === 'sprintArray.folderId') found.push({ folderId: value });
        else sprintArraysIn(value, found);
    });
    return found;
};

module.exports = { Task, driverWrites, sprintArraysIn, isObjectId };
