const logger = require('../../Config/loggerConfig');
const hostingMode = require('../../Config/hostingMode');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const { planUsage } = require('./planUsage');
const { workspaceState } = require('./guards');

const failed = (res, error) => {
    logger.error(`[entitlements] ${error && error.message ? error.message : error}`);
    return res.status(500).send({ status: false, statusText: 'Plan and usage could not be read just now.' });
};

exports.usage = async (req, res) => {
    try {
        if (!hostingMode.isManaged()) return res.send({ status: true, statusText: 'Self-hosted.', data: { managed: false } });
        const companyId = String(req.headers.companyid || '');
        const privileged = isPrivileged(await getRoleType(companyId, req.uid));
        return res.send({ status: true, statusText: 'Plan and usage.', data: await planUsage({ privileged }) });
    } catch (error) {
        return failed(res, error);
    }
};

exports.workspaces = async (req, res) => {
    try {
        if (!hostingMode.isManaged()) return res.send({ status: true, statusText: 'Self-hosted.', data: { managed: false, canCreate: true, limit: null } });
        const { count, limit, canCreate } = await workspaceState();
        return res.send({ status: true, statusText: 'Workspaces.', data: { managed: true, count, limit, canCreate, portalUrl: hostingMode.portalUrl() } });
    } catch (error) {
        return failed(res, error);
    }
};
