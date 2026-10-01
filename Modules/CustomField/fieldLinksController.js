const logger = require('../../Config/loggerConfig');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { QueryRefused } = require('../Tasks/helpers/taskQueryGuard');
const { resolveFor, castVote, RESOLVE_MAX, NOT_FOUND } = require('./helpers/fieldLinks');

const VOTE_KEYS = Object.freeze(['taskId', 'vote']);

const refuse = (res, statusCode, message) => res.status(statusCode).json({ status: false, statusText: message, message });

const handle = (label, work) => async (req, res) => {
    try {
        const answer = await work({ companyId: tenantOf(req), uid: String(req.uid || ''), body: req.body || {}, params: req.params || {} });
        if (answer.refused) return refuse(res, answer.statusCode, answer.refused);
        return res.json({ status: true, statusText: 'OK', data: answer.data });
    } catch (error) {
        if (error instanceof TenantError) return refuse(res, error.statusCode, error.message);
        if (error instanceof QueryRefused) return refuse(res, 400, error.message);
        logger.error(`[field-links] ${label}: ${(error && error.message) || error}`);
        return refuse(res, 500, 'The request could not be completed.');
    }
};

exports.resolve = handle('resolve', async ({ companyId, uid, body }) => {
    const { taskIds } = body;
    if (!Array.isArray(taskIds) || taskIds.length > RESOLVE_MAX) return { statusCode: 400, refused: `taskIds must list at most ${RESOLVE_MAX} tasks.` };
    return { data: await resolveFor({ companyId, uid, taskIds }) };
});

/* The voter is the caller and nobody else, so the body may name the task and the vote and nothing more. */
exports.vote = handle('vote', async ({ companyId, uid, body, params }) => {
    const extra = Object.keys(body).filter((key) => !VOTE_KEYS.includes(key));
    if (extra.length || typeof body.vote !== 'boolean') return { statusCode: 400, refused: 'A vote names the task and whether it is cast or withdrawn, and is cast as yourself.' };
    const cast = await castVote({ companyId, uid, taskId: body.taskId, fieldId: params.fieldId, vote: body.vote });
    if (cast.refused) return cast.refused === NOT_FOUND ? { statusCode: 404, refused: 'Task not found.' } : { statusCode: 400, refused: 'That is not a voting field of this task.' };
    return { data: cast };
});
