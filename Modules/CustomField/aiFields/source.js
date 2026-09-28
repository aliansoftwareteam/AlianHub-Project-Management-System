const crypto = require('crypto');
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { taskIdMatch } = require('../../Comments/helpers/taskIdMatch');

const TITLE_CAP = 300;
const DESCRIPTION_CAP = 3000;
const COMMENT_CAP = 600;
const MAX_COMMENTS = 30;
const MAX_SUBTASKS = 30;

const TASK_PROJECTION = Object.freeze({ TaskName: 1, description: 1, rawDescription: 1, ProjectID: 1, status: 1, customField: 1, aiFieldFills: 1, CompanyId: 1 });

const clamp = (value, cap) => {
    const flat = String(value == null ? '' : value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
};

const plainMentions = (message) => String(message || '').replace(/\[([^\]]+)\]\([0-9a-f]{24}\)/gi, '@$1');

async function comments(companyId, taskId) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[
            { $match: { taskId: taskIdMatch(String(taskId)), isDeleted: { $ne: true }, $or: [{ type: 'text' }, { type: 'link' }, { type: { $exists: false } }] } },
            { $sort: { createdAt: -1 } },
            { $limit: MAX_COMMENTS },
            { $sort: { createdAt: 1 } },
            { $project: { message: 1, createdAt: 1 } },
        ]],
    }, 'aggregate').catch(() => []);
    return (rows || []).map((row) => clamp(plainMentions(row.message), COMMENT_CAP)).filter(Boolean);
}

async function subtasks(companyId, task) {
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.TASKS,
        data: [{ ParentTaskId: String(task._id), ProjectID: task.ProjectID, deletedStatusKey: { $nin: [1, 2] } }, { TaskName: 1, status: 1 }, { limit: MAX_SUBTASKS }],
    }, 'find').catch(() => []);
    return (rows || []).map((row) => {
        const name = clamp(row.TaskName, TITLE_CAP);
        const status = row.status && row.status.text ? ` (${clamp(row.status.text, 40)})` : '';
        return name ? `${name}${status}` : '';
    }).filter(Boolean);
}

/* Only the parts the field reads are loaded, so the prompt never carries more than the field asked for.
 * The caller has already checked the person can open this task, and the parts are all of this task. */
async function readParts({ companyId, task, reads }) {
    const parts = {};
    if (reads.includes('title')) parts.title = clamp(task.TaskName, TITLE_CAP);
    if (reads.includes('description')) parts.description = clamp(task.rawDescription || task.description, DESCRIPTION_CAP);
    if (reads.includes('comments')) parts.comments = await comments(companyId, task._id);
    if (reads.includes('subtasks')) parts.subtasks = await subtasks(companyId, task);
    return parts;
}

const hasContent = (parts) => Object.values(parts).some((value) => (Array.isArray(value) ? value.length : Boolean(value)));

const hashOf = (parts) => crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 20);

const loadTask = (companyId, taskId) => MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.TASKS,
    data: [{ _id: new mongoose.Types.ObjectId(String(taskId)), deletedStatusKey: { $ne: 1 } }, TASK_PROJECTION],
}, 'findOne');

module.exports = { readParts, hasContent, hashOf, loadTask, TASK_PROJECTION };
