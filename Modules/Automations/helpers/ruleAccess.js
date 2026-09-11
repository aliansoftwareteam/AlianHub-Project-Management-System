const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const scope = require('../../Agents/scope');
const { canEditProject } = require('../../AIProjectGenerator/projectAccess');

const MANAGE_REFUSED = 'Only owners and admins can manage automations.';
const PROJECT_REFUSED = 'You cannot edit a project this automation targets.';

const canManageRules = async (companyId, uid) => isPrivileged(await getRoleType(companyId, uid));

/* An all-projects rule has no single target, so only the role check applies to it. */
const ruleProjectIds = (rule = {}) => {
    const ids = [];
    if (rule.scope && rule.scope.allProjects === false) ids.push(...(rule.scope.projectIds || []));
    if (rule.conditions && rule.conditions.projectId) ids.push(rule.conditions.projectId);
    return [...new Set(ids.map(String).filter(Boolean))];
};

/* null when the caller may save `rule`, otherwise { code, statusText }. */
const refuseRuleWrite = async ({ companyId, uid, rule }) => {
    if (!(await canManageRules(companyId, uid))) return { code: 403, statusText: MANAGE_REFUSED };
    for (const projectId of ruleProjectIds(rule)) {
        const access = await canEditProject({ companyId, uid, projectId });
        if (!access.projectId) return { code: 403, statusText: PROJECT_REFUSED };
    }
    return null;
};

const visibleProjectIds = (companyId, uid) => scope.visibleProjectIds(companyId, String(uid));

module.exports = { canManageRules, ruleProjectIds, refuseRuleWrite, visibleProjectIds, MANAGE_REFUSED, PROJECT_REFUSED };
