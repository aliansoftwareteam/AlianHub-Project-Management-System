const logger = require('../../../Config/loggerConfig');
const socketEmitter = require('../../../event/socketEventEmitter');
const { removeCache } = require('../../../utils/commonFunctions');
const { canReadProject } = require('../../../Config/projectAccess');
const { callerOf, canManageAgents } = require('../access');
const { agentsRefused } = require('../guard');
const agentAudit = require('../agentAudit');
const settings = require('./settings');
const findings = require('./findings');
const dailyLook = require('./dailyLook');
const workQueue = require('./workQueue');
const connectedAgents = require('../connectedAgents');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EDIT_ACTION = 'project.agent_manager.edit';

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

/* No total is sent beside the list: a count of what the reader cannot open would give it away. */
const answer = async (companyId, uid, projectId, canEdit) => {
    const [held, list] = await Promise.all([settings.read(companyId, projectId), findings.visibleTo(companyId, uid, projectId)]);
    return { ...held, canEdit, findings: held.on ? await workQueue.claimsOf(companyId, uid, list) : [] };
};

/* An API token never turns it on or off, whoever holds it. */
const mayEdit = (req, caller) => !req.apiToken && canManageAgents(caller);

const getProjectManager = async (req, res) => {
    try {
        const at = await openProject(req, res);
        if (!at) return undefined;
        const caller = await callerOf(req, at.companyId);
        return res.json({ status: true, statusText: 'Project manager fetched.', data: await answer(at.companyId, req.uid, at.projectId, mayEdit(req, caller)) });
    } catch (e) { logger.error(`getProjectManager: ${e.message}`); return fail(res, 500, e.message); }
};

const saveProjectManager = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        if (req.apiToken) return fail(res, 403, 'An API token cannot turn a project\'s manager on or off.');
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 403, 'Owner/admin only.');
        const at = await openProject(req, res);
        if (!at) return undefined;

        const saved = await settings.save(companyId, at.projectId, req.body, caller.actor.userId);
        if (saved.error) return fail(res, saved.status, saved.error);
        await agentAudit.recordProjectPolicyChange(companyId, caller.actor, {
            projectId: at.projectId, projectName: saved.project.ProjectName, from: { manager: saved.from.on }, to: { manager: saved.to.on }, ip: req.ip || '',
        });
        removeCache('UserProjectData:', true);
        socketEmitter.emit('update', { type: 'update', companyId, data: saved.project, updatedFields: { agentManager: saved.agentManager }, module: 'project' });
        // No relay sends a project's event to a browser; an open task reads its hand-over offer again on this one.
        workQueue.announce(companyId);
        if (saved.to.on) {
            await dailyLook.lookAt(companyId, saved.project).catch((e) => logger.error(`saveProjectManager: the first look at ${at.projectId} failed: ${e.message}`));
        }
        return res.json({ status: true, statusText: 'Project manager updated.', data: await answer(companyId, req.uid, at.projectId, true) });
    } catch (e) { logger.error(`saveProjectManager: ${e.message}`); return fail(res, 500, e.message); }
};

/* The work queue as people meet it: the line on a task, handing a task over, and taking an item back from an agent. */
const person = (req, res) => {
    const companyId = String(req.headers.companyid || '');
    if (!companyId || !req.uid) { fail(res, 401, 'Unauthorized.'); return null; }
    if (req.apiToken) { fail(res, 403, 'An API token cannot hand work to an agent or take it back.'); return null; }
    return companyId;
};

const getTaskQueue = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        return res.json({ status: true, statusText: 'Work queue fetched.', data: await workQueue.aboutTask(companyId, req.uid, req.params.taskId) });
    } catch (e) { logger.error(`getTaskQueue: ${e.message}`); return fail(res, 500, e.message); }
};

const getHeldTasks = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        return res.json({ status: true, statusText: 'Held tasks fetched.', data: await workQueue.heldTasks(companyId, req.uid) });
    } catch (e) { logger.error(`getHeldTasks: ${e.message}`); return fail(res, 500, e.message); }
};

const handOverTask = async (req, res) => {
    try {
        const companyId = person(req, res);
        if (!companyId) return undefined;
        const to = (req.body || {}).to;
        if (to !== undefined && !OBJECT_ID.test(typeof to === 'string' ? to : '')) return fail(res, 400, 'A valid person id is required.');
        const handed = await workQueue.handOver(companyId, req.uid, req.params.taskId, new Date(), to === undefined ? {} : { to });
        if (handed.error) return fail(res, handed.status, handed.error);
        return res.json({ status: true, statusText: 'Handed to an agent.', data: handed.about });
    } catch (e) { logger.error(`handOverTask: ${e.message}`); return fail(res, 500, e.message); }
};

const takeBackItem = async (req, res) => {
    try {
        const companyId = person(req, res);
        if (!companyId) return undefined;
        const taken = await workQueue.takeBack(companyId, req.uid, req.params.itemId);
        if (taken.error) return fail(res, taken.status, taken.error);
        return res.json({ status: true, statusText: 'Taken back.', data: await workQueue.aboutTask(companyId, req.uid, taken.taskId) });
    } catch (e) { logger.error(`takeBackItem: ${e.message}`); return fail(res, 500, e.message); }
};

/* The connected AIs of the people the caller already sees as members; with a task, only the caller's own, and only where they may hand that task to it. */
const getConnectedAgents = async (req, res) => {
    try {
        const companyId = String(req.headers.companyid || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        if (req.apiToken) return fail(res, 403, 'Only a signed-in person can see the connected agents.');
        const taskId = (req.query || {}).taskId;
        const data = taskId === undefined ? await connectedAgents.listFor(companyId, req.uid) : await workQueue.pickableOn(companyId, req.uid, taskId);
        return res.json({ status: true, statusText: 'Connected agents fetched.', data });
    } catch (e) { logger.error(`getConnectedAgents: ${e.message}`); return fail(res, 500, e.message); }
};

const HAND_OVER_ACTION = 'queue.hand_over';
const TAKE_BACK_ACTION = 'queue.take_back';

module.exports = {
    getProjectManager, putProjectManager: [agentsRefused(EDIT_ACTION), saveProjectManager], EDIT_ACTION,
    getConnectedAgents, getTaskQueue, getHeldTasks, postHandOver: [agentsRefused(HAND_OVER_ACTION), handOverTask], postTakeBack: [agentsRefused(TAKE_BACK_ACTION), takeBackItem],
};
