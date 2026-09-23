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
});

/* The manifest: every data skill of the company and every code skill not
 * shadowed by a live data skill of the same key. */
const listSkills = async (companyId, options = {}) => {
    const data = await listData(companyId, options);
    const shadowed = new Set(data.filter(isLive).map((d) => d.key));
    return [...data.map(dataEntry), ...codeSkills.all().filter((s) => !shadowed.has(s.slug)).map(codeEntry)];
};

const invalid = (errors, message = 'The skill has errors.') => Object.assign(new Error(message), { status: 400, errors });

const createSkill = async (companyId, input, { createdBy } = {}) => {
    const checked = validateSkill(input);
    if (!checked.ok) throw invalid(checked.errors);
    const readErrors = await checkDeclaredReads(companyId, checked.value);
    if (readErrors.length) throw invalid(readErrors);
    const existing = await findData(companyId, checked.value.key);
    if (existing) throw invalid([{ field: 'key', code: 'duplicate', message: `a skill with key "${checked.value.key}" already exists` }]);
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: { ...checked.value, createdBy: createdBy || null } }, 'save'));
};

const EDITABLE = Object.freeze(['name', 'description', 'enabled', 'inputs', 'gather', 'prompt', 'emit', 'summary', 'fallback', 'grounded', 'risk', 'model']);

const updateSkill = async (companyId, key, patch = {}) => {
    const existing = await findData(companyId, key);
    if (!existing) return null;
    const merged = Object.fromEntries(EDITABLE.map((f) => [f, patch[f] !== undefined ? patch[f] : existing[f]]));
    const checked = validateSkill({ ...merged, key: existing.key });
    if (!checked.ok) throw invalid(checked.errors);
    const readErrors = await checkDeclaredReads(companyId, checked.value);
    if (readErrors.length) throw invalid(readErrors);
    const set = { ...checked.value };
    if (!set.declaredHosts && Array.isArray(existing.declaredHosts) && existing.declaredHosts.length) set.declaredHosts = [];
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ _id: existing._id }, { $set: set }, { returnDocument: 'after' }] }, 'findOneAndUpdate'));
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
        errors.push(stored
            ? { field, code: 'skill_disabled', message: `skill "${key}" is ${stored.retiredAt ? 'retired' : 'disabled'}` }
            : { field, code: 'unknown_skill', message: `unknown skill "${key}"` });
    }
    return errors;
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

module.exports = { SOURCE, compile, taskView, contextOf, getSkill, listSkills, findData, createSkill, updateSkill, retireSkill, checkAgentSkills, agentManifest, enrichAgentSkills, validateSkill, catalogues };
