'use strict';

const mongoose = require('mongoose');
const { visibleTask, TASK_NOT_FOUND } = require('./taskAccess');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { memberProfiles } = require('../../utils/companyMembers');
const { taskIdMatch } = require('../Comments/helpers/taskIdMatch');
const values = require('./taskAiValues');
const { withTimeout } = require('./withTimeout');

const { FEATURES } = require('../AICore/features');
const { STATE, isAiOff } = require('../AICore/aiSwitch');

let providerFactory = null;
try {
    providerFactory = require('../AICore/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_COMMENTS = 40;
const COMMENT_CHAR_CAP = 800;

const SYSTEM_PROMPT = [
    'You summarise the discussion thread of a project-management task for a teammate who has not read it.',
    'Write 2-4 short sentences, plain prose, present tense, no bullet points, no headings, no markdown.',
    'Name people by the names given. Lead with what was decided, then what is still open, then any blocker or upcoming hand-off.',
    'If nothing was decided say so briefly. Never invent facts that are not in the thread.',
    'Return a single JSON object: {"summary": "<text>"}.',
].join(' ');

function clamp(text, cap) {
    if (typeof text !== 'string') return '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > cap ? `${trimmed.slice(0, cap)}…` : trimmed;
}

function stripMentions(message) {
    return String(message || '').replace(/\[([^\]]+)\]\([0-9a-f]{24}\)/gi, '@$1');
}

const SUMMARISED = { isDeleted: { $ne: true }, $or: [{ type: 'text' }, { type: 'link' }, { type: { $exists: false } }] };

/* How many comments each thread holds now, by task id: what a kept summary's count is held against. */
async function commentCounts(companyId, taskIds) {
    if (!taskIds.length) return {};
    const forms = taskIds.flatMap((taskId) => [String(taskId), new mongoose.Types.ObjectId(String(taskId))]);
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[{ $match: { taskId: { $in: forms }, ...SUMMARISED } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]],
    }, 'aggregate');
    return (rows || []).reduce((counts, row) => ({ ...counts, [String(row._id)]: (counts[String(row._id)] || 0) + row.count }), {});
}

async function loadComments(companyId, taskId) {
    const match = { taskId: taskIdMatch(taskId), ...SUMMARISED };
    const [countRow] = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[{ $match: match }, { $count: 'count' }]],
    }, 'aggregate');
    const total = (countRow && countRow.count) || 0;
    if (!total) return { total: 0, comments: [] };

    const comments = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [[
            { $match: match },
            { $sort: { createdAt: -1 } },
            { $limit: MAX_COMMENTS },
            { $sort: { createdAt: 1 } },
            { $project: { message: 1, userId: 1, createdAt: 1 } },
        ]],
    }, 'aggregate');
    return { total, comments: comments || [] };
}

async function resolveNames(companyId, userIds) {
    try {
        const users = await memberProfiles(companyId, userIds, { Employee_Name: 1 });
        return users.reduce((acc, user) => {
            acc[String(user._id)] = user.Employee_Name || 'Someone';
            return acc;
        }, {});
    } catch (error) {
        logger.error(`taskSummary: could not resolve names: ${error.message}`);
        return {};
    }
}

function buildThread({ task, comments, names }) {
    const lines = [
        `Task: ${clamp(task.TaskName, 300) || '(untitled)'}`,
        task.status && task.status.text ? `Status: ${task.status.text}` : null,
        '',
        'Thread (oldest first):',
    ].filter((line) => line !== null);
    for (const comment of comments) {
        const who = names[String(comment.userId)] || 'Someone';
        const when = comment.createdAt ? new Date(comment.createdAt).toISOString().slice(0, 10) : '';
        lines.push(`- ${who}${when ? ` (${when})` : ''}: ${clamp(stripMentions(comment.message), COMMENT_CHAR_CAP)}`);
    }
    return lines.join('\n');
}

function parseSummary(content) {
    if (typeof content !== 'string') return '';
    const text = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed.summary === 'string') return parsed.summary.trim();
    } catch (_e) {
        const first = text.indexOf('{');
        const last = text.lastIndexOf('}');
        if (first !== -1 && last > first) {
            try {
                const parsed = JSON.parse(text.slice(first, last + 1));
                if (parsed && typeof parsed.summary === 'string') return parsed.summary.trim();
            } catch (_e2) { /* fall through */ }
        }
    }
    return text.replace(/^["{}\s]+|["{}\s]+$/g, '');
}

async function askModel(userMessage, spend) {
    const provider = providerFactory.getProvider();
    const result = await withTimeout(provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        temperature: 0.3,
        maxTokens: 600,
        spend,
    }), REQUEST_TIMEOUT_MS, 'AI summary request timed out');
    return parseSummary(result && result.content);
}

const keptView = (row, total) => ({
    summary: row.value || '',
    commentCount: total,
    summaryCount: Number(row.basis) || 0,
    updatedAt: new Date(row.madeAt).toISOString(),
    madeBy: row.madeBy || '',
    cached: true,
    stale: row.basis !== String(total),
});

/**
 * Summarise a task's comment thread. The summary is kept in the store with the
 * comment count it covers, so an unchanged thread never reaches the model twice,
 * whoever asks and however often the server restarts.
 * With `keptOnly` the model is never called: the kept summary comes back, marked
 * `stale` when the thread has moved on, and a thread with none answers `pending`.
 *
 * @returns {Promise<{status:boolean, data?:{summary:string, commentCount:number, summaryCount:number, updatedAt:string, cached:boolean, stale:boolean}, reason?:string}>}
 */
async function summarizeTask({ companyId, uid, taskId, force = false, keptOnly = false }) {
    if (!companyId || !taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
        return { status: false, reason: 'taskId is required' };
    }
    try {
        const task = await visibleTask({ companyId, uid, taskId, projection: { TaskName: 1, status: 1 } });
        if (!task) return { status: false, notFound: true, reason: TASK_NOT_FOUND };
        if (!providerFactory || typeof providerFactory.isAnyProviderConfigured !== 'function' || !providerFactory.isAnyProviderConfigured()) {
            return { status: false, aiState: STATE.UNCONFIGURED, reason: 'no LLM provider configured' };
        }

        const { total, comments } = await loadComments(companyId, taskId);
        if (!total) {
            return { status: true, data: { summary: '', commentCount: 0, updatedAt: new Date().toISOString(), cached: false } };
        }

        const row = await values.kept(companyId, taskId, values.SUMMARY);
        if (row && (keptOnly || (!force && row.basis === String(total)))) return { status: true, data: keptView(row, total) };
        if (keptOnly) return { status: true, data: { summary: '', commentCount: total, updatedAt: '', cached: false, pending: true } };

        const names = await resolveNames(companyId, comments.map((c) => c.userId));
        const summary = await askModel(buildThread({ task, comments, names }), { feature: FEATURES.TASK_SUMMARY, companyId, userId: uid });
        if (!summary) return { status: false, reason: 'no summary returned' };

        const made = await values.keep(companyId, { taskId, kind: values.SUMMARY, value: summary, basis: total, madeBy: uid });
        return { status: true, data: { ...keptView(made, total), cached: false } };
    } catch (error) {
        logger.error(`AI task summary failed: ${error && error.message ? error.message : error}`);
        if (isAiOff(error)) return { status: false, aiState: error.scope === 'instance' ? STATE.OFF_INSTANCE : STATE.OFF_WORKSPACE, reason: error.message };
        return { status: false, reason: (error && error.message) || 'summary error' };
    }
}

module.exports = { summarizeTask, commentCounts, keptView, _internal: { parseSummary, buildThread, stripMentions } };
