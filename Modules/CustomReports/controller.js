const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const { resolveRate } = require('../TimeSheet/helpers/billingRules');
const R = require('./helpers/reportRules');
const T = require('./helpers/reportTemplates');
const access = require('./helpers/reportAccess');

const { oidOrNull } = access;

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

const ID_DIMENSIONS = { project: 'project', sprint: 'sprint', person: 'person' };

const reply = (res, code, statusText, extra = {}) => res.status(code).json({ status: false, statusText, message: statusText, ...extra });
const serverError = (res, where, e) => {
    logger.error(`${where}: ${e && e.message}`);
    return reply(res, 500, 'Something went wrong while handling the report.');
};

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

const callerFor = async (req, res) => {
    const companyId = companyOf(req);
    if (!companyId) { reply(res, 400, 'companyId is required.'); return null; }
    if (!req.uid) { reply(res, 401, 'An authenticated user is required.'); return null; }
    return access.callerOf(companyId, req.uid);
};

const loadManagedReport = async (caller, id, res) => {
    const _id = oidOrNull(id);
    if (!_id) { reply(res, 400, 'A valid report id is required.'); return null; }
    const report = await MongoDbCrudOpration(caller.companyId, {
        type: SCHEMA_TYPE.SAVED_REPORTS, data: [{ _id }],
    }, 'findOne');
    if (!report || report.deletedStatusKey === 1) { reply(res, 404, 'Not found.'); return null; }
    if (!access.canManage(caller, report)) { reply(res, 403, 'Only the report\'s creator, an owner or an admin can use this report.'); return null; }
    return report;
};

const refusesFinancial = (caller, cfg, res) => {
    if (!access.isFinancialConfig(cfg) || caller.privileged) return false;
    res.status(403).json(access.RESTRICTED_BODY);
    return true;
};

const saveReport = async (caller, name, cfg) => {
    const data = { name, ...cfg, createdBy: caller.uid, deletedStatusKey: 0 };
    const saved = await MongoDbCrudOpration(caller.companyId, { type: SCHEMA_TYPE.SAVED_REPORTS, data }, 'save');
    removeCache(`saved_reports:${caller.companyId}`);
    return saved;
};

exports.runReport = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        if (refusesFinancial(caller, check.value, res)) return undefined;
        const out = await runConfig(caller.companyId, check.value);
        return res.json({ status: true, data: { config: check.value, result: out.rows, unit: out.unit } });
    } catch (e) { return serverError(res, 'runReport', e); }
};

exports.createReport = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const name = String(req.body.name || '').trim();
        if (!name) return reply(res, 400, 'name is required.');
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        if (refusesFinancial(caller, check.value, res)) return undefined;
        const saved = await saveReport(caller, name, check.value);
        return res.status(201).json({ status: true, statusText: 'Report saved.', data: saved });
    } catch (e) { return serverError(res, 'createReport', e); }
};

exports.listReports = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const rows = await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS,
            data: [{ deletedStatusKey: { $ne: 1 }, ...access.ownedScope(caller) }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.json({ status: true, data: rows || [] });
    } catch (e) { return serverError(res, 'listReports', e); }
};

exports.getReportResult = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const rep = await loadManagedReport(caller, req.params.id, res);
        if (!rep) return undefined;
        if (refusesFinancial(caller, rep, res)) return undefined;
        const check = R.validateConfig(rep);
        const out = check.valid ? await runConfig(caller.companyId, check.value) : { rows: [], unit: 'count' };
        return res.json({ status: true, data: { report: rep, config: check.value, result: out.rows, unit: out.unit } });
    } catch (e) { return serverError(res, 'getReportResult', e); }
};

exports.updateReport = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const rep = await loadManagedReport(caller, req.params.id, res);
        if (!rep) return undefined;
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        if (refusesFinancial(caller, check.value, res)) return undefined;
        const set = { ...check.value, updatedBy: caller.uid };
        if (req.body.name !== undefined) set.name = String(req.body.name).trim();
        const updated = await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS,
            data: [{ _id: rep._id }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return reply(res, 404, 'Not found.');
        removeCache(`saved_reports:${caller.companyId}`);
        return res.json({ status: true, statusText: 'Report updated.', data: updated });
    } catch (e) { return serverError(res, 'updateReport', e); }
};

exports.deleteReport = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const rep = await loadManagedReport(caller, req.params.id, res);
        if (!rep) return undefined;
        await MongoDbCrudOpration(caller.companyId, {
            type: SCHEMA_TYPE.SAVED_REPORTS,
            data: [{ _id: rep._id }, { $set: { deletedStatusKey: 1, updatedBy: caller.uid } }],
        }, 'updateOne');
        removeCache(`saved_reports:${caller.companyId}`);
        return res.json({ status: true, statusText: 'Report removed.' });
    } catch (e) { return serverError(res, 'deleteReport', e); }
};

exports.listTemplates = async (req, res) => {
    try {
        return res.json({ status: true, data: T.listTemplates() });
    } catch (e) { return serverError(res, 'listTemplates', e); }
};

exports.createFromTemplate = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const tpl = T.getTemplate(req.body && req.body.templateKey);
        if (!tpl) return reply(res, 404, 'Unknown template.');
        const check = R.validateConfig(tpl.config);
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        if (refusesFinancial(caller, check.value, res)) return undefined;
        const name = String((req.body && req.body.name) || tpl.name).trim() || tpl.name;
        const saved = await saveReport(caller, name, check.value);
        return res.status(201).json({ status: true, statusText: 'Report created from template.', data: saved });
    } catch (e) { return serverError(res, 'createFromTemplate', e); }
};

exports.duplicateReport = async (req, res) => {
    try {
        const caller = await callerFor(req, res);
        if (!caller) return undefined;
        const src = await loadManagedReport(caller, req.params.id, res);
        if (!src) return undefined;
        const check = R.validateConfig(src);
        if (!check.valid) return reply(res, 400, check.errors.join('; '));
        if (refusesFinancial(caller, check.value, res)) return undefined;
        const saved = await saveReport(caller, `${src.name} (copy)`, check.value);
        return res.status(201).json({ status: true, statusText: 'Report duplicated.', data: saved });
    } catch (e) { return serverError(res, 'duplicateReport', e); }
};
