// Custom agents — HTTP handlers.
//
// Agents can be created, listed, edited, deleted, resolved for an entity — and
// executed, via test-run (reads and thinks, withholds every mutation) or run-now.
// Automatic triggers are not wired into the comment flow yet, so every run here
// starts from an explicit request.
//
// An agent is modelled as a MEMBER, not a rule: it is assignable, it will reply in
// comments, and its actions will be attributed to it. See the plan for why that
// framing drives the rest.
const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const logger = require('../../Config/loggerConfig');
const socketEmitter = require('../../event/socketEventEmitter');
const R = require('./helpers/agentRules');
const S = require('./helpers/scope');
const llm = require('./llm');
const executor = require('./runner/executor');

const LOG_PREFIX = '[agents]';

const companyOf = (req) => req.headers['companyid'] || (req.body && req.body.companyId) || (req.query && req.query.companyId);

// Caller identity comes from the JWT middleware only. Anything from the body is
// forgeable, and an agent is a thing that can act — so who created or changed it
// has to be trustworthy.
const userOf = (req) => String(req.uid || '');

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

/**
 * Owner (1) or Admin (2) may manage company-wide agents.
 *
 * NOTE (step 01 scope): the plan calls for granular `agents.manage_company` /
 * `agents.manage_project` permission keys. Those live in the company rules
 * catalogue (utils/data.js + the RULES collection + the permissions UI), which is
 * its own piece of work. Until then this gates on the two roles that ARE fixed
 * for every company — Owner and Admin. Roles 3+ are fully dynamic per company, so
 * they must never be hardcoded to a meaning. Swapping this one function for a
 * permission check is the whole migration.
 */
const isCompanyAdmin = async (companyId, userId) => {
    if (!companyId || !userId) return false;
    try {
        const record = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.COMPANY_USERS,
            data: [{ userId: String(userId) }, { _id: 1, roleType: 1, userId: 1 }],
        }, 'findOne');
        return !!record && [1, 2].includes(Number(record.roleType));
    } catch (e) {
        logger.error(`${LOG_PREFIX} role check failed (company ${companyId}, user ${userId}): ${e.message}`);
        return false;   // deny on doubt
    }
};

/**
 * Which project does a scope ultimately sit in?
 *
 * A sprint/folder/task scope names one of those, not a project, so it has to be
 * resolved before it can be permission-checked. Returns '' when it cannot be
 * resolved, which callers must treat as "deny", not "allow".
 */
const projectOfScope = async (companyId, scope = {}) => {
    const level = String(scope.level || '');
    const refId = String(scope.refId || '');
    if (level === 'project') return refId;
    if (!refId) return '';

    const id = oid(refId);
    if (!id) return '';

    const lookup = {
        sprint: SCHEMA_TYPE.SPRINTS,
        folder: SCHEMA_TYPE.SPRINTS,   // folders live in the sprints collection
        task: SCHEMA_TYPE.TASKS,
    }[level];
    if (!lookup) return '';

    const row = await MongoDbCrudOpration(companyId, {
        type: lookup,
        data: [{ _id: id }, { ProjectID: 1, projectId: 1 }],
    }, 'findOne').catch(() => null);
    return row ? String(row.ProjectID || row.projectId || '') : '';
};

/**
 * May this user point an agent at this scope?
 *
 * Without this check, scope is self-declared: a member could create an agent
 * scoped to a project they cannot open, then read that project's tasks through
 * the agent — the runner would happily comply, because the agent's scope said it
 * was allowed. Scope has to be verified against the CREATOR's access at the
 * moment it is set, not just against the agent's own configuration.
 *
 * Deliberately conservative: owners and admins pass, and everyone else must be a
 * member or the lead of the project in question. A company may also grant "see all
 * projects" to a custom role via the rules catalogue, and that is NOT honoured
 * here — such a user is refused even though they could open the project directly.
 * Denying too much is a fixable annoyance; granting too much is a data leak, and
 * the proper check belongs with the `agents.manage_*` permission keys that
 * isCompanyAdmin is already waiting on.
 */
const canUseScope = async (companyId, userId, scope = {}) => {
    const level = String(scope.level || '');

    // Company-wide agents act everywhere, so they stay admin-only.
    if (level === 'company') {
        return (await isCompanyAdmin(companyId, userId))
            ? { ok: true }
            : { ok: false, reason: 'Only an owner or admin can create an agent that works everywhere. Scope it to a project instead.' };
    }

    if (await isCompanyAdmin(companyId, userId)) return { ok: true };

    const projectId = await projectOfScope(companyId, scope);
    if (!projectId) return { ok: false, reason: 'That scope could not be verified, so the agent was not saved.' };

    const pid = oid(projectId);
    if (!pid) return { ok: false, reason: 'That scope could not be verified, so the agent was not saved.' };

    try {
        const project = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [{ _id: pid, deletedStatusKey: { $ne: 1 } }, { AssigneeUserId: 1, LeadUserId: 1 }],
        }, 'findOne');
        if (!project) return { ok: false, reason: 'That project does not exist.' };

        const uid = String(userId);
        const members = (project.AssigneeUserId || []).map((x) => String(x));
        const isMember = members.includes(uid) || String(project.LeadUserId || '') === uid;
        return isMember
            ? { ok: true }
            : { ok: false, reason: 'You can only create an agent for a project you are a member of.' };
    } catch (e) {
        logger.error(`${LOG_PREFIX} scope check failed (company ${companyId}, user ${userId}): ${e.message}`);
        return { ok: false, reason: 'Could not verify access to that project, so the agent was not saved.' };
    }
};

/**
 * Load an agent and confirm the caller may act on it.
 *
 * Every handler that touches one specific agent goes through this, so the access
 * rule lives in one place. Resolves { ok, agent } or { ok:false, reason }.
 *
 * Checked at USE time, not just at creation: an agent may have been scoped by
 * someone who has since been removed from the project, and enabling, pausing or
 * running it is exactly as sensitive as creating it was.
 */
const loadManageableAgent = async (companyId, userId, id, projection) => {
    if (!R.isObjectIdString(id)) return { ok: false, reason: 'A valid agent id is required.' };

    const agent = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: projection ? [{ _id: oid(id), deletedStatusKey: 0 }, projection] : [{ _id: oid(id), deletedStatusKey: 0 }],
    }, 'findOne');
    if (!agent) return { ok: false, reason: 'Agent not found.' };

    const allowed = await canUseScope(companyId, userId, agent.scope || { level: 'company' });
    if (!allowed.ok) {
        logger.error(`${LOG_PREFIX} user ${userId} refused access to agent ${id}`);
        return { ok: false, reason: 'You do not have access to the project this agent works in.' };
    }
    return { ok: true, agent };
};

/**
 * Keep only the agents this user may see.
 *
 * An agent's instructions are free text and can name anything, so listing agents
 * for projects the caller cannot open would leak through the back door the other
 * checks just closed.
 *
 * Memoised on level:refId — a company typically has a handful of distinct scopes
 * across many agents, so this is two or three lookups rather than one per agent.
 */
const filterVisibleAgents = async (companyId, userId, rows = []) => {
    if (await isCompanyAdmin(companyId, userId)) return rows;

    const seen = new Map();
    const visible = [];
    for (const row of rows) {
        const scope = row.scope || { level: 'company' };
        const key = `${scope.level || ''}:${scope.refId || ''}`;
        if (!seen.has(key)) seen.set(key, (await canUseScope(companyId, userId, scope)).ok);
        if (seen.get(key)) visible.push(row);
    }
    return visible;
};

/**
 * Push a renamed agent's name and icon into the rows that copied them.
 *
 * Run rows and agent comments each store agentName (and comments store agentEmoji)
 * at the moment they were written, because both have to keep rendering after the
 * agent is deleted — a comment attributed to nobody is worse than one attributed
 * to a name that no longer exists. The cost of that choice is that a rename does
 * not reach them, which is why Activity kept showing the old name.
 *
 * Fixed by propagating on rename rather than joining on read: comments are fetched
 * constantly and run logs regularly, so paying two writes once per rename is much
 * cheaper than a lookup on every read. A deleted agent keeps its last known name
 * for free, since there is nothing left to propagate from.
 *
 * The trade-off, stated plainly: this rewrites history. The log shows what the
 * agent is called now, not what it was called when it ran. That is what someone
 * renaming an agent expects — they want to recognise it, not audit its former names.
 *
 * Best-effort. The agent itself is already saved, so a failure here is logged and
 * never turned into a failed update.
 */
const propagateIdentity = async (companyId, id, before = {}, after = {}) => {
    const name = after.name;
    const emoji = after.emoji;
    const nameChanged = name !== undefined && String(name) !== String(before.name || '');
    const emojiChanged = emoji !== undefined && String(emoji) !== String(before.emoji || '');
    if (!nameChanged && !emojiChanged) return;

    const asOid = oid(id);
    const asStr = String(id);

    // agentRuns stores agentId as an ObjectId, comments store it as a string.
    // Matching both shapes in each place keeps this correct if either ever changes.
    const idMatch = { $in: [asOid, asStr].filter(Boolean) };

    // `timestamps: false` on both.
    //
    // These schemas are declared with `timestamps: true`, so an update bumps
    // updatedAt — and the comment list shows "(edited)" whenever updatedAt differs
    // from createdAt. Without this, renaming an agent silently marked every comment
    // it had ever written as edited, which is a false claim about the content: the
    // text did not change, only the label attached to it.
    const noTouch = { timestamps: false };

    if (nameChanged) {
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [{ agentId: idMatch }, { $set: { agentName: name } }, noTouch],
        }, 'updateMany').catch((e) => logger.error(`${LOG_PREFIX} could not rename runs for ${id}: ${e.message}`));
    }

    const commentSet = {};
    if (nameChanged) commentSet.agentName = name;
    if (emojiChanged) commentSet.agentEmoji = emoji;
    await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.COMMENTS,
        data: [{ agentId: idMatch }, { $set: commentSet }, noTouch],
    }, 'updateMany').catch((e) => logger.error(`${LOG_PREFIX} could not rename comments for ${id}: ${e.message}`));

    logger.info(`${LOG_PREFIX} propagated identity for ${id}${nameChanged ? ` (name -> "${name}")` : ''}${emojiChanged ? ` (icon -> ${emoji})` : ''}`);
};

/**
 * The agents this user may see, as ids — for the run log and the usage breakdown.
 *
 * Returns { all: true } for an owner/admin, who sees everything, so the caller can
 * skip the id filter entirely rather than building a huge $in.
 */
const visibleAgentIds = async (companyId, userId) => {
    if (await isCompanyAdmin(companyId, userId)) return { all: true, ids: [] };
    const rows = await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ deletedStatusKey: 0 }, { scope: 1, _id: 1 }],
    }, 'find');
    const visible = await filterVisibleAgents(companyId, userId, rows || []);
    return { all: false, ids: visible.map((a) => a._id) };
};

/** Shape an agent for the client. Adds the derived labels the list view needs. */
const present = (row) => {
    if (!row) return null;
    const a = row.toObject ? row.toObject() : { ...row };
    // Report only the skills that are actually in effect. Agents saved before a
    // skill was withdrawn (or before it was implemented) can still carry it in the
    // database, and echoing that back would show a permission count the runner
    // does not honour. Editing and saving such an agent drops the stale keys for
    // good, because validateAgent applies the same filter.
    const skills = (a.skills || []).filter((s) => R.GRANTABLE_SKILL_KEYS.includes(s));
    return {
        ...a,
        skills,
        scopeLabel: S.describeScope(a.scope || {}),
        triggerLabel: R.describeTriggers(a.triggers || []),
        hasWriteSkill: R.hasWriteSkill(skills),
    };
};

/**
 * GET /api/v1/agents/catalogue
 *
 * The static vocabulary the editor renders from: skills, scope levels, trigger
 * types and events, plus default limits. Served from the server so the UI can
 * never offer a skill the backend does not implement.
 */
exports.catalogue = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        const canManage = await isCompanyAdmin(companyId, userId);
        return res.send({
            status: true,
            data: {
                canManage,
                skills: R.SKILLS,
                scopeLevels: R.SCOPE_LEVELS,
                triggerTypes: R.TRIGGER_TYPES,
                triggerEvents: R.TRIGGER_EVENTS,
                defaultLimits: R.DEFAULT_LIMITS,
                maxInstructions: R.MAX_INSTRUCTIONS,
                // So the UI can say "no model configured" up front rather than
                // letting every run fail with the same error.
                llm: llm.status(),
            },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} catalogue: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/agents?level=&refId=
 *
 * Every agent in the company, newest first. Optional level/refId narrows to one
 * scope exactly (not the inherited chain) — that is what the settings list filters
 * by. Use /available for the chain.
 */
exports.listAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const query = { deletedStatusKey: 0 };
        const level = String((req.query || {}).level || '');
        if (level) {
            if (!R.SCOPE_LEVELS.includes(level)) return res.send({ status: false, statusText: 'Unknown scope level.' });
            query['scope.level'] = level;
            const refId = String((req.query || {}).refId || '');
            if (refId) {
                const o = oid(refId);
                query['scope.refId'] = { $in: [o, refId].filter(Boolean) };
            }
        }

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [query, null, { sort: { createdAt: -1 } }],
        }, 'find');

        const visible = await filterVisibleAgents(companyId, userId, rows || []);
        const canManage = await isCompanyAdmin(companyId, userId);
        return res.send({ status: true, data: { canManage, agents: visible.map(present) } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} listAgents: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/agents/available?entityType=task&entityId=…
 *
 * The scope walk: which agents apply here, inherited from every level above.
 * This is what the task/sprint/project UI asks so it can offer the right agents,
 * and it is the reason one agent can serve any level.
 *
 * Narrower scopes sort first, so a task-specific agent appears above a
 * company-wide one.
 */
exports.availableAgents = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const entityType = String((req.query || {}).entityType || '');
        const entityId = String((req.query || {}).entityId || '');
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!['task', 'sprint', 'folder', 'project'].includes(entityType)) {
            return res.send({ status: false, statusText: 'entityType must be task, sprint, folder or project.' });
        }
        if (!R.isObjectIdString(entityId)) return res.send({ status: false, statusText: 'A valid entityId is required.' });

        // Load only the ids needed to build the chain.
        let entity = null;
        if (entityType === 'task') {
            entity = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.TASKS,
                data: [{ _id: oid(entityId), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, sprintId: 1, folderObjId: 1 }],
            }, 'findOne');
            if (!entity) return res.send({ status: false, statusText: 'Task not found.' });
        } else if (entityType === 'sprint') {
            entity = await MongoDbCrudOpration(companyId, {
                type: SCHEMA_TYPE.SPRINTS,
                data: [{ _id: oid(entityId) }, { ProjectID: 1, folderId: 1 }],
            }, 'findOne');
            if (!entity) return res.send({ status: false, statusText: 'Sprint not found.' });
        }
        // folder / project need no parent lookup — the chain is derivable from the id.

        const chain = S.ancestorScopes(entityType, entity || {}, entityId);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ deletedStatusKey: 0, enabled: true, ...S.buildScopeQuery(chain, oid) }],
        }, 'find');

        const inChain = (rows || [])
            // Re-check in memory. The query narrows; this is the authority — scope
            // is a boundary, so it is never trusted from the query shape alone.
            .filter((row) => S.scopeApplies((row.scope && row.scope.toObject ? row.scope.toObject() : row.scope) || {}, chain));

        // Two different questions: does the agent apply here, and may this user see
        // it? The caller supplies the entityId, so without the second check this
        // would answer for entities they have no access to.
        const agents = (await filterVisibleAgents(companyId, userId, inChain))
            .map(present)
            .sort((a, b) => S.scopeRank(a.scope) - S.scopeRank(b.scope) || String(a.name).localeCompare(String(b.name)));

        return res.send({ status: true, data: { chain, agents } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} availableAgents: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/* POST /api/v1/agents */
exports.createAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const check = R.validateAgent(req.body || {});
        if (!check.valid) return res.send({ status: false, statusText: check.errors.join(' ') });

        // Scope is a claim about what the agent may read and change, so it is
        // checked against the creator's own access — not taken on trust.
        const allowed = await canUseScope(companyId, userId, check.value.scope);
        if (!allowed.ok) return res.send({ status: false, statusText: allowed.reason });

        const data = {
            _id: new mongoose.Types.ObjectId(),
            name: check.value.name,
            description: check.value.description || '',
            emoji: check.value.emoji || '🤖',
            colour: check.value.colour || '#2F3990',
            scope: check.value.scope,
            instructions: check.value.instructions,
            triggers: check.value.triggers || [],
            skills: check.value.skills || ['context.read', 'comment.write'],
            context: check.value.context || { docIds: [], taskIds: [] },
            limits: check.value.limits || R.DEFAULT_LIMITS,
            // Off until someone has read it back and turned it on. An agent that
            // starts running the instant it is saved is a surprise, not a feature.
            enabled: false,
            createdBy: String(userId),
            updatedBy: String(userId),
            deletedStatusKey: 0,
        };
        const saved = await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data }, 'save');
        logger.info(`${LOG_PREFIX} created "${data.name}" (${data.scope.level}) by ${userId}`);
        return res.send({ status: true, statusText: 'Agent created.', data: present(saved || data) });
    } catch (e) {
        logger.error(`${LOG_PREFIX} createAgent: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/* PUT /api/v1/agents/:id */
exports.updateAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!R.isObjectIdString(id)) return res.send({ status: false, statusText: 'A valid agent id is required.' });

        const existing = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ _id: oid(id), deletedStatusKey: 0 }],
        }, 'findOne');
        if (!existing) return res.send({ status: false, statusText: 'Agent not found.' });

        const check = R.validateAgent(req.body || {}, { partial: true });
        if (!check.valid) return res.send({ status: false, statusText: check.errors.join(' ') });

        // Both the scope it has and the scope it is moving to must be allowed:
        // checking only the target would let someone edit an agent they cannot
        // reach, and checking only the current one would let them move it somewhere
        // they cannot reach.
        const currentAllowed = await canUseScope(companyId, userId, existing.scope || { level: 'company' });
        if (!currentAllowed.ok) {
            return res.send({ status: false, statusText: 'You do not have access to the project this agent works in.' });
        }
        if (check.value.scope) {
            const nextAllowed = await canUseScope(companyId, userId, check.value.scope);
            if (!nextAllowed.ok) return res.send({ status: false, statusText: nextAllowed.reason });
        }

        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [
                { _id: oid(id) },
                { $set: { ...check.value, updatedBy: String(userId) } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');

        // A rename has to reach the places the old name was copied to.
        await propagateIdentity(companyId, id, existing, updated);

        return res.send({ status: true, statusText: 'Agent updated.', data: present(updated) });
    } catch (e) {
        logger.error(`${LOG_PREFIX} updateAgent: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * DELETE /api/v1/agents/:id — soft delete.
 *
 * Runs are kept. They are the record of what the agent did, and deleting the
 * agent must not erase the evidence.
 */
exports.deleteAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const found = await loadManageableAgent(companyId, userId, id, { scope: 1, name: 1 });
        if (!found.ok) return res.send({ status: false, statusText: found.reason });

        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ _id: oid(id) }, { $set: { deletedStatusKey: 1, enabled: false, updatedBy: String(userId) } }],
        }, 'updateOne');
        logger.info(`${LOG_PREFIX} deleted ${id} by ${userId}`);
        return res.send({ status: true, statusText: 'Agent deleted.' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} deleteAgent: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * POST /api/v1/agents/:id/toggle  { enabled }
 *
 * Separate from update so the list can flip an agent off in one click without
 * sending its whole configuration back. This is the kill switch.
 */
exports.toggleAgent = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        // The kill switch cuts both ways — ENABLING an agent someone deliberately
        // left off is the more dangerous direction, so both need the same gate.
        const found = await loadManageableAgent(companyId, userId, id, { scope: 1, name: 1 });
        if (!found.ok) return res.send({ status: false, statusText: found.reason });

        const enabled = !!(req.body || {}).enabled;
        const updated = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ _id: oid(id), deletedStatusKey: 0 }, { $set: { enabled, updatedBy: String(userId) } }, { returnDocument: 'after' }],
        }, 'findOneAndUpdate');
        if (!updated) return res.send({ status: false, statusText: 'Agent not found.' });
        return res.send({ status: true, statusText: enabled ? 'Agent enabled.' : 'Agent paused.', data: present(updated) });
    } catch (e) {
        logger.error(`${LOG_PREFIX} toggleAgent: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * POST /api/v1/agents/disable-all — company-wide kill switch.
 * Admin only, and deliberately a single call: during an incident you want one
 * button, not a loop over rows.
 */
exports.disableAll = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!(await isCompanyAdmin(companyId, userId))) {
            return res.send({ status: false, statusText: 'Only an owner or admin can pause every agent.' });
        }
        await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENTS,
            data: [{ deletedStatusKey: 0 }, { $set: { enabled: false, updatedBy: String(userId) } }],
        }, 'updateMany');
        logger.info(`${LOG_PREFIX} ALL agents paused by ${userId}`);
        return res.send({ status: true, statusText: 'Every agent is paused.' });
    } catch (e) {
        logger.error(`${LOG_PREFIX} disableAll: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * Shared by both run endpoints: load the agent, confirm the task, execute.
 * `dryRun` is the only difference between test-run and run.
 */
const executeAgainstTask = async (req, res, { dryRun }) => {
    const companyId = companyOf(req);
    const userId = userOf(req);
    const id = String(req.params.id || '');
    const taskId = String((req.body || {}).taskId || '');
    if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
    if (!R.isObjectIdString(taskId)) return res.send({ status: false, statusText: 'Pick a task to run against.' });

    // Running an agent reads whatever is in its scope and echoes it back, so the
    // caller must have access to that scope in their own right.
    const found = await loadManageableAgent(companyId, userId, id);
    if (!found.ok) return res.send({ status: false, statusText: found.reason });
    const agent = found.agent;

    const model = llm.status();
    if (!model.ready) return res.send({ status: false, statusText: model.reason });

    const outcome = await executor.runAgentOnTask({
        companyId,
        agent,
        taskId,
        triggeredBy: userId,
        triggerType: dryRun ? 'test' : 'manual',
        dryRun,
    });

    // A refused or failed run is still a 200 with status:false — the caller needs
    // the reason, and the run row already records it.
    return res.send({ status: !!outcome.ok, statusText: outcome.message, data: outcome });
};

/**
 * POST /api/v1/agents/:id/test-run  { taskId }
 *
 * Runs the agent for real — reads, thinks — but withholds every mutation and
 * returns what it WOULD have posted. This is the control that makes it reasonable
 * to trust an agent before granting it anything that writes.
 */
exports.testRun = async (req, res) => executeAgainstTask(req, res, { dryRun: true });

/* POST /api/v1/agents/:id/run  { taskId } — the real thing. */
exports.runNow = async (req, res) => executeAgainstTask(req, res, { dryRun: false });

/**
 * GET /api/v1/agents/scope-options
 *
 * The projects this user may scope an agent to, for the editor's dropdown.
 *
 * Served from here rather than the frontend's project store because that store is
 * only filled by the Projects area — on a fresh load of Settings it is empty, so
 * the dropdown had nothing in it. Dispatching the store's own loader was the wrong
 * fix too: it clears allProjects before refetching, which would blank the project
 * list for every other view.
 *
 * More importantly, the list is built with the SAME rule canUseScope enforces, so
 * the dropdown cannot offer a project that saving would then reject. Offering a
 * choice that fails on submit is worse than not offering it.
 */
exports.scopeOptions = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const isAdmin = await isCompanyAdmin(companyId, userId);

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.PROJECTS,
            data: [
                { deletedStatusKey: { $ne: 1 }, statusType: { $ne: 'close' } },
                { ProjectName: 1, AssigneeUserId: 1, LeadUserId: 1 },
                { sort: { ProjectName: 1 } },
            ],
        }, 'find');

        const uid = String(userId);
        const projects = (rows || [])
            .filter((p) => {
                if (isAdmin) return true;
                const members = (p.AssigneeUserId || []).map((x) => String(x));
                return members.includes(uid) || String(p.LeadUserId || '') === uid;
            })
            .map((p) => ({ _id: String(p._id), ProjectName: p.ProjectName || '(untitled)' }));

        // canManage rides along so the editor knows whether to offer the
        // company-wide option at all, rather than letting it fail on save.
        return res.send({ status: true, data: { projects, canManage: isAdmin } });
    } catch (e) {
        logger.error(`${LOG_PREFIX} scopeOptions: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * POST /api/v1/agents/:id/assign  { taskId, attached }
 *
 * Attach or detach an agent on a task, writing to the task's own `assignedAgentIds`
 * rather than AssigneeUserId — see the schema comment for why mixing them would
 * break every consumer of the assignee array.
 *
 * Attaching fires the agent if it has an `assigned` trigger, which is the point:
 * "assign it and it gets to work". Detaching never fires anything.
 *
 * Lives here rather than in the task update path on purpose. Task update is a core
 * write path used by every view; an agent attachment has no business being able to
 * break it, and keeping the whole feature inside this module means it cannot.
 */
exports.assignToTask = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const id = String(req.params.id || '');
        const taskId = String((req.body || {}).taskId || '');
        const attached = !!(req.body || {}).attached;
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });
        if (!R.isObjectIdString(taskId)) return res.send({ status: false, statusText: 'A valid taskId is required.' });

        const found = await loadManageableAgent(companyId, userId, id);
        if (!found.ok) return res.send({ status: false, statusText: found.reason });
        const agent = found.agent;

        // The agent must genuinely apply to this task. Its scope is the boundary,
        // so it is checked here as well as inside the runner.
        const task = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [{ _id: oid(taskId), deletedStatusKey: { $ne: 1 } }, { ProjectID: 1, sprintId: 1, folderObjId: 1, assignedAgentIds: 1 }],
        }, 'findOne');
        if (!task) return res.send({ status: false, statusText: 'That task does not exist.' });

        const chain = S.ancestorScopes('task', task, String(task._id));
        if (!S.scopeApplies(agent.scope || {}, chain)) {
            return res.send({ status: false, statusText: 'That task is outside this agent\'s scope.' });
        }

        // $addToSet / $pull rather than read-modify-write: two people assigning
        // different agents at the same time must not overwrite each other.
        //
        // findOneAndUpdate rather than updateOne so the fresh document can be
        // broadcast — the same task appears in List, Board, Table, the detail panel
        // and other people's sessions, and every one of them has to see it.
        const updatedTask = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { _id: oid(taskId) },
                attached
                    ? { $addToSet: { assignedAgentIds: String(agent._id) } }
                    : { $pull: { assignedAgentIds: String(agent._id) } },
                { returnDocument: 'after' },
            ],
        }, 'findOneAndUpdate');

        // Broadcast it like any other task field change, so every view refreshes
        // without each one having to poll. Best-effort — the write already happened.
        try {
            socketEmitter.emit('update', {
                type: 'update',
                data: updatedTask,
                updatedFields: { assignedAgentIds: (updatedTask && updatedTask.assignedAgentIds) || [] },
                module: 'task',
            });
        } catch (e) {
            logger.error(`${LOG_PREFIX} could not broadcast the agent assignment: ${e.message}`);
        }

        if (!attached) {
            return res.send({ status: true, statusText: `${agent.name} removed from this task.`, data: { attached: false } });
        }

        const wantsAssigned = (agent.triggers || []).some((t) => t && t.type === 'assigned');

        // Note what is NOT checked here any more: whether it was already attached.
        // That used to make re-assigning a no-op, which forced people to detach and
        // re-attach an agent to get it to look again — and once it stays engaged
        // with the task, asking twice is a normal thing to do, not a mistake.
        if (!agent.enabled || !wantsAssigned) {
            const why = !agent.enabled
                ? 'It is paused, so it did not run.'
                : 'It does not run on assignment, so it did not run.';
            return res.send({ status: true, statusText: `${agent.name} added. ${why}`, data: { attached: true, ran: false } });
        }

        const model = llm.status();
        if (!model.ready) {
            return res.send({ status: true, statusText: `${agent.name} added, but ${model.reason}`, data: { attached: true, ran: false } });
        }

        const outcome = await executor.runAgentOnTask({
            companyId,
            agent,
            taskId,
            triggeredBy: userId,
            triggerType: 'assigned',
            depth: 0,
        });

        // The attachment succeeded even if the run did not, so this is still a
        // success — with the run's own outcome reported alongside it.
        return res.send({
            status: true,
            statusText: outcome.ok ? `${agent.name} added and replied.` : `${agent.name} added, but ${outcome.message}`,
            data: { attached: true, ran: !!outcome.ok, run: outcome },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} assignToTask: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/agents/:id/test-targets
 *
 * A handful of recent tasks this agent could be tested against.
 *
 * Only tasks inside the agent's own scope are offered. Listing a task the agent
 * would then refuse would make the scope look broken, when in fact it was working
 * — so the picker is built from the same scope definition the runner enforces.
 */
exports.testTargets = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        const id = String(req.params.id || '');
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        // This hands back real task names, so it is gated exactly like running the
        // agent is — otherwise it would be a way to read the titles of tasks in a
        // project the caller cannot open.
        const found = await loadManageableAgent(companyId, userId, id, { scope: 1, name: 1 });
        if (!found.ok) return res.send({ status: false, statusText: found.reason });

        const scopeQuery = S.taskQueryForScope(found.agent.scope || {}, oid);
        if (!scopeQuery) return res.send({ status: true, data: { tasks: [] } });

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.TASKS,
            data: [
                { ...scopeQuery, deletedStatusKey: { $ne: 1 } },
                { TaskName: 1, taskId: 1, ProjectID: 1 },
                { sort: { updatedAt: -1, createdAt: -1 }, limit: 25 },
            ],
        }, 'find');

        return res.send({
            status: true,
            data: {
                tasks: (rows || []).map((r) => ({
                    _id: String(r._id),
                    name: r.TaskName || '(untitled)',
                    taskId: r.taskId || '',
                })),
            },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} testTargets: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/agents/runs?agentId=&limit=
 *
 * The Activity view. Includes refused runs (status "skipped") on purpose: an agent
 * stopped by its daily limit and an agent with nothing to say look identical from
 * the outside, and only one of those is a problem the user can fix.
 */
exports.listRuns = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const query = { deletedStatusKey: 0 };
        const agentId = String((req.query || {}).agentId || '');
        if (agentId) {
            // One agent's history: the same access rule as the agent itself.
            const found = await loadManageableAgent(companyId, userId, agentId, { scope: 1, name: 1 });
            if (!found.ok) return res.send({ status: false, statusText: found.reason });
            query.agentId = oid(agentId);
        } else {
            // The whole log: restricted to the agents this user can see, so run rows
            // do not reveal agents that listAgents hides.
            const visible = await visibleAgentIds(companyId, userId);
            if (!visible.all) {
                if (!visible.ids.length) {
                    return res.send({ status: true, data: { rows: [], total: 0, page: 1, limit: 10 } });
                }
                query.agentId = { $in: visible.ids };
            }
        }

        // Paged, because this grows without bound — one row per run, forever. The
        // total is returned separately so the client can render page numbers rather
        // than guessing from whether the last page was full.
        const rawLimit = Number((req.query || {}).limit);
        const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 100) : 10;
        const rawPage = Number((req.query || {}).page);
        const page = Number.isFinite(rawPage) ? Math.max(Math.floor(rawPage), 1) : 1;

        const total = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [query],
        }, 'countDocuments');

        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [query, null, { sort: { startedAt: -1, createdAt: -1 }, skip: (page - 1) * limit, limit }],
        }, 'find');

        return res.send({
            status: true,
            data: { rows: rows || [], total: Number(total) || 0, page, limit },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} listRuns: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

/**
 * GET /api/v1/agents/usage — runs and estimated spend this calendar month.
 *
 * Surfaced at the top of the settings page because it is the number that decides
 * whether this feature stays switched on.
 */
exports.usage = async (req, res) => {
    try {
        const companyId = companyOf(req);
        const userId = userOf(req);
        if (!companyId || !userId) return res.send({ status: false, statusText: 'companyId and an authenticated user are required.' });

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const rows = await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [[
                { $match: { startedAt: { $gte: monthStart }, deletedStatusKey: { $ne: 1 } } },
                {
                    $group: {
                        _id: null,
                        runs: { $sum: 1 },
                        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                        tokensIn: { $sum: '$tokensIn' },
                        tokensOut: { $sum: '$tokensOut' },
                        cost: { $sum: '$costEstimate' },
                    },
                },
            ]],
        }, 'aggregate').catch(() => []);

        // Per-agent breakdown: which agent is actually spending the tokens. The
        // company total answers "should this feature stay on"; this answers "which
        // agent is the reason", which is the one you act on.
        //
        // Restricted to visible agents because it NAMES them — unlike the total
        // above, which is an aggregate and reveals nothing about who exists.
        const visible = await visibleAgentIds(companyId, userId);
        const byAgentMatch = { startedAt: { $gte: monthStart }, deletedStatusKey: { $ne: 1 } };
        if (!visible.all) byAgentMatch.agentId = { $in: visible.ids };

        const byAgent = (!visible.all && !visible.ids.length) ? [] : await MongoDbCrudOpration(companyId, {
            type: SCHEMA_TYPE.AGENT_RUNS,
            data: [[
                { $match: byAgentMatch },
                {
                    $group: {
                        _id: '$agentId',
                        // Last name seen wins, so a renamed agent reads correctly even
                        // for rows written before propagateIdentity caught up.
                        agentName: { $last: '$agentName' },
                        runs: { $sum: 1 },
                        failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                        refused: { $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] } },
                        tokensIn: { $sum: '$tokensIn' },
                        tokensOut: { $sum: '$tokensOut' },
                        cost: { $sum: '$costEstimate' },
                    },
                },
                { $sort: { tokensOut: -1, tokensIn: -1 } },
            ]],
        }, 'aggregate').catch(() => []);

        const t = (rows && rows[0]) || {};
        return res.send({
            status: true,
            data: {
                periodStart: monthStart,
                runs: Number(t.runs) || 0,
                failed: Number(t.failed) || 0,
                tokensIn: Number(t.tokensIn) || 0,
                tokensOut: Number(t.tokensOut) || 0,
                costEstimate: Number(t.cost) || 0,
                byAgent: (byAgent || []).map((a) => ({
                    agentId: String(a._id || ''),
                    agentName: a.agentName || '',
                    runs: Number(a.runs) || 0,
                    failed: Number(a.failed) || 0,
                    refused: Number(a.refused) || 0,
                    tokensIn: Number(a.tokensIn) || 0,
                    tokensOut: Number(a.tokensOut) || 0,
                    costEstimate: Number(a.cost) || 0,
                })),
            },
        });
    } catch (e) {
        logger.error(`${LOG_PREFIX} usage: ${e.message}`);
        return res.send({ status: false, statusText: e.message });
    }
};

exports.__internals = { isCompanyAdmin, present };
