const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { projectAccess, isCompanyAdmin, isCompanyMember } = require('../../../Config/contentAccess');
const { pageVisibleTo } = require('../../Pages/helpers/pageRules');
const { canSeeSprint, sprintIdentities } = require('../../Sprints/helpers/sprintVisibility');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const NOT_FOUND = Object.freeze({ ok: false, statusCode: 404 });
const ALLOWED = Object.freeze({ ok: true, statusCode: 200 });

const fromProject = async (companyId, uid, projectId) => {
    const access = await projectAccess(companyId, uid, projectId);
    if (access.canEdit) return ALLOWED;
    return access.visible ? { ok: false, statusCode: 403 } : NOT_FOUND;
};

const findOne = (companyId, type, filter) => MongoDbCrudOpration(companyId, { type, data: [filter] }, 'findOne');

/*
 * Whether `uid` may create, read the token of, change or revoke a public link to this
 * entity: they must be able to edit the project the entity lives in. A saved report
 * aggregates every project unless it is filtered to one, so an unfiltered report is
 * owner/admin only. `privateDoc` marks the author's own private doc: they may manage an
 * existing link, but a new one is refused because the renderer would not serve it. A
 * private sprint is marked the same way.
 */
const canManageShare = async ({ companyId, uid, entityType, entityId }) => {
    const user = String(uid || '');
    if (!OBJECT_ID.test(String(entityId || '')) || !OBJECT_ID.test(user)) return NOT_FOUND;
    const _id = new mongoose.Types.ObjectId(String(entityId));

    if (entityType === 'page') {
        const page = await findOne(companyId, SCHEMA_TYPE.PAGES, { _id, deletedStatusKey: 0 });
        if (!page || !pageVisibleTo(page, user)) return NOT_FOUND;
        const decision = page.ProjectID
            ? await fromProject(companyId, user, page.ProjectID)
            : ((await isCompanyMember(companyId, user)) ? ALLOWED : NOT_FOUND);
        return String(page.visibility || '') === 'private' && decision.ok ? { ...decision, privateDoc: true } : decision;
    }
    if (entityType === 'sprint') {
        const sprint = await findOne(companyId, SCHEMA_TYPE.SPRINTS, { _id, deletedStatusKey: { $ne: 1 } });
        if (!sprint) return NOT_FOUND;
        const decision = await fromProject(companyId, user, sprint.projectId);
        if (sprint.private !== true) return decision;
        /* A private sprint is only its assignees' to publish, and like a private doc a new
         * link is refused outright: the sharer sets it back to Shared first. An existing
         * link keeps serving while its author can still see the sprint, and stops the
         * moment they cannot — the same rule the project half of this check already uses. */
        if (!(await isCompanyAdmin(companyId, user)) && !canSeeSprint(sprint, await sprintIdentities(companyId, user))) return NOT_FOUND;
        return decision.ok ? { ...decision, privateDoc: true } : decision;
    }
    if (entityType === 'form') {
        const form = await findOne(companyId, SCHEMA_TYPE.FORMS, { _id, deletedStatusKey: 0 });
        return form ? fromProject(companyId, user, form.ProjectID) : NOT_FOUND;
    }
    if (entityType === 'client_view') {
        return fromProject(companyId, user, entityId);
    }
    if (entityType === 'report') {
        const report = await findOne(companyId, SCHEMA_TYPE.SAVED_REPORTS, { _id, deletedStatusKey: { $ne: 1 } });
        if (!report) return NOT_FOUND;
        const project = report.filters && report.filters.project;
        if (project) return fromProject(companyId, user, project);
        if (await isCompanyAdmin(companyId, user)) return ALLOWED;
        return (await isCompanyMember(companyId, user)) ? { ok: false, statusCode: 403 } : NOT_FOUND;
    }
    return NOT_FOUND;
};

/*
 * Checked on every public request rather than fixed once by a migration: access is lost
 * all the time (removed from a project, a space made private, a member leaving), and a
 * link must stop working the moment its creator could no longer make it.
 */
const shareStillAuthorised = async (companyId, share) => {
    if (!share || !share.createdBy) return false;
    const decision = await canManageShare({
        companyId, uid: share.createdBy, entityType: share.entityType, entityId: share.entityId,
    });
    return decision.ok;
};

module.exports = { canManageShare, shareStillAuthorised };
