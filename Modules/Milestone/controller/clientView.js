const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries.js');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const socketEmitter = require('../../../event/socketEventEmitter');
const { buildClientView } = require('../helpers/clientProjection');
const billing = require('./billing');

// Client view (handoff 19d). The ONE place the guest payload is assembled.
//
// The payload is built from scratch by buildClientView's allow-list — this file
// only decides which source rows are eligible; it never hands a project
// document to the client and trims it, because a trim leaks whatever field is
// added to the schema next.

const MAX_MESSAGE = 2000;
const { companyOf, actorId, isObjectIdString, toEpoch, DONE_STATUS_TYPE } = billing;

const signedOff = (milestone) => Boolean(milestone.signOffAt)
    || milestone.billingState === 'paid'
    || milestone.billingState === 'invoiced'
    || (milestone.percentBp !== null && milestone.percentBp >= 10000);

/* Sign-off requests: open tasks assigned to a client contact. A task the client
 * is not on is not "waiting on you", and only the title and dates cross over. */
const collectSignOffs = (ctx) => {
    const contacts = new Set((ctx.contract.clientContactIds || []).map(String));
    const milestoneByTask = new Map();
    ctx.milestones.forEach((m) => (m.taskIds || []).forEach((id) => milestoneByTask.set(String(id), m.name)));
    if (!contacts.size) return [];
    return (ctx.tasks || [])
        .filter((task) => String(task.statusType || '') !== DONE_STATUS_TYPE)
        .filter((task) => (task.AssigneeUserId || []).some((a) => contacts.has(String(a && a.userId ? a.userId : a))))
        .map((task) => ({
            id: String(task._id),
            title: task.TaskName || '',
            milestoneName: milestoneByTask.get(String(task._id)) || '',
            dueDate: task.DueDate || null,
            waitingSince: task.startDate || task.createdAt || null,
            actionable: true,
        }))
        // Soonest first; anything undated sits at the end rather than at the top.
        .sort((a, b) => (toEpoch(a.dueDate) || Number.MAX_SAFE_INTEGER) - (toEpoch(b.dueDate) || Number.MAX_SAFE_INTEGER));
};

/* Dated updates the client is entitled to: a milestone reaching sign-off and an
 * invoice being issued or paid. Both are facts about the engagement, not
 * internal activity — no comments, no status churn, no agent runs. */
const collectUpdates = (ctx) => {
    const updates = [];
    ctx.milestones.forEach((m) => {
        if (!m.signOffAt) return;
        updates.push({ date: m.signOffAt, text: `${m.name} signed off.` });
    });
    (ctx.invoices || []).forEach((inv) => {
        if (inv.status === 'paid' && inv.paidAt) updates.push({ date: inv.paidAt, text: `Payment received for ${inv.number}.` });
        else if (inv.status === 'sent' && inv.sentAt) updates.push({ date: inv.sentAt, text: `${inv.number} issued.` });
    });
    return updates
        .sort((a, b) => toEpoch(b.date) - toEpoch(a.date))
        .slice(0, 12);
};

/**
 * The guest payload for one project. Exported so the authenticated route and
 * the public /share/:token renderer serve byte-identical data — a second
 * assembly path is a second place for a field to leak.
 */
const buildClientPayload = async (companyId, projectId) => {
    const ctx = await billing.buildBillingContext(companyId, projectId);
    if (!ctx) return null;
    return buildClientView({
        project: { name: ctx.project.ProjectName || '' },
        contract: ctx.contract,
        milestones: ctx.milestones.map((m) => ({
            id: m.id,
            name: m.name,
            dueDate: m.dueDate,
            percentBp: m.percentBp,
            signedOff: signedOff(m),
            signedOffDate: m.signOffAt || m.dueDate,
        })),
        signOffs: collectSignOffs(ctx),
        updates: collectUpdates(ctx),
        invoices: (ctx.invoices || [])
            .filter((inv) => inv.status === 'sent' || inv.status === 'paid')
            .map((inv) => ({
                number: inv.number,
                label: (inv.lines || []).map((l) => l.label).filter(Boolean).join(' + '),
                status: inv.status,
                issuedDate: inv.issuedDate,
                dueDate: inv.dueDate,
                totalMinor: inv.totalMinor,
                currency: inv.currency,
            })),
    });
};

/* GET /api/v2/billing/client-view?projectId=
 * Guests (roleType 4) reach exactly this, and so does everyone else — there is
 * no richer variant of this endpoint to accidentally serve. */
exports.getClientView = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.query && req.query.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        const data = await buildClientPayload(companyId, projectId);
        if (!data) return res.send({ status: false, statusText: 'Project not found.' });
        return res.send({ status: true, statusText: 'OK', data });
    } catch (error) {
        logger.error(`ERROR in get client view: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/billing/client-view/message  body: { projectId, message }
 * Posts into the project channel, which is where the mock says it goes. */
exports.postClientMessage = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const uid = actorId(req);
        const projectId = String((req.body && req.body.projectId) || '');
        const message = String((req.body && req.body.message) || '').trim();
        if (!companyId || !isObjectIdString(projectId) || !uid) {
            return res.send({ status: false, statusText: 'companyId, a valid projectId and an authenticated user are required.' });
        }
        if (!message) return res.send({ status: false, statusText: 'Write a message first.' });

        const contract = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_CONTRACTS,
            data: [{ ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 }],
        }, 'findOne');
        if (contract && contract.allowClientMessages === false) {
            return res.send({ status: false, statusText: 'Messaging is turned off for this project.' });
        }

        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMMENTS,
            data: {
                message: message.slice(0, MAX_MESSAGE),
                project: true,
                projectId: new mongoose.Types.ObjectId(projectId),
                userId: uid,
                type: 'text',
            },
        }, 'save');

        socketEmitter.emit('update', { type: 'add', data: saved, module: 'comments' });
        return res.send({ status: true, statusText: 'Message sent.', data: { _id: String(saved && saved._id) } });
    } catch (error) {
        logger.error(`ERROR in post client message: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

module.exports.buildClientPayload = buildClientPayload;
