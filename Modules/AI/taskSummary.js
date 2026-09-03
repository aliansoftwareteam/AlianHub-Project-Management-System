'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { myCache } = require('../../Config/config');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_COMMENTS = 40;
const COMMENT_CHAR_CAP = 800;
const CACHE_TTL_SECONDS = 60 * 60 * 6;

const SYSTEM_PROMPT = [
    'You summarise the discussion thread of a project-management task for a teammate who has not read it.',
    'Write 2-4 short sentences, plain prose, present tense, no bullet points, no headings, no markdown.',
    'Name people by the names given. Lead with what was decided, then what is still open, then any blocker or upcoming hand-off.',
    'If nothing was decided say so briefly. Never invent facts that are not in the thread.',
    'Return a single JSON object: {"summary": "<text>"}.',
].join(' ');

function cacheKey(companyId, taskId, commentCount) {
    return `taskSummary:${companyId}:${taskId}:${commentCount}`;
}

function clamp(text, cap) {
    if (typeof text !== 'string') return '';
    const trimmed = text.replace(/\s+/g, ' ').trim();
    return trimmed.length > cap ? `${trimmed.slice(0, cap)}…` : trimmed;
}

function stripMentions(message) {
    return String(message || '').replace(/\[([^\]]+)\]\([0-9a-f]{24}\)/gi, '@$1');
}

async function loadComments(companyId, taskId) {
    const match = {
        taskId: new mongoose.Types.ObjectId(taskId),
        isDeleted: { $ne: true },
        $or: [{ type: 'text' }, { type: 'link' }, { type: { $exists: false } }],
    };
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

async function resolveNames(userIds) {
    const ids = Array.from(new Set(userIds.filter(Boolean).map(String)))
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));
    if (!ids.length) return {};
    try {
        const users = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: SCHEMA_TYPE.USERS,
            data: [{ _id: { $in: ids } }, { Employee_Name: 1 }],
        }, 'find');
        return (users || []).reduce((acc, user) => {
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

async function askModel(userMessage) {
    const provider = providerFactory.getProvider();
    const result = await Promise.race([
        provider.chat({
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
            jsonMode: true,
            temperature: 0.3,
            maxTokens: 600,
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI summary request timed out')), REQUEST_TIMEOUT_MS)),
    ]);
    return parseSummary(result && result.content);
}

/**
 * Summarise a task's comment thread. Cached per task + comment count, so a
 * new comment invalidates naturally and an unchanged thread costs nothing.
 *
 * @returns {Promise<{status:boolean, data?:{summary:string, commentCount:number, updatedAt:string, cached:boolean}, reason?:string}>}
 */
async function summarizeTask({ companyId, taskId, force = false }) {
    if (!companyId || !taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
        return { status: false, reason: 'taskId is required' };
    }
    if (!providerFactory || typeof providerFactory.isAnyProviderConfigured !== 'function' || !providerFactory.isAnyProviderConfigured()) {
        return { status: false, reason: 'no LLM provider configured' };
    }
    try {
        const task = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: new mongoose.Types.ObjectId(taskId) }, { TaskName: 1, status: 1 }],
        }, 'findOne');
        if (!task) return { status: false, reason: 'task not found' };

        const { total, comments } = await loadComments(companyId, taskId);
        if (!total) {
            return { status: true, data: { summary: '', commentCount: 0, updatedAt: new Date().toISOString(), cached: false } };
        }

        const key = cacheKey(companyId, taskId, total);
        const hit = !force && myCache.get(key);
        if (hit) return { status: true, data: { ...hit, cached: true } };

        const names = await resolveNames(comments.map((c) => c.userId));
        const summary = await askModel(buildThread({ task, comments, names }));
        if (!summary) return { status: false, reason: 'no summary returned' };

        const data = { summary, commentCount: total, updatedAt: new Date().toISOString() };
        myCache.set(key, data, CACHE_TTL_SECONDS);
        return { status: true, data: { ...data, cached: false } };
    } catch (error) {
        logger.error(`AI task summary failed: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'summary error' };
    }
}

module.exports = { summarizeTask, _internal: { parseSummary, buildThread, stripMentions } };
