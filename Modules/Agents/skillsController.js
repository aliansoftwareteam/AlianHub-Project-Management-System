const { tenantOf, TenantError } = require('../../Config/tenant');
const logger = require('../../Config/loggerConfig');
const { callerOf, canManageAgents } = require('./access');
const skillRecord = require('./skillRecord');
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

/* GET /api/v2/agents/skills */
exports.listSkills = async (req, res) => {
    try {
        const companyId = tenantOf(req);
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
        if (!(await privilegedHuman(req, companyId))) return fail(res, 'Owner/admin only.', 403);
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

/* POST /api/v2/agents/skills */
exports.createSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const actor = await privilegedHuman(req, companyId);
        if (!actor) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.createSkill(companyId, req.body || {}, { createdBy: actor.userId });
        return res.status(201).send({ status: true, statusText: 'Skill created.', data: saved });
    } catch (e) { return failWith(res, e); }
};

/* PUT /api/v2/agents/skills/:key */
exports.updateSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!(await privilegedHuman(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.updateSkill(companyId, req.params.key, req.body || {});
        if (!saved) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, statusText: 'Skill updated.', data: saved });
    } catch (e) { return failWith(res, e); }
};

/* POST /api/v2/agents/skills/:key/dry-run — what this skill would read, ask and
 * change on one task. No model call, no write. */
exports.dryRunSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const actor = await privilegedHuman(req, companyId);
        if (!actor) return fail(res, 'Owner/admin only.', 403);
        const body = req.body || {};
        const data = await skillDryRun.dryRun(companyId, req.params.key, { taskId: body.taskId, agentId: body.agentId, uid: actor.userId });
        return res.send({ status: true, statusText: 'Dry run complete.', data });
    } catch (e) { return failWith(res, e); }
};

/* DELETE /api/v2/agents/skills/:key — retires; agents and rules still hold the key. */
exports.retireSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!(await privilegedHuman(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.retireSkill(companyId, req.params.key);
        if (!saved) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, statusText: 'Skill retired.', data: saved });
    } catch (e) { return failWith(res, e); }
};
