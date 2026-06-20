const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/portfolioRules');

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);
const oid = (id) => new mongoose.Types.ObjectId(String(id));

// POST /api/v1/portfolio — create a portfolio grouping N projects.
exports.createPortfolio = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ status: false, statusText: 'name is required.' });
        const projectIds = Array.isArray(req.body.projectIds) ? req.body.projectIds.map(String) : [];
        const data = {
            name, projectIds,
            description: String(req.body.description || '').slice(0, 1000),
            createdBy: String(req.uid || ''), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PORTFOLIOS, data }, 'save');
        removeCache(`portfolios:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Portfolio created.', data: saved });
    } catch (e) { logger.error(`createPortfolio: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/portfolio — list portfolios for the company.
exports.listPortfolios = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find');
        return res.json({ status: true, data: rows || [] });
    } catch (e) { logger.error(`listPortfolios: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// PUT /api/v1/portfolio/:id — rename / re-describe / change member projects.
exports.updatePortfolio = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const set = { updatedBy: String(req.uid || '') };
        if (req.body.name !== undefined) set.name = String(req.body.name).trim();
        if (req.body.description !== undefined) set.description = String(req.body.description).slice(0, 1000);
        if (Array.isArray(req.body.projectIds)) set.projectIds = req.body.projectIds.map(String);
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS,
            data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.status(404).json({ status: false, statusText: 'Not found.' });
        removeCache(`portfolios:${companyId}`);
        return res.json({ status: true, statusText: 'Portfolio updated.', data: updated });
    } catch (e) { logger.error(`updatePortfolio: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// DELETE /api/v1/portfolio/:id — soft delete.
exports.deletePortfolio = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS,
            data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        removeCache(`portfolios:${companyId}`);
        return res.json({ status: true, statusText: 'Portfolio removed.' });
    } catch (e) { logger.error(`deletePortfolio: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

// GET /api/v1/portfolio/:id/rollup — the cross-project leadership rollup:
// per-project progress / at-risk / milestones + portfolio totals, from real data.
exports.getRollup = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const portfolio = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS, data: [{ _id: oid(req.params.id) }],
        }, 'findOne');
        if (!portfolio || portfolio.deletedStatusKey === 1) return res.status(404).json({ status: false, statusText: 'Not found.' });
        const projectIds = Array.isArray(portfolio.projectIds) ? portfolio.projectIds : [];
        const nowMs = Date.now();

        const projectDocs = projectIds.length
            ? await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.PROJECTS,
                data: [{ _id: { $in: projectIds.map(oid) }, deletedStatusKey: { $nin: [1] } }, 'ProjectName status statusType DueDate'],
            }, 'find')
            : [];
        const projById = {};
        (projectDocs || []).forEach((p) => { projById[String(p._id)] = p; });

        const projects = (await Promise.all(projectIds.map(async (pid) => {
            const proj = projById[String(pid)];
            if (!proj) return null; // deleted / inaccessible — skip
            const tasks = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ ProjectID: String(pid), deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true }, '_id statusType DueDate'],
            }, 'find');
            let milestones = [];
            try {
                milestones = await MongoDbCrudOpration(companyId, {
                    type: SCHEMA_TYPE.MILESTONE, data: [{ projectId: String(pid) }],
                }, 'find') || [];
            } catch (e) { milestones = []; }
            const summary = R.summarizeProject(tasks || [], nowMs);
            return {
                projectId: String(pid),
                name: proj.ProjectName || '(untitled)',
                status: proj.status || '',
                ...summary,
                milestones: R.summarizeMilestones(milestones, nowMs),
            };
        }))).filter(Boolean);

        const totals = R.rollupPortfolio(projects);
        return res.json({
            status: true,
            data: {
                portfolio: { _id: portfolio._id, name: portfolio.name, description: portfolio.description || '' },
                totals,
                projects,
            },
        });
    } catch (e) { logger.error(`getRollup: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
