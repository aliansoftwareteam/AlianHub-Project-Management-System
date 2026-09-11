const { tenantOf } = require('../../Config/tenant');
const { getRoleType, isPrivileged } = require('../../Config/permissionGuard');
const logger = require('../../Config/loggerConfig');
const { resolveActor, isAgent } = require('./actor');
const skillRecord = require('./skillRecord');

const fail = (res, message, code, extra) => res.status(code || 200).send({ status: false, statusText: message, message, ...(extra || {}) });

const failWith = (res, e) => {
    if (e && e.errors) return fail(res, e.message, 400, { data: { errors: e.errors } });
    if (e && e.statusCode === 403) return fail(res, e.message, 403);
    logger.error(`agent skills: ${e && e.message}`);
    return fail(res, (e && e.message) || 'Something went wrong.');
};

const privilegedHuman = async (req, companyId) => {
    const actor = req.agentActor || await resolveActor(req);
    if (isAgent(actor) || !actor.userId) return null;
    return isPrivileged(await getRoleType(companyId, actor.userId)) ? actor : null;
};

/* GET /api/v2/agents/skills */
exports.listSkills = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const includeRetired = String(req.query && req.query.retired) === 'true';
        return res.send({ status: true, data: await skillRecord.listSkills(companyId, { includeRetired }) });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/manifest — what workflows and rules bind an agent by. */
exports.agentManifest = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        return res.send({ status: true, data: await skillRecord.agentManifest(companyId) });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/skills/catalogues */
exports.getCatalogues = (req, res) => {
    try {
        tenantOf(req);
        return res.send({ status: true, data: skillRecord.catalogues() });
    } catch (e) { return failWith(res, e); }
};

/* GET /api/v2/agents/skills/:key */
exports.getSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const doc = await skillRecord.findData(companyId, req.params.key);
        if (!doc) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, data: doc });
    } catch (e) { return failWith(res, e); }
};

/* POST /api/v2/agents/skills */
exports.createSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        const actor = await privilegedHuman(req, companyId);
        if (!actor) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.createSkill(companyId, req.body || {}, { createdBy: actor.userId });
        return res.status(201).send({ status: true, data: saved });
    } catch (e) { return failWith(res, e); }
};

/* PUT /api/v2/agents/skills/:key */
exports.updateSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!(await privilegedHuman(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.updateSkill(companyId, req.params.key, req.body || {});
        if (!saved) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, data: saved });
    } catch (e) { return failWith(res, e); }
};

/* DELETE /api/v2/agents/skills/:key — retires; agents and rules still hold the key. */
exports.retireSkill = async (req, res) => {
    try {
        const companyId = tenantOf(req);
        if (!(await privilegedHuman(req, companyId))) return fail(res, 'Owner/admin only.', 403);
        const saved = await skillRecord.retireSkill(companyId, req.params.key);
        if (!saved) return fail(res, 'Skill not found.', 404);
        return res.send({ status: true, data: saved });
    } catch (e) { return failWith(res, e); }
};
