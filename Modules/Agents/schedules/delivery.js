const mongoose = require('mongoose');
const config = require('../../../Config/config');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { dbCollections } = require('../../../Config/collections');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../../event/socketEventEmitter');
const logger = require('../../../Config/loggerConfig');
const { escapeCommentText } = require('../../Comments/helpers/plainText');
const { subjectText } = require('../../Template/emailText');
const registry = require('../registry');
const { ownerSeesTask, ownerSeesProject, sharedScopeFor } = require('./ownerAccess');

// Where a finished report goes. The owner's Inbox always; email when they asked
// and the instance has mail; a comment or a draft page only when the agent was
// explicitly given that write and its autonomy lets it act without a proposal.
// An empty allowed-actions list, which elsewhere means "every action", grants a
// report no writes: reports are read-only unless someone opted in.
// A comment or page is read by more people than the owner, so it never carries the
// owner's report: it gets the same report rebuilt inside what that place's readers
// can all open, without the model summary written from the owner's wider view.

const NOTIFICATION_KEY = 'agent_report';
const CHANGE_TYPE = 'agent_report';
const LOG_PREFIX = '[agent-schedule]';
const PAGE_TITLE_MAX = 200;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

let uniqueSeq = 0;
const uniqueId = () => `${Date.now().toString(36)}${(uniqueSeq += 1).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const mayWrite = (agent, action) => Array.isArray(agent.allowedActions)
    && agent.allowedActions.map(String).includes(action)
    && registry.has(action)
    && registry.mayActDirectly(agent.autonomy, action);

const mailConfigured = () => Boolean(config.NODEMAILER_HOST && config.NODEMAILER_EMAIL);

const toInbox = async (companyId, { run, agent, report, ownerId }) => {
    const { updateUnReadCommentsCountFun } = require('../../notification-count/controller');
    const row = {
        key: NOTIFICATION_KEY, type: 'agent', changeType: CHANGE_TYPE,
        message: `${agent.name || 'Agent'}: ${report.title}`,
        changeData: { runId: String(run._id), agentId: String(agent._id), agentName: agent.name || '', report: report.key, counts: report.counts },
        projectId: '', taskId: '', userId: String(agent._id), companyId: String(companyId),
        assigneeUsers: [ownerId], notSeen: [ownerId], receiverID: ownerId,
        notificationType: 'push', isSchedule: false, isSeen: false, notificationStatus: 'in-process', uniqueId: uniqueId(),
    };
    const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: row }, 'save');
    const globalRow = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: { ...row, notificationId: saved && saved.id } }, 'save');
    socketEmitter.emit('insert', { type: 'insert', data: globalRow, updatedFields: {}, module: 'globalNotification' });
    await Promise.resolve(updateUnReadCommentsCountFun({ body: { companyId: String(companyId), key: 5, userIds: [ownerId], readAll: false } }))
        .catch((e) => logger.warn(`${LOG_PREFIX} ${companyId}: count bump failed: ${e.message || e}`));
    return true;
};

const emailOf = async (ownerId) => {
    const user = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: dbCollections.USERS, data: [{ _id: oid(ownerId) }, 'Employee_Email'] }, 'findOne').catch(() => null);
    return (user && user.Employee_Email) || '';
};

const toEmail = async ({ report, text, agent, ownerId }) => {
    const to = await emailOf(ownerId);
    if (!to) return false;
    const { SendEmail } = require('../../service');
    return new Promise((resolve) => {
        try { SendEmail(subjectText(`${report.title} from ${agent.name || 'your agent'}`), text, to, false, (r) => resolve(Boolean(r && r.status))); } catch (e) { resolve(false); }
    });
};

const actorFor = (agent, run, ownerId) => ({
    kind: 'agent', userId: ownerId, agentId: String(agent._id), agentName: agent.name || 'Agent', runId: String(run._id), viaAccount: run.viaAccount || agent.account || 'workspace', tokenId: null,
});

const toComment = async (companyId, { run, agent, ownerId, scope, taskId, rebuild, shared }) => {
    if (!mayWrite(agent, 'task.comment')) return { done: false, reason: 'read_only' };
    const task = await ownerSeesTask(companyId, scope, taskId);
    if (!task) return { done: false, reason: 'not_visible' };
    const scoped = await rebuild(await sharedScopeFor(companyId, scope, task.ProjectID, { sprintId: task.sprintId }));
    shared.comment = { projectId: String(task.ProjectID), counts: scoped.report.counts };
    await require('../actions').perform({
        companyId, actor: actorFor(agent, run, ownerId), action: 'task.comment', params: { taskId: String(taskId), body: escapeCommentText(scoped.text) },
        reason: 'scheduled report', allowedActions: agent.allowedActions,
    });
    return { done: true };
};

const toPage = async (companyId, { run, agent, ownerId, scope, projectId, report, rebuild, shared }) => {
    if (!mayWrite(agent, 'page.draft')) return { done: false, reason: 'read_only' };
    if (!(await ownerSeesProject(companyId, scope, projectId))) return { done: false, reason: 'not_visible' };
    // page.draft always files a project-visibility page, so its readers are the project's.
    const scoped = await rebuild(await sharedScopeFor(companyId, scope, projectId));
    shared.page = { projectId: String(projectId), counts: scoped.report.counts };
    const day = new Date(run.slotAt || run.startedAt || Date.now()).toISOString().slice(0, 10);
    await require('../actions').perform({
        companyId, actor: actorFor(agent, run, ownerId), action: 'page.draft',
        params: { title: `${report.title} ${day}`.slice(0, PAGE_TITLE_MAX), text: scoped.text, projectId: String(projectId) },
        reason: 'scheduled report', allowedActions: agent.allowedActions,
    });
    return { done: true };
};

/* Each channel on its own: one that fails is recorded and the rest still go out.
 * `rebuild(scope)` gathers the same report inside a narrower scope for a shared place. */
const deliver = async (companyId, { run, agent, schedule, report, text, scope, rebuild }) => {
    const ownerId = String(schedule.ownerId);
    const wants = schedule.deliver || {};
    const delivered = { inbox: false, email: false, comment: false, page: false };
    const notes = [];
    const shared = {};
    const attempt = async (channel, fn) => {
        try {
            const out = await fn();
            delivered[channel] = out === true || Boolean(out && out.done);
            if (out && out.reason) notes.push(`${channel}: ${out.reason}`);
        } catch (e) {
            notes.push(`${channel}: ${e.message}`);
            logger.error(`${LOG_PREFIX} run ${run._id}: ${channel} delivery failed: ${e.message}`);
        }
    };
    await attempt('inbox', () => toInbox(companyId, { run, agent, report, ownerId }));
    if (wants.email) await attempt('email', () => (mailConfigured() ? toEmail({ report, text, agent, ownerId }) : { done: false, reason: 'mail_not_configured' }));
    if (wants.taskId) await attempt('comment', () => toComment(companyId, { run, agent, ownerId, scope, taskId: wants.taskId, rebuild, shared }));
    if (wants.pageProjectId) await attempt('page', () => toPage(companyId, { run, agent, ownerId, scope, projectId: wants.pageProjectId, report, rebuild, shared }));
    return { delivered, notes, shared };
};

module.exports = { NOTIFICATION_KEY, CHANGE_TYPE, mayWrite, mailConfigured, deliver };
