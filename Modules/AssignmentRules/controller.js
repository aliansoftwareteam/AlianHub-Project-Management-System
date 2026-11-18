const logger = require('../../Config/loggerConfig');
const { availability } = require('../AICore/llmProvider');
const { actingUser } = require('../Sprints/helpers/actingUser');
const { loadRules, saveRules, RuleError } = require('./rules');
const { draftRules } = require('./draft');
const decisions = require('./decisions');

const companyOf = (req) => String(req.headers['companyid'] || '');

const refuse = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });

const fail = (res, what) => (error) => {
    if (error instanceof RuleError) return refuse(res, error.statusCode, error.message);
    logger.error(`[assignment-rules] ${what}: ${(error && error.message) || error}`);
    return refuse(res, 500, 'Something went wrong. Please try again.');
};

const signedIn = async (req, res) => {
    const actor = await actingUser(req);
    if (!actor) refuse(res, 401, 'A signed-in user is required.');
    return actor;
};

exports.getProjectRules = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const [rules, ai] = await Promise.all([loadRules(companyId, req.params.projectId), availability(companyId)]);
        return res.json({ status: true, statusText: 'Assignment rules', data: { rules, ai: { state: ai.state } } });
    } catch (error) {
        return fail(res, 'read rules')(error);
    }
};

exports.saveProjectRules = async (req, res) => {
    try {
        const actor = await signedIn(req, res);
        if (!actor) return undefined;
        const rules = await saveRules(companyOf(req), req.params.projectId, req.body || {}, actor.id);
        return res.json({ status: true, statusText: 'Assignment rules saved', data: rules });
    } catch (error) {
        return fail(res, 'save rules')(error);
    }
};

exports.draftProjectRules = async (req, res) => {
    try {
        const drafts = await draftRules({ companyId: companyOf(req), projectId: req.params.projectId, uid: req.uid, userIds: (req.body || {}).userIds });
        return res.json({ status: true, statusText: 'Suggested rules', data: { drafts } });
    } catch (error) {
        return fail(res, 'draft rules')(error);
    }
};

exports.getTaskDecision = async (req, res) => {
    try {
        const data = await decisions.forTask(companyOf(req), req.uid, req.params.taskId);
        return res.json({ status: true, statusText: 'Assignment suggestion', data });
    } catch (error) {
        return fail(res, 'read suggestion')(error);
    }
};

const ACTIONS = { accept: decisions.accept, dismiss: decisions.dismiss, undo: decisions.undo };

exports.actOnDecision = (action) => async (req, res) => {
    try {
        const actor = await signedIn(req, res);
        if (!actor) return undefined;
        const decision = await ACTIONS[action](companyOf(req), actor, req.params.taskId, req.params.decisionId);
        return res.json({ status: true, statusText: 'Assignment suggestion updated', data: decision });
    } catch (error) {
        return fail(res, `${action} suggestion`)(error);
    }
};
