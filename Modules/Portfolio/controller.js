const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { keepVisibleProjectIds } = require('../../Config/projectAccess');
const { getRoleType } = require('../../Config/permissionGuard');
const { isPrivileged } = require('../../Config/roleTypes');
const { narrowingFor } = require('../../Config/tokenNarrowing');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');
const { removeCache } = require('../../utils/commonFunctions');
const { myCache } = require('../../Config/config');
const logger = require('../../Config/loggerConfig');
const R = require('./helpers/portfolioRules');
const { getProvider, isAnyProviderConfigured } = require('../AICore/llmProvider');
const { FEATURES } = require('../AICore/features');

const { sessionTenantOf, TenantError } = require('../../Config/tenant');
const failed = (res, where, e) => {
    if (e instanceof TenantError) return res.status(e.statusCode).json({ status: false, statusText: e.message });
    logger.error(`${where}: ${e.message}`);
    return res.status(500).json({ status: false, statusText: e.message });
};
const oid = (id) => new mongoose.Types.ObjectId(String(id));

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const idsOf = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter((id) => OBJECT_ID.test(id)))];
const plain = (doc) => (doc && doc.toObject ? doc.toObject() : { ...doc });

/* Owners and admins see every portfolio unless a token narrows them to some projects. */
const seesEveryPortfolio = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid)) && !narrowingFor(uid);

const shown = (portfolio, visible, canDelete) => ({ ...plain(portfolio), projectIds: idsOf(portfolio.projectIds).filter((id) => visible.has(id)), canDelete });

/* A portfolio is seen by whoever can open one of its projects, by its creator, and by owners and
 * admins; `visible` holds the project ids the caller can open, and only those are named. Other
 * people use it, so seeing it is not enough to remove it: that is for the last three. */
const viewOf = (portfolio, uid, visible, seesAll) => {
    const view = shown(portfolio, visible, seesAll || String(portfolio.createdBy || '') === String(uid));
    return view.projectIds.length || view.canDelete ? view : null;
};

const openableIn = async (companyId, uid, portfolio) => new Set(await keepVisibleProjectIds(companyId, uid, idsOf(portfolio.projectIds)));

const findVisible = async (companyId, uid, id) => {
    if (!OBJECT_ID.test(String(id || ''))) return null;
    const portfolio = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PORTFOLIOS, data: [{ _id: oid(id), deletedStatusKey: { $ne: 1 } }],
    }, 'findOne');
    if (!portfolio) return null;
    const view = viewOf(portfolio, uid, await openableIn(companyId, uid, portfolio), await seesEveryPortfolio(companyId, uid));
    return view ? { portfolio, view } : null;
};

const notFound = (res) => res.status(404).json({ status: false, statusText: 'Not found.' });

// POST /api/v1/portfolio — create a portfolio grouping N projects.
exports.createPortfolio = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ status: false, statusText: 'name is required.' });
        const data = {
            name,
            projectIds: await keepVisibleProjectIds(companyId, req.uid, idsOf(req.body.projectIds)),
            description: String(req.body.description || '').slice(0, 1000),
            createdBy: String(req.uid || ''), deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.PORTFOLIOS, data }, 'save');
        removeCache(`portfolios:${companyId}`);
        return res.status(201).json({ status: true, statusText: 'Portfolio created.', data: saved });
    } catch (e) { return failed(res, 'createPortfolio', e); }
};

// GET /api/v1/portfolio — the portfolios the caller may see.
exports.listPortfolios = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { updatedAt: -1 } }],
        }, 'find') || [];
        const [visibleIds, seesAll] = await Promise.all([
            keepVisibleProjectIds(companyId, req.uid, rows.flatMap((row) => idsOf(row.projectIds))),
            seesEveryPortfolio(companyId, req.uid),
        ]);
        const visible = new Set(visibleIds);
        return res.json({ status: true, data: rows.map((row) => viewOf(row, req.uid, visible, seesAll)).filter(Boolean) });
    } catch (e) { return failed(res, 'listPortfolios', e); }
};

// PUT /api/v1/portfolio/:id — rename / re-describe / change member projects.
exports.updatePortfolio = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const found = await findVisible(companyId, req.uid, req.params.id);
        if (!found) return notFound(res);
        const set = { updatedBy: String(req.uid || '') };
        if (req.body.name !== undefined) set.name = String(req.body.name).trim();
        if (req.body.description !== undefined) set.description = String(req.body.description).slice(0, 1000);
        if (Array.isArray(req.body.projectIds)) {
            /* The editor chooses among the projects they can open; the rest of the portfolio is not theirs to drop. */
            const unseen = idsOf(found.portfolio.projectIds).filter((id) => !found.view.projectIds.includes(id));
            const chosen = await keepVisibleProjectIds(companyId, req.uid, idsOf(req.body.projectIds));
            set.projectIds = [...unseen, ...chosen];
        }
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS,
            data: [{ _id: oid(req.params.id), deletedStatusKey: { $ne: 1 } }, { $set: set }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return notFound(res);
        removeCache(`portfolios:${companyId}`);
        /* Answered to the editor even when they just removed the last project that let them see it. */
        const data = shown(updated, await openableIn(companyId, req.uid, updated), found.view.canDelete);
        return res.json({ status: true, statusText: 'Portfolio updated.', data });
    } catch (e) { return failed(res, 'updatePortfolio', e); }
};

// DELETE /api/v1/portfolio/:id — soft delete.
exports.deletePortfolio = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const found = await findVisible(companyId, req.uid, req.params.id);
        if (!found) return notFound(res);
        if (!found.view.canDelete) {
            return res.status(403).json({ status: false, statusText: 'Only its creator, an owner or an admin can remove a portfolio.' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PORTFOLIOS,
            data: [{ _id: oid(req.params.id) }, { $set: { deletedStatusKey: 1 } }],
        }, 'updateOne');
        removeCache(`portfolios:${companyId}`);
        return res.json({ status: true, statusText: 'Portfolio removed.' });
    } catch (e) { return failed(res, 'deletePortfolio', e); }
};

/* Per-project progress, overdue load and milestones with the portfolio totals, counted from the
 * tasks the caller can open. Shared by the rollup and the summary so the paragraph describes the
 * numbers on screen; `audience` tells apart callers whose numbers may differ. */
const buildRollup = async (companyId, portfolioId, uid) => {
    const found = await findVisible(companyId, uid, portfolioId);
    if (!found) return null;
    const { view } = found;
    const { projectIds } = view;
    const nowMs = Date.now();

    const projectDocs = projectIds.length
        ? await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: { $in: projectIds.map(oid) }, deletedStatusKey: { $nin: [1, 2] }, status: { $ne: 'close' } }, 'ProjectName status statusType DueDate'],
        }, 'find')
        : [];
    const projById = {};
    (projectDocs || []).forEach((p) => { projById[String(p._id)] = p; });
    const hiddenSprints = await hiddenSprintFilter(companyId, uid, projectIds);

    const projects = (await Promise.all(projectIds.map(async (pid) => {
        const proj = projById[String(pid)];
        if (!proj) return null;
        const tasks = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ ProjectID: String(pid), deletedStatusKey: { $in: [0, 2, undefined] }, isParentTask: true, mainChat: { $ne: true }, ...hiddenSprints }, '_id statusType DueDate'],
        }, 'find');
        let milestones = [];
        try {
            milestones = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.MILESTONE, data: [{ projectId: { $in: idForms(pid) } }],
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

    const hiddenSprintIds = ((hiddenSprints.sprintId || {}).$nin || []).map(String).sort();
    return {
        audience: crypto.createHash('sha1').update(`${projects.map((p) => p.projectId).sort().join(',')}|${hiddenSprintIds.join(',')}`).digest('hex').slice(0, 16),
        rollup: {
            portfolio: { _id: view._id, name: view.name, description: view.description || '' },
            totals: R.rollupPortfolio(projects),
            projects,
        },
    };
};

// GET /api/v1/portfolio/:id/rollup
exports.getRollup = async (req, res) => {
    try {
        const companyId = sessionTenantOf(req);
        const built = await buildRollup(companyId, req.params.id, req.uid);
        if (!built) return notFound(res);
        return res.json({ status: true, data: built.rollup });
    } catch (e) { return failed(res, 'getRollup', e); }
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
        const companyId = sessionTenantOf(req);
        const portfolioId = String((req.body && req.body.portfolioId) || '');
        if (!portfolioId) return res.status(400).json({ status: false, statusText: 'portfolioId is required.' });

        if (!isAnyProviderConfigured()) {
            return res.json({ status: true, data: { summary: null, reason: 'no-provider' } });
        }

        const built = await buildRollup(companyId, portfolioId, req.uid);
        if (!built) return notFound(res);
        const { rollup, audience } = built;
        if (!rollup.projects.length) {
            return res.json({ status: true, data: { summary: null, reason: 'no-projects' } });
        }

        // Callers see different projects and sprints, so one caller's paragraph must never be served to another.
        const cacheKey = `portfolio_summary:${companyId}:${portfolioId}:${dayStamp()}:${audience}`;
        const cached = myCache.get(cacheKey);
        if (cached) return res.json({ status: true, data: { ...cached, cached: true } });

        let result;
        try {
            const provider = getProvider();
            result = await provider.chat({
                systemPrompt: SUMMARY_SYSTEM_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify(summaryFacts(rollup)) }],
                maxTokens: 400,
                temperature: 0.2,
                spend: { feature: FEATURES.PORTFOLIO_SUMMARY, companyId, userId: req.uid },
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
    } catch (e) { return failed(res, 'getPortfolioSummary', e); }
};
