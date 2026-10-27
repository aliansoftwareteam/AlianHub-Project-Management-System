const WRITE_EVERY_MS = 60 * 60 * 1000;
const FLUSH_EVERY_MS = 5 * 60 * 1000;
const OBJECT_ID = /^[a-f0-9]{24}$/i;

const lastWritten = new Map();
const pending = new Map();
let timer = null;

let write = (seen) => {
    const mongoose = require('mongoose');
    const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
    const { SCHEMA_TYPE } = require('./schemaType');
    const ops = seen.map(([uid, at]) => ({ updateOne: { filter: { _id: new mongoose.Types.ObjectId(uid) }, update: { $set: { lastSeenAt: new Date(at) } } } }));
    return MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.USERS, data: [ops, { ordered: false }] }, 'bulkWrite');
};

/* Writes what was noted since the last flush in one bulk write, off every request path. */
async function flushSeen() {
    const seen = [...pending];
    pending.clear();
    if (!seen.length) return 0;
    try {
        await write(seen);
        seen.forEach(([uid, at]) => lastWritten.set(uid, at));
        return seen.length;
    } catch (error) {
        seen.forEach(([uid, at]) => { if (!pending.has(uid)) pending.set(uid, at); });
        require('./loggerConfig').error(`lastSeenAt: ${seen.length} not written: ${error && error.message ? error.message : error}`);
        return 0;
    }
}

const startFlushing = () => {
    if (timer) return;
    timer = setInterval(() => { flushSeen(); }, FLUSH_EVERY_MS);
    if (timer.unref) timer.unref();
};

/* Hosted only, for the platform usage report (062 T6). A request only notes the moment in memory;
 * the database is written every few minutes, at most once an hour per person and process. */
function noteSeen(uid, now = Date.now()) {
    const id = String(uid || '');
    if (!OBJECT_ID.test(id) || !require('./hostingMode').isManaged()) return false;
    const last = lastWritten.get(id);
    if (last && now - last < WRITE_EVERY_MS) return false;
    pending.set(id, now);
    startFlushing();
    return true;
}

module.exports = {
    noteSeen, flushSeen, WRITE_EVERY_MS, FLUSH_EVERY_MS,
    _useWriterForTests: (next) => { write = next; lastWritten.clear(); pending.clear(); clearInterval(timer); timer = null; },
};
