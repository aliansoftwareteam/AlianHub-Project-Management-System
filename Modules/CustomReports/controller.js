const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/reportRules');

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// Execute a validated config against tasks → [{ label, value }] rows.
const runConfig = async (companyId, cfg) => {
    const pipeline = R.buildPipeline(cfg);
    const rows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [pipeline] }, 'aggregate');
    return (rows || []).map((r) => ({
        label: (r._id === null || r._id === undefined || r._id === '') ? '(none)' : String(r._id),
        value: r.value || 0,
    }));
};

// POST /api/v1/reports/custom/run — live preview, no save.
exports.runReport = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const check = R.validateConfig(req.body || {});
        if (!check.valid) return res.status(400).json({ status: false, statusText: check.errors.join('; ') });
        const result = await runConfig(companyId, check.value);
        return res.json({ status: true, data: { config: check.value, result } });
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
        const result = check.valid ? await runConfig(companyId, check.value) : [];
        return res.json({ status: true, data: { report: rep, config: check.value, result } });
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
