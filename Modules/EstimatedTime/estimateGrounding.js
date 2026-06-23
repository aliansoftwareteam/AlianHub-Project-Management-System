/**
 * Historical-actuals grounding + calibration for the AI time estimator.
 *
 * Everything here is ADDITIVE and READ-ONLY. It is called at estimate time
 * to make the LLM's number more accurate by:
 *
 *   1. Finding the company's COMPLETED tasks that are "similar" to the one
 *      being estimated (same project + same TaskType, preferring overlapping
 *      tags) and pairing each with its ACTUAL logged minutes (summed from the
 *      timesheet) and its prior estimate. These become few-shot anchors in
 *      the prompt ("comparable past tasks — title, est, actual").
 *
 *   2. Computing a calibration multiplier = median(actual ÷ estimate) over
 *      those comparable pairs, clamped to a sane range, applied to the
 *      model's raw estimate to correct a systematic over/under bias.
 *
 * NON-NEGOTIABLE: none of this may break the base estimate. Every query is
 * wrapped so a failure (no provider, no history, slow/broken query) yields
 * empty anchors + a no-op multiplier (1.0), and the caller falls back to the
 * exact single-call behaviour that shipped before.
 *
 * Units: timesheet `LogTimeDuration` is stored in MINUTES (see
 * Modules/LogTime/controllerV2/manualLogtime.js — `diffMin = h*60 + m`), the
 * same unit as `tasks.totalEstimatedTime`, so logged time and estimates are
 * directly comparable with no conversion.
 */
'use strict';

const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');

// Cap how many completed tasks we scan and how many anchors we surface, so
// the grounding queries stay cheap on large companies. We over-fetch a few
// candidates (CANDIDATE_LIMIT) then rank them by similarity and keep the best
// ANCHOR_LIMIT for the prompt / calibration.
const CANDIDATE_LIMIT = 40;
const ANCHOR_LIMIT = 5;

// Calibration needs a minimum signal before it's trustworthy — with fewer
// than this many (estimate, actual) pairs the multiplier stays 1.0 (no-op).
const MIN_PAIRS_FOR_CALIBRATION = 3;

// Clamp the multiplier so a handful of wildly-off historical tasks can't
// blow up (or zero out) a fresh estimate. 0.5–2.0 = "trust history to halve
// or double the model, no more".
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 2.0;

// Status types that mean "this task is finished" (see utils/Tempates/
// task_status.js — the done/complete column carries type "close").
const COMPLETED_STATUS_TYPES = ['close'];

function toObjectIdString(value) {
    return value == null ? '' : String(value);
}

/**
 * Sum logged minutes per task from the timesheet collection for a set of
 * task ids, in a single grouped aggregate. Returns a Map<taskId, minutes>.
 *
 * `LogTimeDuration` is minutes (see file header). `TicketID` is stored as a
 * string id, so we match on string ids. Best-effort: any failure resolves to
 * an empty Map so the caller simply gets no actuals.
 */
async function sumLoggedMinutesByTask(companyId, taskIds) {
    const ids = (taskIds || []).map(toObjectIdString).filter(Boolean);
    if (!ids.length) return new Map();
    try {
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TIMESHEET,
            data: [
                [
                    { $match: { TicketID: { $in: ids } } },
                    {
                        $group: {
                            _id: '$TicketID',
                            minutes: { $sum: '$LogTimeDuration' },
                        },
                    },
                ],
            ],
        }, 'aggregate').catch(() => []);
        const map = new Map();
        for (const row of (rows || [])) {
            if (!row || row._id == null) continue;
            const minutes = Number(row.minutes);
            if (Number.isFinite(minutes) && minutes > 0) {
                map.set(String(row._id), minutes);
            }
        }
        return map;
    } catch (_e) {
        return new Map();
    }
}

/**
 * Fetch completed, non-deleted tasks in the same project + same TaskType as
 * the target task. Read-only, company-scoped, capped at CANDIDATE_LIMIT and
 * sorted most-recent-first. Returns [] on any failure or missing inputs.
 */
async function fetchCompletedSimilarTasks(companyId, task) {
    if (!task || !task.ProjectID) return [];
    let projectId;
    try {
        projectId = new mongoose.Types.ObjectId(String(task.ProjectID));
    } catch (_e) {
        return [];
    }
    const taskType = task.TaskType ? String(task.TaskType) : null;
    const selfId = toObjectIdString(task._id);

    const filter = {
        ProjectID: projectId,
        statusType: { $in: COMPLETED_STATUS_TYPES },
        deletedStatusKey: { $in: [0, undefined] },
    };
    if (taskType) filter.TaskType = taskType;
    if (selfId) {
        try {
            filter._id = { $ne: new mongoose.Types.ObjectId(selfId) };
        } catch (_e) { /* ignore — self-exclusion is best-effort */ }
    }

    try {
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                filter,
                {
                    _id: 1, TaskName: 1, TaskType: 1, tagsArray: 1,
                    totalEstimatedTime: 1, updatedAt: 1,
                },
                { sort: { updatedAt: -1, _id: -1 }, limit: CANDIDATE_LIMIT },
            ],
        }, 'find').catch(() => []);
        return Array.isArray(rows) ? rows : [];
    } catch (_e) {
        return [];
    }
}

/** Normalize a task's tags to a lowercase string array (defensive). */
function normalizeTags(tagsArray) {
    if (!Array.isArray(tagsArray)) return [];
    const out = [];
    for (const t of tagsArray) {
        if (typeof t === 'string' && t.trim()) out.push(t.trim().toLowerCase());
        else if (t && typeof t.name === 'string' && t.name.trim()) out.push(t.name.trim().toLowerCase());
        else if (t && typeof t.title === 'string' && t.title.trim()) out.push(t.title.trim().toLowerCase());
    }
    return out;
}

/** Count how many tags two normalized tag-lists share. */
function tagOverlapCount(aTags, bTags) {
    if (!aTags.length || !bTags.length) return 0;
    const set = new Set(aTags);
    let n = 0;
    for (const t of bTags) if (set.has(t)) n += 1;
    return n;
}

/**
 * Build the grounding payload for a task:
 *   { anchors: [{ title, estimate, actual }], multiplier, sampleCount }
 *
 * anchors    — up to ANCHOR_LIMIT comparable completed tasks, each with a
 *              numeric estimate and/or actual logged minutes, ranked by tag
 *              overlap then recency. Used as few-shot examples in the prompt.
 * multiplier — calibration factor in [CALIBRATION_MIN, CALIBRATION_MAX], or
 *              1.0 when there are < MIN_PAIRS_FOR_CALIBRATION (estimate,
 *              actual) pairs. Multiply the model's raw minutes by this.
 * sampleCount— number of comparable tasks that contributed (for the API
 *              response `basedOnSamples`).
 *
 * NEVER throws. On any failure returns the safe no-op shape
 * { anchors: [], multiplier: 1, sampleCount: 0 } so the estimator falls back
 * to today's behaviour.
 */
async function buildGrounding(companyId, task) {
    const EMPTY = { anchors: [], multiplier: 1, sampleCount: 0 };
    try {
        if (!companyId || !task) return EMPTY;

        const candidates = await fetchCompletedSimilarTasks(companyId, task);
        if (!candidates.length) return EMPTY;

        // Rank by tag overlap with the target, then keep a generous slice to
        // look up actuals for. (We still cap anchors below.)
        const targetTags = normalizeTags(task.tagsArray);
        const ranked = candidates
            .map((c) => ({
                doc: c,
                overlap: tagOverlapCount(targetTags, normalizeTags(c.tagsArray)),
            }))
            .sort((a, b) => b.overlap - a.overlap);

        const idsForActuals = ranked.map((r) => toObjectIdString(r.doc._id)).filter(Boolean);
        const actualsByTask = await sumLoggedMinutesByTask(companyId, idsForActuals);

        // Assemble comparable records: keep only those with a usable estimate
        // and/or actual. Prefer ones that have BOTH (they drive calibration).
        const comparables = [];
        for (const { doc } of ranked) {
            const id = toObjectIdString(doc._id);
            const estimate = Number(doc.totalEstimatedTime);
            const actual = actualsByTask.get(id);
            const hasEstimate = Number.isFinite(estimate) && estimate > 0;
            const hasActual = Number.isFinite(actual) && actual > 0;
            if (!hasEstimate && !hasActual) continue;
            comparables.push({
                title: doc.TaskName ? String(doc.TaskName) : '(untitled task)',
                estimate: hasEstimate ? Math.round(estimate) : null,
                actual: hasActual ? Math.round(actual) : null,
            });
        }

        if (!comparables.length) return EMPTY;

        // Calibration: median(actual ÷ estimate) over pairs that have BOTH a
        // positive estimate and positive actual.
        const ratios = [];
        for (const c of comparables) {
            if (c.estimate && c.actual) ratios.push(c.actual / c.estimate);
        }
        const multiplier = computeCalibrationMultiplier(ratios);

        // Anchors: the most-similar comparable tasks (already ranked), capped.
        const anchors = comparables.slice(0, ANCHOR_LIMIT);

        return { anchors, multiplier, sampleCount: comparables.length };
    } catch (e) {
        logger.error(`estimate grounding failed: ${e && e.message ? e.message : e}`);
        return EMPTY;
    }
}

/** Median of a numeric array (sorted copy); null on empty. */
function median(nums) {
    if (!nums || !nums.length) return null;
    const sorted = nums.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
}

/**
 * Calibration multiplier from a list of actual/estimate ratios.
 * - < MIN_PAIRS_FOR_CALIBRATION ratios → 1.0 (no-op; not enough signal).
 * - otherwise median(ratios) clamped to [CALIBRATION_MIN, CALIBRATION_MAX].
 */
function computeCalibrationMultiplier(ratios) {
    const valid = (ratios || []).filter((r) => Number.isFinite(r) && r > 0);
    if (valid.length < MIN_PAIRS_FOR_CALIBRATION) return 1;
    const med = median(valid);
    if (!Number.isFinite(med) || med <= 0) return 1;
    if (med < CALIBRATION_MIN) return CALIBRATION_MIN;
    if (med > CALIBRATION_MAX) return CALIBRATION_MAX;
    return med;
}

/**
 * Render the anchors as a compact, model-friendly block to append to the user
 * message. Returns '' when there are no anchors (so the prompt is byte-for-byte
 * identical to today when there's no history).
 */
function renderAnchorsForPrompt(anchors) {
    if (!Array.isArray(anchors) || !anchors.length) return '';
    const lines = [
        '',
        'Comparable past tasks from this team (completed, same project/type):',
        'Use these as calibration anchors — they reflect how long this team',
        'actually takes. "est" is the prior estimate, "actual" is real logged',
        'time, both in minutes. Weight actuals over estimates when they differ.',
    ];
    for (const a of anchors) {
        const parts = [];
        if (a.estimate != null) parts.push(`est ${a.estimate}m`);
        if (a.actual != null) parts.push(`actual ${a.actual}m`);
        lines.push(`- "${a.title}" — ${parts.join(', ')}`);
    }
    return lines.join('\n');
}

module.exports = {
    buildGrounding,
    renderAnchorsForPrompt,
    // Exposed for unit tests / debugging — not part of the runtime contract.
    _internal: {
        computeCalibrationMultiplier,
        median,
        normalizeTags,
        tagOverlapCount,
        sumLoggedMinutesByTask,
        fetchCompletedSimilarTasks,
        MIN_PAIRS_FOR_CALIBRATION,
        CALIBRATION_MIN,
        CALIBRATION_MAX,
        ANCHOR_LIMIT,
        CANDIDATE_LIMIT,
    },
};
