const logger = require('../../Config/loggerConfig');
const { sessionTenantOf } = require('../../Config/tenant');
const { KINDS, explain } = require('./helpers/explain');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

/* GET /api/v2/who-can-see/:kind/:id — the same 404 for "cannot see it" as for "does not exist". */
exports.whoCanSee = async (req, res) => {
    try {
        const { kind, id } = req.params || {};
        if (!KINDS.includes(kind) || !OBJECT_ID.test(String(id || ''))) {
            return res.status(400).json({ status: false, statusText: 'A project, sprint or page id is required.' });
        }
        const data = await explain(kind, sessionTenantOf(req), id, req.uid);
        if (!data) {
            return res.status(404).json({ status: false, statusText: 'Not found.' });
        }
        return res.json({ status: true, statusText: 'Who can see this.', data });
    } catch (error) {
        if (error.statusCode === 403) {
            return res.status(403).json({ status: false, statusText: error.message });
        }
        logger.error(`ERROR in who can see: ${error.message || error}`);
        return res.status(500).json({ status: false, statusText: 'Could not work out who can see this.' });
    }
};
