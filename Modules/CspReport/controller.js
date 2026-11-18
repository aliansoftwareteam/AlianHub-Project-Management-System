const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { keysOf } = require('./reportRules');

// Anyone can post here, so a flood of made-up hosts stops growing the collection at this many rows a day,
// and one address may add only a few of them.
const MAX_ROWS_PER_DAY = 2000;
const MAX_NEW_KEYS_PER_ADDRESS = 50;
const MAX_TRACKED_ADDRESSES = 20000;
const DUPLICATE_KEY = 11000;

let trackedDay = '';
let newKeysByAddress = new Map();

const newKeysToday = (address, day) => {
    const stamp = day.toISOString();
    if (stamp !== trackedDay || newKeysByAddress.size > MAX_TRACKED_ADDRESSES) {
        trackedDay = stamp;
        newKeysByAddress = new Map();
    }
    return newKeysByAddress.get(address) || 0;
};

const crud = (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: SCHEMA_TYPE.CSP_REPORTS, data }, method);

const count = (key, at, options) => crud([key, { $inc: { count: 1 }, $set: { lastSeen: at } }, ...(options ? [options] : [])], 'updateOne');

const record = async (key, at, address) => {
    const counted = await count(key, at);
    if (counted && (counted.matchedCount || counted.modifiedCount)) return;
    const added = newKeysToday(address, key.day);
    if (added >= MAX_NEW_KEYS_PER_ADDRESS) return;
    if (await crud([{ day: key.day }], 'countDocuments') >= MAX_ROWS_PER_DAY) return;
    newKeysByAddress.set(address, added + 1);
    try {
        await count(key, at, { upsert: true });
    } catch (error) {
        if (!error || error.code !== DUPLICATE_KEY) throw error;
        await count(key, at);
    }
};

/* Parsed here and not by the app's JSON parser: a JSON error quotes the start of the body, and the app's
 * error handler logs the message. */
const parse = (raw) => {
    try {
        return { body: JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : '') };
    } catch {
        return null;
    }
};

exports.MAX_ROWS_PER_DAY = MAX_ROWS_PER_DAY;
exports.MAX_NEW_KEYS_PER_ADDRESS = MAX_NEW_KEYS_PER_ADDRESS;
exports.resetAddressCounts = () => { trackedDay = ''; newKeysByAddress = new Map(); };

exports.receive = async (req, res) => {
    const parsed = parse(req.body);
    if (!parsed) return res.status(400).end();
    const at = new Date();
    try {
        for (const key of keysOf(parsed.body, at)) await record(key, at, String(req.ip || ''));
    } catch (error) {
        logger.error(`csp report not recorded: ${(error && error.message) || error}`);
    }
    return res.status(204).end();
};
