const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');

// An agent, or an edit of one, made by anyone but an owner or admin waits here until an owner or admin answers.

const STATE = Object.freeze({ PENDING: 'pending', APPROVED: 'approved', DECLINED: 'declined' });
const KIND = Object.freeze({ AGENT: 'agent', EDIT: 'edit', SKILL: 'skill' });
const NOTICE = Object.freeze({ REQUESTED: 'agent_approval_requested', DECIDED: 'agent_approval_decided' });
const NOTICE_SCOPE = 'agents';
const AWAITING_APPROVAL = 'awaiting_approval';
const REASON_MAX = 500;
const UNAPPROVED = Object.freeze([STATE.PENDING, STATE.DECLINED]);

const REFUSAL = Object.freeze({
    PENDING: 'This agent is waiting for an Owner or an Admin to approve it.',
    DECLINED: 'This agent was declined. Its creator can change it and send it again.',
    DECIDED: 'This request has already been answered.',
    REASON: 'Say why it is declined, so its creator can fix it.',
});

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

// An agent from before approvals has no state; every one of them was made by an owner or admin.
const isApproved = (agent) => !(agent && agent.approval && UNAPPROVED.includes(agent.approval.state));
const APPROVED_CLAUSE = Object.freeze({ 'approval.state': { $nin: UNAPPROVED } });

const refusalFor = (agent) => (agent && agent.approval && agent.approval.state === STATE.DECLINED ? REFUSAL.DECLINED : REFUSAL.PENDING);

const reasonOf = (raw) => String(raw || '').trim().slice(0, REASON_MAX);

const requested = (actor, now = new Date()) => ({ state: STATE.PENDING, requestedBy: String(actor.userId), requestedAt: now });

/* The first answer wins: the write matches only while the request is still pending. */
const decide = async (companyId, agentId, { approve, actor, reason }) => {
    const id = oid(agentId);
    if (!id) return null;
    const set = {
        'approval.state': approve ? STATE.APPROVED : STATE.DECLINED,
        'approval.decidedBy': String(actor.userId),
        'approval.decidedAt': new Date(),
        'approval.reason': approve ? '' : reasonOf(reason),
    };
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS, data: [{ _id: id, deletedStatusKey: { $ne: 1 }, 'approval.state': STATE.PENDING }, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');
};

const noticeData = (kind, record, extra = {}) => ({ kind, agentId: String(record.agentId || record._id || ''), agentName: String(record.name || record.agentName || '').slice(0, 120), ...extra });

const MESSAGES = Object.freeze({
    [KIND.AGENT]: 'An agent is waiting for your approval.',
    [KIND.EDIT]: 'A change to an agent is waiting for your approval.',
    [KIND.SKILL]: 'A skill is waiting for your approval.',
});

/* Owners and admins hear that something waits for them. A failed notice never undoes the request. */
const notifyRequested = async (companyId, kind, record, { actor, n } = {}) => {
    try {
        const { ownersAndAdmins, sendNotice } = require('../Inbox/helpers/workspaceNotice');
        const recipients = (await ownersAndAdmins(companyId)).filter((id) => id !== String(actor.userId));
        await sendNotice(companyId, recipients, {
            key: NOTICE.REQUESTED, type: 'agent', scope: NOTICE_SCOPE, from: actor.userId, label: 'agent approval',
            message: MESSAGES[kind], changeData: noticeData(kind, record, n ? { n: Number(n) } : {}),
        });
    } catch (e) { logger.error(`agent approval notice not sent: ${e.message}`); }
};

/* The person who asked hears the answer, with the reason when it was declined. */
const notifyDecided = async (companyId, kind, record, { actor, to, approved, reason, n } = {}) => {
    if (!to || String(to) === String(actor.userId)) return;
    try {
        const { sendNotice } = require('../Inbox/helpers/workspaceNotice');
        await sendNotice(companyId, [String(to)], {
            key: NOTICE.DECIDED, type: 'agent', scope: NOTICE_SCOPE, from: actor.userId, label: 'agent approval',
            message: approved ? 'Your request was approved.' : 'Your request was declined.',
            changeData: noticeData(kind, record, { approved: Boolean(approved), ...(approved ? {} : { reason: reasonOf(reason) }), ...(n ? { n: Number(n) } : {}) }),
        });
    } catch (e) { logger.error(`agent approval answer not sent: ${e.message}`); }
};

const audit = async (companyId, actor, entry) => {
    try {
        await require('./agentAudit').recordApproval(companyId, actor, entry);
    } catch (e) { logger.error(`agent approval audit not written: ${e.message}`); }
};

module.exports = {
    STATE, KIND, NOTICE, NOTICE_SCOPE, AWAITING_APPROVAL, REFUSAL, APPROVED_CLAUSE,
    isApproved, refusalFor, reasonOf, requested, decide, notifyRequested, notifyDecided, audit,
};
