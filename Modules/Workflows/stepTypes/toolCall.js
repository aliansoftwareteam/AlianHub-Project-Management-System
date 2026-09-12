const executors = require('../executors');
const registry = require('../../Automations/engine/registry');
const { deterministic } = require('./graph');

// One registry action, called as a step.
//
// Config: { tool, params }
// Output: whatever the action returns, under { tool, result }
//
// The tools are the automation action registry, not a second catalogue: an
// action is already a described, schema-carrying, tenant-safe thing, and a
// workflow step that could call something the automation builder cannot would
// mean two lists of what the platform is allowed to do.
//
// The step is not made idempotent here — the engine already runs every step
// inside one audit-keyed action, so a redelivered tick replays the record rather
// than the effect.

const TYPE = 'tool_call';

const missing = (schema, params) => Object.entries(schema || {})
    .filter(([field, spec]) => spec.required && (params[field] === undefined || params[field] === null || params[field] === ''))
    .map(([field]) => field);

const execute = async ({ companyId, run, step, context = {} }) => {
    const config = step.config || {};
    const tool = registry.getAction(config.tool);
    if (!tool) throw deterministic(`tool call ${step.stepId}: unknown tool "${config.tool}" (have: ${registry.actionKeys().join(', ')})`);

    const params = config.params && typeof config.params === 'object' ? config.params : {};
    const absent = missing(tool.schema, params);
    if (absent.length) throw deterministic(`tool call ${step.stepId}: "${tool.key}" needs ${absent.join(', ')}`);

    const entity = run.entity || {};
    const result = await tool.run({
        companyId,
        entity,
        config: params,
        context: {
            ...context,
            task: entity.data || {},
            runId: String(run._id),
            ruleId: run.ruleId || null,
            ruleName: run.ruleName || run.name || '',
            traceId: run.traceId || null,
            action: `workflow.${tool.key}`,
        },
    });
    return { tool: tool.key, result: result || {} };
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute };
