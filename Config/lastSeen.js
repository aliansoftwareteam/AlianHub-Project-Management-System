const WRITE_EVERY_MS = 60 * 60 * 1000;
const lastWritten = new Map();

let write = (uid, at) => {
    const mongoose = require('mongoose');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('./schemaType');
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: new mongoose.Types.ObjectId(String(uid)) }, { $set: { lastSeenAt: at } }] }, 'updateOne');
};

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* At most one write an hour per person and process: daily and monthly active counts need no finer
 * grain, and a write per request would double the load of every call. Never delays or fails the request. */
function noteSeen(uid, now = Date.now()) {
    const id = String(uid || '');
    if (!OBJECT_ID.test(id)) return false;
    const last = lastWritten.get(id);
    if (last && now - last < WRITE_EVERY_MS) return false;
    lastWritten.set(id, now);
    Promise.resolve().then(() => write(id, new Date(now))).catch((error) => {
        lastWritten.delete(id);
        require('./loggerConfig').error(`lastSeenAt ${id}: ${error && error.message ? error.message : error}`);
    });
    return true;
}

module.exports = { noteSeen, WRITE_EVERY_MS, _useWriterForTests: (next) => { write = next; lastWritten.clear(); } };
