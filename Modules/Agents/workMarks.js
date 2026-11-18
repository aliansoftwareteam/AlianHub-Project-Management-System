const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// The rows agents leave while they work: a place in a project, the one item a connection holds, the last read of
// a task, the turn to change one. There is one row per scope and key, and it changes hands only by a write that
// names the row as it was read, so of two callers reaching for the same row exactly one gets it.

const TYPE = SCHEMA_TYPE.AGENT_WORK_MARKS;
const NEVER = new Date(0);

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const isDuplicateKey = (e) => Boolean(e && (e.code === 11000 || /duplicate key|E11000/i.test(e.message || '')));

/* One connection acting for one person: a personal token, or an outside client's grant. */
const connectionOf = (actor) => {
    if (actor && actor.grantId) return `grant:${actor.grantId}`;
    return actor && actor.tokenId ? `token:${actor.tokenId}` : '';
};

const readerOf = (actor) => connectionOf(actor) || (actor && actor.agentId ? `agent:${actor.agentId}` : '');

const marksIn = async (companyId, scope) => ((await MongoDbCrudOpration(companyId, { type: TYPE, data: [{ scope }] }, 'find')) || []).map(plain);

const markAt = async (companyId, scope, key) => plain(await MongoDbCrudOpration(companyId, { type: TYPE, data: [{ scope, key: String(key) }] }, 'findOne'));

/* `was` is the row as the caller read it, or null where it read none. Answers null when another caller got there first. */
const take = async (companyId, scope, key, was, set) => {
    if (was) {
        return plain(await MongoDbCrudOpration(companyId, {
            type: TYPE, data: [{ _id: was._id, rev: Number(was.rev || 0) }, { $set: set, $inc: { rev: 1 } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate'));
    }
    try {
        return plain(await MongoDbCrudOpration(companyId, { type: TYPE, data: { scope, key: String(key), rev: 1, ...set } }, 'save'));
    } catch (e) {
        if (isDuplicateKey(e)) return null;
        throw e;
    }
};

const giveUp = (companyId, filter) => MongoDbCrudOpration(companyId, {
    type: TYPE, data: [filter, { $set: { by: '', ref: '', at: NEVER, until: NEVER }, $inc: { rev: 1 } }],
}, 'updateMany');

module.exports = { connectionOf, readerOf, marksIn, markAt, take, giveUp };
