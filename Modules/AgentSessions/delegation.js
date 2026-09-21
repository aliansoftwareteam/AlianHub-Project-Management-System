const { recordAudit } = require('../Audit/recorder');
const automationTools = require('../Automations/engine/tools');
const logger = require('../../Config/loggerConfig');
const store = require('./store');
const access = require('./access');
const clients = require('./clients');
const events = require('./events');
const lifecycle = require('./lifecycle');
const { announce } = require('./announce');
const { STATE, OPEN, newHandle, hashOf } = require('./rules');
const { LIMITS } = require('./config');

class DelegationError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.name = 'DelegationError';
        this.statusCode = statusCode;
    }
}

const refuse = (statusCode, message) => { throw new DelegationError(statusCode, message); };

/* The session is the sender, as a run is for its own notices: the pipeline drops the sender from the recipients, so
 * the delegator cannot be it, and it looks the sender up by object id, which a client id is not. */
const notifyDelegator = async (companyId, task, uid, session) => {
    try {
        const { handleNotificationtFun } = require('../notification/prepare-notification-data/controllerV2');
        const { Notification_key } = require('../../Config/notificationKey');
        const now = new Date();
        await handleNotificationtFun({ body: {
            createdAt: now, updatedAt: now,
            key: Notification_key.TASK_NOTIFICATION, type: 'tasks', changeType: 'agent_session_assigned',
            changeData: { taskId: String(task._id), sessionId: String(session._id), clientName: session.clientName },
            message: `${task.TaskKey || task.TaskName || 'A task'} had no assignee, so it is now yours while ${session.clientName || 'an outside agent'} works on it for you.`,
            companyId: String(companyId), projectId: String(task.ProjectID || ''), taskId: String(task._id),
            userId: String(session._id), assigneeUsers: [String(uid)], notSeen: [String(uid)],
            isSelected: false, folderId: '', sprintId: String(task.sprintId || ''), comments_id: '',
        } });
    } catch (error) {
        logger.error(`agent sessions: notifying ${uid} of the assignment on ${task._id} failed: ${error.message}`);
    }
};

/* The owner's rules (2026-09-21): the assignee stays; an unassigned task gets the delegating person, who is notified;
 * a private sprint only with a delegator who is a member of it and a client an admin opted in to private sprints. */
const delegate = async ({ companyId, uid, taskId, clientId, ip = '', now = new Date() }) => {
    const task = await access.taskOf(companyId, taskId);
    if (!task) refuse(404, 'Task not found.');
    if (!(await access.canEditTask(companyId, uid, task))) refuse(403, 'You cannot edit this task, so you cannot delegate it.');

    const client = await clients.clientStanding(companyId, clientId);
    if (!client.ok) refuse(403, 'This outside agent is not approved in this workspace.');
    const grant = await clients.liveGrantFor(companyId, uid, clientId, now);
    if (!grant) refuse(409, 'This outside agent holds no live grant from you in this workspace; connect it to your account first.');

    const sprint = await access.privateSprintOf(companyId, task.sprintId);
    if (sprint) {
        if (!(await access.isSprintMember(companyId, uid, sprint))) refuse(403, 'Only a member of this private sprint can delegate its tasks to an outside agent.');
        if (!(await clients.privateSprintsOptIn(companyId, clientId))) refuse(403, 'An admin has not opted this outside agent in to private sprints in this workspace.');
    }
    if (!(await store.endpointFor(companyId, clientId))) refuse(409, 'This outside agent has no delivery URL in this workspace; an owner or admin sets one first.');
    const open = await store.openRows(companyId, { taskId: String(task._id), clientId: String(clientId) });
    if (open.length) refuse(409, 'This task is already delegated to this outside agent.');

    const assignees = (task.AssigneeUserId || []).map(String).filter(Boolean);
    const assignDelegator = assignees.length === 0;
    const handle = newHandle();
    const session = await store.create(companyId, {
        taskId: String(task._id), projectId: String(task.ProjectID || ''), sprintId: String(task.sprintId || ''),
        taskKey: task.TaskKey || '', taskName: task.TaskName || '',
        clientId: String(clientId), clientName: client.name || String(clientId), grantId: String(grant.grantId), delegatedBy: String(uid),
        assignedDelegator: assignDelegator, privateSprint: Boolean(sprint),
        state: STATE.OFFERED, handleHash: hashOf(handle), handleExpiresAt: new Date(now.getTime() + LIMITS.handleMs),
        tainted: true, createdAt: now, activityCount: 0, activities: [],
    });

    if (assignDelegator) {
        await automationTools.updateTask(companyId, task._id, { AssigneeUserId: [String(uid)] }, { auditedByCaller: true });
        await notifyDelegator(companyId, task, uid, session);
    }
    recordAudit(companyId, {
        actorId: String(uid), actorName: '', ip,
        action: 'agent_session.delegated',
        entityType: 'task', entityId: String(task._id), entityName: task.TaskName || '',
        meta: { sessionId: String(session._id), clientId: session.clientId, clientName: session.clientName, grantId: session.grantId, assignedDelegator: assignDelegator, privateSprint: Boolean(sprint) },
    });
    lifecycle.track(companyId);
    events.emitSession(session);
    return announce(session, handle);
};

const listForTask = async ({ companyId, uid, taskId }) => {
    const task = await access.taskOf(companyId, taskId);
    if (!task || !(await access.canOpenTask(companyId, uid, task))) refuse(404, 'Task not found.');
    const rows = await store.forTask(companyId, task._id);
    return rows.sort((a, b) => Number(OPEN.includes(b.state)) - Number(OPEN.includes(a.state)));
};

module.exports = { DelegationError, delegate, listForTask };
