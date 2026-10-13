const logger = require('../../Config/loggerConfig');
const changeNotice = require('./changeNotice');

const fail = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

/* GET /api/v2/agents/changes?ids=a,b: what the signed-in person's own connected agent just changed. */
const getChanges = async (req, res) => {
    try {
        const companyId = String((req.headers && req.headers.companyid) || '');
        if (!companyId || !req.uid) return fail(res, 401, 'Unauthorized.');
        if (req.apiToken) return fail(res, 403, 'Only a signed-in person can read what their agent changed.');
        const ids = String((req.query && req.query.ids) || '').split(',').map((id) => id.trim()).filter(Boolean);
        return res.json({ status: true, statusText: 'Agent changes fetched.', data: await changeNotice.describe(companyId, req.uid, ids) });
    } catch (e) { logger.error(`getChanges: ${e.message}`); return fail(res, 500, e.message); }
};

module.exports = { getChanges };
