'use strict';

const logger = require('../../Config/loggerConfig');
const { humanActor } = require('./access');
const chatAgents = require('./chatAgents');
const triggers = require('./triggers');

const fail = (res, statusText, code) => res.status(code || 400).send({ status: false, statusText, message: statusText });
const companyOf = (req) => req.headers.companyid;

/* GET /api/v2/agents/chat/usable?projectId=&sprintId=&taskId= — the agents the caller may @name in that
 * conversation; with no conversation, the agents they may message directly. */
exports.usableAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const { actor, human } = await humanActor(req);
        if (!human) return res.send({ status: true, statusText: 'Agents fetched.', data: [] });
        const { projectId, sprintId, taskId } = req.query || {};
        const agents = projectId
            ? await chatAgents.usableInThread(companyId, actor.userId, { projectId: String(projectId), sprintId: String(sprintId || ''), taskId: String(taskId || '') })
            : await chatAgents.usableAgents(companyId, actor.userId);
        return res.send({ status: true, statusText: 'Agents fetched.', data: agents.map(triggers.listed) });
    } catch (e) { logger.error(`chat usableAgents: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/chat/direct { agentId } — the caller's conversation with that agent, opened if new. */
exports.openDirect = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const { actor, human } = await humanActor(req);
        const conversation = human ? await chatAgents.openDirect(companyId, actor.userId, (req.body || {}).agentId) : null;
        if (!conversation) return fail(res, 'Agent not found.', 404);
        return res.send({ status: true, statusText: 'Conversation opened.', data: conversation });
    } catch (e) { logger.error(`chat openDirect: ${e.message}`); return fail(res, e.message, 500); }
};
