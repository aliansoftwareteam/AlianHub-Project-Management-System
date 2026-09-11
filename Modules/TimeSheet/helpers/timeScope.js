const { getRoleType, isPrivileged } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');

const SCOPE_COMPANY = 'company';
const SCOPE_SELF = 'self';

/* Owners and admins read company-wide time and money; everyone else reads their own
 * time, or the projects they can open. The role comes from req.uid, never the body. */
const resolveTimeScope = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    const companyWide = isPrivileged(roleType);
    return {
        uid: String(uid || ''),
        roleType,
        companyWide,
        canSeeMoney: companyWide,
        label: companyWide ? SCOPE_COMPANY : SCOPE_SELF,
    };
};

/* null means every project. */
const visibleProjectsFor = async (companyId, scope) => {
    if (scope.companyWide) return null;
    if (scope.roleType === null || !scope.uid) return [];
    return (await visibleProjectIds(companyId, scope.uid)).map(String);
};

module.exports = { resolveTimeScope, visibleProjectsFor, SCOPE_COMPANY, SCOPE_SELF };
