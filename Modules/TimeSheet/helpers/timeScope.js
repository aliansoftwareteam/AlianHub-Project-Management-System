const { IANAZone } = require('luxon');
const { getRoleType, isPrivileged, evaluatePermission } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');

const SCOPE_COMPANY = 'company';
const SCOPE_SELF = 'self';
const PERMISSION_EVERYONE = 2;
const DEFAULT_TIME_ZONE = 'UTC';
const UTC_OFFSET = /^[+-](0\d|1[0-4]):[0-5]\d$/;

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

const grantsEveryone = async (companyId, uid, permissionKey) => {
    const permission = await Promise.resolve()
        .then(() => evaluatePermission(companyId, uid, permissionKey))
        .catch(() => null);
    return permission === true || permission === PERMISSION_EVERYONE;
};

/* The timesheet screens let the permission matrix grant a non-admin "Everyone"; that
 * still stops at the projects they can open. Any failure reads as their own time only.
 * A route that several screens call takes each screen's key, and any of them can grant it. */
const resolveSheetScope = async (companyId, uid, permissionKeys) => {
    const scope = await resolveTimeScope(companyId, uid);
    let everyone = scope.companyWide;
    if (!everyone && scope.roleType !== null) {
        const keys = Array.isArray(permissionKeys) ? permissionKeys : [permissionKeys];
        everyone = (await Promise.all(keys.map((key) => grantsEveryone(companyId, uid, key)))).some(Boolean);
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

/* The web app reads a plan's person from UserId and the desktop tracker from userId;
 * a row without UserId belongs to its userId. */
const scopedEstimateMatch = (scope) => {
    const match = {};
    if (!scope.everyone) match.$or = [{ UserId: scope.uid }, { UserId: { $exists: false }, userId: scope.uid }];
    if (scope.visible && (scope.everyone || scope.roleType === null)) match.ProjectId = { $in: scope.visible };
    return match;
};

/* $dateToString evaluates its timezone as an expression, so a body value only gets there as a zone name or offset. */
const safeTimeZone = (zone) => (typeof zone === 'string' && (UTC_OFFSET.test(zone) || IANAZone.isValidZone(zone)) ? zone : DEFAULT_TIME_ZONE);

const asList = (value) => (Array.isArray(value) ? value : []);
const filtersOfType = (selectedFilter, type) => asList(selectedFilter).filter((filter) => filter && filter.type === type);

module.exports = {
    resolveTimeScope,
    visibleProjectsFor,
    resolveSheetScope,
    scopedTimeMatch,
    scopedEstimateMatch,
    safeTimeZone,
    asList,
    filtersOfType,
    SHEET_PERMISSION,
    SCOPE_COMPANY,
    SCOPE_SELF,
};
