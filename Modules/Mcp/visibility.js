const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { getRoleType } = require('../../Config/permissionGuard');
const { isPrivileged } = require('../../Config/roleTypes');
const { visibleProjectIds } = require('../Agents/scope');
const { hiddenSprintIds } = require('../Sprints/helpers/sprintVisibility');
const { pageVisibleTo } = require('../Pages/helpers/pageRules');
const { othersPersonalListIds } = require('../PersonalList/ownership');
const { companyWideMatch, readsCompanyWide } = require('../Tasks/helpers/taskQueryGuard');
const { idForms } = require('../../utils/mongo-handler/objectIdKeys');

// What an MCP caller may read or act on: exactly what the person behind the token
// could open in the web app (Modules/Tasks/helpers/taskQueryGuard visibilityStage),
// narrowed further by the token's own project list. It never widens either.

/* What a task read must carry for allowsTask to judge it. */
const TASK_ACCESS_FIELDS = Object.freeze({ ProjectID: 1, sprintId: 1, mainChat: 1, AssigneeUserId: 1 });

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NOT_VISIBLE = 'not_visible';

const isId = (v) => OBJECT_ID.test(String(v || ''));
const toOid = (v) => new mongoose.Types.ObjectId(String(v));

/* `personalLists` is given for an owner or admin, who reads company-wide: the personal lists that are
 * someone else's. Everyone else's project list already leaves those out, and for them it stays null. */
const build = ({ uid, projectIds, hidden, tokenNarrowed, personalLists = null }) => {
    const hiddenSet = new Set(hidden.map(String));
    const projectSet = projectIds === null ? null : new Set(projectIds.map(String));
    const companyWide = personalLists !== null;
    const excluded = new Set((personalLists || []).map(String));

    const allowsProject = (id) => isId(id) && !excluded.has(String(id)) && (projectSet === null || projectSet.has(String(id)));
    const allowsSprint = (id) => !id || !hiddenSet.has(String(id));
    const allowsTask = (task) => Boolean(task) && allowsProject(task.ProjectID) && allowsSprint(task.sprintId)
        && readsCompanyWide(task, uid, [...excluded]);
    // A page outside every project is company-wide; a project-restricted token was never granted those.
    const allowsPage = (page) => pageVisibleTo(page, uid)
        && (page.ProjectID ? allowsProject(page.ProjectID) : !tokenNarrowed);

    /* A find clause for tasks. `narrowTo` is a caller's projectId argument: it can only
     * shrink the set, so a project outside the filter matches nothing. */
    const taskClause = (narrowTo) => {
        let ids = projectIds;
        if (isId(narrowTo)) ids = allowsProject(narrowTo) ? [String(narrowTo)] : [];
        return {
            ...(ids === null ? {} : { ProjectID: { $in: ids.map(toOid) } }),
            ...(hiddenSet.size ? { sprintId: { $nin: [...hiddenSet].map(toOid) } } : {}),
            ...(companyWide ? companyWideMatch(uid, [...excluded]) : {}),
        };
    };

    const pageClause = () => ({
        $and: [
            { $or: [{ visibility: { $ne: 'private' } }, { createdBy: String(uid) }] },
            projectIds === null
                ? (tokenNarrowed ? { ProjectID: { $nin: [null, undefined] } } : {})
                : { $or: [{ ProjectID: { $in: projectIds.map(toOid) } }, ...(tokenNarrowed ? [] : [{ ProjectID: { $in: [null, undefined] } }])] },
            ...(excluded.size ? [{ ProjectID: { $nin: idForms([...excluded]) } }] : []),
        ],
    });

    return { projectIds, hiddenSprintIds: [...hiddenSet], excludedProjectIds: [...excluded], allowsProject, allowsSprint, allowsTask, allowsPage, taskClause, pageClause };
};

const forCaller = async (ctx) => {
    const companyId = String(ctx.companyId || '');
    const uid = String(ctx.userId || '');
    const tokenList = (Array.isArray(ctx.projectIds) ? ctx.projectIds : []).map(String);
    const tokenNarrowed = tokenList.length > 0;
    const inToken = (id) => !tokenNarrowed || tokenList.includes(String(id));

    const roleType = await getRoleType(companyId, uid);
    if (roleType === null) return build({ uid, projectIds: [], hidden: [], tokenNarrowed });
    if (isPrivileged(roleType)) {
        const personalLists = await othersPersonalListIds(companyId, uid);
        const listed = tokenNarrowed ? tokenList.filter((id) => isId(id) && !personalLists.includes(id)) : null;
        return build({ uid, projectIds: listed, hidden: [], tokenNarrowed, personalLists });
    }

    const projectIds = (await visibleProjectIds(companyId, uid)).map(String).filter(inToken);
    const hidden = await hiddenSprintIds(companyId, uid, projectIds);
    return build({ uid, projectIds, hidden, tokenNarrowed });
};

const refuse = (reason) => Object.assign(new Error(`${NOT_VISIBLE}: ${reason}`), { notVisible: true });

/* Throws unless the write's target — a task, or a project and optional sprint — is inside `vis`. */
const assertWritable = async (companyId, vis, { taskId, projectId, sprintId } = {}) => {
    if (taskId !== undefined) {
        const task = isId(taskId)
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id: toOid(taskId), deletedStatusKey: { $ne: 1 } }, TASK_ACCESS_FIELDS] }, 'findOne')
            : null;
        if (!vis.allowsTask(task)) throw refuse('the task is not one the person behind this token can open');
    }
    if (projectId !== undefined && !vis.allowsProject(projectId)) {
        throw refuse('the project is not one the person behind this token can open');
    }
    if (sprintId) {
        const sprint = isId(sprintId)
            ? await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.SPRINTS, data: [{ _id: toOid(sprintId) }, { projectId: 1 }] }, 'findOne')
            : null;
        if (!sprint || String(sprint.projectId) !== String(projectId) || !vis.allowsSprint(sprintId)) {
            throw refuse('the sprint is not one the person behind this token can open in that project');
        }
    }
};

module.exports = { forCaller, assertWritable, NOT_VISIBLE, TASK_ACCESS_FIELDS };
