/**
 * AI Task Category classifier — Learning vs Actual.
 *
 * Sibling of `aiTaskEstimator.js`. Given a task, gathers a
 * multi-signal context bundle (text from task/project/sprint,
 * structural fields like billing/leadership, and behavioural
 * signals from recent timesheet entries) and asks the LLM to
 * classify the task as `learning` / `actual` / `unknown`.
 *
 * Design rules per spec:
 *   - NO hardcoded keyword shortcuts. Every classifiable task
 *     goes to the LLM with its full signal bundle.
 *   - Caches the answer on the task as `aiTaskCategory`. The
 *     classifier never overwrites a `aiTaskCategoryManual` value
 *     set by the user.
 *   - Never throws. If LLM is not configured or the call fails,
 *     leaves the task uncategorised (UI shows "unknown").
 *
 * Used by the EmployeeWorkloadReportCard widget.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 60_000;
const DESCRIPTION_CHAR_CAP = 4000;
const RECENT_LOG_COUNT = 8;
const ALLOWED_CATEGORIES = new Set(['learning', 'actual', 'unknown']);

// System prompt loaded from a .md partial so it can be edited
// without a code change — same convention the time estimator uses.
const SYSTEM_PROMPT = (() => {
    const promptPath = path.join(
        __dirname, '..', 'AIProjectGenerator', 'prompts', 'project-plan', 'task-category.md'
    );
    try {
        const raw = fs.readFileSync(promptPath, 'utf8');
        return raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    } catch (_e) {
        // Inline fallback — only used if the partial file is missing.
        return [
            'You classify whether a project task is LEARNING work or ACTUAL work.',
            '',
            'LEARNING = the assignee is building skills, not shipping a deliverable.',
            '  Examples: tutorials, training courses, research, exploration, proofs-of-concept that will not ship.',
            '',
            'ACTUAL = the assignee is producing a real, ship-able deliverable.',
            '  Examples: features, bug fixes, customer requests, migrations, refactors that ship, integrations.',
            '',
            'Weigh the project context first (project name, description, billing/lead signals), then the task content, then the recent log descriptions.',
            'If you genuinely cannot tell, return "unknown" — do NOT guess.',
            '',
            'Respond with EXACTLY ONE JSON object: {"category": "learning"|"actual"|"unknown", "confidence": <0..1>, "reasoning": "<one short sentence>"}',
            'No markdown, no fences, no prose outside the JSON.',
        ].join('\n');
    }
})();

function extractText(value, cap = DESCRIPTION_CHAR_CAP) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.length <= cap) return trimmed;
    return `${trimmed.slice(0, cap)}…`;
}

/**
 * Build the LLM context bundle for a task. The model sees text +
 * structural + behavioural signals together and judges with no
 * pre-applied weights.
 */
function buildContextMessage({ task, project, recentLogs }) {
    const lines = [];

    lines.push('Task title:');
    lines.push(task.TaskName || '(no title)');
    lines.push('');
    lines.push(`Task type: ${task.TaskType || 'task'}`);
    lines.push(`Priority: ${task.Task_Priority || 'MEDIUM'}`);
    lines.push(`Is parent task: ${task.isParentTask === false ? 'no (subtask)' : 'yes'}`);
    if (task.tagsArray && task.tagsArray.length) {
        const tagNames = task.tagsArray.map((t) => t.tagName || t).filter(Boolean).join(', ');
        if (tagNames) lines.push(`Task tags: ${tagNames}`);
    }
    if (task.sprintArray && (task.sprintArray.name || task.sprintArray.folderName)) {
        lines.push(`Sprint: ${task.sprintArray.folderName ? `${task.sprintArray.folderName} / ` : ''}${task.sprintArray.name || ''}`);
    }
    lines.push('');
    lines.push('Task description:');
    lines.push(extractText(task.rawDescription) || '(no description)');
    lines.push('');

    if (project) {
        lines.push('Project context:');
        lines.push(`- Name: ${project.ProjectName || '(unknown)'}`);
        if (project.ProjectCategory) lines.push(`- Category: ${project.ProjectCategory}`);
        if (project.ProjectType) lines.push(`- Type: ${project.ProjectType}`);
        if (project.ProjectCurrency && project.ProjectCurrency.code) lines.push(`- Currency set: ${project.ProjectCurrency.code} (billable signal)`);
        if (project.BillingPeriod) lines.push(`- Billing period: ${project.BillingPeriod} (billable signal)`);
        if (Array.isArray(project.LeadUserId) && project.LeadUserId.length) lines.push(`- Has project lead: yes`);
        if (project.isPrivateSpace) lines.push(`- Private space: yes (internal)`);
        if (project.tagsArray && project.tagsArray.length) {
            const tagNames = project.tagsArray.map((t) => t.tagName || t).filter(Boolean).join(', ');
            if (tagNames) lines.push(`- Project tags: ${tagNames}`);
        }
        if (project.description) {
            lines.push('- Project description:');
            lines.push(`  ${extractText(project.description, 600).replace(/\n/g, '\n  ')}`);
        }
        lines.push('');
    }

    if (recentLogs && recentLogs.length) {
        lines.push(`Recent time-log descriptions for this task (${recentLogs.length}, most recent first):`);
        recentLogs.slice(0, RECENT_LOG_COUNT).forEach((l) => {
            const tracker = l.logAddType === 2 ? ' [tracker]' : '';
            lines.push(`- ${extractText(l.LogDescription, 200) || '(empty)'}${tracker}`);
        });
        lines.push('');
    }

    lines.push('Now classify. Respond with ONE JSON object only.');
    return lines.join('\n');
}

function parseResponse(content) {
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
            const category = String(parsed.category || '').toLowerCase();
            if (ALLOWED_CATEGORIES.has(category)) {
                const confidence = Number(parsed.confidence);
                return {
                    category,
                    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
                    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 240) : '',
                };
            }
        }
    } catch (_e) {
        // fall through
    }
    const m = stripped.match(/"category"\s*:\s*"(learning|actual|unknown)"/i);
    if (m) return { category: m[1].toLowerCase(), confidence: null, reasoning: '' };
    return null;
}

async function callProvider(message) {
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
    const chatPromise = provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: message }],
        jsonMode: true,
        temperature: 0.15,
        maxTokens: 256,
    });
    const result = await Promise.race([
        chatPromise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('AI category request timed out')),
            REQUEST_TIMEOUT_MS,
        )),
    ]);
    if (!result || typeof result.content !== 'string') return null;
    return parseResponse(result.content);
}

async function loadContext(companyId, task) {
    let project = null;
    if (task && task.ProjectID) {
        const projects = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { _id: new mongoose.Types.ObjectId(String(task.ProjectID)) },
                {
                    ProjectName: 1, ProjectCategory: 1, ProjectType: 1,
                    ProjectCurrency: 1, BillingPeriod: 1, LeadUserId: 1,
                    isPrivateSpace: 1, tagsArray: 1, description: 1,
                },
            ],
        }, 'find').catch(() => []);
        project = (projects && projects[0]) || null;
    }

    let recentLogs = [];
    if (task && task._id) {
        recentLogs = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [
                { TicketID: String(task._id) },
                { LogDescription: 1, LogEndTime: 1, logAddType: 1 },
                { sort: { LogEndTime: -1 }, limit: RECENT_LOG_COUNT },
            ],
        }, 'find').catch(() => []);
    }

    return { project, recentLogs: recentLogs || [] };
}

async function persistCategory(companyId, taskId, category, confidence) {
    const update = {
        type: SCHEMA_TYPE.TASKS,
        data: [
            { _id: new mongoose.Types.ObjectId(String(taskId)) },
            {
                $set: {
                    aiTaskCategory: category,
                    aiTaskCategoryConfidence: confidence == null ? null : confidence,
                    aiTaskCategoryAt: new Date(),
                },
            },
            { returnDocument: 'after' },
        ],
    };
    return MongoDbCrudOpration(companyId, update, 'findOneAndUpdate');
}

/**
 * Classify a task and persist the result on its document.
 * Never throws — safe to fire-and-forget.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} params.taskId
 * @param {object} [params.task]  Optional pre-fetched task doc (avoid re-fetch)
 * @param {boolean} [params.force] Re-classify even if a value already exists
 * @returns {Promise<{status: boolean, category?: string, confidence?: number, reason?: string}>}
 */
async function classifyAndPersist({ companyId, taskId, task = null, force = false } = {}) {
    try {
        if (!companyId || !taskId) {
            return { status: false, reason: 'missing required input' };
        }

        let taskDoc = task;
        if (!taskDoc) {
            const docs = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [
                    { _id: new mongoose.Types.ObjectId(String(taskId)) },
                    {
                        TaskName: 1, rawDescription: 1, TaskType: 1, Task_Priority: 1,
                        tagsArray: 1, sprintArray: 1, ProjectID: 1, isParentTask: 1,
                        aiTaskCategory: 1, aiTaskCategoryManual: 1,
                    },
                ],
            }, 'find').catch(() => []);
            taskDoc = (docs && docs[0]) || null;
        }
        if (!taskDoc) return { status: false, reason: 'task not found' };

        // Never overwrite a manual override.
        if (taskDoc.aiTaskCategoryManual) {
            return { status: false, reason: 'manual override present' };
        }
        // Skip if already classified, unless force=true.
        if (!force && taskDoc.aiTaskCategory && taskDoc.aiTaskCategory !== 'unknown') {
            return { status: false, reason: 'already classified' };
        }

        if (!providerFactory
            || typeof providerFactory.isAnyProviderConfigured !== 'function'
            || !providerFactory.isAnyProviderConfigured()) {
            return { status: false, reason: 'no LLM provider configured' };
        }

        const ctx = await loadContext(companyId, taskDoc);
        const message = buildContextMessage({ task: taskDoc, project: ctx.project, recentLogs: ctx.recentLogs });

        const result = await callProvider(message);
        if (!result || !result.category) {
            return { status: false, reason: 'no classification returned' };
        }

        await persistCategory(companyId, taskId, result.category, result.confidence);
        return { status: true, category: result.category, confidence: result.confidence };
    } catch (error) {
        logger.error(`aiTaskCategory failed for task ${taskId}: ${error && error.message ? error.message : error}`);
        return { status: false, reason: (error && error.message) || 'classifier error' };
    }
}

module.exports = {
    classifyAndPersist,
    _internal: {
        buildContextMessage,
        parseResponse,
        SYSTEM_PROMPT,
    },
};
