const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');

const LIVE = 0;
const ARCHIVED = 2;
const SOCKET_MODULE = 'goals';

const crud = (companyId, data, method) => MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.GOALS, data }, method);

/* Only the fact of a change leaves the server: which goal it was would tell a member about goals they cannot read. */
const announce = (type, companyId) => socketEmitter.emit(type, { type, companyId, module: SOCKET_MODULE });

/* Lands only on the revision that was read, and answers null when another write got there first. */
const writeAtRevision = (companyId, goal, set) => crud(companyId, [
    { _id: goal._id, revision: Number(goal.revision) || 0 },
    { $set: set, $inc: { revision: 1 } },
    { returnDocument: 'after', lean: true },
], 'findOneAndUpdate');

module.exports = { LIVE, ARCHIVED, crud, announce, writeAtRevision };
