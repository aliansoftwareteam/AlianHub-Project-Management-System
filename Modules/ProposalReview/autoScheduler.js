/**
 * Proposal-review auto-scheduler.
 *
 * Runs every 5 minutes (registered from cron.js) and, for each configured
 * (companyId, projectId, sprintId) target, invokes the existing
 * reviewEngine.runReview(...) — the same code path the manual "Review
 * Proposals" button uses. Each tick processes targets SEQUENTIALLY to
 * keep LLM rate-limit pressure predictable.
 *
 * Configuration (all env vars; scheduler is a no-op unless ENABLED=true):
 *   PROPOSAL_REVIEW_AUTO_ENABLED            "true" to turn on (default off)
 *   PROPOSAL_REVIEW_AUTO_TARGETS            "<companyId>:<projectId>:<sprintId>,..."
 *   PROPOSAL_REVIEW_SYSTEM_USER_ID          Mongo user _id used as the actor
 *   PROPOSAL_REVIEW_SYSTEM_USER_NAME        Display name (default "AI Reviewer")
 *   PROPOSAL_REVIEW_SYSTEM_USER_COMPANY_OWNER_ID  optional; falls back to companyId
 *   PROPOSAL_REVIEW_DRY_RUN                 "true" → read + verdict, NO status moves
 *
 * Concurrency: a single in-memory `inFlight` flag prevents a second tick
 * from starting while the previous one is still running. The skipped
 * tick is logged so an operator can see if 5 minutes isn't enough.
 *
 * Failure handling: per-target errors are caught and logged; the tick
 * continues to the next target. The cron job is never unregistered by a
 * runtime error.
 */
'use strict';

const crypto = require('crypto');
const logger = require('../../Config/loggerConfig');
const engine = require('./reviewEngine');

const RULE = '*/5 * * * *';

let inFlight = false;
let cachedTargets = null;
let cachedTargetsSource = null;

function reviewId() { return crypto.randomBytes(12).toString('hex'); }

function isEnabled() {
    return String(process.env.PROPOSAL_REVIEW_AUTO_ENABLED || '').toLowerCase() === 'true';
}

function isDryRun() {
    return String(process.env.PROPOSAL_REVIEW_DRY_RUN || '').toLowerCase() === 'true';
}

/**
 * Parse PROPOSAL_REVIEW_AUTO_TARGETS into an array of {companyId, projectId, sprintId}.
 * Tolerates trailing commas, extra whitespace. Bad tuples are dropped with a warn.
 * Cached by raw input string so we only validate once per env-var change.
 */
function getTargets() {
    const raw = process.env.PROPOSAL_REVIEW_AUTO_TARGETS || '';
    if (raw === cachedTargetsSource && cachedTargets) return cachedTargets;
    cachedTargetsSource = raw;
    const parts = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    for (const part of parts) {
        const fields = part.split(':').map((s) => s.trim());
        if (fields.length !== 3 || fields.some((f) => !f)) {
            logger.warn(`[proposal-review] auto-scheduler: skipping malformed target "${part}" (expected companyId:projectId:sprintId)`);
            continue;
        }
        out.push({ companyId: fields[0], projectId: fields[1], sprintId: fields[2] });
    }
    cachedTargets = out;
    return out;
}

function buildUserData(companyId) {
    const id = String(process.env.PROPOSAL_REVIEW_SYSTEM_USER_ID || '').trim();
    if (!id) return null;
    return {
        id,
        Employee_Name: process.env.PROPOSAL_REVIEW_SYSTEM_USER_NAME || 'AI Reviewer',
        companyOwnerId: String(process.env.PROPOSAL_REVIEW_SYSTEM_USER_COMPANY_OWNER_ID || companyId),
    };
}

async function reviewOne(target) {
    const userData = buildUserData(target.companyId);
    if (!userData) {
        logger.error('[proposal-review] auto-scheduler: PROPOSAL_REVIEW_SYSTEM_USER_ID is required when enabled — skipping target');
        return;
    }
    const id = reviewId();
    const dryRun = isDryRun();
    const label = `${target.companyId}:${target.projectId}:${target.sprintId}`;
    logger.info(`[proposal-review] auto-scheduler: reviewing ${label} (reviewId=${id}, dryRun=${dryRun})`);
    try {
        engine.startJob(id);
        await engine.runReview({
            reviewId: id,
            companyId: target.companyId,
            projectId: target.projectId,
            sprintId: target.sprintId,
            userData,
            dryRun,
        });
        logger.info(`[proposal-review] auto-scheduler: done ${label} (reviewId=${id})`);
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        logger.error(`[proposal-review] auto-scheduler: ${label} failed: ${msg}`);
    }
}

/**
 * One scheduler tick — called every 5 minutes by cron.js.
 * No-op when disabled, when no targets are configured, or when a previous
 * tick is still in flight (logged so operators see it).
 */
async function tick() {
    if (!isEnabled()) return;
    if (inFlight) {
        logger.warn('[proposal-review] auto-scheduler: previous tick still running — skipping this 5-min slot');
        return;
    }
    const targets = getTargets();
    if (!targets.length) return; // banner at startup already covers the empty-config case

    inFlight = true;
    try {
        for (const t of targets) {
            // Sequential by design: parallel calls would multiply LLM rate-limit pressure.
            await reviewOne(t);
        }
    } finally {
        inFlight = false;
    }
}

/**
 * One-line startup banner so the operator sees the scheduler's effective
 * config the moment the server boots. Called from cron.js after require.
 */
function logStartupBanner() {
    if (!isEnabled()) {
        logger.info('[proposal-review] auto-scheduler disabled (set PROPOSAL_REVIEW_AUTO_ENABLED=true to turn on)');
        return;
    }
    const targets = getTargets();
    const userId = String(process.env.PROPOSAL_REVIEW_SYSTEM_USER_ID || '').trim();
    if (!userId) {
        logger.error('[proposal-review] auto-scheduler ENABLED but PROPOSAL_REVIEW_SYSTEM_USER_ID is missing — ticks will no-op');
    }
    const userName = process.env.PROPOSAL_REVIEW_SYSTEM_USER_NAME || 'AI Reviewer';
    const userIdShort = userId ? `${userId.slice(0, 8)}…` : '<missing>';
    logger.info(
        `[proposal-review] auto-scheduler ENABLED — cadence=${RULE}, targets=${targets.length}, dryRun=${isDryRun()}, systemUser=${userName} (${userIdShort})`,
    );
}

module.exports = { tick, logStartupBanner, RULE };
