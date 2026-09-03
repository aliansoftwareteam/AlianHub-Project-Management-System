const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { resolveRate } = require('../TimeSheet/helpers/billingRules');
const R = require('./helpers/reportRules');
const T = require('./helpers/reportTemplates');

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const oidOrNull = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const ID_DIMENSIONS = { project: 'project', sprint: 'sprint', person: 'person' };

// A group key is an id for project / sprint / person dimensions; a chart that
// shows raw ObjectIds is not a report anyone can read.
const resolveLabels = async (companyId, dimension, keys) => {
    const wanted = [...new Set(keys.map(String).filter(Boolean))];
    if (!wanted.length || !ID_DIMENSIONS[dimension]) return {};
    const ids = wanted.map(oidOrNull).filter(Boolean);
    if (!ids.length) return {};
    if (dimension === 'project') {
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS, data: [{ _id: { $in: ids } }, { ProjectName: 1 }],
        }, 'find').catch(() => []);
        return (rows || []).reduce((a, p) => { a[String(p._id)] = p.ProjectName || ''; return a; }, {});
    }
    if (dimension === 'sprint') {
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SPRINTS, data: [{ _id: { $in: ids } }, { name: 1 }],
        }, 'find').catch(() => []);
        return (rows || []).reduce((a, sp) => { a[String(sp._id)] = sp.name || ''; return a; }, {});
    }
    const rows = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids } }, { Employee_Name: 1, Employee_Email: 1 }],
    }, 'find').catch(() => []);
    return (rows || []).reduce((a, u) => { a[String(u._id)] = u.Employee_Name || u.Employee_Email || ''; return a; }, {});
};

// Revenue: the pipeline groups by dimension + person + project (minutes); an
// hourly rate is resolved for each of those buckets and folded back up.
const foldRevenue = async (companyId, raw) => {
    const rates = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.BILLING_RATES, data: [{ deletedStatusKey: { $ne: 1 } }],
    }, 'find').catch(() => []);
    const byDim = new Map();
    (raw || []).forEach((r) => {
        const key = r._id && r._id.dim !== undefined ? r._id.dim : null;
        const rate = resolveRate({ entry: { Loggeduser: r._id && r._id.user, ProjectId: r._id && r._id.project }, rates: rates || [] });
        const amount = ((Number(r.value) || 0) / 60) * rate;
        byDim.set(key, (byDim.get(key) || 0) + amount);
    });
    return [...byDim.entries()].map(([key, value]) => ({ _id: key, value: Math.round(value * 100) / 100 }));
};

const UNITS = { hours: 'hours', revenue: 'currency', points: 'points', count: 'count', entries: 'count' };

// Execute a validated config → { rows: [{ key, label, value }], unit }.
const runConfig = async (companyId, cfg) => {
    const isLogs = cfg.source === 'timelogs';
    const pipeline = R.buildPipeline(cfg);
    let raw = await MongoDbCrudOpration(companyId, {
        type: isLogs ? SCHEMA_TYPE.TIMESHEET : SCHEMA_TYPE.TASKS, data: [pipeline],
    }, 'aggregate');
    if (isLogs && cfg.metric === 'revenue') raw = await foldRevenue(companyId, raw);

    const scale = (cfg.metric === 'hours') ? (1 / 60) : 1;
    const keys = (raw || []).map((r) => (r._id === null || r._id === undefined ? '' : String(r._id)));
    const labels = await resolveLabels(companyId, cfg.dimension, keys);
    return {
        unit: UNITS[cfg.metric] || 'count',
        rows: (raw || []).map((r) => {
            const key = (r._id === null || r._id === undefined) ? '' : String(r._id);
            const value = (Number(r.value) || 0) * scale;
            return {
                key,
                label: labels[key] || (key === '' ? '(none)' : key),
                value: Math.round(value * 100) / 100,
            };
        }).sort((a, b) => b.value - a.value),
    };
};

// Shared with Modules/ScheduledReports so an emailed report runs the exact
// same query as the one on screen.
exports.runConfig = runConfig;

// POST /api/v1/reports/custom/run — live preview, no save.
exports.runReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const out = await runConfig(companyId, check.value);
        return res.json({ status: true, data: { config: check.value, result: out.rows, unit: out.unit } });
    } catch (e) { logger.error(`runReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// POST /api/v1/reports/custom — save a report.
exports.createReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ status: false, statusText: 'name is required.' });
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const data = { name, ...check.value, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SAVED_REPORTS, data }, 'save');
        removeCache(`saved_reports:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Report saved.', data: saved });
    } catch (e) { logger.error(`createReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/reports/custom — list saved reports.
exports.listReports = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.json({ status: true, data: rows || [] });
    } catch (e) { logger.error(`listReports: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/reports/custom/:id/run — load a saved report + execute it (reload).
exports.getReportResult = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const rep = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: oid(req.params.id) }],
        }, 'findOne');
        if (!rep || rep.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Not found.' });
        const check = R.validateConfig(rep);
        const out = check.valid ? await runConfig(companyId, check.value) : { rows: [], unit: 'count' };
        return res.json({ status: true, data: { report: rep, config: check.value, result: out.rows, unit: out.unit } });
    } catch (e) { logger.error(`getReportResult: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// PUT /api/v1/reports/custom/:id
exports.updateReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const set = { ...check.value, updatedBy: String(req.uid || '') };
        if (req.body.name !== undefined) set.name = String(req.body.name).trim();
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS,
            data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.status(404).json({ status: false, statusText: 'Not found.' });
        removeCache(`saved_reports:${companyId}`);
        return res.json({ status: true, statusText: 'Report updated.', data: updated });
    } catch (e) { logger.error(`updateReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/reports/custom/:id
exports.deleteReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS,
            data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        removeCache(`saved_reports:${companyId}`);
        return res.json({ status: true, statusText: 'Report removed.' });
    } catch (e) { logger.error(`deleteReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/reports/custom/templates — built-in reusable templates (REP-07, static).
exports.listTemplates = async (req, res) => {
    try {
        return res.json({ status: true, data: T.listTemplates() });
    } catch (e) { logger.error(`listTemplates: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// POST /api/v1/reports/custom/from-template { templateKey, name? } — create a new
// saved report seeded from a built-in template (REP-07).
exports.createFromTemplate = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const tpl = T.getTemplate(req.body && req.body.templateKey);
        if (!tpl) return res.status(404).json({ status: false, statusText: 'Unknown template.' });
        const check = R.validateConfig(tpl.config);
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const name = String((req.body && req.body.name) || tpl.name).trim() || tpl.name;
        const data = { name, ...check.value, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SAVED_REPORTS, data }, 'save');
        removeCache(`saved_reports:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Report created from template.', data: saved });
    } catch (e) { logger.error(`createFromTemplate: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// POST /api/v1/reports/custom/:id/duplicate — clone an existing saved report (REP-07).
exports.duplicateReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const src = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id: oid(req.params.id) }],
        }, 'findOne');
        if (!src || src.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Not found.' });
        const check = R.validateConfig(src);
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const data = { name: `${src.name} (copy)`, ...check.value, createdBy: String(req.uid || ''), deletedStatusKey: 0 };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SAVED_REPORTS, data }, 'save');
        removeCache(`saved_reports:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Report duplicated.', data: saved });
    } catch (e) { logger.error(`duplicateReport: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
