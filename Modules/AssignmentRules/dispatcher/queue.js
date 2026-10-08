const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const projectLimits = require('../../Agents/projectLimits');

// The role's queue is the agents' work queue (Modules/Agents/manager/workQueue.js): a handed-over row with the role in its
// facts. Only the row is written; the task's assignees stay as they were.

const plain = (row) => (row && typeof row.toObject === 'function' ? row.toObject() : row);
const find = async (companyId, type, data) => ((await MongoDbCrudOpration(companyId, { type, data }, 'find')) || []).map(plain);

/* Agents are held back in a project paused for them, and connected agents everywhere when the workspace pauses them. */
const paused = async (companyId, projectId) => {
    if ((await projectLimits.read(companyId, projectId)).paused) return true;
    return require('../../Agents/accounts').connectedPaused(companyId);
};

const queueRows = (companyId, task) => {
    const { HANDED_OVER } = require('../../Agents/manager/findings');
    return find(companyId, SCHEMA_TYPE.PROJECT_FINDINGS, [{ projectId: { $in: idForms([String(task.ProjectID)]) }, key: `${HANDED_OVER}:${task._id}` }]);
};

/* Where the task stands in the queue: `role` while an open row holds it, `left` once a row was finished, withdrawn
 * or taken back, which only a person may undo by routing it again. */
const standing = async (companyId, task) => {
    const { STATUS } = require('../../Agents/manager/findings');
    const rows = await queueRows(companyId, task);
    const open = rows.find((row) => row.status === STATUS.OPEN && !row.leftQueue);
    return { role: (open && open.facts && open.facts.role) || '', left: rows.some((row) => Boolean(row.leftQueue)) };
};

/* The least loaded in-product agent that plays the role and may work in the project, counted by the role items it
 * already has; null when none does. An agent with no projects named may work in any. */
const leastLoaded = async (companyId, role, projectId) => {
    const agents = (await find(companyId, SCHEMA_TYPE.AGENTS, [{ role, paused: { $ne: true }, deletedStatusKey: { $ne: 1 } }, { name: 1, projectIds: 1 }]))
        .filter((agent) => !(agent.projectIds || []).length || agent.projectIds.map(String).includes(String(projectId)));
    if (!agents.length) return null;
    const { HANDED_OVER, STATUS } = require('../../Agents/manager/findings');
    const loads = await Promise.all(agents.map(async (agent) => Number(await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_FINDINGS, data: [{ rule: HANDED_OVER, status: STATUS.OPEN, 'facts.agentId': String(agent._id) }],
    }, 'countDocuments')) || 0));
    let best = 0;
    loads.forEach((load, i) => { if (load < loads[best]) best = i; });
    return { id: String(agents[best]._id), name: agents[best].name || '' };
};

async function put(companyId, task, { role, agentId, by, byPerson = false }) {
    const { HANDED_OVER, STATUS, open } = require('../../Agents/manager/findings');
    const facts = { taskKey: task.TaskKey || '', taskName: task.TaskName || '', handedBy: String(by), role, agentId: agentId || '' };
    const rows = await queueRows(companyId, task);
    if (!byPerson && rows.some((row) => row.leftQueue)) return false;
    const held = rows.find((row) => row.status === STATUS.OPEN);
    const now = new Date();
    if (held) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_FINDINGS,
            data: [{ _id: new mongoose.Types.ObjectId(String(held._id)) }, { $set: { 'facts.role': role, 'facts.agentId': agentId || '' }, $unset: { leftQueue: '' } }],
        }, 'updateOne');
    } else {
        const closed = rows.find((row) => row.status === STATUS.CLOSED) || null;
        await open(companyId, String(task.ProjectID), { key: `${HANDED_OVER}:${task._id}`, rule: HANDED_OVER, taskId: String(task._id), taskIds: [String(task._id)], facts }, now, closed);
    }
    require('../../Agents/manager/workQueue').announce(companyId);
    return true;
}

module.exports = { paused, standing, leastLoaded, put };
