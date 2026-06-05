/**
 * AI Workload Summary — plain-English brief for the
 * EmployeeWorkloadReportCard.
 *
 * Takes the aggregated report data the backend endpoint produces
 * and asks the LLM for a short 2-4 sentence summary highlighting
 * who's overloaded, who's idle, what's overdue, and the
 * learning-vs-actual split.
 *
 * Design rules:
 *   - Never throws. Returns `null` if the helper cannot produce
 *     a summary (no LLM configured, no employees in scope, etc.).
 *   - Caches per `(companyId, configHash)` for 5 minutes via the
 *     shared NodeCache instance.
 *   - Bounded prompt size so a 500-employee company doesn't blow
 *     up the token budget.
 */
'use strict';

const crypto = require('crypto');
const { myCache } = require('../../Config/config');
const logger = require('../../Config/loggerConfig');

let providerFactory = null;
try {
    providerFactory = require('../AIProjectGenerator/llmProvider');
} catch (_e) {
    providerFactory = null;
}

const REQUEST_TIMEOUT_MS = 45_000;
const CACHE_TTL_SECONDS = 300; // 5 minutes
const MAX_EMPLOYEES_IN_PROMPT = 20;

const SYSTEM_PROMPT = [
    'You write short managerial briefs for an employee-workload dashboard widget.',
    '',
    'Given the JSON snapshot of a team\'s current workload (estimated minutes,',
    'tracked minutes, task counts, overdue counts, activity status per person,',
    'and team-level learning-vs-actual split), produce a 2-4 sentence summary',
    'that highlights what a project manager would notice first:',
    '',
    '- Who is overloaded (high estimated minutes per day, or "overloaded" status).',
    '- Who is idle or has no current tasks.',
    '- How many tasks are overdue.',
    '- Notable split between learning and actual work.',
    '',
    'Rules:',
    '- Use names verbatim — do not invent or shorten people.',
    '- Quote concrete numbers when relevant (hours, task counts).',
    '- Do not lecture or recommend specific reassignments unless one is obvious.',
    '- Keep it under 75 words total.',
    '- Respond as plain prose. No JSON, no markdown, no bullet points.',
].join('\n');

function minutesToHours(min) {
    if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return '0h';
    const h = Math.floor(min / 60);
    const m = Math.round(min % 60);
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Compress the report into a small, stable JSON snippet for the LLM.
 * Keeps only the fields that drive the brief.
 */
function buildSnapshot(report) {
    const employees = (report && Array.isArray(report.employees)) ? report.employees : [];
    const trimmed = employees.slice(0, MAX_EMPLOYEES_IN_PROMPT).map((e) => ({
        name: e.name,
        activity: e.activityStatus || 'normal',
        trackedHours: minutesToHours(e.trackedMinutes || 0),
        estimatedHours: minutesToHours(e.estimatedMinutes || 0),
        assignedTaskCount: e.assignedTaskCount || 0,
        overdueCount: e.overdueCount || 0,
    }));
    const teamAggregate = (report && report.teamAggregate) || {};
    const breakdown = teamAggregate.taskTypeBreakdown || {};
    return {
        employees: trimmed,
        totalEmployees: employees.length,
        truncated: employees.length > MAX_EMPLOYEES_IN_PROMPT,
        taskTypeBreakdown: {
            learning: Number(breakdown.learning) || 0,
            actual: Number(breakdown.actual) || 0,
            unknown: Number(breakdown.unknown) || 0,
        },
    };
}

function configHash(companyId, callerUserId, snapshot) {
    const h = crypto.createHash('sha1');
    h.update(String(companyId || ''));
    h.update('|');
    h.update(String(callerUserId || ''));
    h.update('|');
    h.update(JSON.stringify(snapshot));
    return h.digest('hex').slice(0, 16);
}

async function callProvider(snapshot) {
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
    const userMessage = [
        'Workload snapshot:',
        JSON.stringify(snapshot, null, 2),
        '',
        'Write the brief now.',
    ].join('\n');
    const chatPromise = provider.chat({
        systemPrompt: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.3,
        maxTokens: 256,
    });
    const result = await Promise.race([
        chatPromise,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error('AI summary request timed out')),
            REQUEST_TIMEOUT_MS,
        )),
    ]);
    if (!result || typeof result.content !== 'string') return null;
    return result.content.trim();
}

/**
 * Produce a short summary string for a workload report.
 * Returns null on any failure or when no LLM is configured.
 *
 * @param {object} params
 * @param {string} params.companyId
 * @param {string} [params.callerUserId]
 * @param {object} params.report  The data object returned by the
 *                                getEmployeeWorkloadReport endpoint.
 * @returns {Promise<string|null>}
 */
async function summarise({ companyId, callerUserId, report } = {}) {
    try {
        if (!companyId || !report) return null;
        const employees = (report.employees && report.employees.length) || 0;
        if (!employees) return null;

        const snapshot = buildSnapshot(report);
        const cacheKey = `workloadSummary_${configHash(companyId, callerUserId, snapshot)}`;
        const cached = myCache.get(cacheKey);
        if (cached) return cached;

        if (!providerFactory
            || typeof providerFactory.isAnyProviderConfigured !== 'function'
            || !providerFactory.isAnyProviderConfigured()) {
            return null;
        }

        const text = await callProvider(snapshot);
        if (!text) return null;
        myCache.set(cacheKey, text, CACHE_TTL_SECONDS);
        return text;
    } catch (error) {
        logger.error(`aiWorkloadSummary failed: ${error && error.message ? error.message : error}`);
        return null;
    }
}

module.exports = {
    summarise,
    _internal: {
        buildSnapshot,
        configHash,
        minutesToHours,
        MAX_EMPLOYEES_IN_PROMPT,
        CACHE_TTL_SECONDS,
    },
};
