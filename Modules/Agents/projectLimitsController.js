const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { removeCache } = require('../../utils/commonFunctions');
const { canReadProject } = require('../../Config/projectAccess');
const { callerOf, canManageAgents } = require('./access');
const { agentsRefused } = require('./guard');
const agentAudit = require('./agentAudit');
const projectLimits = require('./projectLimits');
const directChanges = require('./directChanges');
const runs = require('./runs');
const workQueue = require('./manager/workQueue');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EDIT_ACTION = 'project.agent_limits.edit';
const STOPPED_BY_PAUSE = 'agents were paused in this project';
const LIMITS_CHANGE = 'limits';

const recorded = (limits) => ({ agentsAtOnce: limits.atOnce, agentsPaused: limits.paused, agentsDirectTasks: limits.directTasks });

const fail = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

/* The project the caller can open; one they cannot open reads as a missing one. */
const openProject = async (req, res) => {
    const companyId = String(req.headers.companyid || '');
    const projectId = String((req.params && req.params.projectId) || '');
    if (!companyId || !req.uid) { fail(res, 401, 'Unauthorized.'); return null; }
    if (!OBJECT_ID.test(projectId)) { fail(res, 400, 'A valid project id is required.'); return null; }
    if (!(await canReadProject(companyId, req.uid, projectId)).allowed) { fail(res, 404, 'Project not found.'); return null; }
    return { companyId, projectId };
};

const answer = async (companyId, projectId, canEdit) => ({
    limits: await projectLimits.read(companyId, projectId),
    defaults: { ...projectLimits.DEFAULTS },
    atOnceRange: { min: projectLimits.AT_ONCE.MIN, max: projectLimits.AT_ONCE.MAX },
    directTasksRange: { min: projectLimits.DIRECT_TASKS.MIN, max: projectLimits.DIRECT_TASKS.MAX },
    directTasksMinutes: directChanges.WINDOW_MINUTES,
    canEdit,
});

/* An API token never changes them, whoever holds it: the limits are what hold a token's agent. */
const mayEdit = (req, caller) => !req.apiToken && canManageAgents(caller);

const getProjectLimits = async (req, res) => {
    try {
        const at = await openProject(req, res);
        if (!at) return undefined;
        const caller = await callerOf(req, at.companyId);
        return res.json({ status: true, statusText: 'Limits fetched.', data: await answer(at.companyId, at.projectId, mayEdit(req, caller)) });
    } catch (e) { logger.error(`getProjectLimits: ${e.message}`); return fail(res, 500, e.message); }
};

const saveProjectLimits = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        if (req.apiToken) return fail(res, 403, 'An API token cannot change a project\'s limits for agents.');
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 403, 'Owner/admin only.');
        const at = await openProject(req, res);
        if (!at) return undefined;

        const saved = await projectLimits.save(companyId, at.projectId, req.body, caller.actor.userId);
        if (saved.error) return fail(res, saved.status, saved.error);
        await agentAudit.recordProjectPolicyChange(companyId, caller.actor, {
            projectId: at.projectId, projectName: saved.project.ProjectName, ip: req.ip || '',
            from: recorded(saved.from), to: recorded(saved.to),
        });
        if (saved.pausedNow) {
            await Promise.all([workQueue.dropClaimsIn(companyId, at.projectId), runs.stopIn(companyId, at.projectId, STOPPED_BY_PAUSE)]);
        }
        removeCache('UserProjectData:', true);
        socketEmitter.emit('update', { type: 'update', companyId, data: saved.project, updatedFields: { agentLimits: saved.agentLimits }, module: 'project' });
        // No relay carries a project event to a browser; the agents signal does, and names no project.
        socketEmitter.emit('update', { type: 'update', module: 'agent', companyId, data: { kind: LIMITS_CHANGE }, updatedFields: { kind: LIMITS_CHANGE }, actor: { kind: 'human' }, depth: 1 });
        return res.json({ status: true, statusText: 'Limits updated.', data: await answer(companyId, at.projectId, true) });
    } catch (e) { logger.error(`saveProjectLimits: ${e.message}`); return fail(res, 500, e.message); }
};

module.exports = { getProjectLimits, putProjectLimits: [agentsRefused(EDIT_ACTION), saveProjectLimits], EDIT_ACTION };
