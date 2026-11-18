const { IANAZone } = require('luxon');
const { getRoleType, isPrivileged, evaluatePermission } = require('../../../Config/permissionGuard');
const { visibleProjectIds } = require('../../Agents/scope');
const { idForms } = require('../../../utils/mongo-handler/objectIdKeys');
const { othersPersonalListIds } = require('../../PersonalList/ownership');
const { hiddenSprintIds } = require('../../Sprints/helpers/sprintVisibility');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');

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
 * time, or the projects they can open. The role comes from req.uid, never the body.
 * Company-wide stops at a personal list that is someone else's: `hidden` holds those. */
const resolveTimeScope = async (companyId, uid) => {
    const roleType = await getRoleType(companyId, uid);
    const companyWide = isPrivileged(roleType);
    return {
        uid: String(uid || ''),
        roleType,
        companyWide,
        canSeeMoney: companyWide,
        label: companyWide ? SCOPE_COMPANY : SCOPE_SELF,
        hidden: companyWide ? await othersPersonalListIds(companyId, String(uid)) : [],
    };
};

const hiddenFrom = (scope) => (scope && scope.hidden) || [];

/* For a read that names no project: a clause on the row's project field. */
const withoutHidden = (scope, field = 'ProjectId') => (hiddenFrom(scope).length ? { [field]: { $nin: idForms(hiddenFrom(scope)) } } : {});

/* For a read that names projects: the ones the scope leaves in. */
const openProjects = (scope, projectIds) => projectIds.map(String)
    .filter((id) => !hiddenFrom(scope).includes(id) && (!scope.visible || scope.visible.includes(id)));

const opensProject = (scope, projectId) => openProjects(scope, [projectId]).length === 1;

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
    const visible = await visibleProjectsFor(companyId, scope);
    const reading = { ...scope, everyone, visible };
    return everyone && !scope.companyWide ? readingEveryone(companyId, reading) : reading;
};

/* The private lists of the projects a scope reads that its person is not on. An owner or admin reads past them. */
const hiddenListsOf = async (companyId, scope) => {
    if (scope.hiddenLists) return scope.hiddenLists;
    return scope.companyWide || !scope.visible ? [] : hiddenSprintIds(companyId, scope.uid, scope.visible);
};

/* `scope` as it reads other people's rows: with the tasks it leaves theirs out for. Asked only by a read that
 * shows everyone's time or plans; a person reading their own needs none of it. */
const readingEveryone = async (companyId, scope) => {
    const hiddenLists = await hiddenListsOf(companyId, scope);
    return { ...scope, everyone: true, hiddenLists, closedTasks: await tasksOf(companyId, hiddenLists) };
};

/* The tasks of the private lists a person is not on. Their time and plans are their people's: someone who reads
 * everyone's time in a project reads, of those tasks, only what they logged or planned themselves. */
const tasksOf = async (companyId, listIds) => {
    if (!listIds.length) return [];
    const tasks = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ sprintId: { $in: listIds } }, { _id: 1 }] }, 'find');
    return (tasks || []).map((task) => String(task._id));
};

const closedTasksOf = (scope) => (scope && scope.everyone && scope.closedTasks) || [];

/* userIds and projectIds are the filters the client asked for; null means none. A project id
 * is matched in both stored forms until every time row holds it as an ObjectId (task 040). */
const scopedTimeMatch = (scope, { userIds = null, projectIds = null } = {}) => {
    const match = {};
    if (!scope.everyone) match.Loggeduser = scope.uid;
    else if (userIds) match.Loggeduser = { $in: userIds.map(String) };
    if (projectIds) {
        match.ProjectId = { $in: idForms(openProjects(scope, projectIds)) };
    } else if (scope.visible && (scope.everyone || scope.roleType === null)) {
        match.ProjectId = { $in: idForms(scope.visible) };
    } else {
        Object.assign(match, withoutHidden(scope));
    }
    if (closedTasksOf(scope).length) match.$or = [{ Loggeduser: scope.uid }, { TicketID: { $nin: idForms(closedTasksOf(scope)) } }];
    return match;
};

/* The web app reads a plan's person from UserId and the desktop tracker from userId;
 * a row without UserId belongs to its userId. */
const scopedEstimateMatch = (scope) => {
    const match = {};
    if (!scope.everyone) match.$or = [{ UserId: scope.uid }, { UserId: { $exists: false }, userId: scope.uid }];
    if (scope.visible && (scope.everyone || scope.roleType === null)) match.ProjectId = { $in: idForms(scope.visible) };
    else Object.assign(match, withoutHidden(scope));
    if (closedTasksOf(scope).length) match.$or = [{ UserId: scope.uid }, { TaskId: { $nin: idForms(closedTasksOf(scope)) } }];
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
    hiddenListsOf,
    readingEveryone,
    scopedTimeMatch,
    scopedEstimateMatch,
    withoutHidden,
    openProjects,
    opensProject,
    safeTimeZone,
    asList,
    filtersOfType,
    SHEET_PERMISSION,
    SCOPE_COMPANY,
    SCOPE_SELF,
};
