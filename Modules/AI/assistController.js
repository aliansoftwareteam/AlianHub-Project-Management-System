'use strict';

const logger = require('../../Config/loggerConfig');
const { tenantOf } = require('../../Config/tenant');
const { suggestNextSteps } = require('./taskAssist');
const taskResearch = require('./taskResearch');
const { improveSelection, splitSelection } = require('./selectionAssist');
const { aboutOf, tokenProjectIdsOf } = require('./ask');

const send = (res, result) => {
    if (result.status) return res.send({ status: true, data: result.data });
    const body = { status: false, statusText: result.reason, code: result.code };
    return (result.notFound || result.notAvailable) ? res.status(404).send(body) : res.send(body);
};

const handler = (name, run) => async (req, res) => {
    let companyId;
    try {
        companyId = tenantOf(req);
    } catch (error) {
        return res.status(error.statusCode || 403).send({ status: false, statusText: error.message });
    }
    if (!req.uid) return res.status(401).send({ status: false, statusText: 'An authenticated user is required.', code: 'unauthenticated' });
    try {
        return send(res, await run({ req, companyId, uid: String(req.uid), body: req.body || {} }));
    } catch (error) {
        logger.error(`ai ${name}: ${error.message}`);
        return res.send({ status: false, statusText: 'Something went wrong. Try again.', code: 'failed' });
    }
};

/* GET /api/v1/ai/task-assist — which task assists this instance offers. */
exports.capabilities = handler('task assist capabilities', async () => ({ status: true, data: { research: taskResearch.capability().available } }));

/* POST /api/v1/ai/task-next-steps  body: { taskId } */
exports.nextSteps = handler('next steps', async ({ req, companyId, uid, body }) => suggestNextSteps({
    companyId, uid, taskId: String(body.taskId || ''), tokenProjectIds: tokenProjectIdsOf(req), about: await aboutOf(req, companyId, uid),
}));

/* POST /api/v1/ai/task-research  body: { taskId } — refused before any read while research is unavailable. */
exports.research = handler('task research', ({ req, companyId, uid, body }) => {
    const { search } = taskResearch.capability();
    return taskResearch.researchTask({ companyId, uid, taskId: String(body.taskId || ''), tokenProjectIds: tokenProjectIdsOf(req), search });
});

/* POST /api/v1/ai/selection/improve  body: { mode, text, language? } */
exports.improve = handler('selection improve', ({ companyId, uid, body }) => improveSelection({ companyId, uid, mode: body.mode, text: body.text, language: body.language }));

/* POST /api/v1/ai/selection/tasks  body: { text } */
exports.splitTasks = handler('selection tasks', ({ companyId, uid, body }) => splitSelection({ companyId, uid, text: body.text }));
