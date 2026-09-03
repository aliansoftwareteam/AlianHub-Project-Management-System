const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const { removeCache } = require('../../../utils/commonFunctions');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries.js');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const socketEmitter = require('../../../event/socketEventEmitter');
const { recordAuditFromReq } = require('../../Audit/recorder');
const { getRoleType } = require('../../../Config/permissionGuard');
const { resolveRate } = require('../../TimeSheet/helpers/billingRules');
const math = require('../helpers/billingMath');

// Billing contract + milestone rollups (handoff 19a / 19b).
//
// Nothing here invents a number. Task counts, percent done and logged hours all
// come from the project's own tasks and time logs; money comes from the
// milestones and the invoices raised against them; profitability is only
// reported when the contract carries a blended cost rate, and reports
// `hasCostRate: false` when it does not.

const DONE_STATUS_TYPE = 'close';
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

const companyOf = (req) => String(
    req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId) || '',
);
const actorId = (req) => String(
    req.uid || (req.body && req.body.userData && (req.body.userData.id || req.body.userData._id)) || '',
);
const isObjectIdString = (id) => OBJECT_ID.test(String(id || ''));

const ROLE_GUEST = 4;

/**
 * Everything under /api/v2/billing except the client view exposes internal
 * money — logged hours, cost rates, margins. A Guest is a client with a login,
 * so a Guest reaching one of those would defeat the entire point of the client
 * view. Refused here, at the endpoint, rather than hidden in the UI.
 */
const refuseGuest = async (req, res) => {
    const roleType = await getRoleType(companyOf(req), actorId(req));
    if (roleType !== ROLE_GUEST) return false;
    res.send({ status: false, statusText: 'Guests can only see the client view of this project.' });
    return true;
};

const contractCacheKey = (projectId, companyId) => `billingContract:${projectId}:${companyId}`;

/* User display names live in the GLOBAL users collection, not the per-company
 * one. Best-effort: an unresolved name is omitted, never an error. */
const resolveUserNames = async (userIds) => {
    const ids = [...new Set((userIds || []).map(String).filter(isObjectIdString))];
    const out = new Map();
    if (!ids.length) return out;
    try {
        const users = await MongoDbCrudOpration('global', {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: ids } }, 'Employee_Name Employee_FName Employee_LName'],
        }, 'find');
        (users || []).forEach((u) => {
            const name = u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ');
            if (name) out.set(String(u._id), String(name));
        });
    } catch (e) {
        logger.error(`billing resolveUserNames: ${e.message}`);
    }
    return out;
};

const toEpoch = (value) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

/* Contract terms as the rest of the module wants them: never null, always the
 * same shape, whether or not the project has been set up yet. */
const contractShape = (doc, project) => ({
    _id: doc && doc._id ? String(doc._id) : '',
    exists: Boolean(doc && doc._id),
    billingMode: (doc && doc.billingMode) || 'fixed',
    clientName: (doc && doc.clientName) || '',
    vendorName: (doc && doc.vendorName) || '',
    clientContactIds: (doc && doc.clientContactIds) || [],
    currency: (doc && doc.currency) || (project && project.ProjectCurrency && project.ProjectCurrency.code) || 'USD',
    currencySymbol: (doc && doc.currencySymbol) || (project && project.ProjectCurrency && project.ProjectCurrency.symbol) || '$',
    taxLabel: (doc && doc.taxLabel) || '',
    taxRateBp: Number((doc && doc.taxRateBp) || 0),
    paymentTermsDays: Number(doc && doc.paymentTermsDays !== undefined && doc.paymentTermsDays !== null ? doc.paymentTermsDays : 30),
    blendedCostRateMinor: doc && doc.blendedCostRateMinor ? Number(doc.blendedCostRateMinor) : null,
    monthlyCapMinor: doc && doc.monthlyCapMinor ? Number(doc.monthlyCapMinor) : null,
    requireTasksDoneToInvoice: doc ? doc.requireTasksDoneToInvoice !== false : true,
    signOffIsTask: doc ? doc.signOffIsTask !== false : true,
    warnWhenHoursExceedValue: Boolean(doc && doc.warnWhenHoursExceedValue),
    allowClientMessages: doc ? doc.allowClientMessages !== false : true,
    invoicePrefix: (doc && doc.invoicePrefix) || 'INV',
    invoiceSeq: Number((doc && doc.invoiceSeq) || 0),
});

const loadContract = async (companyId, projectId, project) => {
    const doc = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECT_CONTRACTS,
        data: [{ ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 }],
    }, 'findOne');
    return contractShape(doc, project);
};

const loadProject = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECTS,
    data: [{ _id: projectId }, 'ProjectName ProjectCode ProjectCurrency StartDate EndDate'],
}, 'findOne');

const loadMilestones = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.MILESTONE,
    data: [{ projectId: String(projectId) }, null, { sort: { order: 1, startDate: 1 } }],
}, 'find');

const loadProjectTasks = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [
        { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
        '_id TaskKey TaskName status statusType DueDate startDate AssigneeUserId',
    ],
}, 'find');

const loadProjectTimelogs = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TIMESHEET,
    data: [
        { ProjectId: String(projectId) },
        '_id TicketID Loggeduser LogTimeDuration LogStartTime billable LogDescription',
    ],
}, 'find');

const loadProjectInvoices = (companyId, projectId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.PROJECT_INVOICES,
    data: [
        { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
        null,
        { sort: { createdAt: -1 } },
    ],
}, 'find');

/**
 * Which tasks a milestone covers.
 *
 * An explicit `taskIds` list wins. Without one the milestone's own date window
 * is used — a milestone IS a dated slice of the plan, so the tasks due inside it
 * are the honest answer, and `scope` tells the caller which rule produced the
 * number so the UI can say so rather than implying a link that was never made.
 */
const resolveMilestoneScope = (milestone, tasks) => {
    const explicit = (milestone.taskIds || []).map(String).filter(Boolean);
    if (explicit.length) {
        const wanted = new Set(explicit);
        return { scope: 'explicit', tasks: tasks.filter((t) => wanted.has(String(t._id))) };
    }
    const from = toEpoch(milestone.startDate);
    const to = toEpoch(milestone.dueDate) || toEpoch(milestone.endDate);
    if (!to) return { scope: 'none', tasks: [] };
    return {
        scope: 'dueDateWindow',
        tasks: tasks.filter((t) => {
            const due = toEpoch(t.DueDate);
            return due && due <= to && (!from || due >= from);
        }),
    };
};

const minutesForTasks = (taskList, minutesByTask) => taskList.reduce(
    (total, t) => total + (minutesByTask.get(String(t._id)) || 0),
    0,
);

/* Per-milestone stats straight off the tasks and time logs in scope. */
const milestoneStats = (milestone, tasks, minutesByTask) => {
    const resolved = resolveMilestoneScope(milestone, tasks);
    const total = resolved.tasks.length;
    const done = resolved.tasks.filter((t) => String(t.statusType || '') === DONE_STATUS_TYPE).length;
    return {
        scope: resolved.scope,
        taskCount: total,
        doneCount: done,
        percentBp: total ? math.shareBp(done, total) : null,
        loggedMinutes: minutesForTasks(resolved.tasks, minutesByTask),
        taskIds: resolved.tasks.map((t) => String(t._id)),
    };
};

const isCancelled = (milestone) => {
    const array = milestone.statusArray || [];
    const last = array.length ? array[array.length - 1] : null;
    return String((last && last.milestoneStatusColor) || milestone.statusId || '') === 'CANCELLED';
};

/* Milestone billing state, derived from the invoices that actually reference it
 * — never from a field somebody could set by hand. */
const billingStateFor = (milestoneId, stats, cancelled, paidIds, invoicedIds, dueDate) => {
    if (cancelled) return 'cancelled';
    if (paidIds.has(milestoneId)) return 'paid';
    if (invoicedIds.has(milestoneId)) return 'invoiced';
    if (stats.percentBp !== null && stats.percentBp >= 10000) return 'ready';
    if (stats.percentBp) return 'in_progress';
    // No tasks in scope at all: nothing blocks the invoice, so once the date has
    // passed the milestone is billable. Before that it is simply not due.
    const due = toEpoch(dueDate);
    if (!stats.taskCount && due && due <= Date.now()) return 'ready';
    return 'not_due';
};

const milestoneIdsByInvoiceStatus = (invoices) => {
    const paid = new Set();
    const invoiced = new Set();
    (invoices || []).forEach((inv) => {
        if (inv.status !== 'paid' && inv.status !== 'sent') return;
        const bucket = inv.status === 'paid' ? paid : invoiced;
        (inv.lines || []).forEach((line) => {
            if (line && line.milestoneId) bucket.add(String(line.milestoneId));
        });
    });
    return { paid, invoiced };
};

/* Shared by the contract view, the invoice drafting and the client view, so all
 * three agree about every number on the screen. */
const buildBillingContext = async (companyId, projectId) => {
    const project = await loadProject(companyId, projectId);
    if (!project) return null;
    const [contract, milestones, tasks, timelogs, invoices] = await Promise.all([
        loadContract(companyId, projectId, project),
        loadMilestones(companyId, projectId),
        loadProjectTasks(companyId, projectId),
        loadProjectTimelogs(companyId, projectId),
        loadProjectInvoices(companyId, projectId),
    ]);

    const minutesByTask = new Map();
    (timelogs || []).forEach((log) => {
        const key = String(log.TicketID || '');
        if (!key) return;
        minutesByTask.set(key, (minutesByTask.get(key) || 0) + (Number(log.LogTimeDuration) || 0));
    });

    const { paid, invoiced } = milestoneIdsByInvoiceStatus(invoices);
    const signOffNames = await resolveUserNames((milestones || []).map((m) => m.signOffUserId));
    const rows = (milestones || []).map((m) => {
        const id = String(m._id);
        const stats = milestoneStats(m, tasks || [], minutesByTask);
        const cancelled = isCancelled(m);
        const amountMinor = math.toMinor(m.amount);
        return {
            id,
            name: m.milestoneName || '',
            amountMinor,
            amount: math.fromMinor(amountMinor),
            startDate: m.startDate || null,
            endDate: m.endDate || null,
            dueDate: m.dueDate || m.endDate || null,
            signOffUserId: m.signOffUserId ? String(m.signOffUserId) : '',
            signOffName: signOffNames.get(String(m.signOffUserId || '')) || '',
            signOffAt: m.signOffAt || null,
            order: m.order || '',
            cancelled,
            billingState: billingStateFor(id, stats, cancelled, paid, invoiced, m.dueDate || m.endDate),
            ...stats,
        };
    });

    return {
        project,
        contract,
        milestones: rows,
        tasks: tasks || [],
        timelogs: timelogs || [],
        invoices: invoices || [],
        minutesByTask,
        paidMilestoneIds: paid,
        invoicedMilestoneIds: invoiced,
    };
};

/* GET /api/v2/billing/contract?projectId= */
exports.getBillingContract = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.query && req.query.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const ctx = await buildBillingContext(companyId, projectId);
        if (!ctx) return res.send({ status: false, statusText: 'Project not found.' });

        const rollup = math.contractRollup({
            milestones: ctx.milestones,
            paidMilestoneIds: [...ctx.paidMilestoneIds],
            invoicedMilestoneIds: [...ctx.invoicedMilestoneIds],
        });
        const loggedMinutes = (ctx.timelogs || []).reduce((t, l) => t + (Number(l.LogTimeDuration) || 0), 0);
        const billedMinor = rollup.paidMinor + rollup.invoicedUnpaidMinor;
        const profit = math.profitability({
            loggedMinutes,
            blendedCostRateMinor: ctx.contract.blendedCostRateMinor,
            billedMinor,
        });
        const watch = ctx.milestones
            .map((m) => ({
                milestone: m,
                burn: math.milestoneBurn({
                    percentBp: m.percentBp,
                    loggedMinutes: m.loggedMinutes,
                    blendedCostRateMinor: ctx.contract.blendedCostRateMinor,
                    amountMinor: m.amountMinor,
                }),
            }))
            .filter((row) => row.burn.atRisk)
            .map((row) => ({
                milestoneId: row.milestone.id,
                name: row.milestone.name,
                percentBp: row.burn.percentBp,
                burnBp: row.burn.burnBp,
                projectedMarginBp: row.burn.projectedMarginBp,
            }));

        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                project: {
                    _id: String(ctx.project._id),
                    name: ctx.project.ProjectName || '',
                    code: ctx.project.ProjectCode || '',
                    startDate: ctx.project.StartDate || null,
                    endDate: ctx.project.EndDate || null,
                },
                contract: ctx.contract,
                milestones: ctx.milestones,
                rollup,
                profitability: profit,
                watch,
                invoiceCount: ctx.invoices.length,
            },
        });
    } catch (error) {
        logger.error(`ERROR in get billing contract: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const CONTRACT_WRITABLE = [
    'billingMode', 'clientName', 'vendorName', 'clientContactIds', 'currency', 'currencySymbol',
    'taxLabel', 'taxRateBp', 'paymentTermsDays', 'blendedCostRateMinor', 'monthlyCapMinor',
    'requireTasksDoneToInvoice', 'signOffIsTask', 'warnWhenHoursExceedValue', 'allowClientMessages',
    'invoicePrefix',
];
const NUMERIC_FIELDS = new Set(['taxRateBp', 'paymentTermsDays', 'blendedCostRateMinor', 'monthlyCapMinor']);
const BOOLEAN_FIELDS = new Set(['requireTasksDoneToInvoice', 'signOffIsTask', 'warnWhenHoursExceedValue', 'allowClientMessages']);

const sanitizeContractPatch = (body = {}) => {
    const set = {};
    CONTRACT_WRITABLE.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(body, key)) return;
        const value = body[key];
        if (BOOLEAN_FIELDS.has(key)) { set[key] = Boolean(value); return; }
        if (NUMERIC_FIELDS.has(key)) {
            if (value === null || value === '') { set[key] = null; return; }
            const n = Number(value);
            set[key] = Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
            return;
        }
        if (key === 'clientContactIds') {
            set[key] = Array.isArray(value) ? value.map(String).slice(0, 20) : [];
            return;
        }
        if (key === 'billingMode') {
            set[key] = String(value) === 'hourly' ? 'hourly' : 'fixed';
            return;
        }
        set[key] = String(value === null || value === undefined ? '' : value).slice(0, 160);
    });
    return set;
};

/* PUT /api/v2/billing/contract  body: { projectId, ...terms } */
exports.updateBillingContract = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.body && req.body.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const set = sanitizeContractPatch(req.body);
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });
        if (set.taxRateBp !== undefined && set.taxRateBp !== null && set.taxRateBp > 10000) {
            return res.send({ status: false, statusText: 'A tax rate above 100% is not a tax rate.' });
        }
        const uid = actorId(req);
        set.updatedBy = uid;

        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECT_CONTRACTS,
            data: [
                { ProjectID: new mongoose.Types.ObjectId(projectId), deletedStatusKey: 0 },
                { $set: set, $setOnInsert: { createdBy: uid } },
                { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
            ],
        }, 'findOneAndUpdate');

        removeCache(contractCacheKey(projectId, companyId));
        socketEmitter.emit('update', { type: 'update', data: saved, module: 'billingContract' });
        recordAuditFromReq(req, {
            action: 'billing.contract.update',
            entityType: 'project_contract',
            entityId: projectId,
            entityName: (saved && saved.clientName) || '',
            meta: { fields: Object.keys(set).filter((k) => k !== 'updatedBy') },
        });
        return res.send({ status: true, statusText: 'Contract saved.', data: contractShape(saved) });
    } catch (error) {
        logger.error(`ERROR in update billing contract: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* POST /api/v2/billing/milestone  body: { projectId, milestoneName, amount, dueDate?, signOffUserId? } */
exports.createBillingMilestone = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { projectId, milestoneName, amount, startDate, dueDate, signOffUserId } = req.body || {};
        if (!companyId || !isObjectIdString(String(projectId || ''))) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const name = String(milestoneName || '').trim();
        if (!name) return res.send({ status: false, statusText: 'A milestone name is required.' });
        const amountNumber = Number(amount);
        if (!Number.isFinite(amountNumber) || amountNumber < 0) {
            return res.send({ status: false, statusText: 'A milestone amount must be a non-negative number.' });
        }

        const existing = await loadMilestones(companyId, projectId);
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.MILESTONE,
            data: {
                milestoneName: name,
                amount: math.fromMinor(math.toMinor(amountNumber)),
                projectId: String(projectId),
                startDate: toEpoch(startDate),
                dueDate: toEpoch(dueDate),
                endDate: toEpoch(dueDate),
                order: String((existing || []).length + 1),
                statusArray: [],
                refundedAmount: [],
                taskIds: [],
                signOffUserId: signOffUserId ? String(signOffUserId) : '',
            },
        }, 'save');

        removeCache(`milestone:${projectId}:${companyId}`);
        socketEmitter.emit('update', { type: 'add', data: saved, module: 'milestone' });
        recordAuditFromReq(req, {
            action: 'billing.milestone.create',
            entityType: 'milestone',
            entityId: String(saved && saved._id),
            entityName: name,
            meta: { projectId: String(projectId), amount: amountNumber },
        });
        return res.send({ status: true, statusText: 'Milestone added.', data: saved });
    } catch (error) {
        logger.error(`ERROR in create billing milestone: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

/* PATCH /api/v2/billing/milestone/:id  body: { projectId, ...fields } */
exports.updateBillingMilestone = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const id = String(req.params.id || '');
        const projectId = String((req.body && req.body.projectId) || '');
        if (!companyId || !isObjectIdString(id) || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId, a valid milestone id and projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const body = req.body || {};
        const set = {};
        if (body.milestoneName !== undefined) {
            const name = String(body.milestoneName).trim();
            if (!name) return res.send({ status: false, statusText: 'A milestone name is required.' });
            set.milestoneName = name.slice(0, 160);
        }
        if (body.amount !== undefined) {
            const n = Number(body.amount);
            if (!Number.isFinite(n) || n < 0) return res.send({ status: false, statusText: 'A milestone amount must be a non-negative number.' });
            set.amount = math.fromMinor(math.toMinor(n));
        }
        if (body.dueDate !== undefined) { set.dueDate = toEpoch(body.dueDate); set.endDate = toEpoch(body.dueDate); }
        if (body.startDate !== undefined) set.startDate = toEpoch(body.startDate);
        if (body.signOffUserId !== undefined) set.signOffUserId = String(body.signOffUserId || '');
        if (body.taskIds !== undefined) {
            set.taskIds = Array.isArray(body.taskIds) ? body.taskIds.map(String).filter(isObjectIdString).slice(0, 500) : [];
        }
        if (body.signedOff !== undefined) set.signOffAt = body.signedOff ? new Date() : null;
        if (!Object.keys(set).length) return res.send({ status: false, statusText: 'Nothing to update.' });

        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.MILESTONE,
            data: [{ _id: id, projectId }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!saved) return res.send({ status: false, statusText: 'Milestone not found.' });

        removeCache(`milestone:${projectId}:${companyId}`);
        socketEmitter.emit('update', { type: 'update', data: saved, module: 'milestone' });
        recordAuditFromReq(req, {
            action: 'billing.milestone.update',
            entityType: 'milestone',
            entityId: id,
            entityName: saved.milestoneName || '',
            meta: { projectId, fields: Object.keys(set) },
        });
        return res.send({ status: true, statusText: 'Milestone saved.', data: saved });
    } catch (error) {
        logger.error(`ERROR in update billing milestone: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

const monthWindow = (month) => {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    const now = new Date();
    const year = match ? Number(match[1]) : now.getUTCFullYear();
    const index = match ? Number(match[2]) - 1 : now.getUTCMonth();
    const start = new Date(Date.UTC(year, index, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, index + 1, 0, 23, 59, 59, 999));
    return { start, end, label: `${start.getUTCFullYear()}-${String(index + 1).padStart(2, '0')}` };
};

/* GET /api/v2/billing/hourly?projectId=&month=YYYY-MM
 * Per-person rates, the monthly cap, and approved vs pending hours — approval
 * state comes from Modules/TimesheetApproval, so "approved" means a reviewer
 * actually approved the period, not that the hours merely exist. */
exports.getHourlyBilling = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const projectId = String((req.query && req.query.projectId) || '');
        if (!companyId || !isObjectIdString(projectId)) {
            return res.send({ status: false, statusText: 'companyId and a valid projectId are required.' });
        }
        if (await refuseGuest(req, res)) return undefined;
        const { start, end, label } = monthWindow(req.query && req.query.month);
        const project = await loadProject(companyId, projectId);
        if (!project) return res.send({ status: false, statusText: 'Project not found.' });
        const contract = await loadContract(companyId, projectId, project);

        const startSec = Math.floor(start.getTime() / 1000);
        const endSec = Math.floor(end.getTime() / 1000);
        const [logs, rates, approvals] = await Promise.all([
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET,
                data: [
                    { ProjectId: projectId, LogStartTime: { $gte: startSec, $lte: endSec } },
                    'Loggeduser LogTimeDuration LogStartTime billable',
                ],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.BILLING_RATES,
                data: [{ deletedStatusKey: 0 }],
            }, 'find'),
            MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TIMESHEET_APPROVAL,
                data: [{ deletedStatusKey: 0, periodEnd: { $gte: start }, periodStart: { $lte: end } }],
            }, 'find'),
        ]);

        const approvedWindows = new Map();
        (approvals || []).forEach((a) => {
            if (a.status !== 'approved') return;
            const key = String(a.userId);
            if (!approvedWindows.has(key)) approvedWindows.set(key, []);
            approvedWindows.get(key).push([new Date(a.periodStart).getTime(), new Date(a.periodEnd).getTime()]);
        });
        const isApproved = (userId, atSeconds) => {
            const windows = approvedWindows.get(String(userId)) || [];
            const at = atSeconds * 1000;
            return windows.some(([from, to]) => at >= from && at <= to + 86399999);
        };

        const byUser = new Map();
        let pendingMinutes = 0;
        let pendingMinor = 0;
        (logs || []).forEach((log) => {
            if (log.billable === false) return;
            const minutes = Number(log.LogTimeDuration) || 0;
            if (minutes <= 0) return;
            const userId = String(log.Loggeduser || '');
            const rateMinor = math.toMinor(resolveRate({ entry: { Loggeduser: userId, ProjectId: projectId }, rates: rates || [] }));
            const valueMinor = math.extendLine({ qtyMilli: math.minutesToMilliHours(minutes), unitMinor: rateMinor });
            if (!byUser.has(userId)) {
                byUser.set(userId, { userId, rateMinor, hasRate: rateMinor > 0, approvedMinutes: 0, pendingMinutes: 0, approvedMinor: 0 });
            }
            const row = byUser.get(userId);
            if (isApproved(userId, Number(log.LogStartTime) || 0)) {
                row.approvedMinutes += minutes;
                row.approvedMinor += valueMinor;
            } else {
                row.pendingMinutes += minutes;
                pendingMinutes += minutes;
                pendingMinor += valueMinor;
            }
        });

        const people = [...byUser.values()].sort((a, b) => b.approvedMinor - a.approvedMinor);
        const userIds = people.map((p) => p.userId).filter(isObjectIdString);
        const nameById = await resolveUserNames(userIds);
        people.forEach((p) => { p.name = nameById.get(p.userId) || ''; });

        const approvedMinor = people.reduce((t, p) => t + p.approvedMinor, 0);
        const cap = math.capUsage({ approvedMinor, pendingMinor, capMinor: contract.monthlyCapMinor });

        return res.send({
            status: true,
            statusText: 'OK',
            data: {
                month: label,
                project: { _id: String(project._id), name: project.ProjectName || '' },
                contract,
                people,
                pendingMinutes,
                pendingMinor,
                approvedMinor,
                cap,
                ratesConfigured: (rates || []).length > 0,
            },
        });
    } catch (error) {
        logger.error(`ERROR in get hourly billing: ${error.message}`);
        return res.send({ status: false, statusText: error.message });
    }
};

module.exports.buildBillingContext = buildBillingContext;
module.exports.contractShape = contractShape;
module.exports.resolveMilestoneScope = resolveMilestoneScope;
module.exports.monthWindow = monthWindow;
module.exports.companyOf = companyOf;
module.exports.actorId = actorId;
module.exports.isObjectIdString = isObjectIdString;
module.exports.toEpoch = toEpoch;
module.exports.DONE_STATUS_TYPE = DONE_STATUS_TYPE;
module.exports.refuseGuest = refuseGuest;
module.exports.ROLE_GUEST = ROLE_GUEST;
module.exports.resolveUserNames = resolveUserNames;
