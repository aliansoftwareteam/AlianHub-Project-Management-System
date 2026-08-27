'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { answerWorkspaceQuestion } = require('./pageAi');
const {
    pageReadableBy,
    pageInVisibleProjects,
    PAGE_CAP,
    TASK_CAP,
} = require('./pageWorkspaceAsk');
const { standupWindow, permissionScope } = require('./pageStandup');

const STANDUP_TASK_CAP = 80;
const STANDUP_COMMENT_CAP = 80;
const TASK_FIELDS = 'TaskName TaskKey ProjectID status statusType relations createdAt updatedAt lastMessage deletedStatusKey';
const COMMENT_FIELDS = 'taskId TaskId message createdAt projectId isDeleted';

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

function projectIdVariants(projectId) {
    const pid = String(projectId || '');
    const variants = [pid];
    if (mongoose.Types.ObjectId.isValid(pid)) variants.push(new mongoose.Types.ObjectId(pid));
    return variants;
}

async function gatherStandupContext({ companyId, uid, projectId, window: windowName, now }) {
    const window = standupWindow(windowName, now);
    const missing = permissionScope({ projectId, restrictProjects: false });
    if (!missing.allowed) {
        return { ...missing, window, pages: [], tasks: [], comments: [] };
    }

    const visible = await visibleProjectsForAsk(companyId, uid);
    const scoped = permissionScope({
        projectId,
        visibleProjectIds: visible.ids,
        restrictProjects: visible.restrictProjects,
    });
    if (!scoped.allowed) {
        return { ...scoped, window, pages: [], tasks: [], comments: [] };
    }

    const projectIds = projectIdVariants(scoped.projectId);
    const since = window.since;
    const tasks = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{
            ProjectID: { $in: projectIds },
            deletedStatusKey: 0,
            $or: [
                { createdAt: { $gte: since } },
                { updatedAt: { $gte: since } },
                { lastMessage: { $gte: since } },
                { 'relations.type': 'blocked_by' },
            ],
        }, TASK_FIELDS, { sort: { updatedAt: -1 }, limit: STANDUP_TASK_CAP }],
    }, 'find').catch(() => []);

    const comments = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{
            projectId: { $in: projectIds },
            isDeleted: { $ne: true },
            createdAt: { $gte: since },
        }, COMMENT_FIELDS, { sort: { createdAt: -1 }, limit: STANDUP_COMMENT_CAP }],
    }, 'find').catch(() => []);

    const known = new Set((tasks || []).map((row) => String(row._id || row.id || '')));
    const missingIds = [];
    for (const comment of comments || []) {
        const id = String(comment.taskId || comment.TaskId || '').trim();
        if (!id || id === 'default' || known.has(id)) continue;
        if (mongoose.Types.ObjectId.isValid(id)) missingIds.push(new mongoose.Types.ObjectId(id));
        known.add(id);
    }

    let extra = [];
    if (missingIds.length) {
        extra = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{
                _id: { $in: missingIds },
                ProjectID: { $in: projectIds },
                deletedStatusKey: 0,
            }, TASK_FIELDS],
        }, 'find').catch(() => []);
    }

    return {
        allowed: true,
        projectId: scoped.projectId,
        window,
        pages: [],
        tasks: (tasks || []).concat(extra || []),
        comments: comments || [],
    };
}

module.exports = {
    callerRoleType,
    visibleProjectsForAsk,
    gatherWorkspaceAskContext,
    gatherStandupContext,
    runWorkspaceAsk,
};
