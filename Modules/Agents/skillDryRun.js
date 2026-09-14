// A skill tried against one real task without a run: resolve it, gather what it
// would read, render the prompt it would send, and state the risk from the union
// of the actions it emits. The model is never called and nothing is written, so
// an author can check a skill on an instance with no provider configured.

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const registry = require('./registry');
const scope = require('./scope');
const skillRecord = require('./skillRecord');
const orchestrator = require('./engine/orchestrator');
const { effectiveActions } = require('./skills/effectiveActions');
const { riskOf } = require('./skills/validateSkill');
const { missingInputFor } = require('./skills/inputRules');

const MAX_PROMPT = 8000;
const MAX_VALUE = 1200;

const oid = (id) => { try { return new mongoose.Types.ObjectId(String(id)); } catch (e) { return null; } };

const plainOf = (doc) => (doc && typeof doc.toObject === 'function' ? doc.toObject() : doc);

const loadTask = async (companyId, taskId, uid) => {
    const _id = oid(taskId);
    if (!_id) return null;
    const task = plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.TASKS, data: [{ _id, deletedStatusKey: { $ne: 1 } }] }, 'findOne'));
    if (!task) return null;
    const visible = await scope.visibleProjectIds(companyId, uid);
    return visible.includes(String(task.ProjectID)) ? task : null;
};

const loadAgent = async (companyId, agentId) => {
    const _id = oid(agentId);
    if (!_id) return null;
    return plainOf(await MongoDbCrudOpration(companyId, { type: SCHEMA_TYPE.AGENTS, data: [{ _id, deletedStatusKey: { $ne: 1 } }] }, 'findOne'));
};

const actionRow = (key) => {
    const action = registry.get(key);
    return { key, label: (action && action.label) || key, risk: (action && action.risk) || 'low', undoable: Boolean(action && action.undoable) };
};

/* Gathered values are shown to the author, so long reads are clipped rather than
 * returned whole; the point is to see that a reader answered, not to page it. */
const clip = (value) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
    if (Array.isArray(value)) return value.slice(0, 20).map(clip);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([k, v]) => [k, clip(v)]));
    return value;
};

const notFound = (what) => Object.assign(new Error(what === 'skill' ? 'Skill not found.' : 'Task not found.'), { statusCode: 404 });

const dryRun = async (companyId, key, { taskId, agentId, uid } = {}) => {
    const skill = await skillRecord.getSkill(companyId, key);
    if (!skill) throw notFound('skill');
    const task = await loadTask(companyId, taskId, uid);
    if (!task) throw notFound('task');
    const agent = agentId ? await loadAgent(companyId, agentId) : null;

    const emits = [...new Set((skill.emits || []).map(String))];
    const effective = agent ? effectiveActions(agent, skill) : emits;
    const preview = {
        skill: {
            key: skill.slug || skill.key,
            name: skill.name,
            source: skill.source || skillRecord.SOURCE.CODE,
            version: skill.version || null,
            model: skill.model || null,
            inputs: [...(skill.inputs || [])],
            reads: [...(skill.reads || [])],
        },
        task: { id: String(task._id), key: task.TaskKey || '', name: task.TaskName || '', projectId: String(task.ProjectID || '') },
        agent: agent ? { id: String(agent._id), name: agent.name || '', allowedActions: [...(agent.allowedActions || [])] } : null,
        risk: skill.risk || riskOf(emits),
        actions: emits.map(actionRow),
        effectiveActions: effective,
        outsideAgent: emits.filter((a) => !effective.includes(a)),
        missingInput: missingInputFor({ inputs: skill.inputs }, task),
    };

    const gathered = await orchestrator.gather({ skillSlug: preview.skill.key, task, companyId, startedBy: uid });
    if (gathered.status !== orchestrator.GATHERED) {
        return { ...preview, ran: false, skipped: gathered.reason || 'nothing to work on', gathered: null, prompt: null };
    }

    const context = gathered.context || {};
    // The page audit builds its prompt from a fetched page, which a dry run does
    // not perform; only a generic skill can be asked what it would send.
    const prompt = skill.kind === 'generic' && typeof skill.buildUserPrompt === 'function'
        ? { system: String(skill.systemPrompt || '').slice(0, MAX_PROMPT), user: String(skill.buildUserPrompt({ task, context }) || '').slice(0, MAX_PROMPT), maxTokens: skill.maxTokens || null }
        : null;

    return { ...preview, ran: true, skipped: null, gathered: clip(context), prompt };
};

module.exports = { dryRun };
