const logger = require('../../Config/loggerConfig');
const { getRoleType } = require('../../Config/permissionGuard');
const { ROLE_GUEST } = require('../../Config/roleTypes');
const { canReadProject } = require('../../Config/projectAccess');
const { callerOf } = require('./access');
const { agentsRefused } = require('./guard');
const standingApprovals = require('./standingApprovals');

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const END_ACTION = 'project.standing_approval.end';
const TOKEN_REFUSAL = 'Standing approvals are read and removed only by a person signed in to AlianHub.';

const fail = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

/* A person with a seat who can open the project, or the refusal already sent. A token of any kind is refused:
 * these rows are what hold a token's agent. */
const personAt = async (req, res) => {
    const companyId = String(req.headers.companyid || '');
    const projectId = String((req.params && req.params.projectId) || '');
    if (!companyId || !req.uid) { fail(res, 401, 'Unauthorized.'); return null; }
    if (req.apiToken) { fail(res, 403, TOKEN_REFUSAL); return null; }
    const caller = await callerOf(req, companyId);
    if (!caller.human) { fail(res, 403, TOKEN_REFUSAL); return null; }
    const role = await getRoleType(companyId, req.uid);
    if (role === null || role === undefined || role === ROLE_GUEST) { fail(res, 403, 'Guests do not see standing approvals.'); return null; }
    if (!OBJECT_ID.test(projectId)) { fail(res, 400, 'A valid project id is required.'); return null; }
    if (!(await canReadProject(companyId, req.uid, projectId)).allowed) { fail(res, 404, 'Project not found.'); return null; }
    return { companyId, projectId, by: { userId: String(caller.actor.userId), privileged: caller.privileged } };
};

/* GET /api/v2/agents/standing-approvals/:projectId */
const listStanding = async (req, res) => {
    try {
        const at = await personAt(req, res);
        if (!at) return undefined;
        return res.json({ status: true, statusText: 'Standing approvals fetched.', data: await standingApprovals.list(at.companyId, at.projectId, at.by) });
    } catch (e) { logger.error(`listStanding: ${e.message}`); return fail(res, 500, e.message); }
};

/* DELETE /api/v2/agents/standing-approvals/:projectId/:id */
const endOne = async (req, res) => {
    try {
        const at = await personAt(req, res);
        if (!at) return undefined;
        const out = await standingApprovals.end(at.companyId, String(req.params.id || ''), { projectId: at.projectId, by: at.by, ip: req.ip || '' });
        if (out.error) return fail(res, out.status, out.error);
        return res.json({ status: true, statusText: 'Standing approval removed.', data: out.row });
    } catch (e) { logger.error(`endStanding: ${e.message}`); return fail(res, 500, e.message); }
};

module.exports = { listStanding, endStanding: [agentsRefused(END_ACTION), endOne], END_ACTION };
