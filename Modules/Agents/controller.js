const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const registry = require('./registry');
const runs = require('./runs');
const { TYPE_LIST: PROVIDER_ERROR_TYPES } = require('../AICore/providerError');
const proposals = require('./proposals');
const proposalText = require('./proposalText');
const approverRights = require('./approverRights');
const standingApprovals = require('./standingApprovals');
const accounts = require('./accounts');
const { isAgent } = require('./actor');
const access = require('./access');
const tools = require('../Automations/engine/tools');
const team = require('./team');
const scope = require('./scope');
const shipping = require('./shipping');
const agentAudit = require('./agentAudit');
const auditChain = require('../Audit/chain');
const { inputsOf } = require('./taskInputs');
const revert = require('./revert');
const undo = require('./undo');
const budget = require('./budget');
const routingPolicy = require('../AICore/routingPolicy');
const modelPin = require('../AICore/modelPin');
const taskClass = require('../AICore/taskClass');
const revisions = require('./revisions');
const agentApproval = require('./agentApproval');
const audience = require('./agentAudience');
const aiRights = require('../../Config/aiRights');
const workspaceGuide = require('./workspaceGuide');
const skillRecord = require('./skillRecord');
const { buildTrace } = require('./runTrace');
const knowledgeMemory = require('../Knowledge/memory/publish');
const { DEFAULT_RATE_LIMIT_PER_DAY } = require('./dailyRunLimit');
const confidence = require('./engine/confidence');
const { hiddenSprintFilter } = require('../Sprints/helpers/sprintVisibility');
const triggers = require('./triggers');
const { agentsRefused } = require('./guard');
const { personDecides, refuse } = require('./personDecides');
const runStart = require('./runStart');
const proposalFiling = require('./proposalFiling');
const { tokenAllowsProject } = require('../../Config/tokenNarrowing');

// Every /api/v2/agents route sits behind the company-header JWT check, so the header is the verified tenant.
const companyOf = (req) => String(req.headers['companyid'] || '');
// Recorded because "who asked for this" is the first question about any run.
const TRIGGERS = ['manual', triggers.TRIGGER.MENTION, 'schedule', 'rule', triggers.TRIGGER.ASSIGN];
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };
const fail = (res, statusText, code, extra) => res.status(code || 400).send({ status: false, statusText, message: statusText, ...(extra || {}) });
const refusalOf = (out) => (out.reason ? { reason: out.reason, undoUntil: out.undoUntil || null } : undefined);
const invalid = (statusText) => Object.assign(new Error(statusText), { status: 400 });
const AUTONOMY_MAX = 3;
const IDEMPOTENCY_KEY_MAX = 200;
const numberOf = (value) => (typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN));

const autonomyOf = (value) => {
    const n = numberOf(value);
    if (!Number.isInteger(n) || n < 0 || n > AUTONOMY_MAX) throw invalid(`autonomy must be between 0 and ${AUTONOMY_MAX}`);
    return n;
};

const runSpendCapOf = (value) => {
    if (value === undefined || value === null) return undefined;
    const n = numberOf(value);
    if (!Number.isFinite(n) || n <= 0) throw invalid('spendCapUsd must be a number greater than 0');
    return n;
};

const idempotencyKeyOf = (req) => {
    const raw = req.headers['idempotency-key'] || (req.body && req.body.idempotencyKey);
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string' || raw.length > IDEMPOTENCY_KEY_MAX) throw invalid(`idempotencyKey must be a string of at most ${IDEMPOTENCY_KEY_MAX} characters`);
    return raw;
};

const { humanActor, callerOf, canManageAgents, agentRightsOf, canEditAgent, canControlRun, canActAsAgent, visibleProjectIdsFor, agentProjectsFor, readScopeOf, canSeeRun, canSeeProposal, decidesProposals, REFUSAL } = access;

/* A run that is someone else's private work is not there for an owner or admin; a member's standing
 * on a run is decided by the checks each route already makes. */
const hiddenFromManager = async (companyId, caller, run) => caller.privileged && run.kind !== 'report' && !(await canSeeRun(companyId, caller, run));

const refuseUnlessManager = (res, caller, agentsMessage) => {
    if (!caller.human) return fail(res, agentsMessage, 403);
    if (!canManageAgents(caller)) return fail(res, REFUSAL.MANAGE, 403);
    return null;
};

/* The wizard sends skills as objects; map(String) used to store "[object Object]"
 * and every run of that agent then asked for a skill by that name. */
const normaliseSkill = (skill) => {
    if (!skill) return null;
    if (typeof skill === 'string') return { key: skill.slice(0, 80), name: skill.slice(0, 80), enabled: true };
    const key = String(skill.key || skill.slug || skill.name || '').slice(0, 80);
    if (!key) return null;
    return {
        key,
        name: String(skill.name || key).slice(0, 80),
        enabled: skill.enabled !== false,
        ...(Array.isArray(skill.actions) ? { actions: skill.actions.map(String).slice(0, 40) } : {}),
    };
};

/* A pin that cannot be billed or cannot be reached is refused here, so the
 * person who set it hears about it instead of a run failing on it later. */
const refusePin = (res, set) => {
    if (set.model === undefined) return null;
    const pin = modelPin.validatePin(set.model);
    if (!pin.ok) return fail(res, pin.message, 400, { code: pin.code });
    set.model = pin.model;
    return null;
};

const refuseSkills = async (res, companyId, set) => {
    const errors = set.skills ? await skillRecord.checkAgentSkills(companyId, set.skills) : [];
    return errors.length ? fail(res, 'The agent names skills that cannot run.', 400, { data: { errors } }) : null;
};

/* What only an owner or admin may give an agent: a skill above the caller's risk cap. A skill already on the agent stays.
 * And a share that names nobody real. */
const refuseAgentFields = async (res, companyId, caller, rights, set, before = {}) => {
    const had = new Set((before.skills || []).map((skill) => String((skill && skill.key) || skill)));
    const added = (set.skills || []).filter((skill) => !had.has(String(skill.key)));
    if (!caller.privileged && added.length) {
        const over = await skillRecord.skillsAboveRisk(companyId, added, rights.skillRisk);
        if (over.length) {
            const names = over.map((skill) => `"${skill.name}"`).join(', ');
            return fail(res, `Your role does not let an agent use ${names}. Ask an Owner or an Admin.`, 400, { code: 'skill_risk', data: { skills: over } });
        }
    }
    if (set.visibility !== undefined || set.sharedWith !== undefined) {
        const problems = await audience.unknownShares(companyId, { ...before, ...set });
        if (problems.length) return fail(res, problems[0], 400);
    }
    return null;
};

const fieldsOf = (body) => ({ ...agentPatchFields(body), ...audience.audienceFields(body) });

/* The fields a save actually changes; a form sends every field back. */
const changedFields = (before, set) => Object.fromEntries(Object.entries(set).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(before[key])));

const AUDIENCE_KEYS = Object.freeze(['visibility', 'sharedWith']);

/* Narrowing who may use an agent takes effect at once; every other change to an approved agent waits. */
const splitEdit = (before, set) => {
    const reach = Object.fromEntries(Object.entries(set).filter(([key]) => AUDIENCE_KEYS.includes(key)));
    const rest = Object.fromEntries(Object.entries(set).filter(([key]) => !AUDIENCE_KEYS.includes(key)));
    if (!Object.keys(reach).length || audience.widens(before, reach)) return { now: {}, later: set };
    return { now: reach, later: rest };
};

const roleNameOf = (key) => {
    const [blueprint, slug] = String(key || '').split('/');
    const role = blueprint && slug ? require('./rolePlaybooks').find(blueprint, slug) : null;
    return role ? role.name : '';
};

const agentPatchFields = (body) => {
    const set = {};
    if (body.name !== undefined) set.name = String(body.name).trim().slice(0, 80);
    if (body.description !== undefined) set.description = String(body.description).slice(0, 1000);
    if (body.skills !== undefined && Array.isArray(body.skills)) set.skills = body.skills.slice(0, 20).map(normaliseSkill).filter(Boolean);
    if (body.allowedActions !== undefined && Array.isArray(body.allowedActions)) set.allowedActions = registry.allowedActionsToStore(body.allowedActions);
    if (body.projectIds !== undefined && Array.isArray(body.projectIds)) set.projectIds = body.projectIds.filter((id) => OBJECT_ID.test(String(id))).map(String);
    if (body.autonomy !== undefined) set.autonomy = autonomyOf(body.autonomy);
    if (body.spendCapUsd !== undefined) set.spendCapUsd = Math.max(0, Number(body.spendCapUsd) || 0);
    if (body.account !== undefined && accounts.MODES.includes(body.account)) set.account = body.account;
    if (body.model !== undefined) set.model = String(body.model).slice(0, modelPin.MAX_LENGTH);
    // Schedules live in agent_schedules (Modules/Agents/schedules); this legacy field is kept only because revisions snapshot it.
    if (body.schedule !== undefined && typeof body.schedule === 'object') set.schedule = body.schedule;
    if (body.rateLimitPerDay !== undefined) set.rateLimitPerDay = Math.max(0, Number(body.rateLimitPerDay) || 0);
    if (body.confidenceFloor !== undefined) set.confidenceFloor = confidence.floorToStore(body.confidenceFloor);
    if (body.role !== undefined) set.role = require('./agentRole').roleOf(body.role);
    return set;
};

/* A built-in agent ships with its limits: it can be renamed, paused or removed, never widened. */
const BUILT_IN_EDITABLE = Object.freeze(['name']);
const BUILT_IN_LOCKED = 'built_in_locked';
const refuseBuiltInEdit = (res, agent, set) => {
    if (!agent || !agent.builtIn) return null;
    const locked = Object.keys(set).filter((k) => !BUILT_IN_EDITABLE.includes(k));
    if (!locked.length) return null;
    return fail(res, 'A built-in agent keeps its own settings. You can rename, pause or remove it.', 400, { code: BUILT_IN_LOCKED, data: { fields: locked } });
};

/* GET /api/v2/agents/registry */
exports.getRegistry = (req, res) => res.send({ status: true, statusText: 'Registry fetched.', data: require('./actions').manifest() });

/* GET /api/v2/agents */
exports.listAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        const [rows, visible, rights, person] = await Promise.all([
            MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { createdAt: 1 } }] }, 'find'),
            visibleProjectIdsFor(companyId, caller),
            agentRightsOf(companyId, caller),
            audience.personOf(companyId, caller.actor.userId),
        ]);
        const seen = (rows || []).filter((agent) => audience.maySee(agent, person, { seesAll: rights.seesAll }));
        const agents = await skillRecord.enrichAgentSkills(companyId, seen);
        const people = await peopleOf(companyId, agents);
        return res.send({ status: true, statusText: 'Agents fetched.', data: agents.map((agent) => ({ ...agent, ...agentProjectsFor(agent, visible), roleName: roleNameOf(agent.role), ...people(agent) })) });
    } catch (e) { logger.error(`listAgents: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runnable?taskId= — the agents the caller may start on that task, for the
 * assignee picker and the comment mention list. Empty for anyone who may not start one there. */
exports.runnableAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const { actor, human } = await humanActor(req);
        const task = human ? await triggers.workTask(companyId, (req.query || {}).taskId) : null;
        const agents = task ? await triggers.runnableAgents(companyId, actor.userId, task) : [];
        return res.send({ status: true, statusText: 'Agents fetched.', data: agents.map(triggers.listed) });
    } catch (e) { logger.error(`runnableAgents: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents — an owner or admin's agent works at once; anyone else's waits for one of them to approve it */
exports.createAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot create agents.', 403);
        const rights = await agentRightsOf(companyId, caller);
        if (!rights.build) return fail(res, REFUSAL.BUILD, 403);
        const { actor } = caller;
        const set = fieldsOf(req.body || {});
        if (!set.name) return fail(res, 'name is required.');
        if (refusePin(res, set)) return undefined;
        if (await refuseSkills(res, companyId, set)) return undefined;
        if (await refuseAgentFields(res, companyId, caller, rights, set)) return undefined;
        const asks = !caller.privileged;
        const saved = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: {
                autonomy: 1, spendCapUsd: 30, rateLimitPerDay: DEFAULT_RATE_LIMIT_PER_DAY, paused: false, account: 'workspace', deletedStatusKey: 0, projectIds: [],
                visibility: audience.VISIBILITY.PRIVATE, ...set, ownerId: actor.userId, ...(asks ? { approval: agentApproval.requested(actor) } : {}),
            },
        }, 'save');
        await revisions.recordCreate(companyId, saved, { actor });
        if (asks) {
            await agentApproval.audit(companyId, actor, { entityType: 'agent', entityId: saved._id, name: saved.name, ip: req.ip || '' });
            await agentApproval.notifyRequested(companyId, agentApproval.KIND.AGENT, saved, { actor });
        }
        return res.send({ status: true, statusText: asks ? 'Agent saved. It waits for an Owner or an Admin to approve it.' : 'Agent created.', data: saved });
    } catch (e) { logger.error(`createAgent: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/workspace-guide — adds the built-in Workspace Guide once; a removed one is not made again */
exports.addWorkspaceGuide = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot create agents.')) return undefined;
        const out = await workspaceGuide.ensureWorkspaceAgent(companyId, { ownerId: caller.actor.userId, actor: caller.actor });
        const statusText = out.created ? 'Workspace Guide added.' : (out.state === workspaceGuide.STATE.REMOVED ? 'The Workspace Guide was removed and is not added again.' : 'The Workspace Guide is already here.');
        return res.send({ status: true, statusText, data: { state: out.state, created: out.created, agent: out.state === workspaceGuide.STATE.PRESENT ? out.agent : null } });
    } catch (e) { logger.error(`addWorkspaceGuide: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* PUT /api/v2/agents/:id — autonomy, spend cap, skills, scope */
exports.updateAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot edit agents.', 403);
        const rights = await agentRightsOf(companyId, caller);
        if (!rights.build) return fail(res, REFUSAL.BUILD, 403);
        const { actor } = caller;
        const fields = fieldsOf(req.body || {});
        if (!Object.keys(fields).length) return fail(res, 'Nothing to update.');
        const before = await runs.getAgent(companyId, req.params.id);
        if (!before) return fail(res, 'Agent not found.', 404);
        if (!canEditAgent(caller, rights, before)) return fail(res, REFUSAL.OWN_AGENT, 403);
        if (refuseBuiltInEdit(res, before, fields)) return undefined;
        if (refusePin(res, fields)) return undefined;
        if (await refuseSkills(res, companyId, fields)) return undefined;
        if (await refuseAgentFields(res, companyId, caller, rights, fields, before)) return undefined;
        const ip = req.ip || '';
        const saveLive = async (set, extra = {}) => {
            const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(req.params.id) }, { $set: { ...set, ...extra } }, { returnDocument: 'after' }] }, 'findOneAndUpdate');
            if (!updated) return { updated: null };
            const { revision } = await revisions.recordSave(companyId, before, updated, { actor, ip });
            return { updated, revision };
        };
        if (caller.privileged) {
            const { updated, revision } = await saveLive(fields);
            if (!updated) return fail(res, 'Agent not found.', 404);
            return res.send({ status: true, statusText: 'Agent updated.', data: updated, revision: revision ? Number(revision.n) : null });
        }
        if (!agentApproval.isApproved(before)) {
            const resent = before.approval.state === agentApproval.STATE.DECLINED;
            const { updated, revision } = await saveLive(fields, resent ? { approval: agentApproval.requested(actor) } : {});
            if (!updated) return fail(res, 'Agent not found.', 404);
            if (resent) {
                await agentApproval.audit(companyId, actor, { entityType: 'agent', entityId: updated._id, name: updated.name, ip });
                await agentApproval.notifyRequested(companyId, agentApproval.KIND.AGENT, updated, { actor });
            }
            const statusText = resent ? 'Agent sent again. It waits for an Owner or an Admin to approve it.' : 'Agent updated. It still waits for an Owner or an Admin to approve it.';
            return res.send({ status: true, statusText, data: updated, revision: revision ? Number(revision.n) : null });
        }
        const { now, later } = splitEdit(before, changedFields(before, fields));
        let updated = before;
        if (Object.keys(now).length) {
            ({ updated } = await saveLive(now));
            if (!updated) return fail(res, 'Agent not found.', 404);
        }
        const waiting = Object.keys(later).length ? await revisions.createDraft(companyId, updated, { fields: later, actor, requestedApproval: true }) : null;
        if (waiting) {
            await agentApproval.audit(companyId, actor, { entityType: 'agent', entityId: updated._id, name: updated.name, n: waiting.n, ip });
            await agentApproval.notifyRequested(companyId, agentApproval.KIND.EDIT, updated, { actor, n: waiting.n });
        }
        const statusText = waiting ? 'Your change waits for an Owner or an Admin to approve it. The agent keeps working as it was.' : 'Agent updated.';
        return res.send({ status: true, statusText, data: updated, pendingRevision: waiting ? Number(waiting.n) : null });
    } catch (e) { logger.error(`updateAgent: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* The kill switch and delete: an owner or admin for any agent, a person whose role builds agents for their own. */
const ownAgentOrRefuse = async (req, res, companyId, agentsMessage) => {
    const caller = await callerOf(req, companyId);
    if (!caller.human) { fail(res, agentsMessage, 403); return null; }
    const rights = await agentRightsOf(companyId, caller);
    if (!rights.build) { fail(res, REFUSAL.BUILD, 403); return null; }
    const agent = await runs.getAgent(companyId, req.params.id);
    if (!agent) { fail(res, 'Agent not found.', 404); return null; }
    if (!canEditAgent(caller, rights, agent)) { fail(res, REFUSAL.OWN_AGENT, 403); return null; }
    return { caller, agent };
};

/* POST /api/v2/agents/:id/pause  |  /resume — the kill switch */
exports.setPaused = (paused) => async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        if (!(await ownAgentOrRefuse(req, res, companyId, 'Agents cannot pause or resume agents.'))) return undefined;
        const set = paused ? { paused: true, pausedReason: String((req.body && req.body.reason) || 'manual').slice(0, 120), pausedAt: new Date() } : { paused: false, pausedReason: null, pausedAt: null };
        const updated = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: oid(req.params.id) }, { $set: set }, { returnDocument: 'after' }] }, 'findOneAndUpdate');
        if (!updated) return fail(res, 'Agent not found.', 404);
        if (paused) {
            const open = await runs.list(companyId, { status: 'open', agentId: req.params.id });
            for (const r of (open || []).filter((x) => [runs.STATUS.RUNNING, runs.STATUS.QUEUED].includes(x.status))) {
                // eslint-disable-next-line no-await-in-loop
                await runs.stop(companyId, r._id, req.uid);
            }
        }
        return res.send({ status: true, statusText: paused ? 'Agent paused.' : 'Agent resumed.', data: updated });
    } catch (e) { logger.error(`setPaused: ${e.message}`); return fail(res, e.message, 500); }
};

const revisionRow = (r, names = {}) => {
    const o = typeof r.toObject === 'function' ? r.toObject() : { ...r };
    return {
        _id: String(o._id), agentId: o.agentId, n: o.n, state: o.state, snapshot: o.snapshot, serves: o.serves || [], skillRefs: o.skillRefs || [],
        source: o.source || null, rollbackOf: o.rollbackOf || null, note: o.note || null,
        createdBy: o.createdBy || null, createdByName: names[String(o.createdBy)] || null, createdAt: o.createdAt,
        promotedBy: o.promotedBy || null, promotedByName: names[String(o.promotedBy)] || null, promotedAt: o.promotedAt || null, supersededAt: o.supersededAt || null,
        requestedApproval: Boolean(o.requestedApproval),
        declinedBy: o.declinedBy || null, declinedByName: names[String(o.declinedBy)] || null, declinedAt: o.declinedAt || null, declineReason: o.declineReason || null,
    };
};

const namesOf = async (personIds) => {
    const ids = [...new Set(personIds.filter(Boolean).map(String))].map(oid).filter(Boolean);
    if (!ids.length) return {};
    const { dbCollections } = require('../../Config/collections');
    const users = await MongoDbCrudOpration(dbCollections.GLOBAL, { type: SCHEMA_TYPE.USERS, data: [{ _id: { $in: ids } }, { Employee_Name: 1, Employee_FName: 1, Employee_LName: 1 }] }, 'find').catch(() => []);
    return Object.fromEntries((users || []).map((u) => [String(u._id), u.Employee_Name || [u.Employee_FName, u.Employee_LName].filter(Boolean).join(' ') || null]));
};

const userNames = (rows) => namesOf(rows.flatMap((r) => [r.createdBy, r.promotedBy, r.declinedBy]));

/* Who made each agent, who answered its approval, and the edit of it that waits for an owner or admin. */
const peopleOf = async (companyId, agents) => {
    const edits = await revisions.requestedEditsOf(companyId, agents.map((agent) => agent._id));
    const approvalOf = (agent) => agent.approval || {};
    const names = await namesOf(agents.flatMap((agent) => [agent.ownerId, approvalOf(agent).decidedBy, (edits.get(String(agent._id)) || {}).createdBy]));
    return (agent) => {
        const approval = approvalOf(agent);
        const edit = edits.get(String(agent._id));
        return {
            ownerName: names[String(agent.ownerId)] || null,
            ...(approval.decidedBy ? { decidedByName: names[String(approval.decidedBy)] || null } : {}),
            pendingEdit: edit ? { n: Number(edit.n), createdBy: edit.createdBy || null, createdByName: names[String(edit.createdBy)] || null, createdAt: edit.createdAt || null } : null,
        };
    };
};

/* Revisions are owner/admin ground, like the agent settings page. */
const revisionAccess = async (req, res) => {
    const companyId = companyOf(req);
    if (!companyId || !OBJECT_ID.test(req.params.id)) { fail(res, 'companyId and a valid agent id are required.'); return null; }
    const caller = await callerOf(req, companyId);
    if (!canManageAgents(caller)) { fail(res, 'Owner/admin only.', 403); return null; }
    const { actor } = caller;
    const agent = await runs.getAgent(companyId, req.params.id);
    if (!agent) { fail(res, 'Agent not found.', 404); return null; }
    return { companyId, actor, agent };
};

const revisionN = (raw) => { const n = Number(raw); return Number.isInteger(n) && n > 0 ? n : null; };

/* GET /api/v2/agents/:id/revisions */
exports.listRevisions = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        await revisions.liveFor(ctx.companyId, ctx.agent);
        const rows = await revisions.listFor(ctx.companyId, ctx.agent._id);
        const names = await userNames(rows || []);
        return res.send({ status: true, statusText: 'Revisions fetched.', data: (rows || []).map((r) => revisionRow(r, names)) });
    } catch (e) { logger.error(`listRevisions: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/:id/revisions/:n */
exports.getRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        const row = n ? await revisions.getRevision(ctx.companyId, ctx.agent._id, n) : null;
        if (!row) return fail(res, 'Revision not found.', 404);
        return res.send({ status: true, statusText: 'Revision fetched.', data: revisionRow(row) });
    } catch (e) { logger.error(`getRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/revisions  body: { state?: draft|candidate, note?, ...agent fields }
 * The only way to a draft or candidate: the plain save always goes live. */
exports.createRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const body = req.body || {};
        const fields = agentPatchFields(body);
        if (refuseBuiltInEdit(res, ctx.agent, fields)) return undefined;
        if (await refuseSkills(res, ctx.companyId, fields)) return undefined;
        const row = await revisions.createDraft(ctx.companyId, ctx.agent, { fields, state: body.state, note: body.note, actor: ctx.actor });
        return res.send({ status: true, statusText: `Revision ${row.n} saved as ${row.state}.`, data: revisionRow(row) });
    } catch (e) { logger.error(`createRevision: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* An owner or admin's answer to an edit someone asked for: recorded, and told to the person who asked. */
const answerEdit = async (ctx, revision, { approved, reason, ip }) => {
    const { companyId, actor, agent } = ctx;
    await agentApproval.audit(companyId, actor, { decision: approved ? 'approved' : 'declined', entityType: 'agent', entityId: agent._id, name: agent.name, n: revision.n, reason, ip });
    await agentApproval.notifyDecided(companyId, agentApproval.KIND.EDIT, agent, { actor, to: revision.createdBy, approved, reason, n: revision.n });
};

/* POST /api/v2/agents/:id/revisions/:n/promote */
exports.promoteRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        if (!n) return fail(res, 'Revision not found.', 404);
        const out = await revisions.promote(ctx.companyId, ctx.agent, n, { actor: ctx.actor, ip: req.ip || '' });
        if (out.error) return fail(res, out.error, out.status || 400, out.errors ? { data: { errors: out.errors } } : undefined);
        if (!out.unchanged && out.revision.requestedApproval) await answerEdit(ctx, out.revision, { approved: true, ip: req.ip || '' });
        return res.send({ status: true, statusText: out.unchanged ? `Revision ${n} is already live.` : `Revision ${n} is live.`, data: { revision: revisionRow(out.revision), from: out.from, agent: out.agent || null } });
    } catch (e) { logger.error(`promoteRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/revisions/:n/decline  body: { reason } — the live revision stays */
exports.declineRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        if (!n) return fail(res, 'Revision not found.', 404);
        const reason = agentApproval.reasonOf((req.body || {}).reason);
        if (!reason) return fail(res, agentApproval.REFUSAL.REASON, 400);
        const out = await revisions.decline(ctx.companyId, ctx.agent, n, { actor: ctx.actor, reason });
        if (out.error) return fail(res, out.error, out.status || 400);
        if (out.revision.requestedApproval) await answerEdit(ctx, out.revision, { approved: false, reason, ip: req.ip || '' });
        return res.send({ status: true, statusText: `Revision ${n} declined. The live version keeps running.`, data: { revision: revisionRow(out.revision) } });
    } catch (e) { logger.error(`declineRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/:id/approve  |  /decline  body: { reason } — an owner or admin answers a request to put an agent to work */
exports.decideAgent = (approve) => async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot approve agents.')) return undefined;
        const reason = approve ? '' : agentApproval.reasonOf((req.body || {}).reason);
        if (!approve && !reason) return fail(res, agentApproval.REFUSAL.REASON, 400);
        if (!(await runs.getAgent(companyId, req.params.id))) return fail(res, 'Agent not found.', 404);
        const updated = await agentApproval.decide(companyId, req.params.id, { approve, actor: caller.actor, reason });
        if (!updated) return fail(res, agentApproval.REFUSAL.DECIDED, 409);
        await agentApproval.audit(companyId, caller.actor, { decision: approve ? 'approved' : 'declined', entityType: 'agent', entityId: updated._id, name: updated.name, reason, ip: req.ip || '' });
        await agentApproval.notifyDecided(companyId, agentApproval.KIND.AGENT, updated, { actor: caller.actor, to: updated.approval.requestedBy, approved: approve, reason });
        runs.emitAgent(companyId, { agentId: String(updated._id), agent: updated });
        return res.send({ status: true, statusText: approve ? 'Agent approved. It can start work now.' : 'Agent declined.', data: updated });
    } catch (e) { logger.error(`decideAgent: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/:id/revisions/:n/rollback — copies :n forward and makes the copy live */
exports.rollbackRevision = async (req, res) => {
    try {
        const ctx = await revisionAccess(req, res);
        if (!ctx) return undefined;
        const n = revisionN(req.params.n);
        if (!n) return fail(res, 'Revision not found.', 404);
        const out = await revisions.rollback(ctx.companyId, ctx.agent, n, { actor: ctx.actor, ip: req.ip || '', note: (req.body || {}).note });
        if (out.error) return fail(res, out.error, out.status || 400, out.errors ? { data: { errors: out.errors } } : undefined);
        return res.send({ status: true, statusText: `Rolled back to revision ${n} as revision ${out.revision.n}.`, data: { revision: revisionRow(out.revision), from: out.from, rollbackOf: out.rollbackOf, agent: out.agent || null } });
    } catch (e) { logger.error(`rollbackRevision: ${e.message}`); return fail(res, e.message, 500); }
};

/* DELETE /api/v2/agents/:id — owner/admin. A soft delete:
 * runs, proposals and audit rows keep naming the agent. */
exports.deleteAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid agent id are required.');
        const owned = await ownAgentOrRefuse(req, res, companyId, 'Agents cannot delete agents.');
        if (!owned) return undefined;
        const { caller: { actor }, agent } = owned;
        const active = await runs.list(companyId, { status: 'open', agentId: req.params.id });
        const running = (active || []).filter((r) => [runs.STATUS.RUNNING, runs.STATUS.QUEUED].includes(r.status));
        if (running.length) return fail(res, `This agent has ${running.length} run(s) in progress — stop them first.`, 409);
        await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id: agent._id }, { $set: { deletedStatusKey: 1, deletedAt: new Date(), deletedBy: String(actor.userId), paused: true, pausedReason: 'deleted' } }] }, 'updateOne');
        await agentAudit.recordAgentDeleted(companyId, actor, { agentId: String(agent._id), agentName: agent.name, ip: req.ip || '' });
        runs.emitAgent(companyId, { agentId: String(agent._id), deleted: true });
        knowledgeMemory.agentDeleted(companyId, String(agent._id));
        return res.send({ status: true, statusText: 'Agent deleted. Its runs and audit history stay.', data: { agentId: String(agent._id) } });
    } catch (e) { logger.error(`deleteAgent: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/pause-all */
exports.pauseAll = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        if (refuseUnlessManager(res, await callerOf(req, companyId), 'Agents cannot pause agents.')) return undefined;
        const out = await runs.pauseAll(companyId, `pause all by ${req.uid}`, req.uid);
        return res.send({ status: true, statusText: 'All agents paused.', data: out });
    } catch (e) { logger.error(`pauseAll: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/spend?month= */
exports.spend = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const month = (req.query && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : runs.monthKey());
        const agents = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ deletedStatusKey: { $ne: 1 } }, 'name spendCapUsd spendMonth paused pausedReason account'] }, 'find');
        const from = new Date(`${month}-01T00:00:00.000Z`);
        const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
        const byAgent = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [[{ $match: { startedAt: { $gte: from, $lt: to } } },
                    { $group: { _id: { agentId: '$agentId', via: '$viaAccount' }, usd: { $sum: '$spend.usd' }, tokens: { $sum: '$spend.tokens' }, runs: { $sum: 1 } } }]],
        }, 'aggregate').catch(() => []);
        const rows = (agents || []).map((a) => {
            const mine = (byAgent || []).filter((g) => g._id.agentId === String(a._id));
            return { agentId: String(a._id), name: a.name, account: a.account, cap: a.spendCapUsd, paused: a.paused, pausedReason: a.pausedReason,
                     usd: Math.round(mine.reduce((s, g) => s + (g.usd || 0), 0) * 100) / 100, tokens: mine.reduce((s, g) => s + (g.tokens || 0), 0), runs: mine.reduce((s, g) => s + (g.runs || 0), 0) };
        });
        const cli = (byAgent || []).filter((g) => g._id.via === 'personal');
        return res.send({ status: true, statusText: 'Spend fetched.', data: { month, agents: rows, totalUsd: Math.round(rows.reduce((s, r) => s + r.usd, 0) * 100) / 100,
                                                cliAgents: { runs: cli.reduce((s, g) => s + g.runs, 0), usdToWorkspace: 0 } } });
    } catch (e) { logger.error(`spend: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs?status=open|running|…&projectId=&agentId=&taskId=&errorType=&limit= */
exports.listRuns = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        if (q.errorType && !PROVIDER_ERROR_TYPES.includes(String(q.errorType))) return fail(res, `errorType must be one of: ${PROVIDER_ERROR_TYPES.join(', ')}.`, 400);
        const readScope = await readScopeOf(companyId, await callerOf(req, companyId));
        const [rows, summary] = await Promise.all([runs.list(companyId, { ...q, ...readScope }), runs.summary(companyId, { projectId: q.projectId, ...readScope })]);
        return res.send({ status: true, statusText: 'Runs fetched.', data: rows || [], summary });
    } catch (e) { logger.error(`listRuns: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs/summary?projectId= */
exports.runSummary = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        const readScope = await readScopeOf(companyId, await callerOf(req, companyId));
        const [live, counts] = await Promise.all([runs.summary(companyId, { projectId: q.projectId, ...readScope }), runs.countsByStatus(companyId, { projectId: q.projectId, agentId: q.agentId, ...readScope })]);
        return res.send({ status: true, statusText: 'Run summary fetched.', data: { ...live, counts } });
    } catch (e) { logger.error(`runSummary: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/runs/:id */
exports.getRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(req.params.id) }] }, 'findOne');
        if (!run) return fail(res, 'Run not found.', 404);
        const caller = await callerOf(req, companyId);
        const visible = await visibleProjectIdsFor(companyId, caller);
        // A report holds what its owner could read, so only they and owners/admins open it.
        if (run.kind === 'report') {
            if (!caller.privileged && String(run.startedBy || '') !== String(caller.actor.userId || '')) return fail(res, 'Run not found.', 404);
        } else if (!(await canSeeRun(companyId, caller, run))) {
            return fail(res, 'Run not found.', 404);
        }
        const auditRows = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AUDIT_LOGS, data: [{ 'meta.runId': String(run._id) }, {}, { sort: { createdAt: 1 }, limit: 200 }] }, 'find')
            .then((rows) => auditChain.foldRows(companyId, rows)).catch(() => []);
        const plain = typeof run.toObject === 'function' ? run.toObject() : { ...run };
        const pinned = await revisions.forRun(companyId, plain);
        plain.agentRevision = Number(pinned.n);
        plain.skillRevision = plain.skillRevision || null;
        plain.skillSource = plain.skillSource || null;
        plain.traceId = plain.traceId || null;
        plain.steps = Array.isArray(plain.steps) ? plain.steps : [];
        const { actor } = caller;
        const ctx = await undo.undoContext(companyId, actor, { run: plain, ...(visible ? { visibleProjectIds: visible } : {}) });
        const check = await revert.revertCheck(companyId, plain, { actor, isPrivileged: caller.privileged, ...ctx });
        if (plain.finishedAt && !plain.revertedAt) plain.windowEndsAt = new Date(check.undoUntil);
        Object.assign(plain, { undoUntil: check.undoUntil, undoable: Boolean(check.ok), undoReason: check.reason || '' });
        const audit = [];
        for (const row of auditRows || []) {
            const o = typeof row.toObject === 'function' ? row.toObject() : { ...row };
            // eslint-disable-next-line no-await-in-loop
            const state = o.action === agentAudit.ACTION_DONE ? await undo.undoStateOf(companyId, o, actor, ctx) : null;
            audit.push(state ? { ...o, undoUntil: state.undoUntil, undoable: state.undoable, undoReason: state.reason } : o);
        }
        const revision = { n: Number(pinned.n), state: pinned.state, synthetic: Boolean(pinned.synthetic), missing: Boolean(pinned.missing), createdAt: pinned.createdAt || null, createdBy: pinned.createdBy || null, serves: pinned.serves || [], skillRefs: pinned.skillRefs || [] };
        const [firstReplay] = await replaysOf(companyId, run._id, { _id: 1 }, 1).catch(() => []);
        if (firstReplay) plain.replayId = String(firstReplay._id);
        return res.send({ status: true, statusText: 'Run fetched.', data: { run: plain, audit, revision, trace: buildTrace(plain, audit) } });
    } catch (e) { logger.error(`getRun: ${e.message}`); return fail(res, e.message, 500); }
};

const REPLAY_LIMIT = 200;
const replaysOf = async (companyId, runId, fields, limit) => (await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AI_REPLAYS, data: [{ runId: String(runId) }, fields, { sort: { createdAt: 1 }, limit }] }, 'find')) || [];

/* GET /api/v2/agents/runs/:id/replay — owner/admin only: the records hold the prompts and raw responses */
exports.getRunReplay = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 'Owner/admin only.', 403);
        if (!OBJECT_ID.test(req.params.id)) return fail(res, 'A valid run id is required.', 400);
        const run = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_RUNS, data: [{ _id: oid(req.params.id) }] }, 'findOne');
        if (!run || await hiddenFromManager(companyId, caller, run)) return fail(res, 'Run not found.', 404);
        return res.send({ status: true, statusText: 'Replay fetched.', data: await replaysOf(companyId, run._id, {}, REPLAY_LIMIT) });
    } catch (e) { logger.error(`getRunReplay: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/runs  body: { agentId, taskId, skill?, trigger?, note?, spendCapUsd?, notifyMe?, idempotencyKey? }
 * An Idempotency-Key header (or body field) makes a retry return the run the
 * first request started; without one, a second start while a run for the same
 * agent and task is open returns that run. Either way data.deduplicated says so. */
exports.startRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { actor, human } = await humanActor(req);
        const { agentId, taskId, skill, trigger, note, notifyMe } = req.body || {};
        if (!companyId || !OBJECT_ID.test(String(agentId || ''))) return fail(res, 'companyId and a valid agentId are required.');
        const spendCapUsd = runSpendCapOf((req.body || {}).spendCapUsd);
        const idempotencyKey = idempotencyKeyOf(req);
        const agent = await runs.getAgent(companyId, agentId);
        const check = await runs.canStart(agent, { trigger: trigger || 'manual', viaAccount: isAgent(actor) ? actor.viaAccount : undefined, companyId });
        if (!check.ok) return fail(res, check.reason, 409);
        if (!human && !isAgent(actor)) return fail(res, 'Unauthorized.', 401);
        let task = null;
        if (taskId) {
            task = await tools.getTask(companyId, taskId).catch(() => null);
            if (!task) return fail(res, 'Task not found.', 404);
            if (!triggers.isWorkTask(task) || !tokenAllowsProject(req.apiToken, task.ProjectID)) return fail(res, 'Task not found.', 404);
            if (!(await triggers.mayRunOn(companyId, actor.userId, task))) return fail(res, 'Task not found.', 404);
            if (agent.projectIds && agent.projectIds.length && !agent.projectIds.includes(String(task.ProjectID))) return fail(res, 'This agent is not scoped to that project.', 403);
            if (!audience.mayUse(agent, await audience.personOf(companyId, actor.userId))) return fail(res, audience.REFUSAL.USE, 403);
        }
        if (!(await aiRights.mayUse(companyId, actor.userId, aiRights.AI_RIGHT.AGENT_USE))) return fail(res, aiRights.REFUSAL[aiRights.AI_RIGHT.AGENT_USE], 403);
        if (!task) {
            // Every executable skill works on a task. Without one the run used to be created,
            // never executed and never finished — "running" forever in every counter.
            return fail(res, 'This agent needs a task to run on. Assign the agent to a task, @mention it in a task comment, or run it on a task from the agent\'s page.');
        }
        const paused = await runs.pausedIn(companyId, task.ProjectID);
        if (paused) return fail(res, paused, 409);
        const held = human ? '' : await runStart.heldBy(companyId, actor, task);
        if (held) return refuse(req, res, actor, { action: runStart.START, reason: held, params: { taskId: String(task._id) }, entityId: String(task._id) });
        const { run, deduplicated } = await runs.start(companyId, { agent, taskId, projectId: task && task.ProjectID, skill: runs.skillSlugOf(agent, skill), trigger: TRIGGERS.includes(trigger) ? trigger : 'manual', startedBy: actor.userId, viaAccount: isAgent(actor) ? actor.viaAccount : agent.account, note, spendCapUsd, notifyMe: Boolean(notifyMe), idempotencyKey });
        const plain = typeof run.toObject === 'function' ? run.toObject() : { ...run };
        if (deduplicated) return res.send({ status: true, statusText: 'Run already started.', data: { ...plain, deduplicated: true } });
        triggers.dispatch(companyId, run, agent, task, { userId: actor.userId, note });
        return res.send({ status: true, statusText: 'Run started.', data: { ...plain, deduplicated: false } });
    } catch (e) { logger.error(`startRun: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* POST /api/v2/agents/runs/:id/stop — owner/admin or the run's starter. Permission is
 * checked before the run's state, so a finished run tells a stranger nothing. */
exports.stopRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot stop runs.', 403);
        const run = await runs.get(companyId, req.params.id);
        if (!run || await hiddenFromManager(companyId, caller, run)) return fail(res, 'Run not found.', 404);
        if (!canControlRun(caller, run)) return fail(res, REFUSAL.CONTROL_RUN, 403);
        const out = await runs.stop(companyId, req.params.id, req.uid);
        if (out.error) return fail(res, out.error, out.status || 409);
        return res.send({ status: true, statusText: 'Run stopped.', data: out.run });
    } catch (e) { logger.error(`stopRun: ${e.message}`); return fail(res, e.message, 500); }
};

/* POST /api/v2/agents/runs/:id/revert — owner/admin or the run's starter */
exports.revertRun = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid run id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, 'Agents cannot revert runs.', 403);
        const run = await runs.get(companyId, req.params.id);
        if (!run || await hiddenFromManager(companyId, caller, run)) return fail(res, 'Run not found.', 404);
        const out = await revert.revertRun(companyId, req.params.id, { actor: caller.actor, isPrivileged: caller.privileged, ip: req.ip || '' });
        if (out.error) return fail(res, out.error, out.status || 400, refusalOf(out));
        return res.send({ status: true, statusText: 'Run reverted.', data: out });
    } catch (e) { logger.error(`revertRun: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET / PUT /api/v2/agents/settings — undo window, monthly budget, provider (read-only) */
exports.getSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Settings fetched.', data: { ...(await budget.settings(companyId)), provider: budget.provider() } });
    } catch (e) { logger.error(`getSettings: ${e.message}`); return fail(res, e.message, 500); }
};

exports.putSettings = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 'Owner/admin only.', 403);
        const before = await budget.settings(companyId);
        const out = await budget.updateSettings(companyId, req.body || {});
        if (out.error) return fail(res, out.error, out.status || 400);
        const limitsOf = (s) => ({ monthlyBudgetUsd: s.monthlyBudgetUsd, dailyBudgetUsd: s.dailyBudgetUsd });
        const [from, to] = [limitsOf(before), limitsOf(out.settings)];
        if (from.monthlyBudgetUsd !== to.monthlyBudgetUsd || from.dailyBudgetUsd !== to.dailyBudgetUsd) {
            await agentAudit.recordBudgetChange(companyId, caller.actor, { from, to, ip: req.ip || '' });
        }
        if (JSON.stringify(before) !== JSON.stringify(out.settings)) {
            socketEmitter.emit('update', { type: 'update', module: 'agent', companyId, data: { kind: BUDGET_CHANGE }, updatedFields: { kind: BUDGET_CHANGE }, actor: { kind: 'human' }, depth: 1 });
        }
        return res.send({ status: true, statusText: 'Settings updated.', data: { ...out.settings, provider: budget.provider() } });
    } catch (e) { logger.error(`putSettings: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/budget — this month's company spend against the budget */
exports.getBudget = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Budget fetched.', data: await budget.status(companyId) });
    } catch (e) { logger.error(`getBudget: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/models — the priced allowlist a pin may name */
exports.getModels = (req, res) => {
    const configuredOnly = String((req.query && req.query.configured) || '') === 'true';
    const models = modelPin.allowlist({ configuredOnly });
    return res.send({ status: true, statusText: 'Models fetched.', data: { models, taskClasses: taskClass.list() } });
};

/* GET /api/v2/agents/routing-policy — task class to model preferences for this workspace */
exports.getRoutingPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Routing policy fetched.', data: await routingPolicy.get(companyId) });
    } catch (e) { logger.error(`getRoutingPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

/* PUT /api/v2/agents/routing-policy */
exports.putRoutingPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const caller = await callerOf(req, companyId);
        if (refuseUnlessManager(res, caller, 'Agents cannot change the routing policy.')) return undefined;
        const out = await routingPolicy.update(companyId, req.body || {}, caller.actor.userId);
        if (out.error) return fail(res, out.error, out.status || 400, out.code ? { code: out.code } : undefined);
        return res.send({ status: true, statusText: 'Routing policy updated.', data: out.policy });
    } catch (e) { logger.error(`putRoutingPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

/* What the AI Inbox page draws a proposal from, beside the proposal itself: for a person, the one card of a batch
 * and the card of each change that waits (the same the Inbox queue shows, naming only what that person may see, and
 * marking the parts of a plan that person may not approve), and which changes came with no words of their own. */
const asCards = async (companyId, caller, listed, locks) => {
    const intentPreview = require('./intentPreview');
    const cards = (build, rows) => (caller.human
        ? build(companyId, caller.actor.userId, rows, { locks }).catch((e) => { logger.error(`proposal cards: ${e.message}`); return new Map(); })
        : new Map());
    const [batches, previews] = await Promise.all([cards(intentPreview.forBatches, listed), cards(intentPreview.forProposals, listed.filter((p) => p.status === proposals.STATUS.PENDING))]);
    const { markOf } = require('./changeLabels');
    return listed.map((p) => ({
        ...p,
        changes: (Array.isArray(p.changes) ? p.changes : []).map((change, at) => {
            const preview = (previews.get(String(p._id)) || [])[at];
            return { ...change, ...markOf(change), ...(preview ? { preview } : {}) };
        }),
        ...(batches.has(String(p._id)) ? { batch: batches.get(String(p._id)) } : {}),
    }));
};

/* GET /api/v2/agents/proposals?status=pending&bucket=primary|later&agentId= */
exports.listProposals = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        const q = req.query || {};
        const caller = await callerOf(req, companyId);
        const readScope = await readScopeOf(companyId, caller);
        // An agent reads what waits; whether a row is a person's to decide is said to a person.
        // The rights behind a waiting plan are read once for this request, for its standing and for its card.
        const locks = new Map();
        const out = await proposals.list(companyId, { status: q.status === 'all' ? undefined : (q.status || 'pending'), bucket: q.bucket, agentId: q.agentId, limit: q.limit, ...readScope, viewer: caller.human ? caller : null, locks });
        return res.send({ status: true, statusText: 'Proposals fetched.', data: await asCards(companyId, caller, out.proposals, locks), counts: out.counts });
    } catch (e) { logger.error(`listProposals: ${e.message}`); return fail(res, e.message, 500); }
};

const NAMED_NOT_FOUND = 'A task, project, list, doc or run this proposal names was not found.';

/* POST /api/v2/agents/proposals — only an agent files one, only in its own name, only about what its person can open, only in the projects it works in, and a plan only as a connected agent could file it */
exports.createProposal = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const caller = await callerOf(req, companyId);
        const { actor } = caller;
        const b = req.body || {};
        const agentId = b.agentId || actor.agentId;
        if (!isAgent(actor)) return fail(res, REFUSAL.ACT_AS_AGENT, 403);
        if (!companyId || !OBJECT_ID.test(String(agentId || ''))) return fail(res, 'companyId and a valid agentId are required.');
        if (!canActAsAgent(caller, agentId)) return fail(res, REFUSAL.ACT_AS_AGENT, 403);
        const agent = await runs.getAgent(companyId, agentId);
        if (!agent) return fail(res, 'Agent not found.', 404);
        if (!proposalText.words(b.what)) return fail(res, 'what is required: say in one sentence what the proposal does.');
        if (actor.tokenId && require('./connectors/slackPost').hasSlackChange(b.changes)) return fail(res, 'A Slack message is proposed only by a workspace agent\'s own run, not through a token.', 403);
        const connectorWrites = require('../Connectors/writes');
        if (connectorWrites.hasWrite(b.changes)) return fail(res, connectorWrites.REFUSAL.TOKEN_FILED, 403);
        const runId = b.runId || actor.runId;
        const open = await proposalFiling.namesOnlyOpenThings(companyId, actor.userId, b) && (!runId || await proposalFiling.ownRun(companyId, actor.userId, agentId, runId));
        if (!open) return fail(res, NAMED_NOT_FOUND, 404);
        if (!(await proposalFiling.insideAgentScope(companyId, agent, b))) return fail(res, 'This agent is not scoped to that project.', 403);
        const refused = await proposalFiling.refusedChange(companyId, actor, b);
        if (refused) return refuse(req, res, actor, { ...refused, entityId: refused.params.taskId });
        const stopped = await proposalFiling.stoppedPlan(companyId, actor, agent, b);
        if (stopped && stopped.error) return fail(res, stopped.error, 400);
        if (stopped) return refuse(req, res, actor, { ...stopped, entityId: stopped.params.projectId });
        const saved = await proposals.create(companyId, { agent, runId, taskId: b.taskId, projectId: b.projectId, what: b.what, why: b.why, changes: b.changes, gate: proposalFiling.gateAsked(b.gate), priority: b.priority, cost: b.cost });
        return res.send({ status: true, statusText: 'Proposal filed.', data: saved });
    } catch (e) { logger.error(`createProposal: ${e.message}`); return fail(res, e.message, e.status || 500); }
};

/* An approval stays approved when part of it was not made (proposals.approve keeps `notMade`); its answer names what. */
const approvalText = (out) => {
    const notMade = (out && out.proposal && Array.isArray(out.proposal.notMade)) ? out.proposal.notMade : [];
    if (!notMade.length) return 'Done.';
    const lines = notMade.map((entry) => [entry.name, entry.error].filter(Boolean).join(': ')).join(' ');
    const madeAny = Array.isArray(out.applied) && out.applied.some((change) => change && change.ok);
    return `${madeAny ? 'Approved, but part of it was not made.' : 'Approved, but nothing was made.'} ${lines}`;
};

/* `heldTo`, when given, is asked of the caller and the proposal before the decision is taken; it answers a refusal or null. */
const decide = (action, fn, heldTo = null) => async (req, res) => {
    try {
        if (!(await personDecides(req, res, action))) return undefined;
        const companyId = companyOf(req);
        if (!companyId || !OBJECT_ID.test(req.params.id)) return fail(res, 'companyId and a valid proposal id are required.');
        const caller = await callerOf(req, companyId);
        if (!caller.human) return fail(res, REFUSAL.DECIDE_PERSON, 403);
        // One answer for a proposal that is not there and one the caller may not see.
        const proposal = await proposals.get(companyId, req.params.id);
        if (!proposal || !(await canSeeProposal(companyId, caller, proposal))) return fail(res, 'Proposal not found.', 404);
        if (!decidesProposals(caller)) return fail(res, REFUSAL.DECIDE_MEMBER, 403, refusalOf({ reason: 'not_permitted' }));
        const held = heldTo ? await heldTo(companyId, caller, proposal) : null;
        if (held) return fail(res, held.error, held.status, refusalOf(held));
        const out = await fn(companyId, req.params.id, { decider: caller.actor, isPrivileged: caller.privileged, changes: req.body && req.body.changes, parts: req.body && req.body.parts, reason: req.body && req.body.reason, ip: req.ip || '', always: Boolean(req.body) && req.body.always === true, viaToken: Boolean(req.apiToken) });
        if (out.error) return fail(res, out.error, out.status || 400, refusalOf(out));
        return res.send({ status: true, statusText: action === 'proposal.approve' ? approvalText(out) : 'Done.', data: out });
    } catch (e) { logger.error(`proposal decision: ${e.message}`); return fail(res, e.message, 500); }
};

const approveOnceOrAlways = (companyId, id, { always, ...decision }) => (always ? standingApprovals.approveAlways(companyId, id, decision) : proposals.approve(companyId, id, decision));

exports.approveProposal = decide('proposal.approve', approveOnceOrAlways);
exports.declineProposal = decide('proposal.decline', proposals.decline, approverRights.declineRefusal);
exports.undoProposal = decide('proposal.undo', proposals.undoApproval);

/* GET / PUT / DELETE /api/v2/agents/account — my personal coding-agent link */
exports.getAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const [account, policy, summary] = await Promise.all([accounts.getAccount(req.uid), accounts.getPolicy(companyId), accounts.monthlySummary(companyId, req.uid, req.query && req.query.month)]);
        return res.send({ status: true, statusText: 'Account fetched.', data: { account, policy, summary } });
    } catch (e) { logger.error(`getAccount: ${e.message}`); return fail(res, e.message, 500); }
};

exports.linkAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { human } = await humanActor(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!human) return fail(res, 'Agents cannot link accounts.', 403);
        const out = await accounts.link(companyId, req.uid, req.body || {});
        if (out.error) return fail(res, out.error, out.status || 400);
        return res.send({ status: true, statusText: 'Account linked.', data: out.account });
    } catch (e) { logger.error(`linkAccount: ${e.message}`); return fail(res, e.message, 500); }
};

exports.unlinkAccount = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const { human } = await humanActor(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (!human) return fail(res, 'Agents cannot unlink accounts.', 403);
        return res.send({ status: true, statusText: 'Account unlinked. Past comments, PRs and hours stay on their tasks.', data: await accounts.unlink(companyId, req.uid) });
    } catch (e) { logger.error(`unlinkAccount: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET / PUT /api/v2/agents/policy — owner/admin */
exports.getPolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId) return fail(res, 'companyId is required.');
        return res.send({ status: true, statusText: 'Policy fetched.', data: await accounts.getPolicy(companyId) });
    } catch (e) { return fail(res, e.message, 500); }
};

const POLICY_EDIT_ACTION = 'workspace.agent_policy.edit';
const POLICY_CHANGE = 'policy';
const BUDGET_CHANGE = 'budget';

/* An API token never changes it, whoever holds it: the policy is what holds a token's agent. */
const saveWorkspacePolicy = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        if (req.apiToken) return fail(res, 'An API token cannot change the workspace\'s agent settings.', 403);
        const caller = await callerOf(req, companyId);
        if (!canManageAgents(caller)) return fail(res, 'Owner/admin only.', 403);
        const out = await accounts.setPolicy(companyId, req.body || {}, caller.actor.userId);
        if (out.error) return fail(res, out.error, out.status || 400);
        await agentAudit.recordWorkspacePolicyChange(companyId, caller.actor, { from: out.from, to: out.policy, ip: req.ip || '' });
        socketEmitter.emit('update', { type: 'update', module: 'agent', companyId, data: { kind: POLICY_CHANGE }, updatedFields: { kind: POLICY_CHANGE }, actor: { kind: 'human' }, depth: 1 });
        return res.send({ status: true, statusText: 'Policy updated.', data: out.policy });
    } catch (e) { logger.error(`setPolicy: ${e.message}`); return fail(res, e.message, 500); }
};

exports.setPolicy = [agentsRefused(POLICY_EDIT_ACTION), saveWorkspacePolicy];
exports.POLICY_EDIT_ACTION = POLICY_EDIT_ACTION;

/* GET /api/v2/agents/team — the Team board (13h): people and agents, what each
 * is on right now, load for the week, PTO, and a composed standup. */
exports.teamBoard = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const hoursPerWeek = Number(req.query && req.query.hoursPerWeek) > 0 ? Number(req.query.hoursPerWeek) : 40;
        const caller = await callerOf(req, companyId);
        const [rights, person] = await Promise.all([agentRightsOf(companyId, caller), audience.personOf(companyId, req.uid)]);
        const seesAgent = (agent) => audience.maySee(agent, person, { seesAll: rights.seesAll });
        const data = await team.board(companyId, { hoursPerWeek, viewerId: req.uid, seesAgent });
        return res.send({ status: true, statusText: 'Team board fetched.', data: { ...data, standup: team.standup(data) } });
    } catch (e) { logger.error(`teamBoard: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/team/standup?tz= — the caller's own standup, from activity rather than a model */
exports.myStandup = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const window = team.standupWindow({ now: Date.now(), tzOffset: req.query && req.query.tz });
        const activity = await team.personalActivity(companyId, { userId: req.uid, window });
        return res.send({ status: true, statusText: 'Standup fetched.', data: team.personalStandup(activity) });
    } catch (e) { logger.error(`myStandup: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/routable?projectId=&limit= — open tasks the caller can
 * already see, for the bulk router (30b). Scoped through Agents/scope so routing
 * can never surface a task the person could not open on their own. */
exports.routableTasks = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const ids = await scope.visibleProjectIds(companyId, req.uid);
        if (!ids.length) return res.send({ status: true, statusText: 'Routable tasks fetched.', data: [] });
        const q = req.query || {};
        const wanted = q.projectId && ids.includes(String(q.projectId)) ? [String(q.projectId)] : ids;
        const limit = Math.min(100, Math.max(1, Number(q.limit) || 40));
        const sprints = await hiddenSprintFilter(companyId, req.uid, wanted);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ ...sprints, deletedStatusKey: { $ne: 1 }, mainChat: { $ne: true }, ProjectID: { $in: wanted }, statusType: { $nin: ['close', 'done', 'default_close'] } },
                   'TaskName TaskKey status statusType Task_Priority ProjectID tagsArray AssigneeUserId totalEstimatedTime updatedAt links description rawDescription',
                   { sort: { updatedAt: -1 }, limit }],
        }, 'find').catch(() => []);
        // The router needs to know what each task carries (PR link, public URL,
        // brief length) — not the body itself, which can be long.
        const data = (rows || []).map((t) => {
            const o = typeof t.toObject === 'function' ? t.toObject() : { ...t };
            const inputs = inputsOf(o);
            delete o.description; delete o.rawDescription; delete o.links;
            return { ...o, inputs };
        });
        return res.send({ status: true, statusText: 'Routable tasks fetched.', data });
    } catch (e) { logger.error(`routableTasks: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/pipeline — tasks an agent has worked on (28a task picker). */
exports.pipelineTasks = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const data = await shipping.pipelineTasks(companyId, req.uid, { limit: req.query && req.query.limit });
        return res.send({ status: true, statusText: 'Pipeline fetched.', data });
    } catch (e) { logger.error(`pipelineTasks: ${e.message}`); return fail(res, e.message, 500); }
};

/* GET /api/v2/agents/release?since= — the release candidate (28c). */
exports.releaseCandidate = async (req, res) => {
    try {
        const companyId = companyOf(req);
        if (!companyId || !req.uid) return fail(res, 'Unauthorized.', 401);
        const data = await shipping.releaseCandidate(companyId, req.uid, { since: req.query && req.query.since });
        return res.send({ status: true, statusText: 'Release candidate fetched.', data });
    } catch (e) { logger.error(`releaseCandidate: ${e.message}`); return fail(res, e.message, 500); }
};

exports.normaliseSkill = normaliseSkill;
