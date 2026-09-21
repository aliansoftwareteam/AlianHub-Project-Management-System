const grants = require('./grants');
const store = require('./store');
const workspaces = require('./workspaces');
const logger = require('../../Config/loggerConfig');

const GRANT_ID = /^[a-f0-9]{32}$/;

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

const personOrRefuse = (req, res) => {
    if (req.apiToken || !req.uid) {
        refuse(res, 403, 'An API token cannot see or revoke the apps a person connected.');
        return false;
    }
    return true;
};

/* A metadata document client has no row of its own; the workspace's approval remembers its name. */
const clientNames = async (rows) => {
    const byId = new Map();
    const approvalRows = await store.approvals.namesFor(rows.map((row) => ({ companyId: row.companyId, clientId: row.clientId })));
    for (const row of approvalRows) if (row.clientName) byId.set(`${row.companyId}|${row.clientId}`, row.clientName);
    const missing = [...new Set(rows.filter((row) => !byId.has(`${row.companyId}|${row.clientId}`)).map((row) => row.clientId))];
    const found = await Promise.all(missing.map((clientId) => store.clients.find(clientId).catch(() => null)));
    const fromRows = new Map(found.filter(Boolean).map((client) => [client.clientId, client.name]));
    return (row) => byId.get(`${row.companyId}|${row.clientId}`) || fromRows.get(row.clientId) || row.clientId;
};

exports.list = async (req, res) => {
    try {
        if (!personOrRefuse(req, res)) return undefined;
        const rows = await grants.liveGrantsOf(req.uid);
        const [nameOf, workspaceNames] = await Promise.all([clientNames(rows), workspaces.namesOf(rows.map((row) => row.companyId))]);
        const data = rows.map((row) => ({
            grantId: row.grantId,
            clientId: row.clientId,
            clientName: nameOf(row),
            companyId: row.companyId,
            workspaceName: workspaceNames.get(String(row.companyId)) || '',
            scopes: row.scopes || [],
            createdAt: row.createdAt,
            lastUsedAt: row.lastUsedAt || null,
            expiresAt: row.expiresAt,
        }));
        return res.send({ status: true, statusText: 'Connected apps fetched.', data });
    } catch (error) {
        logger.error(`ERROR in list oauth grants: ${error.message}`);
        return refuse(res, 500, 'Something went wrong.');
    }
};

exports.revoke = async (req, res) => {
    try {
        if (!personOrRefuse(req, res)) return undefined;
        const grantId = String(req.params.grantId || '');
        if (!GRANT_ID.test(grantId) || !(await grants.revokeOwnGrant(req.uid, grantId))) return refuse(res, 404, 'No such connected app.');
        return res.send({ status: true, statusText: 'Connected app revoked.' });
    } catch (error) {
        logger.error(`ERROR in revoke oauth grant: ${error.message}`);
        return refuse(res, 500, 'Something went wrong.');
    }
};
