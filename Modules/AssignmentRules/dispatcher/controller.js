const logger = require('../../../Config/loggerConfig');
const { actingUser } = require('../../Sprints/helpers/actingUser');
const { RuleError } = require('../rules');
const flag = require('./flag');
const settings = require('./settings');
const decisions = require('./decisions');
const audit = require('./audit');

const companyOf = (req) => String(req.headers['companyid'] || '');

const refuse = (res, statusCode, statusText) => res.status(statusCode).json({ status: false, statusText, message: statusText });

const fail = (res, what) => (error) => {
    if (error instanceof RuleError) return refuse(res, error.statusCode, error.message);
    logger.error(`[dispatcher] ${what}: ${(error && error.message) || error}`);
    return refuse(res, 500, 'Something went wrong. Please try again.');
};

const signedIn = async (req, res) => {
    const actor = await actingUser(req);
    if (!actor) refuse(res, 401, 'A signed-in user is required.');
    return actor;
};

/* Off, the routes that change something answer as if they did not exist. */
exports.whenOn = (req, res, next) => (flag.enabled() ? next() : refuse(res, 404, 'Not found.'));

exports.getSettings = async (req, res) => {
    try {
        const on = flag.enabled();
        const data = on ? { on, settings: await settings.load(companyOf(req), req.params.projectId), roles: settings.roleChoices() } : { on, settings: null, roles: [] };
        return res.json({ status: true, statusText: 'Dispatcher settings', data });
    } catch (error) {
        return fail(res, 'read settings')(error);
    }
};

const saved = (add) => async (req, res) => {
    try {
        const actor = await signedIn(req, res);
        if (!actor) return undefined;
        const companyId = companyOf(req);
        const { projectId } = req.params;
        const result = add
            ? await settings.addRule(companyId, projectId, req.body || {}, actor.id)
            : await settings.save(companyId, projectId, req.body || {}, actor.id);
        audit.settingsChanged(companyId, actor, projectId, { mode: result.mode, threshold: result.threshold, modelGuess: result.modelGuess, roles: result.roles.length, rules: result.rules.length, revision: result.revision }, add);
        return res.json({ status: true, statusText: 'Dispatcher settings saved', data: result });
    } catch (error) {
        return fail(res, 'save settings')(error);
    }
};

exports.saveSettings = saved(false);
exports.addRule = saved(true);

exports.getNeedsRouting = async (req, res) => {
    try {
        const data = await decisions.needsRouting(companyOf(req), req.uid, req.params.projectId);
        return res.json({ status: true, statusText: 'Needs routing', data });
    } catch (error) {
        return fail(res, 'read needs routing')(error);
    }
};

exports.getTaskDecision = async (req, res) => {
    try {
        const data = await decisions.forTask(companyOf(req), req.uid, req.params.taskId);
        return res.json({ status: true, statusText: 'Routing suggestion', data });
    } catch (error) {
        return fail(res, 'read suggestion')(error);
    }
};

const ACTIONS = {
    accept: (companyId, actor, req) => decisions.accept(companyId, actor, req.params.taskId, req.params.decisionId),
    dismiss: (companyId, actor, req) => decisions.dismiss(companyId, actor, req.params.taskId, req.params.decisionId),
    route: (companyId, actor, req) => decisions.route(companyId, actor, req.params.taskId, req.params.decisionId, String((req.body || {}).role || '')),
};

exports.actOnDecision = (action) => async (req, res) => {
    try {
        const actor = await signedIn(req, res);
        if (!actor) return undefined;
        const data = await ACTIONS[action](companyOf(req), actor, req);
        return res.json({ status: true, statusText: 'Routing suggestion updated', data });
    } catch (error) {
        return fail(res, `${action} suggestion`)(error);
    }
};
