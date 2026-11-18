const { tenantOf } = require('../../Config/tenant');
const { ok, fail } = require('../../Config/respond');
const logger = require('../../Config/loggerConfig');
const delegation = require('./delegation');
const endpoints = require('./endpoints');
const { publicView } = require('./rules');
const { requestAddress } = require('../../utils/requestAddress');


const handle = (label, fn) => async (req, res) => {
    try {
        return await fn(req, res, { companyId: tenantOf(req), uid: String(req.uid || '') });
    } catch (error) {
        if (error instanceof delegation.DelegationError) return fail(res, error.message, error.statusCode, error.code ? { code: error.code } : {});
        logger.error(`agent sessions: ${label}: ${error.message}`);
        return fail(res, 'Something went wrong.', 500);
    }
};

exports.listForTask = handle('list', async (req, res, { companyId, uid }) => {
    const rows = await delegation.listForTask({ companyId, uid, taskId: String(req.query.taskId || '') });
    return ok(res, { statusText: 'Agent sessions.', data: rows.map((row) => publicView(row)) });
});

exports.delegate = handle('delegate', async (req, res, { companyId, uid }) => {
    const body = req.body || {};
    const { session, delivered } = await delegation.delegate({ companyId, uid, taskId: String(body.taskId || ''), clientId: String(body.clientId || ''), ip: requestAddress(req) });
    return ok(res, { statusText: delivered ? 'Delegated.' : 'Delegated, but the outside agent could not be told.', data: publicView(session) });
});

exports.listEndpoints = handle('list endpoints', async (req, res, { companyId, uid }) => ok(res, {
    statusText: 'Delivery URLs.', data: await endpoints.list({ companyId, uid }),
}));

exports.saveEndpoint = handle('save endpoint', async (req, res, { companyId, uid }) => {
    const body = req.body || {};
    const saved = await endpoints.save({ companyId, uid, clientId: String(body.clientId || ''), url: String(body.url || ''), ip: requestAddress(req) });
    return ok(res, { statusText: 'Saved. Keep the secret now; it is not shown again.', data: saved });
});
