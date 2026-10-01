const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { removeCache } = require('../../utils/commonFunctions');
const { canReadProject } = require('../../Config/projectAccess');
const { callerOf, canManageAgents } = require('./access');
const { agentsRefused } = require('./guard');
const agentAudit = require('./agentAudit');
const projectPolicy = require('./projectPolicy');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EDIT_ACTION = 'project.agent_policy.edit';

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

const answer = async (companyId, projectId, canEdit) => {
    const [project, held] = await Promise.all([projectPolicy.read(companyId, projectId), projectPolicy.effective(companyId, projectId)]);
    const { workspaceChecksBeforeDone, ...effective } = held;
    return { project, effective, workspaceChecksBeforeDone, defaults: { ...projectPolicy.DEFAULTS }, canEdit };
};

/* An API token never changes it, whoever holds it: the policy is what holds a token's agent. */
const mayEdit = (req, caller) => !req.apiToken && canManageAgents(caller);

const getProjectPolicy = async (req, res) => {
    try {
        const at = await openProject(req, res);
        if (!at) return undefined;
        const caller = await callerOf(req, at.companyId);
        return res.json({ status: true, statusText: 'Policy fetched.', data: await answer(at.companyId, at.projectId, mayEdit(req, caller)) });
    } catch (e) { logger.error(`getProjectPolicy: ${e.message}`); return fail(res, 500, e.message); }
};

const saveProjectPolicy = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        if (req.apiToken) return fail(res, 403, 'An API token cannot change a project\'s agent policy.');
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 403, 'Owner/admin only.');
        const at = await openProject(req, res);
        if (!at) return undefined;

        const saved = await projectPolicy.save(companyId, at.projectId, req.body, caller.actor.userId);
        if (saved.error) return fail(res, saved.status, saved.error);
        await agentAudit.recordProjectPolicyChange(companyId, caller.actor, { projectId: at.projectId, projectName: saved.project.ProjectName, from: saved.from, to: saved.to, ip: req.ip || '' });
        removeCache('UserProjectData:', true);
        socketEmitter.emit('update', { type: 'update', data: saved.project, updatedFields: { agentPolicy: saved.agentPolicy }, module: 'project' });
        return res.json({ status: true, statusText: 'Policy updated.', data: await answer(companyId, at.projectId, true) });
    } catch (e) { logger.error(`saveProjectPolicy: ${e.message}`); return fail(res, 500, e.message); }
};

module.exports = { getProjectPolicy, putProjectPolicy: [agentsRefused(EDIT_ACTION), saveProjectPolicy], EDIT_ACTION };
