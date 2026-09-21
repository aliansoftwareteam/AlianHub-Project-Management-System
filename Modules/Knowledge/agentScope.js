const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { RetrievalRefused } = require('./visibleSet');
const memoryFlag = require('./memory/flag');

// An agent retrieving during a run sees what the person who started the run can see, further
// limited to the agent's own projects (owner, 2026-09-18). The starter's side is the visible set
// itself; this narrows every list in it that is keyed by project, by the agent row, read on every
// call like the rest of the set. It applies with KNOWLEDGE_AGENT_MEMORY on, so a company with the
// switch off retrieves as it did before the rule.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const PER_PROJECT_LISTS = ['projectIds', 'fileProjectIds'];

/* Owner decision pending. Elsewhere the app reads an agent with no projects as one that may work
 * in every project (policy.js, the MCP tools, the run starters); for knowledge retrieval the
 * starter ∩ agent-projects rule gives it nothing until the owner says otherwise. */
const projectsForAgentWithoutProjects = () => [];

const narrowToAgent = async (set) => {
    if (!set || set.caller.kind !== 'agent') return set;
    if (!(await memoryFlag.enabledFor(set.companyId))) return set;
    const agentId = String(set.caller.agentId || '');
    if (!OBJECT_ID.test(agentId)) throw new RetrievalRefused('An agent caller names its agent.');
    const agent = await MongoDbCrudOpration(set.companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ _id: new mongoose.Types.ObjectId(agentId), deletedStatusKey: { $ne: 1 } }, 'projectIds', { lean: true }],
    }, 'findOne');
    if (!agent) throw new RetrievalRefused('The agent does not exist in this company.');
    const own = (Array.isArray(agent.projectIds) ? agent.projectIds : []).map(String);
    const allowed = own.length ? own : projectsForAgentWithoutProjects(set.projectIds);
    const narrowed = { ...set, caller: { ...set.caller, agentId }, agentProjectIds: own };
    PER_PROJECT_LISTS.forEach((list) => {
        narrowed[list] = (Array.isArray(set[list]) ? set[list] : []).filter((id) => allowed.includes(String(id)));
    });
    return narrowed;
};

module.exports = { PER_PROJECT_LISTS, projectsForAgentWithoutProjects, narrowToAgent };
