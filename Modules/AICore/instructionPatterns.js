const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { FLAGS, MAX_LENGTH, MAX_REPEATS, MAX_REPEAT_BOUND } = require('./instructionPatternRules');

const COLLECTION = SCHEMA_TYPE.INSTRUCTION_PATTERNS;
const CACHE_TTL_SECONDS = 30;
const MAX_PATTERNS = 100;
const MAX_NOTE = 200;

const run = (data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type: COLLECTION, data }, method);

let compiled = [];
let loadedAt = null;
let loading = null;

const stale = () => loadedAt === null || Date.now() - loadedAt >= CACHE_TTL_SECONDS * 1000;

/* A stored row that no longer compiles is skipped rather than failing the whole list. */
const compile = (rows) => (Array.isArray(rows) ? rows : []).flatMap((row) => {
    if (!row || typeof row.source !== 'string') return [];
    try {
        return [{ id: String(row._id), source: row.source, re: new RegExp(row.source, FLAGS) }];
    } catch (error) {
        logger.error(`instruction patterns: stored pattern ${row._id} does not compile, skipped`);
        return [];
    }
});

const list = () => run([{}, 'source note addedBy addedAt', { sort: { addedAt: 1, _id: 1 } }], 'find');

/* Reads the list once per window. A failed read keeps the last list it had and tries again on the next call. */
const fresh = () => {
    if (!stale()) return Promise.resolve(compiled);
    if (!loading) {
        loading = list()
            .then((rows) => {
                compiled = compile(rows);
                loadedAt = Date.now();
                return compiled;
            })
            .catch((error) => {
                logger.error(`instruction patterns: could not be read, keeping the last list: ${error.message || error}`);
                return compiled;
            })
            .finally(() => { loading = null; });
    }
    return loading;
};

const current = () => compiled;

const invalidate = () => { loadedAt = null; };

const count = (filter = {}) => run([filter], 'countDocuments').then(Number);

const add = async ({ source, note, addedBy }) => {
    const row = await run({ source, note: String(note || '').trim().slice(0, MAX_NOTE), addedBy: String(addedBy || ''), addedAt: new Date() }, 'save');
    invalidate();
    return row;
};

const remove = async (id) => {
    const row = await run([{ _id: new mongoose.Types.ObjectId(String(id)) }], 'findOneAndDelete');
    invalidate();
    return row;
};

module.exports = { COLLECTION, CACHE_TTL_SECONDS, MAX_PATTERNS, MAX_NOTE, MAX_LENGTH, MAX_REPEATS, MAX_REPEAT_BOUND, fresh, current, invalidate, list, count, add, remove };
