/**
 * AI-powered task time estimator.
 *
 * Given a task, asks the configured LLM (Anthropic preferred, OpenAI/DeepSeek
 * fallback — reuses the AIProjectGenerator/llmProvider factory) for an
 * estimated completion time. By default the target is a human DEVELOPER's
 * effort (configurable via ESTIMATE_TARGET=human|agent). The point estimate
 * is persisted to `tasks.totalEstimatedTime` (minutes) and broadcast over
 * Socket.io so connected clients see the value appear without a refresh.
 *
 * Accuracy is improved in three additive, fully optional layers — each wrapped
 * so a failure degrades gracefully to the original single-call behaviour:
 *
 *   1. Historical grounding — completed similar tasks (same project + type)
 *      and their ACTUAL logged minutes are injected as few-shot anchors.
 *   2. Calibration — a clamped median(actual ÷ estimate) multiplier corrects
 *      a systematic over/under bias for this team.
 *   3. Range + confidence + self-consistency — the model returns a 3-point
 *      range; a PERT point is computed, calibrated, and the model is sampled
 *      N times (median combined) for stability.
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

// Historical-actuals grounding + calibration (additive). Loaded defensively
// so a missing/renamed module can never break the base estimate — grounding
// just no-ops (empty anchors, multiplier 1.0).
let grounding = null;
try {
    grounding = require('./estimateGrounding');
} catch (_e) {
    grounding = null;
}

// Task activity-log + minute-formatting helpers, loaded defensively (same
// pattern as providerFactory above) so a missing/renamed module can never
// break the estimator — the activity-log entry just silently no-ops.
// HandleHistory writes the same HISTORY doc the manual estimate edit does,
// so the AI estimate shows up in a task's Activity tab identically.
let taskHistoryHelper = null;
try {
    taskHistoryHelper = require('../Tasks/helpers/helper');
} catch (_e) {
    taskHistoryHelper = null;
}

// Default actor for AI-generated estimates when no explicit user is passed.
// Matches the AIProjectGenerator flow's author name (see controller.js).
const AI_ACTOR_NAME = 'AlianHub AI';

// Bounds chosen so a malformed LLM response can't write nonsense.
// 5 minutes — smallest meaningful unit of work.
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

// Estimate target: whose effort are we estimating?
//   'human' (default) — a developer does the work by hand.
//   'agent'           — an AI coding agent (Claude Code) does it end-to-end.
// Config-only (env var); NO settings UI. Anything other than 'agent' is
// treated as 'human' so a typo can never silently pick the agent calibration.
const ESTIMATE_TARGET = (() => {
    const raw = (process.env.ESTIMATE_TARGET || '').trim().toLowerCase();
    return raw === 'agent' ? 'agent' : 'human';
})();

// Self-consistency: how many times to sample the model and combine (median
// of the PERT points). Default 2 — cheap but smooths out a single unlucky
// draw. Tunable via ESTIMATE_SAMPLES; clamped to [1, 5] so a bad env value
// can't fan out an unbounded number of LLM calls.
const ESTIMATE_SAMPLES = (() => {
    const n = parseInt(process.env.ESTIMATE_SAMPLES, 10);
    if (!Number.isFinite(n)) return 2;
    if (n < 1) return 1;
    if (n > 5) return 5;
    return n;
})();

// Per-target prompt framing. Substituted into the {{ESTIMATE_TARGET_LABEL}}
// and {{ESTIMATE_TARGET_GUIDANCE}} placeholders in the prompt .md so the
// same pipeline serves both targets without two prompt files.
const TARGET_FRAGMENTS = {
    human: {
        label: 'human software developer who will implement the work by hand',
        guidance:
            'Estimate a competent human developer\'s hands-on working time: '
            + 'reading the task, locating code, designing the change, writing it, '
            + 'running it, fixing what breaks, and self-verifying. Assume normal '
            + 'human pace with realistic context-switching and iteration — not an '
            + 'idealised uninterrupted sprint, and not an AI agent.',
    },
    agent: {
        label: 'AI coding agent (Claude Code) doing the work end-to-end with no manual human implementation',
        guidance:
            'Estimate the AI agent\'s wall-clock time to complete the task '
            + 'end-to-end with no human implementation effort: reading the task, '
            + 'planning, editing files, running commands/builds/tests, and '
            + 'self-verifying.',
    },
};

// Load the system prompt from the shared AIProjectGenerator prompts dir so
// it lives alongside the other model-facing prompts and can be edited
// without a code change. Read once at module load (require() caches this
// module) — zero file I/O per estimate call. BOM stripped and CRLF
// normalized so files authored on different OSes produce identical bytes.
// The {{ESTIMATE_TARGET_*}} placeholders are substituted for the configured
// target; if the template ever lacks them (older prompt), the substitution
// is a harmless no-op and the prompt still works.
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
    const cleaned = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
    const frag = TARGET_FRAGMENTS[ESTIMATE_TARGET] || TARGET_FRAGMENTS.human;
    return cleaned
        .replace(/\{\{ESTIMATE_TARGET_LABEL\}\}/g, frag.label)
        .replace(/\{\{ESTIMATE_TARGET_GUIDANCE\}\}/g, frag.guidance);
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

/**
 * Render assignee role/seniority cheaply IF it's already on the task doc.
 * We do NOT make extra DB calls here — only use fields the caller passed.
 * Returns '' when nothing useful is available (so the prompt is unchanged).
 */
function describeAssignee(task) {
    if (!task) return '';
    // Accept a few shapes defensively — different call sites attach assignee
    // metadata differently, and we only want it when it's cheaply present.
    const a = task.assigneeInfo || task.primaryAssignee || null;
    if (a && typeof a === 'object') {
        const role = a.role || a.Designation || a.title || a.seniority || '';
        const name = a.name || a.Employee_Name || '';
        const desc = [name, role].filter(Boolean).join(' — ');
        if (desc) return desc;
    }
    if (typeof task.assigneeRole === 'string' && task.assigneeRole.trim()) {
        return task.assigneeRole.trim();
    }
    return '';
}

/** Compact list of subtask titles for parent tasks (already fetched). */
function describeSubtasks(task) {
    const subs = task && Array.isArray(task.subtaskTitles) ? task.subtaskTitles : null;
    if (!subs || !subs.length) return '';
    const titles = subs
        .map((s) => (typeof s === 'string' ? s : (s && s.TaskName) || ''))
        .filter((t) => typeof t === 'string' && t.trim())
        .slice(0, 25);
    if (!titles.length) return '';
    return titles.map((t) => `- ${t}`).join('\n');
}

/** Normalize tags to a short comma-joined string (defensive about shape). */
function describeTags(task) {
    const tags = task && Array.isArray(task.tagsArray) ? task.tagsArray : null;
    if (!tags || !tags.length) return '';
    const names = [];
    for (const t of tags) {
        if (typeof t === 'string' && t.trim()) names.push(t.trim());
        else if (t && typeof t.name === 'string' && t.name.trim()) names.push(t.name.trim());
        else if (t && typeof t.title === 'string' && t.title.trim()) names.push(t.title.trim());
    }
    return names.slice(0, 20).join(', ');
}

/**
 * Build the user message. `anchorsBlock` (optional) is the rendered
 * comparable-past-tasks block from the grounding helper — appended verbatim
 * when present, omitted entirely when absent so the no-history prompt is
 * identical to before.
 */
function buildUserMessage(task, anchorsBlock = '') {
    const title = (task && task.TaskName) ? String(task.TaskName) : '(no title)';
    const priority = (task && task.Task_Priority) ? String(task.Task_Priority) : 'MEDIUM';
    const taskType = (task && task.TaskType) ? String(task.TaskType) : 'task';
    const isParent = !task || task.isParentTask !== false;
    let description = normalizeDescriptionForPrompt(extractDescription(task));
    if (description.length > DESCRIPTION_CHAR_CAP) {
        description = `${description.slice(0, DESCRIPTION_CHAR_CAP)}…`;
    }

    const lines = [
        `Task title: ${title}`,
        `Task type: ${taskType}`,
        `Priority: ${priority}`,
        `Is parent task: ${isParent ? 'yes' : 'no (subtask)'}`,
    ];

    const tags = describeTags(task);
    if (tags) lines.push(`Tags: ${tags}`);

    const assignee = describeAssignee(task);
    if (assignee) lines.push(`Assignee: ${assignee}`);

    lines.push('', 'Description:', description || '(no description provided — estimate from the title only)');

    const subtasks = describeSubtasks(task);
    if (subtasks) {
        lines.push('', 'Subtasks (account for each in the total):', subtasks);
    }

    if (anchorsBlock) lines.push(anchorsBlock);

    lines.push(
        '',
        'Follow the four-phase pipeline in the system prompt. Deduplicate before estimating; do not double-count overlapping requirements.',
    );
    return lines.join('\n');
}

function clampMinutes(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    const rounded = Math.round(num);
    if (rounded < MIN_MINUTES) return MIN_MINUTES;
    if (rounded > MAX_MINUTES) return MAX_MINUTES;
    return rounded;
}

const VALID_CONFIDENCE = new Set(['low', 'medium', 'high']);

function normalizeConfidence(value) {
    if (typeof value !== 'string') return null;
    const v = value.trim().toLowerCase();
    return VALID_CONFIDENCE.has(v) ? v : null;
}

/**
 * Strip code fences and parse the model's JSON, tolerating prose around it.
 * Returns the parsed object or null.
 */
function parseJsonLoose(content) {
    if (typeof content !== 'string') return null;
    const trimmed = content.trim();
    if (!trimmed) return null;
    const stripped = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```$/i, '')
        .trim();
    try {
        const parsed = JSON.parse(stripped);
        if (parsed && typeof parsed === 'object') return parsed;
    } catch (_e) {
        // Try to rescue the first {...} block from surrounding prose.
        const match = stripped.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                const parsed = JSON.parse(match[0]);
                if (parsed && typeof parsed === 'object') return parsed;
            } catch (_e2) { /* fall through */ }
        }
    }
    return null;
}

/**
 * Backward-compatible point parser. Returns a single integer (minutes) or
 * null. Kept for the original contract / unit tests: accepts the old
 * { minutes } shape AND the new ranged shape, and even a bare number.
 */
function parseMinutes(content) {
    const parsed = parseJsonLoose(content);
    if (parsed) {
        if ('minutes' in parsed) {
            const m = clampMinutes(parsed.minutes);
            if (m != null) return m;
        }
        if ('likely' in parsed) {
            const m = clampMinutes(parsed.likely);
            if (m != null) return m;
        }
        if ('estimate' in parsed) {
            const m = clampMinutes(parsed.estimate);
            if (m != null) return m;
        }
        if ('totalEstimatedTime' in parsed) {
            const m = clampMinutes(parsed.totalEstimatedTime);
            if (m != null) return m;
        }
    }
    if (typeof content === 'string') {
        const stripped = content.trim()
            .replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
        const keyMatch = stripped.match(/"(?:minutes|likely)"\s*:\s*(-?\d+(?:\.\d+)?)/);
        if (keyMatch) return clampMinutes(keyMatch[1]);
        const bareNumber = stripped.match(/^\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (bareNumber) return clampMinutes(bareNumber[1]);
    }
    return null;
}

/**
 * Parse the full ranged estimate from one model response. Returns a normalized
 * sample object, or null when nothing usable could be extracted.
 *
 *   { point, optimistic, likely, pessimistic, confidence, work_items, reasoning }
 *
 * `point` is the PERT estimate (O + 4·likely + P)/6 when a full range is
 * present, otherwise the single point — always clamped. The ranged fields
 * fall back to the point when the model omitted them, so a model that still
 * answers the OLD { minutes } shape produces a valid (degenerate) sample.
 */
function parseEstimateSample(content) {
    const parsed = parseJsonLoose(content);

    // Fallback: no JSON object → reuse the legacy point parser (handles bare
    // numbers / regex rescue) and synthesize a degenerate sample.
    if (!parsed) {
        const point = parseMinutes(content);
        if (point == null) return null;
        return {
            point,
            optimistic: point,
            likely: point,
            pessimistic: point,
            confidence: null,
            work_items: [],
            reasoning: '',
        };
    }

    const likely = clampMinutes(parsed.likely != null ? parsed.likely : parsed.minutes);
    const optimisticRaw = clampMinutes(parsed.optimistic);
    const pessimisticRaw = clampMinutes(parsed.pessimistic);
    const pointFallback = clampMinutes(parsed.minutes != null ? parsed.minutes : parsed.likely);

    // Need at least one usable number.
    if (likely == null && pointFallback == null && optimisticRaw == null && pessimisticRaw == null) {
        return null;
    }

    const base = likely != null ? likely : pointFallback;
    let optimistic = optimisticRaw != null ? optimisticRaw : base;
    let pessimistic = pessimisticRaw != null ? pessimisticRaw : base;
    const mid = base != null ? base : Math.round((optimistic + pessimistic) / 2);

    // Enforce optimistic ≤ likely ≤ pessimistic (models occasionally swap).
    optimistic = Math.min(optimistic, mid);
    pessimistic = Math.max(pessimistic, mid);

    // PERT point estimate from the (sanitized) three-point range.
    const pert = clampMinutes((optimistic + 4 * mid + pessimistic) / 6);
    const point = pert != null ? pert : (pointFallback != null ? pointFallback : mid);

    const workItems = Array.isArray(parsed.work_items)
        ? parsed.work_items.filter((w) => typeof w === 'string' && w.trim()).slice(0, 50)
        : [];
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 500) : '';

    return {
        point,
        optimistic,
        likely: mid,
        pessimistic,
        confidence: normalizeConfidence(parsed.confidence),
        work_items: workItems,
        reasoning,
    };
}

/** Median of a numeric array; null on empty. */
function medianOf(nums) {
    const arr = (nums || []).filter((n) => Number.isFinite(n));
    if (!arr.length) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Pick the most common confidence among samples (ties → highest present). */
function combineConfidence(samples) {
    const order = ['low', 'medium', 'high'];
    const counts = { low: 0, medium: 0, high: 0 };
    let any = false;
    for (const s of samples) {
        if (s && s.confidence && counts[s.confidence] != null) { counts[s.confidence] += 1; any = true; }
    }
    if (!any) return null;
    let best = null;
    let bestCount = -1;
    for (const level of order) {
        if (counts[level] >= bestCount) { bestCount = counts[level]; best = level; }
    }
    return best;
}

/** Resolve the provider once (or null when none is configured). */
function resolveProvider() {
    if (!providerFactory || typeof providerFactory.getProvider !== 'function') return null;
    if (typeof providerFactory.isAnyProviderConfigured === 'function'
        && !providerFactory.isAnyProviderConfigured()) {
        return null;
    }
    try {
        return providerFactory.getProvider();
    } catch (_e) {
        return null;
    }
}

/** One model call → one parsed sample (or null). Never throws. */
async function callOnce(provider, userMessage) {
    try {
        const chatPromise = provider.chat({
            systemPrompt: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userMessage }],
            jsonMode: true,
            // Low temperature pulls the model toward deterministic, calibrated
            // numbers — accuracy depends on the model NOT being creative here.
            temperature: 0.15,
            // The visible JSON answer (work_items[] + range + minutes +
            // reasoning) is small — ~400-600 tokens — but THINKING models
            // (deepseek-reasoner, deepseek-v4-pro, OpenAI o-series) spend their
            // output budget on hidden chain-of-thought BEFORE the visible JSON.
            // 8192 gives the reasoning ample room while non-thinking models
            // (GPT-4.1, Claude, deepseek-chat) self-terminate well under it.
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
        return parseEstimateSample(result.content);
    } catch (e) {
        logger.error(`AI estimate sample failed: ${e && e.message ? e.message : e}`);
        return null;
    }
}

/**
 * Run the estimate: build the message (with optional grounding anchors),
 * sample the model ESTIMATE_SAMPLES times, combine by median of the PERT
 * points, apply the calibration multiplier, and return the full estimate
 * object — or null when every sample failed.
 *
 * @returns {Promise<null | {
 *   minutes:number, optimistic:number, likely:number, pessimistic:number,
 *   confidence:(string|null), work_items:string[], reasoning:string,
 *   basedOnSamples:number, calibrationMultiplier:number, modelSamples:number
 * }>}
 */
async function runEstimate(companyId, task) {
    const provider = resolveProvider();
    if (!provider) return null;

    // --- Grounding (additive, best-effort) ---
    let anchorsBlock = '';
    let multiplier = 1;
    let basedOnSamples = 0;
    try {
        if (grounding && typeof grounding.buildGrounding === 'function' && companyId) {
            const g = await grounding.buildGrounding(companyId, task);
            if (g) {
                multiplier = (typeof g.multiplier === 'number' && g.multiplier > 0) ? g.multiplier : 1;
                basedOnSamples = Number.isFinite(g.sampleCount) ? g.sampleCount : 0;
                if (typeof grounding.renderAnchorsForPrompt === 'function') {
                    anchorsBlock = grounding.renderAnchorsForPrompt(g.anchors) || '';
                }
            }
        }
    } catch (e) {
        // Grounding failure must never break the estimate.
        logger.error(`AI estimate grounding step failed: ${e && e.message ? e.message : e}`);
        anchorsBlock = '';
        multiplier = 1;
        basedOnSamples = 0;
    }

    const userMessage = buildUserMessage(task, anchorsBlock);

    // --- Sample the model (self-consistency) ---
    const samples = [];
    for (let i = 0; i < ESTIMATE_SAMPLES; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const sample = await callOnce(provider, userMessage);
        if (sample) samples.push(sample);
    }
    if (!samples.length) return null;

    // Combine: median of the per-sample PERT points, plus median of each
    // range bound, then apply the calibration multiplier to the points.
    const rawPoint = medianOf(samples.map((s) => s.point));
    const rawOptimistic = medianOf(samples.map((s) => s.optimistic));
    const rawLikely = medianOf(samples.map((s) => s.likely));
    const rawPessimistic = medianOf(samples.map((s) => s.pessimistic));

    const minutes = clampMinutes((rawPoint != null ? rawPoint : rawLikely) * multiplier);
    if (minutes == null) return null;

    const optimistic = clampMinutes((rawOptimistic != null ? rawOptimistic : rawPoint) * multiplier);
    const likely = clampMinutes((rawLikely != null ? rawLikely : rawPoint) * multiplier);
    const pessimistic = clampMinutes((rawPessimistic != null ? rawPessimistic : rawPoint) * multiplier);

    // Re-assert ordering after independent clamping.
    const o = Math.min(optimistic != null ? optimistic : minutes, minutes);
    const p = Math.max(pessimistic != null ? pessimistic : minutes, minutes);
    const l = likely != null ? Math.min(Math.max(likely, o), p) : minutes;

    // Prefer the richest sample's work_items/reasoning (most work items).
    const richest = samples.reduce((best, s) => (
        (s.work_items.length > (best ? best.work_items.length : -1)) ? s : best
    ), null) || samples[0];

    return {
        minutes,
        optimistic: o,
        likely: l,
        pessimistic: p,
        confidence: combineConfidence(samples),
        work_items: richest.work_items || [],
        reasoning: richest.reasoning || '',
        basedOnSamples,
        calibrationMultiplier: multiplier,
        modelSamples: samples.length,
    };
}

async function persistEstimate(companyId, taskId, minutes, opts = {}) {
    const { userData, previousMinutes } = opts;
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

        // Activity-log entry — mirrors the manual estimate-edit history
        // (key "task_total_estimate") so the AI estimate shows in the task's
        // Activity tab. Best-effort: never throws, never blocks the estimate.
        logEstimateHistory({ companyId, result, taskId, minutes, userData, previousMinutes });
    }
    return result;
}

/**
 * Write a task activity-log row for an AI-generated estimate. Resolved from
 * the canonical updated task doc (so ProjectId / sprintId are always right)
 * and the shared HandleHistory helper used everywhere else. Best-effort:
 * any failure is logged and swallowed so it can't affect the estimate flow.
 */
function logEstimateHistory({ companyId, result, taskId, minutes, userData, previousMinutes }) {
    try {
        if (!taskHistoryHelper
            || typeof taskHistoryHelper.HandleHistory !== 'function'
            || typeof taskHistoryHelper.convertToDisplayFormat !== 'function') {
            return;
        }
        const projectId = result.ProjectID ? String(result.ProjectID) : null;
        if (!projectId) return;

        const actorName = (userData && userData.Employee_Name) || AI_ACTOR_NAME;
        const actorId = (userData && userData.id) ? String(userData.id) : '';
        // HISTORY.UserId is a required String — Mongoose rejects an empty
        // value, so a blank actor id would make the save fail validation and
        // get silently swallowed by the .catch below (no activity-log row).
        // Skip rather than attempt a doomed write; callers that want the log
        // pass a real user (orchestrator -> creator, manual trigger -> clicker).
        if (!actorId) return;
        const toText = taskHistoryHelper.convertToDisplayFormat(minutes);
        const hasPrev = typeof previousMinutes === 'number' && previousMinutes > 0;
        const message = hasPrev
            ? `<b>${actorName}</b> has updated total estimated time from <b>${taskHistoryHelper.convertToDisplayFormat(previousMinutes)}</b> to <b>${toText}</b> using AI.`
            : `<b>${actorName}</b> has set the total estimated time to <b>${toText}</b> using AI.`;

        taskHistoryHelper.HandleHistory('task', companyId, projectId, taskId, {
            key: 'task_total_estimate',
            message,
            sprintId: (result.sprintArray && result.sprintArray.id) || result.sprintId || '',
        }, { id: actorId, Employee_Name: actorName }).catch((e) => {
            logger.error(`AI estimate history error for task ${taskId}: ${e && e.message ? e.message : e}`);
        });
    } catch (e) {
        logger.error(`AI estimate history build error for task ${taskId}: ${e && e.message ? e.message : e}`);
    }
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
 * @param {object} [params.userData]  Optional actor for the activity-log entry
 *                                    ({ id, Employee_Name }). Defaults to the
 *                                    "AlianHub AI" actor when omitted.
 * @returns {Promise<{status: boolean, minutes?: number, optimistic?: number,
 *   likely?: number, pessimistic?: number, confidence?: (string|null),
 *   work_items?: string[], reasoning?: string, basedOnSamples?: number,
 *   reason?: string}>}
 */
async function estimateAndPersist({ companyId, taskId, task, force = false, userData } = {}) {
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
        // Capture the prior value BEFORE the update so the activity log can
        // render a "from X to Y" message on a re-estimate (and "set to Y" on
        // a first estimate, where there is no prior value).
        const previousMinutes = (typeof task.totalEstimatedTime === 'number')
            ? task.totalEstimatedTime
            : null;

        const estimate = await runEstimate(companyId, task);
        if (!estimate || estimate.minutes == null) {
            return { status: false, reason: 'no estimate returned' };
        }

        // Persist the SAME stored field, same shape, as always.
        await persistEstimate(companyId, taskId, estimate.minutes, { userData, previousMinutes });

        return {
            status: true,
            minutes: estimate.minutes,
            optimistic: estimate.optimistic,
            likely: estimate.likely,
            pessimistic: estimate.pessimistic,
            confidence: estimate.confidence,
            work_items: estimate.work_items,
            reasoning: estimate.reasoning,
            basedOnSamples: estimate.basedOnSamples,
        };
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
        parseEstimateSample,
        parseJsonLoose,
        buildUserMessage,
        extractDescription,
        normalizeDescriptionForPrompt,
        describeTags,
        describeSubtasks,
        describeAssignee,
        medianOf,
        combineConfidence,
        normalizeConfidence,
        ESTIMATE_TARGET,
        ESTIMATE_SAMPLES,
        MIN_MINUTES,
        MAX_MINUTES,
    },
};
