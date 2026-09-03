const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { removeCache } = require('../../../utils/commonFunctions');
const socketEmitter = require('../../../event/socketEventEmitter');
const { recordAuditFromReq } = require('../../Audit/recorder');
const { resolveRate } = require('../../TimeSheet/helpers/billingRules');
const math = require('../../Milestone/helpers/billingMath');
const billing = require('../../Milestone/controller/billing');

// Client invoices raised against a project (handoff 19c).
//
// A line is never typed in as a bare number: it is drafted from a milestone or
// from a month of time logs and keeps the ids it came from, so "what is this
// $28,000?" is answered by opening the tasks or the logs behind it rather than
// by trusting the label. Every mutation here touches money, so every one of
// them is audited.

const { companyOf, actorId, isObjectIdString, refuseGuest } = billing;
const LINE_KINDS = Object.freeze(['milestone', 'time', 'change_request', 'expense', 'adjustment']);
const STATUSES = Object.freeze(['draft', 'sent', 'paid']);

const cacheKeyFor = (projectId, companyId) => `projectInvoices:${projectId}:${companyId}`;

const lineId = () => new mongoose.Types.ObjectId().toString();

/* Recompute every stored total from the lines. Totals are never taken from the
 * client: a request that could set its own total could send a $0 invoice. */
const priceInvoice = (lines, taxRateBp) => {
    const totals = math.invoiceTotals({ lines, taxRateBp });
    const priced = lines.map((line, index) => ({ ...line, amountMinor: totals.lineAmountsMinor[index] }));
    return {
        lines: priced,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
    };
};

const sanitizeLine = (raw = {}) => {
    const kind = LINE_KINDS.includes(String(raw.kind)) ? String(raw.kind) : 'adjustment';
    const hasRate = raw.unitMinor !== null && raw.unitMinor !== undefined && raw.unitMinor !== '';
    return {
        id: raw.id ? String(raw.id) : lineId(),
        kind,
        label: String(raw.label || '').slice(0, 200),
        detail: String(raw.detail || '').slice(0, 300),
        qtyMilli: hasRate ? Math.max(0, Math.round(Number(raw.qtyMilli) || 0)) : 1000,
        unitMinor: hasRate ? Math.max(0, Math.round(Number(raw.unitMinor) || 0)) : null,
        amountMinor: hasRate ? 0 : Math.round(Number(raw.amountMinor) || 0),
        milestoneId: raw.milestoneId && isObjectIdString(String(raw.milestoneId)) ? String(raw.milestoneId) : '',
        taskIds: Array.isArray(raw.taskIds) ? raw.taskIds.map(String).filter(isObjectIdString).slice(0, 500) : [],
        timelogIds: Array.isArray(raw.timelogIds) ? raw.timelogIds.map(String).filter(isObjectIdString).slice(0, 2000) : [],
    };
};

/* Sequential invoice number, allocated on the contract so two drafts raised in
 * the same second cannot collide. */
const nextInvoiceNumber = async (companyId, projectId, contract) => {
    const updated = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_CONTRACTS,
        data: [
            { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
            { $inc: { invoiceSeq: 1 } },
            { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
        ],
    }, 'findOneAndUpdate');
    const seq = Number((updated && updated.invoiceSeq) || 1);
    const prefix = (contract && contract.invoicePrefix) || 'INV';
    return `${prefix}-${new Date().getUTCFullYear()}-${String(seq).padStart(3, '0')}`;
};

const addDays = (date, days) => new Date(date.getTime() + (Number(days) || 0) * 86400000);

const saveDraft = async ({ companyId, req, projectId, ctx, source, lines, periodStart, periodEnd }) => {
    const contract = ctx.contract;
    const priced = priceInvoice(lines.map(sanitizeLine), contract.taxRateBp);
    const issuedDate = new Date();
    const number = await nextInvoiceNumber(companyId, projectId, contract);
    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_INVOICES,
        data: {
            ProjectID: new mongoose.Types.ObjectId(projectId),
            number,
            clientName: contract.clientName,
            source,
            periodStart: periodStart || null,
            periodEnd: periodEnd || null,
            issuedDate,
            dueDate: addDays(issuedDate, contract.paymentTermsDays),
            lines: priced.lines,
            currency: contract.currency,
            currencySymbol: contract.currencySymbol,
            taxLabel: contract.taxLabel,
            taxRateBp: contract.taxRateBp,
            subtotalMinor: priced.subtotalMinor,
            taxMinor: priced.taxMinor,
            totalMinor: priced.totalMinor,
            status: 'draft',
            createdBy: actorId(req),
        },
    }, 'save');

    removeCache(cacheKeyFor(projectId, companyId));
    socketEmitter.emit('update', { type: 'add', data: saved, module: 'projectInvoice' });
    recordAuditFromReq(req, {
        action: 'billing.invoice.draft',
        entityType: 'project_invoice',
        entityId: String(saved._id),
        entityName: number,
        meta: { projectId, source, totalMinor: priced.totalMinor, currency: contract.currency, lineCount: priced.lines.length },
    });
    return saved;
};

/* GET /api/v2/invoices?projectId= */
exports.listInvoices = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.query && req.query.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const docs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_INVOICES,
            data: [{ ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 }, null, { sort: { issuedDate: -1, createdAt: -1 } }],
        }, 'find');
        return res.send({ status: true, statusText: 'OK', data: docs || [] });
    } catch (error) {
        logger.error(`ERROR in list invoices: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* GET /api/v2/invoices/:id — the invoice plus the tasks and time logs each line
 * was drafted from, so a line can be expanded without a second round trip. */
exports.getInvoice = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid invoice id are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const invoice = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_INVOICES,
            data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!invoice) return res.send({ status: false, statusText: 'Invoice not found.' });

        const taskIds = [...new Set((invoice.lines || []).flatMap((l) => l.taskIds || []).map(String))];
        const timelogIds = [...new Set((invoice.lines || []).flatMap((l) => l.timelogIds || []).map(String))];
        const [tasks, timelogs] = await Promise.all([
            taskIds.length ? MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: { $in: taskIds } }, '_id TaskKey TaskName statusType'],
            }, 'find') : [],
            timelogIds.length ? MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [{ _id: { $in: timelogIds } }, '_id TicketID Loggeduser LogTimeDuration LogStartTime LogDescription'],
            }, 'find') : [],
        ]);
        const names = await billing.resolveUserNames((timelogs || []).map((l) => String(l.Loggeduser)));

        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                invoice,
                trace: {
                    tasks: (tasks || []).map((t) => ({ _id: String(t._id), key: t.TaskKey || '', name: t.TaskName || '', done: String(t.statusType || '') === billing.DONE_STATUS_TYPE })),
                    timelogs: (timelogs || []).map((l) => ({
                        _id: String(l._id),
                        taskId: String(l.TicketID || ''),
                        userName: names.get(String(l.Loggeduser)) || '',
                        minutes: Number(l.LogTimeDuration) || 0,
                        at: Number(l.LogStartTime) || 0,
                        note: String(l.LogDescription || '').slice(0, 200),
                    })),
                },
            },
        });
    } catch (error) {
        logger.error(`ERROR in get invoice: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/invoices/draft-from-milestone  body: { projectId, milestoneId } */
exports.draftFromMilestone = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.body && req.body.projectId) || '');
        const milestoneId = String((req.body && req.body.milestoneId) || '');
        if (!companyId || !isObjectIdString(projectId) || !isObjectIdString(milestoneId)) {
            return res.send({ status: false, statusText: 'companyId, a valid projectId and milestoneId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const ctx = await billing.buildBillingContext(companyId, projectId);
        if (!ctx) return res.send({ status: false, statusText: 'Project not found.' });
        const milestone = ctx.milestones.find((m) => m.id === milestoneId);
        if (!milestone) return res.send({ status: false, statusText: 'Milestone not found on this project.' });
        if (milestone.cancelled) return res.send({ status: false, statusText: 'A cancelled milestone cannot be invoiced.' });
        if (ctx.paidMilestoneIds.has(milestoneId) || ctx.invoicedMilestoneIds.has(milestoneId)) {
            return res.send({ status: false, statusText: 'This milestone is already on an issued invoice.' });
        }
        if (ctx.contract.requireTasksDoneToInvoice && milestone.taskCount > 0 && milestone.doneCount < milestone.taskCount) {
            return res.send({
                status: false,
                statusText: `${milestone.taskCount - milestone.doneCount} task(s) in this milestone are still open. Finish them or turn the rule off in the contract.`,
            });
        }

        const lines = [{
            kind: 'milestone',
            label: milestone.name,
            detail: `${milestone.taskCount} tasks`,
            amountMinor: milestone.amountMinor,
            milestoneId,
            taskIds: milestone.taskIds,
        }];
        const saved = await saveDraft({ companyId, req, projectId, ctx, source: 'milestone', lines });
        return res.send({ status: true, statusText: 'Draft invoice created.', data: saved });
    } catch (error) {
        logger.error(`ERROR in draft invoice from milestone: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/invoices/draft-from-month  body: { projectId, month: 'YYYY-MM' }
 * One line per person, from that month's BILLABLE logs at their resolved rate. */
exports.draftFromMonth = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.body && req.body.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const ctx = await billing.buildBillingContext(companyId, projectId);
        if (!ctx) return res.send({ status: false, statusText: 'Project not found.' });

        const { start, end, label } = billing.monthWindow(req.body && req.body.month);
        const startSec = Math.floor(start.getTime() / 1000);
        const endSec = Math.floor(end.getTime() / 1000);
        const rates = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.BILLING_RATES,
            data: [{ deletedStatusKey: 0 }],
        }, 'find');

        const byUser = new Map();
        (ctx.timelogs || []).forEach((log) => {
            const at = Number(log.LogStartTime) || 0;
            if (at < startSec || at > endSec) return;
            if (log.billable === false) return;
            const minutes = Number(log.LogTimeDuration) || 0;
            if (minutes <= 0) return;
            const userId = String(log.Loggeduser || '');
            if (!byUser.has(userId)) byUser.set(userId, { userId, minutes: 0, taskIds: new Set(), timelogIds: [] });
            const row = byUser.get(userId);
            row.minutes += minutes;
            if (log.TicketID) row.taskIds.add(String(log.TicketID));
            row.timelogIds.push(String(log._id));
        });
        if (!byUser.size) {
            return res.send({ status: false, statusText: `No billable time logged on this project in ${label}.` });
        }

        const names = await billing.resolveUserNames([...byUser.keys()]);
        const lines = [...byUser.values()].map((row) => {
            const rateMinor = math.toMinor(resolveRate({ entry: { Loggeduser: row.userId, ProjectId: projectId }, rates: rates || [] }));
            const qtyMilli = math.minutesToMilliHours(row.minutes);
            return {
                kind: 'time',
                label: `${names.get(row.userId) || 'Unassigned'} · ${label}`,
                detail: `${math.milliHoursToHours(qtyMilli).toFixed(2)}h across ${row.taskIds.size} task(s)`,
                qtyMilli,
                unitMinor: rateMinor,
                taskIds: [...row.taskIds],
                timelogIds: row.timelogIds,
            };
        });

        const saved = await saveDraft({
            companyId, req, projectId, ctx, source: 'month', lines, periodStart: start, periodEnd: end,
        });
        return res.send({ status: true, statusText: 'Draft invoice created.', data: saved });
    } catch (error) {
        logger.error(`ERROR in draft invoice from month: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PUT /api/v2/invoices/:id  body: { lines?, taxRateBp?, dueDate?, notes? }
 * Only a draft is editable — an issued invoice is a document the client has. */
exports.updateInvoice = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !isObjectIdString(id)) {
            return res.send({ status: false, statusText: 'companyId and a valid invoice id are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const invoice = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_INVOICES,
            data: [{ _id: id, deletedStatusKey: 0 }],
        }, 'findOne');
        if (!invoice) return res.send({ status: false, statusText: 'Invoice not found.' });
        if (invoice.status !== 'draft') {
            return res.send({ status: false, statusText: 'This invoice has already been issued. Raise a new one instead.' });
        }

        const body = req.body || {};
        const set = {};
        const taxRateBp = body.taxRateBp === undefined ? Number(invoice.taxRateBp) || 0 : Math.max(0, Math.round(Number(body.taxRateBp) || 0));
        if (taxRateBp > 10000) return res.send({ status: false, statusText: 'A tax rate above 100% is not a tax rate.' });
        const lines = (body.lines === undefined ? (invoice.lines || []) : body.lines).map(sanitizeLine);
        const priced = priceInvoice(lines, taxRateBp);
        set.lines = priced.lines;
        set.taxRateBp = taxRateBp;
        set.subtotalMinor = priced.subtotalMinor;
        set.taxMinor = priced.taxMinor;
        set.totalMinor = priced.totalMinor;
        if (body.taxLabel !== undefined) set.taxLabel = String(body.taxLabel).slice(0, 40);
        if (body.notes !== undefined) set.notes = String(body.notes).slice(0, 2000);
        if (body.dueDate !== undefined) {
            const d = new Date(body.dueDate);
            set.dueDate = Number.isNaN(d.getTime()) ? invoice.dueDate : d;
        }
        set.updatedBy = actorId(req);

        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_INVOICES,
            data: [{ _id: id }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');

        removeCache(cacheKeyFor(String(invoice.ProjectID), companyId));
        socketEmitter.emit('update', { type: 'update', data: saved, module: 'projectInvoice' });
        recordAuditFromReq(req, {
            action: 'billing.invoice.update',
            entityType: 'project_invoice',
            entityId: id,
            entityName: invoice.number,
            meta: {
                projectId: String(invoice.ProjectID),
                fromTotalMinor: Number(invoice.totalMinor) || 0,
                toTotalMinor: priced.totalMinor,
                currency: invoice.currency,
            },
        });
        return res.send({ status: true, statusText: 'Invoice saved.', data: saved });
    } catch (error) {
        logger.error(`ERROR in update invoice: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const transition = async (req, res, target) => {
    const companyId = companyOf(req);
    const id = String(req.params.id || '');
    if (!companyId || !isObjectIdString(id)) {
        return res.send({ status: false, statusText: 'companyId and a valid invoice id are required.' });
    }
    if (await refuseGuest(req, res)) return undefined;
    const invoice = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_INVOICES,
        data: [{ _id: id, deletedStatusKey: 0 }],
    }, 'findOne');
    if (!invoice) return res.send({ status: false, statusText: 'Invoice not found.' });
    if (invoice.status === target) return res.send({ status: false, statusText: `This invoice is already ${target}.` });
    if (target === 'sent' && invoice.status !== 'draft') {
        return res.send({ status: false, statusText: 'Only a draft can be sent.' });
    }
    if (target === 'paid' && invoice.status !== 'sent') {
        return res.send({ status: false, statusText: 'Send the invoice before marking it paid.' });
    }
    if (target === 'sent' && !(invoice.lines || []).length) {
        return res.send({ status: false, statusText: 'An invoice with no lines cannot be sent.' });
    }

    const set = { status: target, updatedBy: actorId(req) };
    if (target === 'sent') set.sentAt = new Date();
    if (target === 'paid') set.paidAt = new Date();

    const saved = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_INVOICES,
        data: [{ _id: id }, { $set: set }, { returnDocument: 'after' }],
    }, 'findOneAndUpdate');

    removeCache(cacheKeyFor(String(invoice.ProjectID), companyId));
    socketEmitter.emit('update', { type: 'update', data: saved, module: 'projectInvoice' });
    recordAuditFromReq(req, {
        action: `billing.invoice.${target}`,
        entityType: 'project_invoice',
        entityId: id,
        entityName: invoice.number,
        meta: {
            projectId: String(invoice.ProjectID),
            totalMinor: Number(invoice.totalMinor) || 0,
            currency: invoice.currency,
            milestoneIds: (invoice.lines || []).map((l) => l.milestoneId).filter(Boolean),
        },
    });
    return res.send({ status: true, statusText: target === 'sent' ? 'Invoice sent.' : 'Invoice marked paid.', data: saved });
};

/* POST /api/v2/invoices/:id/send */
exports.sendInvoice = async (req, res) => {
    try {
        return await transition(req, res, 'sent');
    } catch (error) {
        logger.error(`ERROR in send invoice: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/invoices/:id/paid */
exports.markInvoicePaid = async (req, res) => {
    try {
        return await transition(req, res, 'paid');
    } catch (error) {
        logger.error(`ERROR in mark invoice paid: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

module.exports.LINE_KINDS = LINE_KINDS;
module.exports.STATUSES = STATUSES;
module.exports.priceInvoice = priceInvoice;
module.exports.sanitizeLine = sanitizeLine;
