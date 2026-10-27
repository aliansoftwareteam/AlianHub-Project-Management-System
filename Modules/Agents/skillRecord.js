// The agent_skills record: a per-company skill written in the closed
// vocabulary (skills/catalogues.js) and compiled by skills/compile.js into the
// generic-skill shape the orchestrator runs. Resolution is hybrid: a company's
// own data skill first, the built-in skill second.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const codeSkills = require('./skills');
const { SOURCE, compile, taskView, contextOf } = require('./skills/compile');
const { validateSkill, riskOf } = require('./skills/validateSkill');
const { effectiveActions } = require('./skills/effectiveActions');
const { requirementDetail } = require('./skills/inputRules');
const { catalogues } = require('./skills/catalogues');
const { checkDeclaredReads, unavailableOf } = require('./skills/externalReads');

const isLive = (doc) => Boolean(doc) && doc.enabled !== false && !doc.retiredAt;

const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const findData = async (companyId, key) => plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ key: String(key || '').toLowerCase() }] }, 'findOne'));

const listData = async (companyId, { includeRetired = false } = {}) => ((await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_SKILLS,
    data: [includeRetired ? {} : { retiredAt: { $exists: false } }, {}, { sort: { createdAt: 1 } }],
}, 'find')) || []).map(plainOf);

/* Data first, code second. A disabled or retired data skill does not shadow
 * the code skill of the same key. */
const getSkill = async (companyId, key) => {
    const slug = String(key || '');
    if (!slug) return null;
    const doc = await findData(companyId, slug);
    if (isLive(doc)) return compile(doc);
    return codeSkills.getSkill(slug);
};

const codeEntry = (skill) => ({
    key: skill.slug,
    name: skill.name,
    description: skill.description || '',
    source: SOURCE.CODE,
    aliases: [...(skill.aliases || [])],
    inputs: [...(skill.inputs || [])],
    requires: requirementDetail(skill),
    reads: [...(skill.reads || [])],
    emits: [...(skill.emits || [])],
    risk: riskOf(skill.emits || []),
    enabled: true,
    unavailable: unavailableOf(skill.slug, skill.reads || []),
    version: null,
});

const approvalEntry = (doc) => ({
    approval: doc.approval || null,
    createdBy: doc.createdBy || null,
    pendingChange: doc.pendingChange ? { requestedBy: doc.pendingChange.requestedBy, requestedAt: doc.pendingChange.requestedAt } : null,
});

const dataEntry = (doc) => ({
    key: doc.key,
    name: doc.name,
    description: doc.description || '',
    source: SOURCE.DATA,
    aliases: [],
    inputs: [...(doc.inputs || [])],
    requires: requirementDetail(doc),
    reads: (doc.gather || []).map((s) => s.reader),
    emits: [...(doc.emits || [])],
    risk: doc.risk || riskOf(doc.emits || []),
    model: doc.model || null,
    enabled: doc.enabled !== false,
    unavailable: unavailableOf(doc.key, (doc.gather || []).map((s) => s.reader)),
    version: doc.version,
    retiredAt: doc.retiredAt || null,
    updatedAt: doc.updatedAt || null,
    ...approvalEntry(doc),
});

/* The manifest: every data skill of the company and every code skill not
 * shadowed by a live data skill of the same key. */
const listSkills = async (companyId, options = {}) => {
    const data = await listData(companyId, options);
    const shadowed = new Set(data.filter(isLive).map((d) => d.key));
    return [...data.map(dataEntry), ...codeSkills.all().filter((s) => !shadowed.has(s.slug)).map(codeEntry)];
};

const invalid = (errors, message = 'The skill has errors.') => Object.assign(new Error(message), { status: 400, errors });

/* `approval` is set on a skill someone who is not an owner or admin wrote: it stays off until one of them approves it. */
const createSkill = async (companyId, input, { createdBy, approval = null } = {}) => {
    const checked = validateSkill(input);
    if (!checked.ok) throw invalid(checked.errors);
    const readErrors = await checkDeclaredReads(companyId, checked.value);
    if (readErrors.length) throw invalid(readErrors);
    const existing = await findData(companyId, checked.value.key);
    if (existing) throw invalid([{ field: 'key', code: 'duplicate', message: `a skill with key "${checked.value.key}" already exists` }]);
    const waits = approval ? { approval, enabled: false } : {};
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: { ...checked.value, createdBy: createdBy || null, ...waits } }, 'save'));
};

const EDITABLE = Object.freeze(['name', 'description', 'enabled', 'inputs', 'gather', 'prompt', 'emit', 'summary', 'fallback', 'grounded', 'risk', 'model']);

const checkedPatch = async (companyId, existing, patch) => {
    const merged = Object.fromEntries(EDITABLE.map((f) => [f, patch[f] !== undefined ? patch[f] : existing[f]]));
    const checked = validateSkill({ ...merged, key: existing.key });
    if (!checked.ok) throw invalid(checked.errors);
    const readErrors = await checkDeclaredReads(companyId, checked.value);
    if (readErrors.length) throw invalid(readErrors);
    const set = { ...checked.value };
    if (!set.declaredHosts && Array.isArray(existing.declaredHosts) && existing.declaredHosts.length) set.declaredHosts = [];
    return set;
};

const writeSkill = async (companyId, filter, update) => plainOf(await MongoDbCrudOpration(companyId, {
    type: SCHEMA_TYPE.AGENT_SKILLS, data: [filter, update, { returnDocument: 'after' }],
}, 'findOneAndUpdate'));

const APPROVAL_WAITS = Object.freeze(['pending', 'declined']);

/* `asks` is set for someone who is not an owner or admin. A live skill keeps running as it was and their change
 * waits as `pendingChange`; one not approved yet is changed in place and stays off, and a declined one waits again. */
const updateSkill = async (companyId, key, patch = {}, { asks = null } = {}) => {
    const existing = await findData(companyId, key);
    if (!existing) return null;
    const set = await checkedPatch(companyId, existing, patch);
    if (!asks) return writeSkill(companyId, { _id: existing._id }, { $set: set });
    if (existing.approval && APPROVAL_WAITS.includes(existing.approval.state)) {
        return writeSkill(companyId, { _id: existing._id }, { $set: { ...set, enabled: false, approval: asks } });
    }
    const change = { set: { ...set, enabled: existing.enabled !== false }, requestedBy: asks.requestedBy, requestedAt: asks.requestedAt };
    return writeSkill(companyId, { _id: existing._id }, { $set: { pendingChange: change } });
};

/* An owner or admin's answer. A new skill turns on or stays off; a waiting change is applied or dropped. The first answer wins. */
const decideSkill = async (companyId, key, { approve, actor, reason }) => {
    const existing = await findData(companyId, key);
    if (!existing) return { error: 'Skill not found.', status: 404 };
    const decided = { decidedBy: String(actor.userId), decidedAt: new Date(), reason: approve ? '' : String(reason || '').slice(0, 500) };
    const answered = { error: 'This request has already been answered.', status: 409 };
    if (existing.approval && existing.approval.state === 'pending') {
        const approval = { ...existing.approval, state: approve ? 'approved' : 'declined', ...decided };
        const saved = await writeSkill(companyId, { _id: existing._id, 'approval.state': 'pending' }, { $set: { approval, enabled: Boolean(approve) } });
        return saved ? { skill: saved, kind: 'skill', requestedBy: existing.approval.requestedBy } : answered;
    }
    if (existing.pendingChange) {
        const change = existing.pendingChange;
        const update = approve ? { $set: { ...change.set, pendingChange: null } } : { $set: { pendingChange: null } };
        const saved = await writeSkill(companyId, { _id: existing._id, 'pendingChange.requestedAt': change.requestedAt }, update);
        return saved ? { skill: saved, kind: 'change', requestedBy: change.requestedBy } : answered;
    }
    return { error: 'Nothing about this skill waits for an answer.', status: 409 };
};

const skillKeyOf = (entry) => (typeof entry === 'string' ? entry : String((entry && (entry.key || entry.slug || entry.name)) || ''));

/* A key that resolves to nothing is unknown unless a disabled or retired data
 * skill still holds it, which asks a different fix of the person saving. */
const checkAgentSkills = async (companyId, skills = []) => {
    const errors = [];
    for (const [i, entry] of skills.entries()) {
        const key = skillKeyOf(entry);
        const field = `skills[${i}].key`;
        // eslint-disable-next-line no-await-in-loop
        if (key && await getSkill(companyId, key)) continue;
        // eslint-disable-next-line no-await-in-loop
        const stored = key ? await findData(companyId, key) : null;
        const waiting = stored && stored.approval && APPROVAL_WAITS.includes(stored.approval.state);
        if (waiting) {
            errors.push({ field, code: 'skill_not_approved', message: `skill "${key}" is not approved yet` });
        } else {
            errors.push(stored
                ? { field, code: 'skill_disabled', message: `skill "${key}" is ${stored.retiredAt ? 'retired' : 'disabled'}` }
                : { field, code: 'unknown_skill', message: `unknown skill "${key}"` });
        }
    }
    return errors;
};

/* The named skills riskier than `cap` ('low' | 'medium' | 'high', or null for none), as { key, name, risk }. */
const skillsAboveRisk = async (companyId, skills = [], cap) => {
    const { riskWithin } = require('../../Config/aiRights');
    const over = [];
    for (const entry of skills) {
        const key = skillKeyOf(entry);
        // eslint-disable-next-line no-await-in-loop
        const skill = key ? await getSkill(companyId, key) : null;
        const risk = skill ? skill.risk || riskOf(skill.emits || []) : 'low';
        if (!riskWithin(cap, risk)) over.push({ key, name: (skill && skill.name) || key, risk });
    }
    return over;
};

const manifestSkill = async (agent, entry, resolve) => {
    const key = skillKeyOf(entry);
    const skill = key ? await resolve(key) : null;
    const own = entry && typeof entry === 'object' ? entry : {};
    const base = { key, name: String(own.name || (skill && skill.name) || key), enabled: own.enabled !== false };
    if (!skill) return { ...base, resolved: false, source: null, version: null, inputs: [], requires: null, emits: [], risk: null, effectiveActions: [], unavailable: null };
    const source = skill.source || SOURCE.CODE;
    return {
        ...base,
        resolved: true,
        source,
        version: source === SOURCE.DATA ? skill.version : null,
        inputs: [...(skill.inputs || [])],
        requires: requirementDetail(skill),
        emits: [...(skill.emits || [])],
        risk: skill.risk || riskOf(skill.emits || []),
        effectiveActions: effectiveActions(agent, skill),
        unavailable: unavailableOf(skill.slug || key, skill.reads || []),
    };
};

/* Agent documents with each named skill answered from the manifest: what it
 * needs, what it emits, and the actions this agent would actually let it take.
 * The stored entry's own fields survive, so a save round-trips unchanged. */
const enrichAgentSkills = async (companyId, agents = []) => {
    const resolved = new Map();
    const resolve = (key) => { if (!resolved.has(key)) resolved.set(key, getSkill(companyId, key)); return resolved.get(key); };
    return Promise.all(agents.map(plainOf).map(async (agent) => ({
        ...agent,
        skills: await Promise.all((Array.isArray(agent.skills) ? agent.skills : []).map(async (entry) => ({
            ...(entry && typeof entry === 'object' ? plainOf(entry) : {}),
            ...(await manifestSkill(agent, entry, resolve)),
        }))),
    })));
};

const agentManifest = async (companyId) => {
    const agents = (await MongoDbCrudOpration(companyId, {
        type: SCHEMA_TYPE.AGENTS,
        data: [{ deletedStatusKey: { $ne: 1 } }, {}, { sort: { createdAt: 1 } }],
    }, 'find')) || [];
    const resolved = new Map();
    const resolve = (key) => { if (!resolved.has(key)) resolved.set(key, getSkill(companyId, key)); return resolved.get(key); };
    return Promise.all(agents.map(plainOf).map(async (agent) => ({
        id: String(agent._id),
        name: agent.name,
        paused: Boolean(agent.paused),
        allowedActions: [...(agent.allowedActions || [])],
        skills: await Promise.all((Array.isArray(agent.skills) ? agent.skills : []).map((entry) => manifestSkill(agent, entry, resolve))),
    })));
};

/* Retired, never deleted: agents and saved rules still hold the key. */
const retireSkill = async (companyId, key) => {
    const existing = await findData(companyId, key);
    if (!existing) return null;
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ _id: existing._id }, { $set: { enabled: false, retiredAt: new Date() } }, { returnDocument: 'after' }] }, 'findOneAndUpdate'));
};

module.exports = { SOURCE, compile, taskView, contextOf, getSkill, listSkills, findData, createSkill, updateSkill, decideSkill, retireSkill, checkAgentSkills, skillsAboveRisk, agentManifest, enrichAgentSkills, validateSkill, catalogues };
