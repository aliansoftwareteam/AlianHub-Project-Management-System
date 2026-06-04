/**
 * Proposal-review controller — start / stop / SSE events.
 *
 * start: validates input, mints a reviewId, responds immediately, then runs the
 *        review asynchronously (client subscribes to SSE with the reviewId).
 * stop:  flips the job's cancel flag (emergency stop). The engine checks it
 *        before touching each card, so it halts before the next status change.
 * events: opens the SSE progress stream for a reviewId.
 */
'use strict';

const crypto = require('crypto');
const logger = require('../../Config/loggerConfig');
const engine = require('./reviewEngine');
const sse = require('./sseEmitter');

function token() { return crypto.randomBytes(12).toString('hex'); }
function sendErr(res, code, msg) { return res.status(code).send({ status: false, statusText: msg }); }

exports.start = (req, res) => {
    try {
        // Prefer the verified companyId header; fall back to the body.
        const companyId = (req.headers && req.headers['companyid']) || (req.body && req.body.companyId);
        const { projectId, sprintId, userData, dryRun } = req.body || {};
        if (!companyId) return sendErr(res, 400, 'companyId required');
        if (!projectId || !sprintId) return sendErr(res, 400, 'projectId and sprintId required');
        if (!userData || !userData.id) return sendErr(res, 400, 'userData with id is required');

        const reviewId = token();
        engine.startJob(reviewId);
        res.send({ status: true, reviewId });

        // Run after responding so the client can attach its SSE listener first.
        setTimeout(() => {
            engine.runReview({
                reviewId,
                companyId: String(companyId),
                projectId: String(projectId),
                sprintId: String(sprintId),
                userData: {
                    id: String(userData.id),
                    Employee_Name: userData.Employee_Name || 'Reviewer',
                    companyOwnerId: userData.companyOwnerId || String(companyId),
                },
                dryRun: dryRun === true,
            }).catch((e) => logger.error(`ProposalReview run error: ${e && e.message ? e.message : e}`));
        }, 150);
    } catch (error) {
        return sendErr(res, 500, (error && error.message) || 'Failed to start review');
    }
};

exports.stop = (req, res) => {
    try {
        const reviewId = req.body && req.body.reviewId;
        if (!reviewId) return sendErr(res, 400, 'reviewId required');
        const existed = engine.cancelJob(reviewId);
        return res.send({ status: true, statusText: existed ? 'Stopping…' : 'Job not running' });
    } catch (error) {
        return sendErr(res, 500, (error && error.message) || 'Failed to stop review');
    }
};

exports.events = (req, res) => sse.handleEvents(req, res);
