const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { SendEmail } = require('../service');
const reportRules = require('../CustomReports/helpers/reportRules');
const access = require('../CustomReports/helpers/reportAccess');
const customReports = require('../CustomReports/controller');
const R = require('./helpers/scheduleRules');

// The prod cron calls runScheduledReportsForAllCompanies; POST /run-due runs the
// same path for one company. SendEmail fails gracefully when mail is not
// configured, so delivery never throws into the request.

const { oidOrNull } = access;

const { sessionTenantOf, TenantError } = require('../../Config/tenant');

const DIM_LABELS = { status: 'Status', project: 'Project', sprint: 'Sprint', person: 'Person', month: 'Month' };
const METRIC_LABELS = { count: 'Task count', points: 'Story points', hours: 'Hours', entries: 'Entries', revenue: 'Amount' };

const reply = (res, code, statusText, extra = {}) => res.status(code).json({ status: false, statusText, message: statusText, ...extra });
const serverError = (res, where, e) => {
    if (e instanceof TenantError) return reply(res, e.statusCode, e.message);
    logger.error(`${where}: ${e && e.message}`);
    return reply(res, 500, 'Something went wrong while handling the schedule.');
};

const sendOne = (subject, html, recipients) => new Promise((resolve) => {
    try { SendEmail(subject, html, recipients, true, (r) => resolve(!!(r && r.status))); }
    catch (e) { resolve(false); }
});

const runSavedReport = async (companyId, report) => {
    const check = reportRules.validateConfig(report);
    if (!check.valid) return { rows: [], total: 0, config: null };
    const out = await customReports.runConfig(companyId, check.value);
    const rows = out.rows.map((r) => ({ label: r.label, value: r.value }));
    return { rows, total: Math.round(rows.reduce((a, r) => a + (r.value || 0), 0) * 100) / 100, config: check.value };
};

// The cron has no session, so the financial gate is checked against the people
// who built the report and the schedule: neither may widen who sees billing data.
const mayEmailFinancial = async (companyId, schedule, report) => {
    if (!access.isFinancialConfig(report)) return true;
    const [reportOwner, scheduleOwner] = await Promise.all([
        access.isPrivilegedUser(companyId, report.createdBy),
        access.isPrivilegedUser(companyId, schedule.createdBy),
    ]);
    return reportOwner && scheduleOwner;
};

const deliver = async (companyId, schedule) => {
    const reportId = oidOrNull(schedule.savedReportId);
    const report = reportId ? await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: reportId }],
    }, 'findOne') : null;
    if (!report || report.deletedStatusKey === 1) return { sent: false, reason: 'report-missing' };
    if (!(await mayEmailFinancial(companyId, schedule, report))) return { sent: false, reason: 'restricted' };
    const { rows, total, config } = await runSavedReport(companyId, report);
    const html = R.reportEmailHtml({
        name: report.name, rows, total,
        dimensionLabel: DIM_LABELS[config && config.dimension] || (config && config.dimension) || 'Group',
        metricLabel: METRIC_LABELS[config && config.metric] || (config && config.metric) || 'Value',
    });
    const sent = await sendOne(R.reportEmailSubject(report.name), html, schedule.recipients || []);
    return { sent, recipients: (schedule.recipients || []).length };
};

const runDueForCompany = async (companyId, now = new Date()) => {
    if (!companyId) return { due: 0, delivered: 0 };
    const schedules = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ active: true, deletedStatusKey: { $ne: 1 } }],
    }, 'find');
    const due = (schedules || []).filter((s) => R.isDue(s, now));
    let delivered = 0;
    for (const s of due) {
        // eslint-disable-next-line no-await-in-loop
        const res = await deliver(companyId, s).catch((e) => { logger.error(`[scheduledReports] deliver ${s._id}: ${e.message}`); return { sent: false }; });
        if (res && res.sent) delivered++;
        // Advance regardless of the send outcome so a misconfigured mailer cannot
        // make the same report fire on every cron tick.
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES,
            data: [{ _id: s._id }, { $set: { lastRunAt: now, nextRunAt: R.computeNextRun(s.cadence, now) } }],
        }, 'updateOne').catch(() => {});
    }
    removeCache(`report_schedules:${companyId}`);
    return { due: due.length, delivered };
};

const runScheduledReportsForAllCompanies = async () => {
    try {
        const companies = await MongoDbCrudOpration('global', { type: SCHEMA_TYPE.COMPANIES, data: [{}, { _id: 1 }] }, 'find');
        const now = new Date();
        for (const c of (companies || [])) {
            // eslint-disable-next-line no-await-in-loop
            await runDueForCompany(String(c._id), now).catch((e) => logger.error(`[scheduledReports] ${c._id}: ${e.message}`));
        }
    } catch (e) { logger.error(`[scheduledReports] runForAllCompanies: ${e.message}`); }
};

const callerFor = async (req, res) => {
    if (!req.uid) { reply(res, 401, 'An authenticated user is required.'); return null; }
    const companyId = sessionTenantOf(req);
    return access.callerOf(companyId, req.uid);
};

const loadManagedSchedule = async (caller, id, res) => {
    const _id = oidOrNull(id);
    if (!_id) { reply(res, 400, 'A valid schedule id is required.'); return null; }
    const schedule = await MongoDbCrudOpration(caller.companyId, {
        type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id }],
    }, 'findOne');
    if (!schedule || schedule.deletedStatusKey === 1) { reply(res, 404, 'Not found.'); return null; }
    if (!access.canManage(caller, schedule)) { reply(res, 403, 'Only the schedule\'s creator, an owner or an admin can change this schedule.'); return null; }
    return schedule;
};

exports.createSchedule = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const check = R.validateSchedule(req.body || {});
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        const reportId = oidOrNull(check.value.savedReportId);
        if (!reportId) return reply(res, 400, 'A valid savedReportId is required.');
        const report = await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: reportId }],
        }, 'findOne');
        if (!report || report.deletedStatusKey === 1) return reply(res, 404, 'Saved report not found.');
        if (!access.canManage(caller, report)) return reply(res, 403, 'You can only schedule reports you manage.');
        if (access.isFinancialConfig(report) && !caller.privileged) return res.status(403).json(access.RESTRICTED_BODY);
        const now = new Date();
        const data = { ...check.value, lastRunAt: null, nextRunAt: R.computeNextRun(check.value.cadence, now), createdBy: caller.uid, deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(caller.companyId, { type: SCHEMA_TYPE.REPORT_SCHEDULES, data }, 'save');
        removeCache(`report_schedules:${caller.companyId}`);
        return res.status(201).json({ status: true, statusText: 'Schedule created.', data: saved });
    } catch (e) { return serverError(res, 'createSchedule', e); }
};

exports.listSchedules = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const rows = await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES,
            data: [{ deletedStatusKey: { $ne: 1 }, ...access.ownedScope(caller) }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        const ids = [...new Set((rows || []).map((r) => String(r.savedReportId)).filter(Boolean))].map(oidOrNull).filter(Boolean);
        const reports = ids.length ? await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: { $in: ids } }, { name: 1 }],
        }, 'find') : [];
        const nameById = {};
        (reports || []).forEach((r) => { nameById[String(r._id)] = r.name; });
        const data = (rows || []).map((r) => ({
            _id: r._id,
            savedReportId: r.savedReportId,
            reportName: nameById[String(r.savedReportId)] || '(deleted report)',
            cadence: r.cadence,
            recipients: r.recipients,
            active: r.active,
            lastRunAt: r.lastRunAt,
            nextRunAt: r.nextRunAt,
        }));
        return res.json({ status: true, data });
    } catch (e) { return serverError(res, 'listSchedules', e); }
};

exports.updateSchedule = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const existing = await loadManagedSchedule(caller, req.params.id, res);
        if (!existing) return undefined;
        const set = { updatedBy: caller.uid };
        if (req.body.recipients !== undefined) {
            const rec = R.cleanRecipients(req.body.recipients);
            if (!rec.length) return reply(res, 400, 'at least one valid recipient email is required');
            set.recipients = rec;
        }
        if (req.body.cadence !== undefined && R.CADENCES.includes(req.body.cadence)) {
            set.cadence = req.body.cadence;
            set.nextRunAt = R.computeNextRun(req.body.cadence, new Date());
        }
        if (req.body.active !== undefined) set.active = !!req.body.active;
        const updated = await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: existing._id }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        removeCache(`report_schedules:${caller.companyId}`);
        return res.json({ status: true, statusText: 'Schedule updated.', data: updated });
    } catch (e) { return serverError(res, 'updateSchedule', e); }
};

exports.deleteSchedule = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const existing = await loadManagedSchedule(caller, req.params.id, res);
        if (!existing) return undefined;
        await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: existing._id }, { $set: { deletedStatusKey: 1, updatedBy: caller.uid } }],
        }, 'updateOne');
        removeCache(`report_schedules:${caller.companyId}`);
        return res.json({ status: true, statusText: 'Schedule removed.' });
    } catch (e) { return serverError(res, 'deleteSchedule', e); }
};

exports.runScheduleNow = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const s = await loadManagedSchedule(caller, req.params.id, res);
        if (!s) return undefined;
        const result = await deliver(caller.companyId, s);
        let statusText = result.sent ? 'Report emailed.' : 'Could not send — mail may not be configured.';
        if (result.reason === 'restricted') statusText = access.RESTRICTED_BODY.statusText;
        return res.json({ status: true, statusText, data: result });
    } catch (e) { return serverError(res, 'runScheduleNow', e); }
};

exports.triggerDue = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        if (!caller.privileged) return reply(res, 403, 'Only an owner or admin can process every due schedule.');
        const result = await runDueForCompany(caller.companyId, new Date());
        return res.json({ status: true, statusText: 'Due schedules processed.', data: result });
    } catch (e) { return serverError(res, 'triggerDue', e); }
};

exports.runDueForCompany = runDueForCompany;
exports.runScheduledReportsForAllCompanies = runScheduledReportsForAllCompanies;
