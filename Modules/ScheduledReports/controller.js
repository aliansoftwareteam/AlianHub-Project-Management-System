const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { SendEmail } = require('../service');
const reportRules = require('../CustomReports/helpers/reportRules'); // REP-02 whitelist engine
const customReports = require('../CustomReports/controller');
const R = require('./helpers/scheduleRules');

// REP-08 — scheduled / emailed reports. A schedule emails a saved report
// (REP-02) to recipients on a cadence. The prod cron calls
// runScheduledReportsForAllCompanies; dev exercises the same path via
// POST /run-due. Email delivery uses service.SendEmail, which fails gracefully
// when mail isn't configured (e.g. local dev) — never throws into the request.

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const DIM_LABELS = { status: 'Status', project: 'Project', sprint: 'Sprint', person: 'Person', month: 'Month' };
const METRIC_LABELS = { count: 'Task count', points: 'Story points', hours: 'Hours', entries: 'Entries', revenue: 'Amount' };

const sendOne = (subject, html, recipients) => new Promise((resolve) => {
    try { SendEmail(subject, html, recipients, true, (r) => resolve(!!(r && r.status))); }
    catch (e) { resolve(false); }
});

// Run a saved report's config → rows. Delegates to the REP-02 engine so the
// emailed table is the same query, the same units and the same labels as the
// builder shows on screen.
const runSavedReport = async (companyId, report) => {
    const check = reportRules.validateConfig(report);
    if (!check.valid) return { rows: [], total: 0, config: null };
    const out = await customReports.runConfig(companyId, check.value);
    const rows = out.rows.map((r) => ({ label: r.label, value: r.value }));
    return { rows, total: Math.round(rows.reduce((a, r) => a + (r.value || 0), 0) * 100) / 100, config: check.value };
};

// Deliver one schedule now: load its report, run it, email recipients.
const deliver = async (companyId, schedule) => {
    const report = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: oid(schedule.savedReportId) }],
    }, 'findOne');
    if (!report || report.deletedStatusKey === 1) return { sent: false, reason: 'report-missing' };
    const { rows, total, config } = await runSavedReport(companyId, report);
    const html = R.reportEmailHtml({
        name: report.name, rows, total,
        dimensionLabel: DIM_LABELS[config && config.dimension] || (config && config.dimension) || 'Group',
        metricLabel: METRIC_LABELS[config && config.metric] || (config && config.metric) || 'Value',
    });
    const sent = await sendOne(R.reportEmailSubject(report.name), html, schedule.recipients || []);
    return { sent, recipients: (schedule.recipients || []).length };
};

// Process all DUE schedules for one company. Idempotent: nextRunAt advances each run.
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
        // Advance the schedule regardless of send outcome so a misconfigured mailer
        // can't cause the same report to fire every cron tick.
        // eslint-disable-next-line no-await-in-loop
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES,
            data: [{ _id: oid(s._id) }, { $set: { lastRunAt: now, nextRunAt: R.computeNextRun(s.cadence, now) } }],
        }, 'updateOne').catch(() => {});
    }
    removeCache(`report_schedules:${companyId}`);
    return { due: due.length, delivered };
};

// Cron entry — every company. Prod-only (index.js gates cron on NODE_ENV).
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

// POST /api/v1/reports/schedules — create a schedule for a saved report.
exports.createSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const check = R.validateSchedule(req.body || {});
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const report = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: oid(check.value.savedReportId) }],
        }, 'findOne');
        if (!report || report.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Saved report not found.' });
        const now = new Date();
        const data = { ...check.value, lastRunAt: null, nextRunAt: R.computeNextRun(check.value.cadence, now), createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.REPORT_SCHEDULES, data }, 'save');
        removeCache(`report_schedules:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Schedule created.', data: saved });
    } catch (e) { logger.error(`createSchedule: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/reports/schedules — list (with the saved-report name attached).
exports.listSchedules = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        const ids = [...new Set((rows || []).map((r) => String(r.savedReportId)).filter(Boolean))].map(oid).filter(Boolean);
        const reports = ids.length ? await MongoDbCrudOpration(companyId, {
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
    } catch (e) { logger.error(`listSchedules: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// PUT /api/v1/reports/schedules/:id — update cadence / recipients / active.
exports.updateSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: oid(req.params.id) }],
        }, 'findOne');
        if (!existing || existing.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Not found.' });
        const set = { updatedBy: String(req.uid || '') };
        if (req.body.recipients !== undefined) {
            const rec = R.cleanRecipients(req.body.recipients);
            if (!rec.length) return res.status(400).json({ status: false, statusText: 'at least one valid recipient email is required' });
            set.recipients = rec;
        }
        if (req.body.cadence !== undefined && R.CADENCES.includes(req.body.cadence)) {
            set.cadence = req.body.cadence;
            set.nextRunAt = R.computeNextRun(req.body.cadence, new Date());
        }
        if (req.body.active !== undefined) set.active = !!req.body.active;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        removeCache(`report_schedules:${companyId}`);
        return res.json({ status: true, statusText: 'Schedule updated.', data: updated });
    } catch (e) { logger.error(`updateSchedule: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/reports/schedules/:id — soft delete.
exports.deleteSchedule = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        removeCache(`report_schedules:${companyId}`);
        return res.json({ status: true, statusText: 'Schedule removed.' });
    } catch (e) { logger.error(`deleteSchedule: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// POST /api/v1/reports/schedules/:id/run-now — send once now (does not advance the schedule).
exports.runScheduleNow = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const s = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.REPORT_SCHEDULES, data: [{ _id: oid(req.params.id) }],
        }, 'findOne');
        if (!s || s.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Not found.' });
        const result = await deliver(companyId, s);
        return res.json({ status: true, statusText: result.sent ? 'Report emailed.' : 'Could not send — mail may not be configured.', data: result });
    } catch (e) { logger.error(`runScheduleNow: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// POST /api/v1/reports/schedules/run-due — process due schedules for the caller's
// company on demand (same path the prod cron runs across all companies).
exports.triggerDue = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const result = await runDueForCompany(companyId, new Date());
        return res.json({ status: true, statusText: 'Due schedules processed.', data: result });
    } catch (e) { logger.error(`triggerDue: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

exports.runDueForCompany = runDueForCompany;
exports.runScheduledReportsForAllCompanies = runScheduledReportsForAllCompanies;
