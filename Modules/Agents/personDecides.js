const audit = require('./agentAudit');
const { resolveActor, isAgent } = require('./actor');
const logger = require('../../Config/loggerConfig');

const SESSION_ONLY = 'Only a person signed in to AlianHub can decide this; an API token cannot.';

const refuse = async (req, res, actor, { action, reason, params, entityId }) => {
    const companyId = req.headers['companyid'] || '';
    const auditId = await audit.recordRefusal(companyId, actor, {
        action, reason, params, entityId, path: `${req.method} ${String(req.originalUrl || '').split('?')[0]}`, ip: req.ip || '',
    });
    return res.status(403).json({ status: false, message: reason, statusText: reason, auditId });
};

const isSignedInSession = (req) => !req.apiToken && !req.agentRun && !req.mcp;

/* A decision is a person's, made in a signed-in session. Anything else is answered here and false comes back:
 * a token of any kind is refused whoever holds it, and an agent's attempt is recorded under `action`. */
const personDecides = async (req, res, action) => {
    if (isSignedInSession(req)) return true;
    const actor = req.agentActor || await resolveActor(req);
    req.agentActor = actor;
    if (isAgent(actor)) await refuse(req, res, actor, { action, reason: `Agents cannot perform ${action}`, params: {} });
    else res.status(403).json({ status: false, message: SESSION_ONLY, statusText: SESSION_ONLY });
    return false;
};

/* The same rule in front of a handler, for a route that mounts it. */
const decidedByPerson = (action) => async (req, res, next) => {
    try {
        return (await personDecides(req, res, action)) ? next() : undefined;
    } catch (e) {
        logger.error(`decidedByPerson: ${e.message}`);
        return res.status(500).json({ status: false, message: 'The check failed.', statusText: 'The check failed.' });
    }
};

module.exports = { SESSION_ONLY, refuse, isSignedInSession, personDecides, decidedByPerson };
