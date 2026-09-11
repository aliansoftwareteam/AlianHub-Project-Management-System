const { getRoleType, isPrivileged, evaluatePermission } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');

const SCOPE_COMPANY = 'company';
const SCOPE_SELF = 'self';
const PERMISSION_EVERYONE = 2;

const SHEET_PERMISSION = Object.freeze({
    user: 'sheet_settings.user_timesheet',
    project: 'sheet_settings.project_timesheet',
    workload: 'sheet_settings.workload_timesheet',
    tracker: 'sheet_settings.tracker_timesheet',
});

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

/* The timesheet screens let the permission matrix grant a non-admin "Everyone"; that
 * still stops at the projects they can open. Any failure reads as their own time only. */
const resolveSheetScope = async (companyId, uid, permissionKey) => {
    const scope = await resolveTimeScope(companyId, uid);
    let everyone = scope.companyWide;
    if (!everyone && scope.roleType !== null) {
        const permission = await Promise.resolve()
            .then(() => evaluatePermission(companyId, uid, permissionKey))
            .catch(() => null);
        everyone = permission === true || permission === PERMISSION_EVERYONE;
    }
    return { ...scope, everyone, visible: await visibleProjectsFor(companyId, scope) };
};

/* userIds and projectIds are the filters the client asked for; null means none. */
const scopedTimeMatch = (scope, { userIds = null, projectIds = null } = {}) => {
    const match = {};
    if (!scope.everyone) match.Loggeduser = scope.uid;
    else if (userIds) match.Loggeduser = { $in: userIds.map(String) };
    if (projectIds) {
        const wanted = projectIds.map(String);
        match.ProjectId = { $in: scope.visible ? wanted.filter((id) => scope.visible.includes(id)) : wanted };
    } else if (scope.visible && (scope.everyone || scope.roleType === null)) {
        match.ProjectId = { $in: scope.visible };
    }
    return match;
};

const asList = (value) => (Array.isArray(value) ? value : []);
const filtersOfType = (selectedFilter, type) => asList(selectedFilter).filter((filter) => filter && filter.type === type);

module.exports = {
    resolveTimeScope,
    visibleProjectsFor,
    resolveSheetScope,
    scopedTimeMatch,
    asList,
    filtersOfType,
    SHEET_PERMISSION,
    SCOPE_COMPANY,
    SCOPE_SELF,
};
