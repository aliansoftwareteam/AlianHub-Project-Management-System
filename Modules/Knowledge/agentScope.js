const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { RetrievalRefused } = require('./visibleSet');

// An agent retrieving during a run sees what the person who started the run can see, further
// limited to the agent's own projects (owner, 2026-09-18). The starter's side is the visible set
// itself; this narrows it by the agent row, read on every call like the rest of the set. An agent
// with no projects is not narrowed, the same reading policy.js gives it: it may read, not write.

const OBJECT_ID = /^[a-f0-9]{24}$/i;

const narrowToAgent = async (set) => {
    if (!set || set.caller.kind !== 'agent') return set;
    const agentId = String(set.caller.agentId || '');
    if (!OBJECT_ID.test(agentId)) throw new RetrievalRefused('An agent caller names its agent.');
    const agent = await MongoDbCrudOpration(set.companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ _id: new mongoose.Types.ObjectId(agentId), deletedStatusKey: { $ne: 1 } }, 'projectIds', { lean: true }],
    }, 'findOne');
    if (!agent) throw new RetrievalRefused('The agent does not exist in this company.');
    const own = (Array.isArray(agent.projectIds) ? agent.projectIds : []).map(String);
    const caller = { ...set.caller, agentId };
    if (!own.length) return { ...set, caller, agentProjectIds: [] };
    return { ...set, caller, agentProjectIds: own, projectIds: set.projectIds.filter((id) => own.includes(String(id))) };
};

module.exports = { narrowToAgent };
