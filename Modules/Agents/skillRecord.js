// The agent_skills record: a per-company skill written in the closed
// vocabulary (skills/catalogues.js), compiled here into the same generic-skill
// shape the orchestrator runs a code skill through. Resolution is hybrid: a
// company's data skill first, the built-in code skill second.

const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('./registry');
const codeSkills = require('./skills');
const readers = require('./skills/readers');
const { validateSkill, riskOf } = require('./skills/validateSkill');
const { effectiveActions } = require('./skills/effectiveActions');
const { INPUT_CATALOGUE, PROMPT_PARTIALS, EMIT_ACTIONS, EMIT_REQUIRED, TASK_FIELDS, TEMPLATE_ROOTS, catalogues, plain } = require('./skills/catalogues');
const { render, renderString, tagsIn } = require('./skills/skillTemplate');
const { readField } = require('../Automations/engine/expression');

const SOURCE = Object.freeze({ DATA: 'data', CODE: 'code' });
const MAX_SUMMARY = 1500;

/* The task as a template may see it: the whitelisted fields, description as
 * plain text, nothing else. The renderer's own whitelist reads everything
 * under `task`, so the view is the only object handed to it. */
const taskView = (task = {}) => {
    const view = {};
    TASK_FIELDS.forEach((path) => {
        const [head, tail] = path.split('.');
        const value = tail ? task[head] && task[head][tail] : task[head];
        if (value === undefined) return;
        if (tail) { view[head] = { ...(view[head] || {}), [tail]: value }; return; }
        view[head] = head === 'description' ? plain(value) : (head === '_id' ? String(value) : value);
    });
    return view;
};

const contextOf = (task, extra = {}) => ({ task: { ...taskView(task), ...extra } });

const systemPromptOf = (doc) => [
    ...doc.prompt.partials.map((name) => PROMPT_PARTIALS[name]).filter(Boolean),
    doc.prompt.instructions,
    `Return ONLY JSON:\n${doc.prompt.output}`,
].filter(Boolean).join('\n\n');

const usesMemory = (doc) => [doc.prompt.template, doc.prompt.instructions].some((text) => tagsIn(text).some((tag) => tag.path.replace(/^task\./, '') === TEMPLATE_ROOTS.memory))
    || doc.gather.some((step) => step.reader === 'memory');

const scopeOf = (action) => { const rating = require('./actions').rating(action); return rating ? rating.scope : 'task'; };

const fillIds = (action, params, task) => {
    const out = { ...params };
    const scope = scopeOf(action);
    if (scope === 'task' && out.taskId === undefined) out.taskId = String(task._id);
    if (scope === 'project' && out.projectId === undefined && task.ProjectID) out.projectId = String(task.ProjectID);
    return out;
};

const emptyRequired = (action, params) => (EMIT_REQUIRED[action] || []).find((name) => params[name] === undefined || params[name] === null || params[name] === '' || (Array.isArray(params[name]) && !params[name].length));

const changeOf = (mapping, ctx, task) => {
    const params = fillIds(mapping.action, render(mapping.params, ctx), task);
    const missing = emptyRequired(mapping.action, params);
    if (missing) return { dropped: { reason: `"${missing}" rendered empty for ${mapping.action}`, text: mapping.label || mapping.action } };
    const entry = registry.get(mapping.action);
    const label = (mapping.label ? renderString(mapping.label, ctx) : '').trim() || entry.label;
    return { change: { action: mapping.action, label: label.slice(0, 200), reversible: Boolean(entry.undoable), params } };
};

const zeroCounts = () => {
    const counts = {};
    EMIT_ACTIONS.forEach((key) => { const parts = key.split('.'); const last = parts.pop(); parts.reduce((node, k) => { node[k] = node[k] || {}; return node[k]; }, counts)[last] = 0; });
    return counts;
};

const countOf = (counts, action) => { const parts = action.split('.'); const last = parts.pop(); parts.reduce((node, k) => node[k], counts)[last] += 1; };

const changesOf = (doc, { task, answer, gathered }) => {
    const changes = [];
    const dropped = [];
    const emitted = zeroCounts();
    const keep = (out) => {
        if (!out.change) { dropped.push(out.dropped); return; }
        changes.push(out.change);
        countOf(emitted, out.change.action);
    };
    doc.emit.forEach((mapping) => {
        const base = { ...gathered, answer, emitted };
        if (!mapping.each) { keep(changeOf(mapping, contextOf(task, base), task)); return; }
        const items = readField(mapping.each, contextOf(task, base));
        (Array.isArray(items) ? items : []).slice(0, mapping.max).forEach((item) => {
            keep(changeOf(mapping, contextOf(task, { ...base, item: item && typeof item === 'object' ? item : { value: item } }), task));
        });
    });
    return { changes, dropped, emitted };
};

/* A stored document as the orchestrator's generic-skill contract:
 * gather → buildUserPrompt → toChanges, with systemPrompt and maxTokens. */
const compile = (doc) => ({
    slug: doc.key,
    key: doc.key,
    name: doc.name,
    description: doc.description || '',
    kind: 'generic',
    source: SOURCE.DATA,
    version: doc.version,
    risk: doc.risk || riskOf(doc.emits || []),
    model: doc.model || null,
    inputs: [...(doc.inputs || [])],
    emits: [...(doc.emits || [])],
    reads: (doc.gather || []).map((s) => s.reader),
    enabled: doc.enabled !== false,
    maxTokens: doc.prompt.maxTokens || 2500,
    usesMemory: usesMemory(doc),
    systemPrompt: systemPromptOf(doc),

    async gather({ task, companyId, memory, startedBy }) {
        const input = {};
        for (const key of doc.inputs) {
            const value = INPUT_CATALOGUE[key].value(task);
            if (value === null || value === undefined || value === '') return { skip: INPUT_CATALOGUE[key].missing(task) };
            input[key] = value;
        }
        const gather = {};
        for (const step of doc.gather) {
            // eslint-disable-next-line no-await-in-loop
            const out = await readers.read(step.reader, companyId, { task, memory, startedBy }, step.params);
            if (out && out.skip) return { skip: out.skip };
            gather[step.as] = out;
        }
        return { input, gather };
    },

    buildUserPrompt({ task, context }) {
        return renderString(doc.prompt.template, contextOf(task, { input: context.input || {}, gather: context.gather || {}, memory: context.memory || '' }));
    },

    toChanges({ task, raw, context }) {
        const answer = raw && typeof raw === 'object' ? raw : {};
        const gathered = { input: context.input || {}, gather: context.gather || {}, memory: context.memory || '' };
        const { changes, dropped, emitted } = changesOf(doc, { task, answer, gathered });
        const summary = (doc.summary
            ? renderString(doc.summary, contextOf(task, { ...gathered, answer, emitted }))
            : String(answer.summary || answer.digest || answer.nextStep || `Proposed ${changes.length} change(s).`)).slice(0, MAX_SUMMARY);
        return { summary, changes, dropped };
    },
});

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
    reads: [...(skill.reads || [])],
    emits: [...(skill.emits || [])],
    risk: riskOf(skill.emits || []),
    enabled: true,
    version: null,
});

const dataEntry = (doc) => ({
    key: doc.key,
    name: doc.name,
    description: doc.description || '',
    source: SOURCE.DATA,
    aliases: [],
    inputs: [...(doc.inputs || [])],
    reads: (doc.gather || []).map((s) => s.reader),
    emits: [...(doc.emits || [])],
    risk: doc.risk || riskOf(doc.emits || []),
    model: doc.model || null,
    enabled: doc.enabled !== false,
    version: doc.version,
    retiredAt: doc.retiredAt || null,
    updatedAt: doc.updatedAt || null,
});

/* The manifest: every data skill of the company and every code skill not
 * shadowed by a live data skill of the same key. */
const listSkills = async (companyId, options = {}) => {
    const data = await listData(companyId, options);
    const shadowed = new Set(data.filter(isLive).map((d) => d.key));
    return [...data.map(dataEntry), ...codeSkills.ALL.filter((s) => !shadowed.has(s.slug)).map(codeEntry)];
};

const invalid = (errors, message = 'The skill has errors.') => Object.assign(new Error(message), { status: 400, errors });

const createSkill = async (companyId, input, { createdBy } = {}) => {
    const checked = validateSkill(input);
    if (!checked.ok) throw invalid(checked.errors);
    const existing = await findData(companyId, checked.value.key);
    if (existing) throw invalid([{ field: 'key', code: 'duplicate', message: `a skill with key "${checked.value.key}" already exists` }]);
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: { ...checked.value, createdBy: createdBy || null } }, 'save'));
};

const EDITABLE = Object.freeze(['name', 'description', 'enabled', 'inputs', 'gather', 'prompt', 'emit', 'summary', 'risk', 'model']);

const updateSkill = async (companyId, key, patch = {}) => {
    const existing = await findData(companyId, key);
    if (!existing) return null;
    const merged = Object.fromEntries(EDITABLE.map((f) => [f, patch[f] !== undefined ? patch[f] : existing[f]]));
    const checked = validateSkill({ ...merged, key: existing.key });
    if (!checked.ok) throw invalid(checked.errors);
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENT_SKILLS, data: [{ _id: existing._id }, { $set: checked.value }, { returnDocument: 'after' }] }, 'findOneAndUpdate'));
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
    if (!skill) return { ...base, resolved: false, source: null, version: null, emits: [], effectiveActions: [] };
    const source = skill.source || SOURCE.CODE;
    return { ...base, resolved: true, source, version: source === SOURCE.DATA ? skill.version : null, emits: [...(skill.emits || [])], effectiveActions: effectiveActions(agent, skill) };
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

module.exports = { SOURCE, compile, taskView, contextOf, getSkill, listSkills, findData, createSkill, updateSkill, retireSkill, checkAgentSkills, agentManifest, validateSkill, catalogues };
