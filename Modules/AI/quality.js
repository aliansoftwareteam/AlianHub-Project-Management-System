const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const spend = require('../AICore/spend');
const budgetRead = require('../AICore/budgetRead');
const askEval = require('./askEval');

/* The AI quality page: owners and admins only. It names no person; a shared answer appears only because
 * the person who rated it ticked "include the answer". */

const WINDOWS = Object.freeze([7, 30, 90]);
const DEFAULT_DAYS = 30;
const DAY = 86400000;
const LIMITS = Object.freeze({ ROWS: 5000, DISLIKED: 10, NOTES: 3, SHARED: 3, RUNS_KEPT: 20 });

const feedbackStore = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.AI_FEEDBACK, data }, method);
const runsStore = (companyId, data, method) => MongoDbCrudOpration(String(companyId), { type: SCHEMA_TYPE.AI_EVAL_RUNS, data }, method);

const fail = (res, statusCode, code, statusText) => res.status(statusCode).send({ status: false, statusText, message: statusText, code });

const refused = async (req, res) => {
    const companyId = String(req.headers['companyid'] || '');
    if (!companyId || !req.uid) return fail(res, 401, 'unauthenticated', 'Unauthorized.');
    if (req.agentRun || req.apiToken) {
        const { resolveActor, isAgent } = require('../Agents/actor');
        if (isAgent(await resolveActor(req))) return fail(res, 403, 'owner_admin_only', 'Owner/admin only.');
    }
    if (!isPrivileged(await getRoleType(companyId, req.uid))) return fail(res, 403, 'owner_admin_only', 'Owner/admin only.');
    return null;
};

const dayOf = (date) => new Date(date).toISOString().slice(0, 10);
const monthOf = (date) => date.toISOString().slice(0, 7);

const tally = (rows, keyOf, name) => {
    const out = new Map();
    rows.forEach((row) => {
        const key = keyOf(row) || '';
        const cur = out.get(key) || { [name]: key, up: 0, down: 0 };
        cur[row.rating === 'up' ? 'up' : 'down'] += 1;
        out.set(key, cur);
    });
    return [...out.values()].sort((a, b) => (b.up + b.down) - (a.up + a.down) || String(a[name]).localeCompare(String(b[name])));
};

const seriesOf = (rows, days, now) => {
    const buckets = new Map();
    for (let i = days - 1; i >= 0; i -= 1) buckets.set(dayOf(now.getTime() - i * DAY), { day: dayOf(now.getTime() - i * DAY), up: 0, down: 0 });
    rows.forEach((row) => {
        const bucket = buckets.get(dayOf(row.createdAt));
        if (bucket) bucket[row.rating === 'up' ? 'up' : 'down'] += 1;
    });
    return [...buckets.values()];
};

const dislikedOf = async (companyId, rows, since) => {
    const items = new Map();
    rows.forEach((row) => {
        const key = `${row.feature}:${row.itemId}`;
        const cur = items.get(key) || { feature: row.feature, kind: row.kind, itemId: row.itemId, model: row.model || '', up: 0, down: 0, reasons: {}, notes: [], last: 0 };
        if (row.rating === 'up') cur.up += 1;
        else {
            cur.down += 1;
            (row.reasons || []).forEach((reason) => { cur.reasons[reason] = (cur.reasons[reason] || 0) + 1; });
            if (row.note && cur.notes.length < LIMITS.NOTES) cur.notes.push(row.note);
        }
        cur.last = Math.max(cur.last, new Date(row.createdAt).getTime());
        items.set(key, cur);
    });
    const top = [...items.values()].filter((item) => item.down > 0)
        .sort((a, b) => b.down - a.down || (b.down - b.up) - (a.down - a.up) || b.last - a.last)
        .slice(0, LIMITS.DISLIKED);
    if (!top.length) return [];
    const shared = await feedbackStore(companyId, [
        { shared: true, createdAt: { $gte: since }, itemId: { $in: top.map((item) => item.itemId) } },
        'feature itemId answer sources createdAt', { sort: { createdAt: -1 }, lean: true },
    ], 'find');
    return top.map(({ last, ...item }) => ({
        ...item,
        shared: (shared || []).filter((row) => row.feature === item.feature && row.itemId === item.itemId).slice(0, LIMITS.SHARED)
            .map((row) => ({ answer: row.answer || '', sources: (row.sources || []).map((s) => ({ kind: s.kind, id: s.sourceId, ref: s.ref || '' })), at: row.createdAt })),
    }));
};

const heldOutView = (run) => (run ? {
    suite: run.suite, passed: run.passed, total: run.total, ranAt: run.ranAt,
    failures: (run.failures || []).map((f) => ({ question: f.question, expected: f.expected || [], got: f.got || [] })),
} : null);

const latestRun = async (companyId) => {
    const rows = await runsStore(companyId, [{ suite: askEval.SUITE }, null, { sort: { ranAt: -1 }, limit: 1, lean: true }], 'find');
    return heldOutView(rows && rows[0]);
};

/* GET /api/v1/ai/quality?days=30 */
const getQuality = async (req, res) => {
    try {
        const stop = await refused(req, res);
        if (stop) return stop;
        const companyId = String(req.headers['companyid']);
        const asked = Number((req.query && req.query.days) || DEFAULT_DAYS);
        const days = WINDOWS.includes(asked) ? asked : DEFAULT_DAYS;
        const now = new Date();
        const since = new Date(now.getTime() - (days - 1) * DAY);
        since.setUTCHours(0, 0, 0, 0);
        const rows = (await feedbackStore(companyId, [
            { createdAt: { $gte: since } }, 'feature kind itemId model rating reasons note createdAt', { sort: { createdAt: -1 }, limit: LIMITS.ROWS, lean: true },
        ], 'find')) || [];
        const [disliked, heldOut, cost] = await Promise.all([
            dislikedOf(companyId, rows, since),
            latestRun(companyId),
            spend.monthly(companyId, monthOf(now)).catch((error) => {
                if (!budgetRead.isUnavailable(error)) throw error;
                return { unavailable: true, usedUsd: null, features: [] };
            }),
        ]);
        const up = rows.filter((row) => row.rating === 'up').length;
        return res.send({
            status: true,
            data: {
                days,
                ratings: {
                    up,
                    down: rows.length - up,
                    byFeature: tally(rows, (row) => row.feature, 'feature'),
                    byModel: tally(rows, (row) => row.model, 'model'),
                    series: seriesOf(rows, days, now),
                },
                disliked,
                heldOut,
                cost: { month: monthOf(now), ...cost },
            },
        });
    } catch (error) {
        logger.error(`ai quality: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

/* POST /api/v1/ai/quality/held-out — runs the held-out Ask questions now, without a model, and keeps the result */
const runHeldOut = async (req, res) => {
    try {
        const stop = await refused(req, res);
        if (stop) return stop;
        const companyId = String(req.headers['companyid']);
        const result = askEval.runHeldOut();
        const run = { ...result, ranBy: String(req.uid), ranAt: new Date() };
        await runsStore(companyId, run, 'save');
        const extra = await runsStore(companyId, [{ suite: askEval.SUITE }, '_id', { sort: { ranAt: -1 }, skip: LIMITS.RUNS_KEPT, lean: true }], 'find');
        if (extra && extra.length) await runsStore(companyId, [{ _id: { $in: extra.map((r) => r._id) } }], 'deleteMany');
        return res.send({ status: true, statusText: 'Held-out set run.', data: heldOutView(run) });
    } catch (error) {
        logger.error(`ai quality held-out: ${error.message}`);
        return res.status(500).send({ status: false, statusText: error.message });
    }
};

module.exports = { WINDOWS, getQuality, runHeldOut };
