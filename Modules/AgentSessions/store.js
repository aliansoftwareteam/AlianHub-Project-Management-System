const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { OPEN } = require('./rules');
const { LIMITS } = require('./config');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const toOid = (id) => (OBJECT_ID.test(String(id || '')) ? new mongoose.Types.ObjectId(String(id)) : null);
const plain = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);
const withCompany = (companyId, doc) => (doc ? { ...plain(doc), companyId: String(companyId) } : null);

const sessions = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.AGENT_SESSIONS, data }, method);

const create = async (companyId, row) => withCompany(companyId, await sessions(companyId, row, 'save'));

const find = async (companyId, id) => {
    const _id = toOid(id);
    return _id ? withCompany(companyId, await sessions(companyId, [{ _id }], 'findOne')) : null;
};

const forTask = async (companyId, taskId, limit = 5) => ((await sessions(companyId, [{ taskId: String(taskId) }, null, { sort: { createdAt: -1 }, limit }], 'find')) || [])
    .map((row) => withCompany(companyId, row));

const forStep = async (companyId, runId, stepId) => {
    const [row] = (await sessions(companyId, [{ workflowRunId: String(runId), workflowStepId: String(stepId) }, null, { sort: { createdAt: -1 }, limit: 1 }], 'find')) || [];
    return withCompany(companyId, row);
};

const openRows = async (companyId, extra = {}) => ((await sessions(companyId, [{ state: { $in: [...OPEN] }, ...extra }], 'find')) || [])
    .map((row) => withCompany(companyId, row));

/* Moves a session only from the states named, so two closers cannot both win. Answers the row after, or null. */
const transition = async (companyId, id, from, set, extra = {}) => {
    const _id = toOid(id);
    if (!_id) return null;
    return withCompany(companyId, await sessions(companyId, [
        { ...extra, _id, state: { $in: [].concat(from) } },
        { $set: set },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate'));
};

const markDelivered = async (companyId, id, at) => withCompany(companyId, await sessions(companyId, [
    { _id: toOid(id), deliveredAt: { $exists: false } },
    { $set: { deliveredAt: at } },
    { returnDocument: 'after' },
], 'findOneAndUpdate'));

/* The first activity also takes an offered session up; a later one needs it still open. */
const appendActivity = async (companyId, id, activity) => {
    const _id = toOid(id);
    if (!_id) return null;
    const push = { activities: { $each: [activity], $slice: -LIMITS.activitiesKept } };
    const deadline = new Date(new Date(activity.at).getTime() - LIMITS.firstActivityMs);
    const taken = await sessions(companyId, [
        { _id, state: OPEN[0], $or: [{ deliveredAt: { $exists: false } }, { deliveredAt: { $gte: deadline } }] },
        { $set: { state: OPEN[1], firstActivityAt: activity.at, lastActivityAt: activity.at, handleHash: '' }, $push: push, $inc: { activityCount: 1 } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    if (taken) return { session: withCompany(companyId, taken), first: true };
    const added = await sessions(companyId, [
        { _id, state: OPEN[1] },
        { $set: { lastActivityAt: activity.at }, $push: push, $inc: { activityCount: 1 } },
        { returnDocument: 'after' },
    ], 'findOneAndUpdate');
    return added ? { session: withCompany(companyId, added), first: false } : null;
};

const endpoints = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS, data }, method);

const endpointFor = async (companyId, clientId) => plain(await endpoints(companyId, [{ clientId: String(clientId) }], 'findOne'));

const listEndpoints = async (companyId) => ((await endpoints(companyId, [{}, { secret: 0 }, { sort: { updatedAt: -1 } }], 'find')) || []).map(plain);

const saveEndpoint = async (companyId, clientId, fields) => plain(await endpoints(companyId, [
    { clientId: String(clientId) },
    { $set: fields, $setOnInsert: { clientId: String(clientId) } },
    { upsert: true, returnDocument: 'after' },
], 'findOneAndUpdate'));

module.exports = { toOid, create, find, forTask, forStep, openRows, transition, markDelivered, appendActivity, endpointFor, listEndpoints, saveEndpoint };
