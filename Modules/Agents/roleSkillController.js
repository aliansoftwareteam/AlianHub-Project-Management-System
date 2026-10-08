const { tenantOf, TenantError } = require('../../Config/tenant');
const logger = require('../../Config/loggerConfig');
const { callerOf } = require('./access');
const rolesFlag = require('../Mcp/rolesFlag');
const rolePlaybooks = require('./rolePlaybooks');
const roleSkill = require('./roleSkill');

const fail = (res, message, code) => res.status(code).send({ status: false, statusText: message, message });

/* GET /api/v2/agents/roles/:blueprint/:slug/skill — one role playbook as a Claude skill zip. */
exports.downloadRoleSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!rolesFlag.enabled()) return fail(res, 'Role skills are not available on this server.', 404);
        const caller = await callerOf(req, companyId);
        if (!caller.human || !(caller.member || caller.privileged)) return fail(res, 'Only a member of this workspace can download a role.', 403);
        const role = rolePlaybooks.find(req.params.blueprint, req.params.slug);
        if (!role) return fail(res, 'Role not found.', 404);
        const zip = await roleSkill.skillZip(role);
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${roleSkill.skillName(role)}.zip"`);
        return res.status(200).send(zip);
    } catch (e) {
        if (e instanceof TenantError) return fail(res, e.message, e.statusCode);
        logger.error(`role skill download: ${e && e.message}`);
        return fail(res, 'The role could not be prepared; try again.', 500);
    }
};
