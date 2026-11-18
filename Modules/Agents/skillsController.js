const { tenantOf, TenantError } = require('../../Config/tenant');
const logger = require('../../Config/loggerConfig');
const { callerOf, canManageAgents, agentRightsOf, REFUSAL } = require('./access');
const skillRecord = require('./skillRecord');
const agentApproval = require('./agentApproval');
const skillDryRun = require('./skillDryRun');
const externalReads = require('./skills/externalReads');

const fail = (res, message, code, extra) => res.status(code || 400).send({ status: false, statusText: message, message, ...(extra || {}) });

const failWith = (res, e) => {
    if (e && e.errors) return fail(res, e.message, 400, { data: { errors: e.errors } });
    if (e && (e.statusCode === 403 || e.statusCode === 404)) return fail(res, e.message, e.statusCode);
    logger.error(`agent skills: ${e && e.message}`);
    return fail(res, (e && e.message) || 'Something went wrong.', 500);
};

const privilegedHuman = async (req, companyId) => {
    const caller = await callerOf(req, companyId);
    return canManageAgents(caller) ? caller.actor : null;
};

/* A person whose role writes skills, with what their role holds; null once refused. */
const skillWriter = async (req, res, companyId) => {
    const caller = await callerOf(req, companyId);
    const rights = await agentRightsOf(companyId, caller);
    if (!caller.human || !rights.writeSkills) { fail(res, REFUSAL.SKILLS, 403); return null; }
    return caller;
};

const ownsSkill = (caller, doc) => caller.privileged || (Boolean(doc) && String(doc.createdBy || '') === String(caller.actor.userId));

/* GET /api/v2/agents/skills — the library for whoever may see it, and for whoever builds agents, who picks from it. */
exports.listSkills = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const caller = await callerOf(req, companyId);
        const rights = await agentRightsOf(companyId, caller);
        if (caller.human && !rights.seesSkills && !rights.build) return fail(res, REFUSAL.SKILLS, 403);
        const includeRetired = String(req.query && req.query.retired) === 'true';
        return res.send({ status: true, statusText: 'Skills fetched.', data: await skillRecord.listSkills(companyId, { includeRetired }) });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/manifest — what workflows and rules bind an agent by. */
exports.agentManifest = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        return res.send({ status: true, statusText: 'Manifest fetched.', data: await skillRecord.agentManifest(companyId) });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/skills/catalogues */
exports.getCatalogues = (req, res) => {
    try {
        tenantOf(req);
        return res.send({ status: true, statusText: 'Catalogues fetched.', data: skillRecord.catalogues() });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/skills/egress-check?host= — whether one host is on this workspace's list, for whoever may
 * save a skill. A token never asks: the answer, host by host, would read the list out. */
exports.egressCheck = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (req.apiToken || req.mcp) return fail(res, 'A token cannot check the egress allowlist.', 403);
        if (!(await skillWriter(req, res, companyId))) return undefined;
        if (!externalReads.enabled()) return fail(res, 'Declared reads are not available on this server.', 404);
        let data;
        try {
            data = await externalReads.checkHost(companyId, req.query && req.query.host);
        } catch (e) {
            logger.error(`agent skills: egress check: ${e && e.message}`);
            return fail(res, 'The workspace egress allowlist could not be read; try again.', 503, { code: externalReads.CODE.ALLOWLIST_UNREADABLE });
        }
        return res.send({ status: true, statusText: 'Host checked.', data });
    } catch (e) {
        if (e instanceof TenantError) return fail(res, e.message, e.statusCode);
        return failWith(res, e);
    }
};

/* GET /api/v2/agents/skills/:key */
exports.getSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const doc = await skillRecord.findData(companyId, req.params.key);
        if (!doc) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, statusText: 'Skill fetched.', data: doc });
    } catch (e) { return failWith(res, e); }
};

/* POST /api/v2/agents/skills — an owner or admin's skill is on at once; anyone else's waits for one of them */
exports.createSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const caller = await skillWriter(req, res, companyId);
        if (!caller) return undefined;
        const { actor } = caller;
        const asks = caller.privileged ? null : agentApproval.requested(actor);
        const saved = await skillRecord.createSkill(companyId, req.body || {}, { createdBy: actor.userId, approval: asks });
        if (asks) {
            await agentApproval.audit(companyId, actor, { entityType: 'agent_skill', entityId: saved.key, name: saved.name, ip: req.ip || '' });
            await agentApproval.notifyRequested(companyId, agentApproval.KIND.SKILL, { _id: saved.key, name: saved.name }, { actor });
        }
        return res.status(201).send({ status: true, statusText: asks ? 'Skill saved. It waits for an Owner or an Admin to approve it.' : 'Skill created.', data: saved });
    } catch (e) { return failWith(res, e); }
};

/* PUT /api/v2/agents/skills/:key — anyone but an owner or admin changes only the skills they wrote, and the change waits */
exports.updateSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const caller = await skillWriter(req, res, companyId);
        if (!caller) return undefined;
        const existing = await skillRecord.findData(companyId, req.params.key);
        if (!existing) return fail(res, 'Skill not found.', 404);
        if (!ownsSkill(caller, existing)) return fail(res, REFUSAL.OWN_SKILL, 403);
        const asks = caller.privileged ? null : agentApproval.requested(caller.actor);
        const saved = await skillRecord.updateSkill(companyId, req.params.key, req.body || {}, { asks });
        if (!saved) return fail(res, 'Skill not found.', 404);
        if (asks) {
            await agentApproval.audit(companyId, caller.actor, { entityType: 'agent_skill', entityId: saved.key, name: saved.name, ip: req.ip || '' });
            await agentApproval.notifyRequested(companyId, agentApproval.KIND.SKILL, { _id: saved.key, name: saved.name }, { actor: caller.actor });
        }
        return res.send({ status: true, statusText: asks ? 'Your change waits for an Owner or an Admin to approve it.' : 'Skill updated.', data: saved });
    } catch (e) { return failWith(res, e); }
};

/* POST /api/v2/agents/skills/:key/approve  |  /decline  body: { reason } — an owner or admin answers */
exports.decideSkill = (approve) => async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const actor = await privilegedHuman(req, companyId);
        if (!actor) return fail(res, 'Only an Owner or an Admin can approve skills.', 403);
        const reason = approve ? '' : agentApproval.reasonOf((req.body || {}).reason);
        if (!approve && !reason) return fail(res, agentApproval.REFUSAL.REASON, 400);
        const out = await skillRecord.decideSkill(companyId, req.params.key, { approve, actor, reason });
        if (out.error) return fail(res, out.error, out.status);
        const named = { _id: out.skill.key, name: out.skill.name };
        await agentApproval.audit(companyId, actor, { decision: approve ? 'approved' : 'declined', entityType: 'agent_skill', entityId: out.skill.key, name: out.skill.name, reason, ip: req.ip || '' });
        await agentApproval.notifyDecided(companyId, agentApproval.KIND.SKILL, named, { actor, to: out.requestedBy, approved: approve, reason });
        return res.send({ status: true, statusText: approve ? 'Skill approved.' : 'Skill declined.', data: out.skill });
    } catch (e) { return failWith(res, e); }
};

/* POST /api/v2/agents/skills/:key/dry-run — what this skill would read, ask and
 * change on one task. No model call, no write. */
exports.dryRunSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const caller = await skillWriter(req, res, companyId);
        if (!caller) return undefined;
        const body = req.body || {};
        const data = await skillDryRun.dryRun(companyId, req.params.key, { taskId: body.taskId, agentId: body.agentId, uid: caller.actor.userId });
        return res.send({ status: true, statusText: 'Dry run complete.', data });
    } catch (e) { return failWith(res, e); }
};

/* DELETE /api/v2/agents/skills/:key — retires; agents and rules still hold the key. */
exports.retireSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const caller = await skillWriter(req, res, companyId);
        if (!caller) return undefined;
        if (!ownsSkill(caller, await skillRecord.findData(companyId, req.params.key))) return fail(res, REFUSAL.OWN_SKILL, 403);
        const saved = await skillRecord.retireSkill(companyId, req.params.key);
        if (!saved) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, statusText: 'Skill retired.', data: saved });
    } catch (e) { return failWith(res, e); }
};
