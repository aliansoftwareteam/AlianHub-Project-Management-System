const logger = require('../../Config/loggerConfig');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { resolveActor, isAgent } = require('./actor');
const metrics = require('./metrics');
const alerts = require('./alerts');

const fail = (res, statusText, code) => res.status(code).send({ status: false, statusText, message: statusText });

/* Owner and admin people only, the same gate as the agent settings; null when the request may proceed. */
const refuse = async (req, res) => {
    const companyId = req.headers.companyid || '';
    if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
    const actor = req.agentActor || await resolveActor(req);
    if (isAgent(actor) || !actor.userId || !isPrivileged(await getRoleType(companyId, req.uid))) return fail(res, 'Owner/admin only.', 403);
    return null;
};

/* GET /api/v2/agents/metrics?window=24h */
exports.getMetrics = async (req, res) => {
    try {
        const companyId = req.headers.companyid || '';
        const refused = await refuse(req, res);
        if (refused) return refused;
        const windowName = String((req.query && req.query.window) || metrics.DEFAULT_WINDOW);
        if (!metrics.isWindow(windowName)) return fail(res, `window must be one of ${Object.keys(metrics.WINDOWS).join(', ')}.`, 400);
        const data = await metrics.cachedCompanyMetrics(String(companyId), windowName);
        return res.send({ status: true, statusText: 'Agent metrics.', data });
    } catch (e) {
        logger.error(`getMetrics: ${e.message}`);
        return fail(res, e.message, e.status || 500);
    }
};

/* GET /api/v2/agents/alerts — open incidents and the last week's resolved ones */
exports.getAlerts = async (req, res) => {
    try {
        const refused = await refuse(req, res);
        if (refused) return refused;
        const data = await alerts.cachedIncidents(String(req.headers.companyid));
        return res.send({ status: true, statusText: 'Agent alerts.', data });
    } catch (e) {
        logger.error(`getAlerts: ${e.message}`);
        return fail(res, e.message, e.status || 500);
    }
};

/* POST /api/v2/agents/alerts/evaluate — runs the evaluator for this company now instead of waiting for the job */
exports.evaluateAlerts = async (req, res) => {
    try {
        const refused = await refuse(req, res);
        if (refused) return refused;
        const data = await alerts.evaluateCompany(String(req.headers.companyid));
        return res.send({ status: true, statusText: 'Alerts evaluated.', data });
    } catch (e) {
        logger.error(`evaluateAlerts: ${e.message}`);
        return fail(res, e.message, e.status || 500);
    }
};

/* GET /api/v2/instance/metrics — Prometheus text exposition; the instance router's admin guard runs first. */
exports.instanceMetrics = async (req, res) => {
    try {
        const text = await metrics.cachedInstanceText();
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        return res.send(text);
    } catch (e) {
        logger.error(`instanceMetrics: ${e.message}`);
        return fail(res, e.message, 500);
    }
};
