const { tenantOf, TenantError } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const llmProvider = require('../AICore/llmProvider');
const aiSwitch = require('../AICore/aiSwitch');
const { isInstanceOwner } = require('../Instance/guard');

const refuse = (res, code, statusText) => res.status(code).send({ status: false, statusText });

const companyOf = (req, res) => {
    try {
        return tenantOf(req);
    } catch (error) {
        if (!(error instanceof TenantError)) throw error;
        refuse(res, error.statusCode, error.message);
        return '';
    }
};

async function describeFor(req, companyId, roleType) {
    const [availability, instanceOwner] = await Promise.all([
        llmProvider.availability(companyId),
        req.apiToken ? false : isInstanceOwner(req.uid),
    ]);
    return {
        ...availability,
        canManageWorkspace: !req.apiToken && isPrivileged(roleType),
        canConfigureInstance: Boolean(instanceOwner),
    };
}

exports.getAvailability = async (req, res) => {
    try {
        const companyId = companyOf(req, res);
        if (!companyId) return undefined;
        const roleType = await getRoleType(companyId, req.uid);
        if (roleType === null || roleType === undefined) return refuse(res, 403, 'You are not a member of this workspace.');
        return res.send({ status: true, statusText: 'AI availability.', data: await describeFor(req, companyId, roleType) });
    } catch (error) {
        logger.error(`ERROR in ai availability: ${error.message}`);
        return refuse(res, 500, 'Something went wrong.');
    }
};

exports.setWorkspaceSwitch = async (req, res) => {
    try {
        const companyId = companyOf(req, res);
        if (!companyId) return undefined;
        if (req.apiToken) return refuse(res, 403, 'An API token cannot change the AI switch.');
        const roleType = await getRoleType(companyId, req.uid);
        if (!isPrivileged(roleType)) return refuse(res, 403, 'Only an owner or admin can turn AI on or off for the workspace.');
        const enabled = req.body && req.body.enabled;
        if (typeof enabled !== 'boolean') return refuse(res, 400, '"enabled" must be true or false.');
        await aiSwitch.setWorkspaceEnabled(companyId, enabled, req.uid);
        socketEmitter.emit('update', { type: 'update', module: 'aiSwitch', companyId: String(companyId), data: { enabled }, updatedFields: { aiSwitch: enabled } });
        logger.info(`ai switch: ${req.uid} turned AI ${enabled ? 'on' : 'off'} for company ${companyId}`);
        return res.send({ status: true, statusText: enabled ? 'AI is on for this workspace.' : 'AI is off for this workspace.', data: await describeFor(req, companyId, roleType) });
    } catch (error) {
        logger.error(`ERROR in ai switch: ${error.message}`);
        if (error.statusCode === 404) return refuse(res, 404, error.message);
        return refuse(res, 500, 'Something went wrong.');
    }
};
