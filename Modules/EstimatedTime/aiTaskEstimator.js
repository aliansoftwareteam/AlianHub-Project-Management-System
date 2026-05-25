/**
 * AI-powered task time estimator.
 *
 * Given a freshly-created task, asks the configured LLM (Anthropic preferred,
 * OpenAI fallback — reuses the AIProjectGenerator/llmProvider factory) for an
 * estimated completion time assuming an AI coding agent (Claude Code) does
 * the work end-to-end with no human implementation effort. The estimate is
 * persisted to `tasks.totalEstimatedTime` (minutes) and broadcast over
 * Socket.io so connected clients see the value appear without a refresh.
 *
 * Designed to be invoked fire-and-forget right after task creation: it never
 * throws, never blocks the caller, and silently no-ops when no LLM provider
 * is configured (so the feature degrades gracefully on installs without AI).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const socketEmitter = require('../../event/socketEventEmitter');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

// Bounds chosen so a malformed LLM response can't write nonsense.
// 5 minutes — smallest meaningful "AI does the task end-to-end" unit.
// 7 days  — anything larger should be broken into subtasks.
const MIN_MINUTES = 5;
const MAX_MINUTES = 60 * 24 * 7;
const REQUEST_TIMEOUT_MS = 60_000;
const DESCRIPTION_CHAR_CAP = 4000;

// Load the system prompt from the shared AIProjectGenerator prompts dir so
// it lives alongside the other model-facing prompts and can be edited
// without a code change. Read once at module load (require() caches this
// module) — zero file I/O per estimate call. BOM stripped and CRLF
// normalized so files authored on different OSes produce identical bytes.
const SYSTEM_PROMPT = (() => {
    const promptPath = path.join(
        __dirname,
        '..',
        'AIProjectGenerator',
        'prompts',
        'project-plan',
        'task-time-estimate.md',
    );
    const raw = fs.readFileSync(promptPath, 'utf8');
    return raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
})();

function extractDescription(task) {
    if (!task) return '';
    if (typeof task.rawDescription === 'string' && task.rawDescription.trim()) {
        return task.rawDescription.trim();
    }
    const blocks = task.descriptionBlock && Array.isArray(task.descriptionBlock.blocks)
        ? task.descriptionBlock.blocks
        : null;
    if (!blocks) return '';
    const lines = [];
    for (const b of blocks) {
        if (!b || !b.data) continue;
        if ((b.type === 'paragraph' || b.type === 'header') && typeof b.data.text === 'string') {
            lines.push(b.data.text);
        } else if (b.type === 'list' && Array.isArray(b.data.items)) {
            for (const item of b.data.items) {
                if (typeof item === 'string') lines.push(`- ${item}`);
                else if (item && typeof item.content === 'string') lines.push(`- ${item.content}`);
            }
        }
    }
    return lines.join('\n').trim();
}

function buildUserMessage(task) {
    const title = (task && task.TaskName) ? String(task.TaskName) : '(no title)';
    const priority = (task && task.Task_Priority) ? String(task.Task_Priority) : 'MEDIUM';
    const taskType = (task && task.TaskType) ? String(task.TaskType) : 'task';
    const isParent = !task || task.isParentTask !== false;
    let description = extractDescription(task);
    if (description.length > DESCRIPTION_CHAR_CAP) {
        description = `${description.slice(0, DESCRIPTION_CHAR_CAP)}…`;
    }
    return [
        `Task title: ${title}`,
        `Task type: ${taskType}`,
        `Priority: ${priority}`,
        `Is parent task: ${isParent ? 'yes' : 'no (subtask)'}`,
        '',
        'Description:',
        description || '(no description provided — estimate from the title only)',
    ].join('\n');
}

function clampMinutes(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const rounded = Math.round(num);
    if (rounded < MIN_MINUTES) return MIN_MINUTES;
    if (rounded > MAX_MINUTES) return MAX_MINUTES;
    return rounded;
}

function parseMinutes(content) {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    const stripped = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        const parsed = JSON.parse(stripped);
        if (parsed && typeof parsed === 'object') {
            if ('minutes' in parsed) return clampMinutes(parsed.minutes);
            if ('estimate' in parsed) return clampMinutes(parsed.estimate);
            if ('totalEstimatedTime' in parsed) return clampMinutes(parsed.totalEstimatedTime);
        }
    } catch (_e) {
        // Fall through to regex rescue below.
    }
    const keyMatch = stripped.match(/"minutes"\s*:\s*(-?\d+(?:\.\d+)?)/);
    if (keyMatch) return clampMinutes(keyMatch[1]);
    const bareNumber = stripped.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
    return bareNumber ? clampMinutes(bareNumber[1]) : null;
}

async function callProvider(task) {
    if (!providerFactory || typeof providerFactory.getProvider !== 'function') return null;
    if (typeof providerFactory.isAnyProviderConfigured === 'function'
        && !providerFactory.isAnyProviderConfigured()) {
        return null;
    }
    let provider;
    try {
        provider = providerFactory.getProvider();
    } catch (_e) {
        return null;
    }
    const userMessage = buildUserMessage(task);
    const chatPromise = provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 256,
    });
    const result = await Promise.race([
        chatPromise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('AI estimate request timed out')),
            REQUEST_TIMEOUT_MS,
        )),
    ]);
    if (!result || typeof result.content !== 'string') return null;
    return parseMinutes(result.content);
}

async function persistEstimate(companyId, taskId, minutes) {
    const updateQuery = {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { _id: new mongoose.Types.ObjectId(taskId) },
            { $set: { totalEstimatedTime: minutes } },
            { returnDocument: 'after' },
        ],
    };
    const result = await MongoDbCrudOpration(companyId, updateQuery, 'findOneAndUpdate');
    if (result && result._id) {
        try {
            socketEmitter.emit('update', {
                type: 'update',
                data: result,
                updatedFields: { totalEstimatedTime: minutes },
                module: 'task',
            });
        } catch (_e) { /* socket emit best-effort */ }
    }
    return result;
}

/**
 * Estimate task completion time and persist to `totalEstimatedTime` (minutes).
 * Never throws; safe to invoke without `await`.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.taskId
 * @param {object} params.task        Task-shaped object (TaskName, description, etc.)
 * @returns {Promise<{status: boolean, minutes?: number, reason?: string}>}
 */
async function estimateAndPersist({ companyId, taskId, task } = {}) {
    try {
        if (!companyId || !taskId || !task) {
            return { status: false, reason: 'missing required input' };
        }
        if (!providerFactory
            || typeof providerFactory.isAnyProviderConfigured !== 'function'
            || !providerFactory.isAnyProviderConfigured()) {
            return { status: false, reason: 'no LLM provider configured' };
        }
        // Don't overwrite an explicit value the caller already set.
        if (typeof task.totalEstimatedTime === 'number' && task.totalEstimatedTime > 0) {
            return { status: false, reason: 'estimate already set' };
        }
        const minutes = await callProvider(task);
        if (minutes == null) {
            return { status: false, reason: 'no estimate returned' };
        }
        await persistEstimate(companyId, taskId, minutes);
        return { status: true, minutes };
    } catch (error) {
        logger.error(`AI task estimator failed for task ${taskId}: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'estimator error' };
    }
}

module.exports = {
    estimateAndPersist,
    // Exposed for unit tests / debugging — not part of the runtime contract.
    _internal: {
        clampMinutes,
        parseMinutes,
        buildUserMessage,
        extractDescription,
        MIN_MINUTES,
        MAX_MINUTES,
    },
};
