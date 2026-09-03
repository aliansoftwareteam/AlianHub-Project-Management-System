const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getCatalog } = require('../Integrations/helpers/integrationsRules');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const registry = require('./registry');
const scope = require('./scope');

// Reads behind the pipeline (28a) and the release screen (28c). Both are views
// of the same boundary: what an agent may do, what it may only propose, and what
// it cannot reach at all. Every stop is derived from registry.js here rather than
// listed again, so a change to the registry changes the screens.

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_FIELDS = 'TaskName TaskKey status statusType ProjectID sprintId folderId AssigneeUserId updatedAt createdAt';
const REFUSED = 'agent.action_refused';
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const ids = (list) => [...new Set((list || []).map((v) => String(v || '')).filter(Boolean))];

const gatedActions = () => registry.ACTIONS.filter((a) => a.gate || a.proposeOnly);
const gatedKeys = () => gatedActions().map((a) => a.key);

const findTasks = (companyId, taskIds, visible) => (taskIds.length
    ? MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: { $in: taskIds.map(oid).filter(Boolean) }, ProjectID: { $in: visible }, deletedStatusKey: { $ne: 1 } }, TASK_FIELDS],
    }, 'find').catch(() => [])
    : Promise.resolve([]));

const shapeTask = (t) => ({
    _id: String(t._id),
    taskKey: t.TaskKey || '',
    name: t.TaskName || '',
    status: (t.status && (t.status.text || t.status.name)) || t.status || '',
    statusType: t.statusType || '',
    projectId: String(t.ProjectID || ''),
    sprintId: t.sprintId ? String(t.sprintId) : '',
    folderId: t.folderId ? String(t.folderId) : '',
    assignees: Array.isArray(t.AssigneeUserId) ? t.AssigneeUserId.map(String) : (t.AssigneeUserId ? [String(t.AssigneeUserId)] : []),
    updatedAt: t.updatedAt || null,
    createdAt: t.createdAt || null,
});

const proposalTouchesGate = (p, keys) => (p.changes || []).some((c) => keys.includes(c.action)) || Boolean(p.gate);

const shapeProposal = (p) => ({
    _id: String(p._id),
    agentId: String(p.agentId || ''),
    agentName: p.agentName || '',
    taskId: p.taskId ? String(p.taskId) : '',
    projectId: p.projectId ? String(p.projectId) : '',
    what: p.what || '',
    why: p.why || '',
    gate: p.gate || null,
    status: p.status,
    actions: (p.changes || []).map((c) => c.action),
    decidedBy: p.decidedBy ? String(p.decidedBy) : '',
    decidedAt: p.decidedAt || null,
    createdAt: p.createdAt || null,
});

/* Tasks an agent has touched — a run or a proposal names them — newest first.
 * Scoped to the projects the caller can already open, so the picker can never
 * surface a task they could not read on their own. */
const pipelineTasks = async (companyId, uid, { limit = 25 } = {}) => {
    const visible = await scope.visibleProjectIds(companyId, uid);
    if (!visible.length) return { tasks: [], visibleProjects: 0 };
    const [runs, proposals] = await Promise.all([
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [{ taskId: { $ne: null } }, 'taskId projectId agentName status startedAt finishedAt', { sort: { startedAt: -1 }, limit: 300 }],
        }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_PROPOSALS,
            data: [{ taskId: { $ne: null } }, 'taskId projectId agentName status createdAt', { sort: { createdAt: -1 }, limit: 300 }],
        }, 'find').catch(() => []),
    ]);
    const touched = ids([...(runs || []).map((r) => r.taskId), ...(proposals || []).map((p) => p.taskId)]);
    const tasks = await findTasks(companyId, touched, visible);
    const lastAt = {};
    const runCount = {};
    const proposalCount = {};
    (runs || []).forEach((r) => {
        const id = String(r.taskId);
        runCount[id] = (runCount[id] || 0) + 1;
        const at = new Date(r.finishedAt || r.startedAt || 0).getTime();
        if (at > (lastAt[id] || 0)) lastAt[id] = at;
    });
    (proposals || []).forEach((p) => {
        const id = String(p.taskId);
        proposalCount[id] = (proposalCount[id] || 0) + 1;
        const at = new Date(p.createdAt || 0).getTime();
        if (at > (lastAt[id] || 0)) lastAt[id] = at;
    });
    const shaped = (tasks || []).map((t) => ({
        ...shapeTask(t),
        runs: runCount[String(t._id)] || 0,
        proposals: proposalCount[String(t._id)] || 0,
        lastActivityAt: lastAt[String(t._id)] ? new Date(lastAt[String(t._id)]) : null,
    })).sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));
    return { tasks: shaped.slice(0, Math.min(100, Math.max(1, Number(limit) || 25))), visibleProjects: visible.length };
};

/* The release candidate: what has been marked Done since the last release, how
 * much of it an agent worked on, which staging deploys were proposed and who
 * approved them — and, from the registry, the fact that production is offered to
 * nobody. Deploy targets come from the integrations catalog; there is none, so
 * the screen says so instead of drawing a button that would do nothing. */
const releaseCandidate = async (companyId, uid, { since } = {}) => {
    const from = since && !Number.isNaN(new Date(since).getTime()) ? new Date(since) : new Date(Date.now() - 30 * DAY_MS);
    const [visible, roleType] = await Promise.all([scope.visibleProjectIds(companyId, uid), getRoleType(companyId, uid)]);
    const privileged = isPrivileged(roleType);
    const keys = gatedKeys();

    const doneTasks = visible.length
        ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ deletedStatusKey: { $ne: 1 }, ProjectID: { $in: visible }, statusType: { $in: [...registry.DONE_STATUS_TYPES] }, updatedAt: { $gte: from } },
                   TASK_FIELDS, { sort: { updatedAt: -1 }, limit: 200 }],
        }, 'find').catch(() => [])
        : [];

    const doneIds = ids((doneTasks || []).map((t) => t._id));
    const [runsOnDone, proposals, connections] = await Promise.all([
        doneIds.length
            ? MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ taskId: { $in: doneIds } }, 'taskId agentId agentName'] }, 'find').catch(() => [])
            : Promise.resolve([]),
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_PROPOSALS,
            data: [{ $or: [{ gate: { $ne: null } }, { 'changes.action': { $in: keys } }] }, {}, { sort: { createdAt: -1 }, limit: 50 }],
        }, 'find').catch(() => []),
        MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.INTEGRATION_CONNECTIONS, data: [{ deletedStatusKey: { $ne: 1 }, status: 'connected' }, 'type name status'],
        }, 'find').catch(() => []),
    ]);

    const assisted = new Set((runsOnDone || []).map((r) => String(r.taskId)));
    const agentNames = ids((runsOnDone || []).map((r) => r.agentName));
    const staging = (proposals || []).filter((p) => proposalTouchesGate(p, keys)).map(shapeProposal);
    const lastStagingDeploy = staging.find((p) => ['approved', 'edited'].includes(p.status)) || null;

    const refusals = privileged
        ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AUDIT_LOGS,
            data: [{ action: REFUSED }, 'actorName createdAt meta', { sort: { createdAt: -1 }, limit: 25 }],
        }, 'find').catch(() => [])
        : [];

    const catalog = getCatalog();
    const deployCatalog = catalog.filter((c) => /deploy/i.test(`${c.category} ${c.description}`));
    const connectedTypes = ids((connections || []).map((c) => c.type));
    const codeProviders = catalog.filter((c) => c.category === 'Dev').map((c) => ({ key: c.key, name: c.name, connected: connectedTypes.includes(c.key) }));

    return {
        since: from,
        tasks: (doneTasks || []).map((t) => ({ ...shapeTask(t), agentAssisted: assisted.has(String(t._id)) })),
        counts: {
            done: (doneTasks || []).length,
            agentAssisted: (doneTasks || []).filter((t) => assisted.has(String(t._id))).length,
            agents: agentNames.length,
            projects: ids((doneTasks || []).map((t) => t.ProjectID)).length,
        },
        staging: {
            actions: gatedActions().map((a) => ({ key: a.key, label: a.label, gate: a.gate || null, proposeOnly: Boolean(a.proposeOnly) })),
            proposals: staging,
            pending: staging.filter((p) => p.status === 'pending').length,
            last: lastStagingDeploy,
        },
        production: {
            offeredToAgents: registry.has('deploy.production') || registry.has('git.merge'),
            never: [...registry.NEVER],
            deployTargets: deployCatalog.map((c) => c.key),
            codeProviders,
        },
        audit: { visible: privileged, refusals: (refusals || []).map((r) => ({ _id: String(r._id), actorName: r.actorName || '', at: r.createdAt, action: (r.meta && r.meta.action) || '', reason: (r.meta && r.meta.reason) || '' })) },
    };
};

module.exports = { pipelineTasks, releaseCandidate, gatedActions, gatedKeys };
