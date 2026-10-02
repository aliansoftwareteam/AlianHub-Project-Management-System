const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const aiSwitch = require('../AICore/aiSwitch');
const tools = require('../Automations/engine/tools');
const { commentThreadAccess } = require('../Comments/helpers/threadAccess');
const { parseAgentMentionIds, mentionsAsNames } = require('../Comments/helpers/parseMentions');
const registry = require('./registry');
const runs = require('./runs');

// Where people start agents from the task itself: choosing one in the assignee
// picker, or @naming one in a comment. Guests never start one here, and neither
// does anyone who cannot open the task's thread.

const TRIGGER = Object.freeze({ ASSIGN: 'assignment', MENTION: 'mention' });
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const NOTE_MAX = 2000;

const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : { ...doc });

/* A chat conversation is stored as a task row with mainChat set; no skill works on one. */
const workTask = async (companyId, taskId) => {
    if (!OBJECT_ID.test(String(taskId || ''))) return null;
    const task = await tools.getTask(companyId, taskId).catch(() => null);
    return task && task.mainChat !== true && task.deletedStatusKey !== 1 ? task : null;
};

const threadOfTask = (task) => ({ projectId: String(task.ProjectID || ''), sprintId: task.sprintId ? String(task.sprintId) : '', taskId: String(task._id) });

const mayRunOn = async (companyId, uid, task) => {
    if (!task || !OBJECT_ID.test(String(uid || ''))) return false;
    const roleType = await getRoleType(companyId, uid);
    if (roleType === null || roleType === undefined || roleType === ROLE_GUEST) return false;
    const access = await commentThreadAccess(companyId, uid, threadOfTask(task));
    return Boolean(access && access.allowed);
};

const inScope = (agent, task) => {
    const scoped = (agent.projectIds || []).map(String);
    return !scoped.length || scoped.includes(String(task.ProjectID));
};

/* Whole agent rows: the caller shapes what it shows. Empty rather than refused, so a
 * person who may not start agents learns nothing about which exist. */
const runnableAgents = async (companyId, uid, task) => {
    if (!(await mayRunOn(companyId, uid, task))) return [];
    if (!(await aiSwitch.allowed(companyId))) return [];
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 }, paused: { $ne: true } }, {}, { sort: { name: 1 } }],
    }, 'find');
    return (rows || []).filter((agent) => inScope(agent, task));
};

const listed = (agent) => ({ _id: String(agent._id), name: agent.name, description: agent.description || '', autonomy: Number(agent.autonomy || 0) });

/* The engine queues the run when workflows are on; otherwise it executes here, after the reply. */
const dispatch = (companyId, run, agent, task, { userId, note } = {}) => {
    if (!registry.has('subtask.create')) return;
    const workflows = require('../Workflows');
    const plain = plainOf(run);
    const actor = { kind: 'agent', userId: String(userId || ''), agentId: String(agent._id), agentName: agent.name, runId: String(run._id), viaAccount: run.viaAccount, tokenId: null };
    const execute = () => (workflows.enabled()
        ? workflows.enqueueForAgentRun(companyId, plain, { note })
        : runs.executeSkill(companyId, run, agent, task, { proposals: require('./proposals'), actions: require('./actions'), actor }));
    setImmediate(() => Promise.resolve(execute()).catch((e) => logger.error(`agent run ${run._id} was not dispatched: ${e.message}`)));
};

const launch = async (companyId, { agent, task, trigger, startedBy, note, depth }) => {
    const check = await runs.canStart(agent, { trigger, companyId, depth, projectId: task.ProjectID });
    if (!check.ok) return { agentId: String(agent._id), started: false, reason: check.reason };
    const { run, deduplicated } = await runs.start(companyId, {
        agent, taskId: String(task._id), projectId: task.ProjectID, skill: runs.skillSlugOf(agent), trigger,
        startedBy: String(startedBy), viaAccount: agent.account, note: note ? String(note).slice(0, NOTE_MAX) : undefined, triggerDepth: depth,
    });
    if (!deduplicated) dispatch(companyId, run, agent, task, { userId: startedBy, note });
    return { agentId: String(agent._id), started: !deduplicated, deduplicated: Boolean(deduplicated), run: plainOf(run) };
};

/* A saved comment that @names agents starts each one its author may run on that task,
 * with the comment as the brief. Never throws: the comment is already posted. */
const fromComment = async (companyId, { authorId, taskId, message, depth = 0 }) => {
    const mentioned = parseAgentMentionIds(message);
    if (!mentioned.length) return [];
    try {
        const task = await workTask(companyId, taskId);
        if (!task) return [];
        const agents = (await runnableAgents(companyId, authorId, task)).filter((agent) => mentioned.includes(String(agent._id)));
        const note = mentionsAsNames(message).trim();
        const out = [];
        for (const agent of agents) {
            // eslint-disable-next-line no-await-in-loop
            out.push(await launch(companyId, { agent, task, trigger: TRIGGER.MENTION, startedBy: authorId, note, depth }));
        }
        return out;
    } catch (e) {
        logger.error(`agent mention on task ${taskId}: ${e.message}`);
        return [];
    }
};

module.exports = { TRIGGER, workTask, mayRunOn, runnableAgents, listed, dispatch, launch, fromComment };
