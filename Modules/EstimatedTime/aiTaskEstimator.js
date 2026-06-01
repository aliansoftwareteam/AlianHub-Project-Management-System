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
// Thinking models (DeepSeek deepseek-reasoner / deepseek-v4-pro, OpenAI
// o-series) reason before answering and are noticeably slower per call,
// so allow generous headroom. The estimator runs fire-and-forget in the
// background, so a longer ceiling costs nothing in UX and only raises the
// success rate for slow models.
const REQUEST_TIMEOUT_MS = 120_000;
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

/**
 * Lightweight whitespace normalization for the description before it
 * hits the LLM. We don't deduplicate text here — that's the model's
 * job per the prompt's Phase 1 — but we strip whitespace noise so the
 * model spends its reasoning budget on real content:
 *
 *   - Trim trailing whitespace on every line (so two lines that differ
 *     only by trailing spaces look identical to the model).
 *   - Collapse 3+ consecutive blank lines into a single blank line.
 *   - Collapse 3+ repeats of the same non-empty line (e.g. accidental
 *     copy/paste) into a single occurrence.
 *
 * This is conservative: it removes accidental duplication, not
 * intentional repetition with different wording.
 */
function normalizeDescriptionForPrompt(text) {
    if (typeof text !== 'string' || !text) return '';
    // Strip trailing whitespace per line and normalize newlines.
    let lines = text.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
    // Collapse 3+ blank lines into one.
    const collapsed = [];
    let blankRun = 0;
    for (const line of lines) {
        if (line === '') {
            blankRun += 1;
            if (blankRun <= 1) collapsed.push('');
        } else {
            blankRun = 0;
            collapsed.push(line);
        }
    }
    // Collapse 3+ identical consecutive non-empty lines into one.
    const out = [];
    let lastNonEmpty = null;
    let lastRun = 0;
    for (const line of collapsed) {
        if (line !== '' && line === lastNonEmpty) {
            lastRun += 1;
            if (lastRun <= 1) out.push(line);
        } else {
            lastNonEmpty = line === '' ? lastNonEmpty : line;
            lastRun = line === '' ? lastRun : 1;
            out.push(line);
        }
    }
    return out.join('\n').trim();
}

function buildUserMessage(task) {
    const title = (task && task.TaskName) ? String(task.TaskName) : '(no title)';
    const priority = (task && task.Task_Priority) ? String(task.Task_Priority) : 'MEDIUM';
    const taskType = (task && task.TaskType) ? String(task.TaskType) : 'task';
    const isParent = !task || task.isParentTask !== false;
    let description = normalizeDescriptionForPrompt(extractDescription(task));
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
        '',
        'Follow the four-phase pipeline in the system prompt. Deduplicate before estimating; do not double-count overlapping requirements.',
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
        // Low temperature pulls the model toward deterministic, calibrated
        // numbers — accuracy depends on the model NOT being creative here.
        temperature: 0.15,
        // The visible JSON answer (work_items[] + minutes + reasoning) is
        // tiny — ~300-500 tokens — so 1024 was fine for non-thinking models
        // (GPT-4.1, Claude, deepseek-chat). But THINKING models
        // (deepseek-reasoner, deepseek-v4-pro, OpenAI o-series) spend their
        // output budget on hidden chain-of-thought BEFORE the visible JSON.
        // At 1024 the reasoning consumed the entire budget and the model
        // emitted an EMPTY answer (finish_reason="length") → parseMinutes
        // returned null → no estimate was ever saved. 8192 gives the
        // reasoning ample room while the model still self-terminates
        // (finish_reason="stop") at ~1000-1300 tokens, so non-thinking
        // models pay nothing for the larger ceiling.
        maxTokens: 8192,
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
 * @param {boolean} [params.force]    When true, bypass the "estimate already set"
 *                                    guard. Used by the manual sidebar button
 *                                    which is an explicit recalculation request.
 * @returns {Promise<{status: boolean, minutes?: number, reason?: string}>}
 */
async function estimateAndPersist({ companyId, taskId, task, force = false } = {}) {
    try {
        if (!companyId || !taskId || !task) {
            return { status: false, reason: 'missing required input' };
        }
        if (!providerFactory
            || typeof providerFactory.isAnyProviderConfigured !== 'function'
            || !providerFactory.isAnyProviderConfigured()) {
            return { status: false, reason: 'no LLM provider configured' };
        }
        // Don't overwrite an explicit value the caller already set — unless
        // the caller is explicitly recalculating (manual sidebar button).
        if (!force
            && typeof task.totalEstimatedTime === 'number'
            && task.totalEstimatedTime > 0) {
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
        normalizeDescriptionForPrompt,
        MIN_MINUTES,
        MAX_MINUTES,
    },
};
