/**
 * Read-only evaluation pipeline for ONE task.
 *
 * Given (companyId, taskId), this:
 *   1. Reads the task from Mongo
 *   2. Extracts the Upwork ~token from TaskName
 *   3. Reads the recent comment thread (oldest → newest)
 *   4. Looks up the matching job in Postgres
 *   5. Calls the Managed Agent for a verdict
 *
 * Returns a diagnostics object. DOES NOT mutate any data — no status moves,
 * no comments posted, no Postgres writes. Each early-return sets `skipReason`
 * so the caller knows exactly why this task can't be (auto-)judged:
 *   task_not_found | no_token | no_comments | job_not_found
 *
 * This is the smallest piece the eventual cron will call once per task.
 */
'use strict';

const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const pg = require('./pgClient');
const { reviewProposal } = require('./managedAgentClient');

const MAX_COMMENTS = 8;
const MAX_COMMENT_CHARS = 2500;

// Comments are stored HTML-escaped; the agent should see the raw text.
function decodeEntities(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
}

async function getTask(companyId, taskId) {
    const oid = new mongoose.Types.ObjectId(taskId);
    return MongoDbCrudOpration(companyId, {
        type: dbCollections.TASKS,
        data: [
            { _id: oid },
            { TaskName: 1, statusKey: 1, sprintId: 1, folderObjId: 1, ProjectID: 1 },
        ],
    }, 'findOne');
}

// Don't filter by `type`: a proposal containing a URL is sometimes stored as
// "link" rather than "text"; the text always lives in `message`. We also don't
// assume the proposal is the LAST comment — threads can mix proposal versions,
// status notes, review remarks, and chit-chat. The agent itself is responsible
// for picking the actual proposal out of the thread.
async function getRecentComments(companyId, taskId) {
    const oid = new mongoose.Types.ObjectId(taskId);
    const list = await MongoDbCrudOpration(companyId, {
        type: dbCollections.COMMENTS,
        data: [
            { taskId: { $in: [oid, String(taskId)] }, isDeleted: { $ne: true }, message: { $nin: ['', null] } },
            { message: 1, userId: 1, createdAt: 1 },
        ],
    }, 'find').catch(() => []);
    const sorted = (Array.isArray(list) ? list : [])
        .filter((c) => c && typeof c.message === 'string' && c.message.trim())
        .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
    return sorted.slice(-MAX_COMMENTS).map((c) => ({
        userId: String(c.userId || ''),
        text: decodeEntities(c.message).trim().slice(0, MAX_COMMENT_CHARS),
    }));
}

/**
 * @param {string} companyId  Multi-tenant Mongo database name.
 * @param {string} taskId     Mongo _id of the task to evaluate.
 * @returns {Promise<{
 *   companyId: string, taskId: string,
 *   task: object|null, token: string|null,
 *   commentsCount: number, commentsPreview: object[],
 *   job: object|null,
 *   verdict: object|null,
 *   skipReason: 'task_not_found'|'no_token'|'no_comments'|'job_not_found'|null
 * }>}
 */
async function evaluateOne(companyId, taskId) {
    const result = {
        companyId,
        taskId,
        task: null,
        token: null,
        commentsCount: 0,
        commentsPreview: [],
        job: null,
        verdict: null,
        skipReason: null,
    };

    const task = await getTask(companyId, taskId);
    if (!task) { result.skipReason = 'task_not_found'; return result; }
    result.task = {
        _id: String(task._id),
        TaskName: task.TaskName,
        statusKey: task.statusKey,
        sprintId: String(task.sprintId || ''),
        ProjectID: String(task.ProjectID || ''),
    };

    const token = pg.extractToken(task.TaskName);
    result.token = token;
    if (!token) { result.skipReason = 'no_token'; return result; }

    const comments = await getRecentComments(companyId, task._id);
    result.commentsCount = comments.length;
    result.commentsPreview = comments.map((c) => ({
        userId: c.userId,
        text: c.text.length > 140 ? c.text.slice(0, 140) + '… [truncated]' : c.text,
    }));
    if (!comments.length) { result.skipReason = 'no_comments'; return result; }

    const job = await pg.findJobByToken(token);
    if (!job) { result.skipReason = 'job_not_found'; return result; }
    result.job = {
        jobId: job.jobId,
        title: job.title,
        descriptionLen: (job.description || '').length,
        questionsCount: Array.isArray(job.questions) ? job.questions.length : 0,
    };

    result.verdict = await reviewProposal({
        job: { title: job.title, description: job.description, questions: job.questions },
        thread: comments,
    });

    return result;
}

module.exports = { evaluateOne };
