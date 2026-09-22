// A skill document as the orchestrator's generic-skill contract:
// gather → buildUserPrompt → toChanges, with systemPrompt and maxTokens.
// The same function compiles a company's stored document and a built-in one,
// so a skill that ships with the product runs the path an admin's skill runs.

const registry = require('../registry');
const readers = require('./readers');
const externalReads = require('./externalReads');
const { riskOf } = require('./validateSkill');
const { ground } = require('./grounding');
const { INPUT_CATALOGUE, PROMPT_PARTIALS, EMIT_ACTIONS, EMIT_REQUIRED, TASK_FIELDS, TEMPLATE_ROOTS, plain } = require('./catalogues');
const { render, renderString, tagsIn } = require('./skillTemplate');
const { readField } = require('../../Automations/engine/expression');

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

const scopeOf = (action) => { const rating = require('../actions').rating(action); return rating ? rating.scope : 'task'; };

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
        if (!externalReads.enabled() && doc.gather.some((step) => externalReads.isExternal(step.reader))) throw externalReads.notAvailable(doc.key);
        const input = {};
        for (const key of doc.inputs) {
            const value = INPUT_CATALOGUE[key].value(task);
            if (value === null || value === undefined || value === '') return { skip: INPUT_CATALOGUE[key].missing(task) };
            input[key] = value;
        }
        const gather = {};
        for (const step of doc.gather) {
            // eslint-disable-next-line no-await-in-loop
            const out = await readers.read(step.reader, companyId, { task, memory, startedBy, input, declaredHosts: doc.declaredHosts || [] }, step.params);
            if (out && out.skip) return { skip: out.skip };
            gather[step.as] = out;
        }
        const context = { input, gather };
        if (doc.fallback) context.fallback = renderString(doc.fallback, contextOf(task, { input, gather, memory: memory || '' }));
        return context;
    },

    buildUserPrompt({ task, context }) {
        return renderString(doc.prompt.template, contextOf(task, { input: context.input || {}, gather: context.gather || {}, memory: context.memory || '' }));
    },

    ...(doc.grounded ? {
        verify({ raw, context }) {
            return ground(doc.grounded, raw, contextOf({}, { input: context.input || {}, gather: context.gather || {} }));
        },
    } : {}),

    toChanges({ task, raw, context }) {
        const answer = raw && typeof raw === 'object' ? raw : {};
        const gathered = { input: context.input || {}, gather: context.gather || {}, memory: context.memory || '', fallback: context.fallback || '' };
        const { changes, dropped, emitted } = changesOf(doc, { task, answer, gathered });
        const summary = (doc.summary
            ? renderString(doc.summary, contextOf(task, { ...gathered, answer, emitted }))
            : String(answer.summary || answer.digest || answer.nextStep || context.fallback || `Proposed ${changes.length} change(s).`)).slice(0, MAX_SUMMARY);
        return { summary, changes, dropped };
    },
});

module.exports = { SOURCE, compile, taskView, contextOf, MAX_SUMMARY };
