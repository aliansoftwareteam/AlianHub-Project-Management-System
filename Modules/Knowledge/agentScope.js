const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { RetrievalRefused } = require('./visibleSet');
const memoryFlag = require('./memory/flag');

// An agent retrieving during a run sees what the person who started the run can see, further
// limited to the agent's own projects (owner, 2026-09-18). The run is the one the caller names,
// read from agent_runs and still running: its agent and its starter are the ones the retrieval
// acts for, so a caller cannot borrow another agent's or another person's reach. The starter's
// side is the visible set itself; this narrows every list in it that is keyed by project, and
// marks the set project-bound so sources keyed by participation (calls) or by nothing (company
// pages) are held to the same projects. It applies with KNOWLEDGE_AGENT_MEMORY on, so a company
// with the switch off retrieves as it did before the rule.

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const RUNNING = 'running';
const PER_PROJECT_LISTS = ['projectIds', 'fileProjectIds'];

/* Owner decision pending. Elsewhere the app reads an agent with no projects as one that may work
 * in every project (policy.js, the MCP tools, the run starters); for knowledge retrieval the
 * starter ∩ agent-projects rule gives it nothing until the owner says otherwise. */
const projectsForAgentWithoutProjects = () => [];

/* Owner decision pending: whether an agent run reaches content that sits in no project, such as
 * company-level pages and calls filed under no project. Closed until the owner says otherwise. */
const agentsReachContentWithoutProject = () => false;

const oid = (id) => new mongoose.Types.ObjectId(String(id));

const runOf = async (set) => {
    const runId = String(set.caller.runId || '');
    if (!OBJECT_ID.test(runId)) throw new RetrievalRefused('An agent caller names its run.');
    const run = await MongoDbCrudOpration(set.companyId, {
        type: SCHEMA_TYPE.AGENT_RUNS,
        data: [{ _id: oid(runId), status: RUNNING }, 'agentId startedBy', { lean: true }],
    }, 'findOne');
    if (!run) throw new RetrievalRefused('The run is not running in this company.');
    return { runId, agentId: String(run.agentId || ''), startedBy: run.startedBy ? String(run.startedBy) : '' };
};

const narrowToAgent = async (set) => {
    if (!set || set.caller.kind !== 'agent') return set;
    if (!(await memoryFlag.enabledFor(set.companyId))) return set;
    const agentId = String(set.caller.agentId || '');
    if (!OBJECT_ID.test(agentId)) throw new RetrievalRefused('An agent caller names its agent.');
    const run = await runOf(set);
    if (run.agentId !== agentId) throw new RetrievalRefused('The run belongs to another agent.');
    if (run.startedBy && run.startedBy !== set.caller.userId) throw new RetrievalRefused('The run was started by someone else.');
    const agent = await MongoDbCrudOpration(set.companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ _id: oid(agentId), deletedStatusKey: { $ne: 1 } }, 'projectIds', { lean: true }],
    }, 'findOne');
    if (!agent) throw new RetrievalRefused('The agent does not exist in this company.');
    const own = (Array.isArray(agent.projectIds) ? agent.projectIds : []).map(String);
    const allowed = own.length ? own : projectsForAgentWithoutProjects(set.projectIds);
    const narrowed = {
        ...set,
        caller: { ...set.caller, agentId, runId: run.runId },
        starterId: run.startedBy,
        agentProjectIds: own,
        projectBound: true,
        reachesProjectless: agentsReachContentWithoutProject(),
    };
    PER_PROJECT_LISTS.forEach((list) => {
        narrowed[list] = (Array.isArray(set[list]) ? set[list] : []).filter((id) => allowed.includes(String(id)));
    });
    return narrowed;
};

module.exports = { PER_PROJECT_LISTS, projectsForAgentWithoutProjects, agentsReachContentWithoutProject, narrowToAgent };
