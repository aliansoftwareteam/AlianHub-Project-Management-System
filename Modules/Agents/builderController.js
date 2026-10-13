const logger = require('../../Config/loggerConfig');
const aiSwitch = require('../AICore/aiSwitch');
const { callerOf, canManageAgents, REFUSAL } = require('./access');
const builder = require('./builder');

const fail = (res, statusText, code, extra) => res.status(code || 400).send({ status: false, statusText, message: statusText, ...(extra || {}) });

/* POST /api/v2/agents/draft — a draft for the new-agent wizard; nothing is stored. */
exports.draftAgent = async (req, res) => {
    try {
        const companyId = String(req.headers['companyid'] || '');
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot draft agents.', 403);
        if (!canManageAgents(caller)) return fail(res, REFUSAL.MANAGE, 403);
        const draft = await builder.draftAgent({ companyId, userId: String(caller.actor.userId), description: (req.body || {}).description });
        return res.send({ status: true, statusText: 'Draft ready.', data: draft });
    } catch (e) {
        if (aiSwitch.isAiOff(e)) return fail(res, e.message, 403, { code: aiSwitch.AI_OFF });
        if (e.status) return fail(res, e.message, e.status);
        logger.error(`draftAgent: ${e.message}`);
        return fail(res, 'The draft could not be made. Try again or pick a template.', 500);
    }
};
