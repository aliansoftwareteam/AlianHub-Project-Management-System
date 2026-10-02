'use strict';

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const { memberProfiles } = require('../../utils/companyMembers');
const { visibleProjectIds, visibleProjects } = require('../Agents/scope');
const { canReadTask } = require('../Tasks/helpers/taskReadAccess');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const { pageReachFilter } = require('../Pages/helpers/pageRules');
const { taskIdMatch } = require('../Comments/helpers/taskIdMatch');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const MAX_COMMENTS = 30;
const MAX_SUBTASKS = 30;
const MAX_DOCS = 8;

const TASK_FIELDS = 'TaskName TaskKey ProjectID sprintId sprintArray status statusType Task_Priority DueDate rawDescription checklistArray AssigneeUserId mainChat ParentTaskId';

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const clip = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const statusName = (t) => ((t.status && typeof t.status === 'object') ? t.status.text : t.status) || t.statusType || '';
const stripMentions = (message) => String(message || '').replace(/\[([^\]]+)\]\([0-9a-f]{24}\)/gi, '@$1');

const loadSubtasks = async (companyId, uid, task) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{
        ParentTaskId: { $in: [String(task._id), oid(task._id)] },
        ProjectID: task.ProjectID,
        deletedStatusKey: { $ne: 1 },
        ...(await hiddenSprintFilter(companyId, uid, [task.ProjectID])),
    }, 'TaskName TaskKey status statusType', { limit: MAX_SUBTASKS }],
}, 'find');

/* A private doc is its author's alone, and a doc in a project the caller cannot open stays out
 * even when it is linked to a task they can. */
const loadDocs = async (companyId, uid, task) => {
    const visible = await visibleProjectIds(companyId, uid);
    return MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.PAGES,
        data: [{
            linkedTasks: oid(task._id),
            deletedStatusKey: { $ne: 1 },
            ...pageReachFilter({ uid, projectIds: visible.map(oid) }),
        }, 'title rawText ProjectID', { limit: MAX_DOCS }],
    }, 'find');
};

const loadComments = async (companyId, task) => {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[
            { $match: { taskId: taskIdMatch(String(task._id)), isDeleted: { $ne: true }, $or: [{ type: 'text' }, { type: 'link' }, { type: { $exists: false } }] } },
            { $sort: { createdAt: -1 } },
            { $limit: MAX_COMMENTS },
            { $sort: { createdAt: 1 } },
            { $project: { message: 1, userId: 1, createdAt: 1 } },
        ]],
    }, 'aggregate');
    const comments = rows || [];
    const names = {};
    try {
        (await memberProfiles(companyId, [...new Set(comments.map((c) => String(c.userId)))], { Employee_Name: 1 }))
            .forEach((user) => { names[String(user._id)] = user.Employee_Name; });
    } catch (error) {
        logger.error(`task context: names not resolved: ${error.message}`);
    }
    return comments.map((c) => ({ message: stripMentions(c.message), who: names[String(c.userId)] || 'Someone', createdAt: c.createdAt }));
};

/* Everything an AI answer about one task may read: the task, its comments, subtasks and linked
 * docs, each held to the caller's own access. Null when the caller cannot open the task. */
async function taskContext({ companyId, uid, taskId, tokenProjectIds = [] }) {
    if (!companyId || !uid || !OBJECT_ID.test(String(taskId || ''))) return null;
    const task = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ _id: oid(taskId), deletedStatusKey: { $ne: 1 } }, TASK_FIELDS],
    }, 'findOne');
    if (!task || !task.ProjectID) return null;
    if (tokenProjectIds.length && !tokenProjectIds.map(String).includes(String(task.ProjectID))) return null;
    if (!(await canReadTask(companyId, String(uid), task))) return null;
    const [subtasks, docs, comments] = await Promise.all([
        loadSubtasks(companyId, uid, task),
        loadDocs(companyId, uid, task),
        loadComments(companyId, task),
    ]);
    return { task, subtasks: subtasks || [], docs: docs || [], comments };
}

const refOf = (task) => task.TaskKey || String(task._id).slice(-6);

/* The context as Ask sources, so the answer cites them the way a workspace answer does. */
function taskSources({ task, subtasks, docs, comments }, projectName = '') {
    const projectId = String(task.ProjectID || '');
    const base = { project: projectName, projectId };
    const checklist = (task.checklistArray || []).map((item) => item && item.name).filter(Boolean).slice(0, 20).join('; ');
    const sources = [{
        ...base,
        kind: 'task',
        id: String(task._id),
        ref: refOf(task),
        title: clip(task.TaskName, 160),
        detail: clip([statusName(task), task.Task_Priority, task.rawDescription, checklist && `checklist: ${checklist}`].filter(Boolean).join(' · '), 1500),
    }];
    comments.forEach((c, i) => sources.push({
        ...base,
        kind: 'comment',
        id: `${task._id}:c${i + 1}`,
        ref: `c${i + 1}`,
        title: `${c.who}${c.createdAt ? ` (${new Date(c.createdAt).toISOString().slice(0, 10)})` : ''}`,
        detail: clip(c.message, 600),
    }));
    subtasks.forEach((s) => sources.push({ ...base, kind: 'task', id: String(s._id), ref: refOf(s), title: clip(s.TaskName, 160), detail: clip(`subtask · ${statusName(s)}`, 120) }));
    docs.forEach((d) => sources.push({ ...base, kind: 'page', id: String(d._id), ref: `page:${String(d._id).slice(-6)}`, title: clip(d.title, 160), detail: clip(d.rawText, 1200) }));
    return sources;
}

/* Ask's material for a question about one task, in the shape gather() returns; null when the
 * caller cannot open the task. */
async function gatherForTask(companyId, uid, taskId, tokenProjectIds = []) {
    const ctx = await taskContext({ companyId, uid, taskId, tokenProjectIds });
    if (!ctx) return null;
    const project = (await visibleProjects(companyId, uid)).find((p) => String(p._id) === String(ctx.task.ProjectID));
    return {
        sources: taskSources(ctx, project ? project.ProjectName || '' : ''),
        projects: project ? [project] : [],
        scopedProjectIds: [String(ctx.task.ProjectID)],
        focus: `This question is about task [${refOf(ctx.task)}]. The sources are that task, its comments, its subtasks and its linked docs.`,
    };
}

module.exports = { taskContext, taskSources, gatherForTask, statusName, clip, refOf };
