'use strict';

const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { answerWorkspaceQuestion } = require('./pageAi');
const {
    pageReadableBy,
    pageInVisibleProjects,
    PAGE_CAP,
    TASK_CAP,
} = require('./pageWorkspaceAsk');

async function callerRoleType(companyId, uid) {
    if (!uid) return 3;
    try {
        const row = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(uid), isDelete: { $ne: true } }, { roleType: 1 }],
        }, 'findOne');
        const role = Number(row && row.roleType);
        return Number.isFinite(role) && role > 0 ? role : 3;
    } catch (_e) {
        return 3;
    }
}

async function visibleProjectsForAsk(companyId, uid) {
    const roleType = await callerRoleType(companyId, uid);
    const restrictProjects = roleType !== 1 && roleType !== 2;
    const filter = { deletedStatusKey: { $ne: 1 } };
    if (restrictProjects) {
        filter.$or = [
            { isPrivateSpace: { $ne: true } },
            { AssigneeUserId: String(uid) },
        ];
    }
    const projects = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PROJECTS,
        data: [filter, '_id', { sort: { updatedAt: -1 }, limit: 80 }],
    }, 'find').catch(() => []);
    return {
        ids: (projects || []).map((row) => row._id),
        restrictProjects,
    };
}

async function gatherWorkspaceAskContext({ companyId, uid }) {
    const visible = await visibleProjectsForAsk(companyId, uid);
    const pageFilter = {
        deletedStatusKey: 0,
        $or: [{ visibility: { $ne: 'private' } }, { createdBy: uid }],
    };
    const pages = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [pageFilter, 'title rawText visibility createdBy ProjectID updatedAt', { sort: { updatedAt: -1 }, limit: 40 }],
    }, 'find').catch(() => []);

    const readablePages = (pages || []).filter((page) => (
        pageReadableBy(page, uid) && pageInVisibleProjects(page, visible.ids, visible.restrictProjects)
    )).slice(0, PAGE_CAP);

    const taskFilter = { deletedStatusKey: 0 };
    if (visible.restrictProjects) {
        taskFilter.ProjectID = { $in: visible.ids };
    }
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [taskFilter, 'TaskName TaskKey ProjectID updatedAt', { sort: { updatedAt: -1 }, limit: TASK_CAP }],
    }, 'find').catch(() => []);

    return { pages: readablePages, tasks: tasks || [] };
}

async function runWorkspaceAsk({ companyId, uid, question }) {
    const context = await gatherWorkspaceAskContext({ companyId, uid });
    return answerWorkspaceQuestion({
        question,
        pages: context.pages,
        tasks: context.tasks,
    });
}

module.exports = {
    callerRoleType,
    visibleProjectsForAsk,
    gatherWorkspaceAskContext,
    runWorkspaceAsk,
};
