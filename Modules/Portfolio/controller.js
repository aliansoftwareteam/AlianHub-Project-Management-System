const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const { myCache } = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/portfolioRules');
const { getProvider, isAnyProviderConfigured } = require('../AIProjectGenerator/llmProvider');

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

// The cross-project leadership rollup: per-project progress / at-risk /
// milestones + portfolio totals, from real data. Shared by the rollup endpoint
// and the summary endpoint so the paragraph can never describe different
// numbers from the ones on screen.
const buildRollup = async (companyId, portfolioId) => {
    const portfolio = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PORTFOLIOS, data: [{ _id: oid(portfolioId) }],
    }, 'findOne');
    if (!portfolio || portfolio.deletedStatusKey === 1) return null;
    const projectIds = Array.isArray(portfolio.projectIds) ? portfolio.projectIds : [];
    const nowMs = Date.now();

    const projectDocs = projectIds.length
        ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: { $in: projectIds.map(oid) }, deletedStatusKey: { $nin: [1, 2] }, status: { $ne: 'close' } }, 'ProjectName status statusType DueDate'],
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
            dueDate: proj.DueDate || null,
            ...summary,
            milestones: R.summarizeMilestones(milestones, nowMs),
        };
    }))).filter(Boolean);

    return {
        portfolio: { _id: portfolio._id, name: portfolio.name, description: portfolio.description || '' },
        totals: R.rollupPortfolio(projects),
        projects,
    };
};

// GET /api/v1/portfolio/:id/rollup
exports.getRollup = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const data = await buildRollup(companyId, req.params.id);
        if (!data) return res.status(404).json({ status: false, statusText: 'Not found.' });
        return res.json({ status: true, data });
    } catch (e) { logger.error(`getRollup: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};

const SUMMARY_SYSTEM_PROMPT = [
    'You write the weekly portfolio note for the person accountable for these projects.',
    'You are given the exact figures the screen shows. Use only those figures — never invent a name, a date, a cause or a number.',
    'Write 2 to 4 sentences of plain prose: what is at risk and why the numbers say so, then what is on track.',
    'No headings, no bullet points, no markdown, no greeting, no sign-off.',
].join(' ');

const summaryFacts = (rollup) => ({
    portfolio: rollup.portfolio.name,
    totals: rollup.totals,
    projects: rollup.projects.map((p) => ({
        name: p.name,
        health: p.health,
        progressPct: p.progressPct,
        openTasks: p.open,
        overdueTasks: p.overdue,
        milestonesOverdue: p.milestones ? p.milestones.overdue : 0,
    })),
});

const dayStamp = () => new Date().toISOString().slice(0, 10);

// POST /api/v1/portfolio/summary { portfolioId } — a written digest of THIS
// portfolio's real numbers, cached one per company per portfolio per day so a
// team refreshing the page does not spend a model call each time. With no
// provider configured the screen keeps its figures and simply has no paragraph.
exports.getPortfolioSummary = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return res.status(400).json({ status: false, statusText: 'companyId is required.' });
        const portfolioId = String((req.body && req.body.portfolioId) || '');
        if (!portfolioId) return res.status(400).json({ status: false, statusText: 'portfolioId is required.' });

        if (!isAnyProviderConfigured()) {
            return res.json({ status: true, data: { summary: null, reason: 'no-provider' } });
        }

        const cacheKey = `portfolio_summary:${companyId}:${portfolioId}:${dayStamp()}`;
        const cached = myCache.get(cacheKey);
        if (cached) return res.json({ status: true, data: { ...cached, cached: true } });

        const rollup = await buildRollup(companyId, portfolioId);
        if (!rollup) return res.status(404).json({ status: false, statusText: 'Not found.' });
        if (!rollup.projects.length) {
            return res.json({ status: true, data: { summary: null, reason: 'no-projects' } });
        }

        let result;
        try {
            const provider = getProvider();
            result = await provider.chat({
                systemPrompt: SUMMARY_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify(summaryFacts(rollup)) }],
                maxTokens: 400,
                temperature: 0.2,
            });
        } catch (llmError) {
            logger.error(`getPortfolioSummary llm: ${llmError.message}`);
            return res.json({ status: true, data: { summary: null, reason: 'unavailable' } });
        }

        const summary = String((result && result.content) || '').trim();
        if (!summary) return res.json({ status: true, data: { summary: null, reason: 'unavailable' } });
        const payload = { summary, model: (result && result.model) || '', generatedAt: new Date().toISOString() };
        myCache.set(cacheKey, payload, 86400);
        return res.json({ status: true, data: payload });
    } catch (e) { logger.error(`getPortfolioSummary: ${e.message}`); return res.status(500).json({ status: false, statusText: e.message }); }
};
