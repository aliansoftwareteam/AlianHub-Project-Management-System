const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const { tenantOf, TenantError } = require('../../Config/tenant');
const { callerOf, canManageAgents } = require('./access');
const { setByPerson } = require('./personDecides');
const agentAudit = require('./agentAudit');
const rolesFlag = require('../Mcp/rolesFlag');
const rolePlaybooks = require('./rolePlaybooks');
const overrides = require('./rolePlaybookOverrides');

const EDIT_ACTION = 'agent.role_playbook.edit';
const RESTORE_ACTION = 'agent.role_playbook.restore';
const KIND = 'role_playbook';

const fail = (res, code, statusText) => res.status(code).json({ status: false, statusText, message: statusText });

const rowOf = (role, edited) => ({
    blueprint: role.blueprint,
    slug: role.slug,
    name: role.name,
    department: role.department,
    default: role.body,
    body: edited.get(overrides.keyOf(role.blueprint, role.slug)) || role.body,
    edited: edited.has(overrides.keyOf(role.blueprint, role.slug)),
});

const answerFor = async (companyId, canEdit) => {
    const edited = await overrides.forCompany(companyId);
    return { roles: rolePlaybooks.all().map((role) => rowOf(role, edited)), maxLength: overrides.BODY_MAX, canEdit };
};

/* Whoever may open the AI settings reads the roles; only an owner or admin, in a signed-in session, changes one. */
const guarded = async (req, res) => {
    if (!rolesFlag.enabled()) { fail(res, 404, 'Role playbooks are not available on this server.'); return null; }
    const companyId = tenantOf(req);
    const caller = await callerOf(req, companyId);
    return { companyId, caller };
};

const listRoles = async (req, res) => {
    try {
        const at = await guarded(req, res);
        if (!at) return undefined;
        if (!at.caller.human || !(at.caller.member || at.caller.privileged)) return fail(res, 403, 'Only a member of this workspace can read the roles.');
        return res.json({ status: true, statusText: 'Roles fetched.', data: await answerFor(at.companyId, !req.apiToken && canManageAgents(at.caller)) });
    } catch (e) {
        if (e instanceof TenantError) return fail(res, e.statusCode, e.message);
        logger.error(`listRoles: ${e.message}`);
        return fail(res, 500, 'The roles could not be read; try again.');
    }
};

const changed = async (req, res, make) => {
    try {
        const at = await guarded(req, res);
        if (!at) return undefined;
        if (!canManageAgents(at.caller)) return fail(res, 403, 'Owner/admin only.');
        const out = await make(at.companyId, at.caller);
        if (out.error) return fail(res, out.status, out.error);
        await agentAudit.recordRolePlaybookChange(at.companyId, at.caller.actor, { role: out.role, restored: out.restored, from: out.from, to: out.to, ip: req.ip || '' });
        socketEmitter.emit('update', { type: 'update', module: 'agent', companyId: at.companyId, data: { kind: KIND, role: `${out.role.blueprint}/${out.role.slug}` }, updatedFields: { kind: KIND }, actor: { kind: 'human' }, depth: 1 });
        return res.json({ status: true, statusText: 'Playbook updated.', data: await answerFor(at.companyId, true) });
    } catch (e) {
        if (e instanceof TenantError) return fail(res, e.statusCode, e.message);
        logger.error(`role playbook change: ${e.message}`);
        return fail(res, 500, 'The playbook could not be saved; try again.');
    }
};

const saveRole = (req, res) => changed(req, res, async (companyId, caller) => {
    const { blueprint, slug } = req.params;
    const body = req.body && typeof req.body === 'object' ? req.body.body : undefined;
    return overrides.save(companyId, blueprint, slug, body, caller.actor.userId);
});

const restoreRole = (req, res) => changed(req, res, async (companyId) => {
    const out = await overrides.restore(companyId, req.params.blueprint, req.params.slug);
    return { ...out, restored: true };
});

module.exports = {
    listRoles,
    putRolePlaybook: [setByPerson(EDIT_ACTION), saveRole],
    deleteRolePlaybook: [setByPerson(RESTORE_ACTION), restoreRole],
    EDIT_ACTION,
    RESTORE_ACTION,
};
