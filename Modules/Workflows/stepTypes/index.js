const executors = require('../executors');
const flag = require('../flag');
const { validate: validateCondition } = require('../../Automations/engine/expression');
const agentRun = require('./agentRun');
const toolCall = require('./toolCall');
const approval = require('./approval');
const fanOut = require('./fanOut');
const condition = require('./condition');
const wait = require('./wait');
const loop = require('./loop');
const waiting = require('./waiting');

// The step types, and what each one is.
//
// Requiring this file is what registers them; CONTRACTS is the same idea the
// automation registry has — the manifest a builder draws its forms from and a
// validator reads its rules from, so a new step type is one file and one entry
// rather than a form somebody has to hand-write.

const CONTRACTS = Object.freeze([
    {
        key: agentRun.TYPE,
        label: 'Run an agent',
        config: {
            agentId: { type: 'agent', label: 'Agent', required: true },
            skill: { type: 'text', label: 'Skill' },
            input: { type: 'object', label: 'Input' },
            taskId: { type: 'text', label: 'Task' },
            projectId: { type: 'text', label: 'Project' },
            deadlineMs: { type: 'duration', label: 'Deadline' },
            budgetUsd: { type: 'number', label: 'Budget (USD)' },
        },
        output: ['agentRunId', 'status', 'costUsd', 'findings'],
    },
    {
        key: toolCall.TYPE,
        label: 'Call a tool',
        config: {
            tool: { type: 'action', label: 'Tool', required: true },
            params: { type: 'object', label: 'Parameters' },
        },
        output: ['tool', 'result'],
    },
    {
        key: approval.TYPE,
        label: 'Ask a person',
        config: {
            title: { type: 'text', label: 'Title' },
            prompt: { type: 'text', label: 'What is being asked' },
            ownerUserId: { type: 'user', label: 'Owner' },
            ownerRole: { type: 'text', label: 'Owning role' },
            escalateToUserId: { type: 'user', label: 'Escalate to' },
            escalateAfterMs: { type: 'duration', label: 'Escalate after' },
            deadlineMs: { type: 'duration', label: 'Deadline' },
            onDeadline: { type: 'select', label: 'On the deadline', options: ['fail', 'approve', 'reject'] },
            onReject: { type: 'select', label: 'If refused', options: ['skip', 'continue'] },
        },
        output: ['approvalId', 'decision', 'decidedBy', 'decidedAt', 'escalated'],
    },
    {
        key: fanOut.FAN_OUT,
        label: 'Fan out',
        config: {
            items: { type: 'list', label: 'Items' },
            itemsFrom: { type: 'text', label: 'Items from a step output' },
            type: { type: 'step_type', label: 'What each child is', required: true },
            config: { type: 'object', label: 'Child configuration' },
            maxChildren: { type: 'number', label: 'At most', max: flag.maxFanOut() },
        },
        output: ['children', 'count'],
    },
    {
        key: fanOut.FAN_IN,
        label: 'Join',
        config: {
            from: { type: 'step', label: 'The fan-out it joins', required: true },
            onChildFailure: { type: 'select', label: 'If a child fails', options: ['fail', 'continue'] },
        },
        output: ['total', 'succeeded', 'failed', 'results'],
    },
    {
        key: condition.TYPE,
        label: 'Branch',
        config: {
            when: { type: 'condition', label: 'When', required: true },
            then: { type: 'steps', label: 'Then' },
            else: { type: 'steps', label: 'Otherwise' },
        },
        output: ['matched', 'taken', 'skipped'],
    },
    {
        key: wait.WAIT,
        label: 'Wait',
        config: { forMs: { type: 'duration', label: 'For', required: true } },
        output: ['waitedMs', 'until'],
    },
    {
        key: wait.TIMER,
        label: 'Wait until',
        config: {
            at: { type: 'datetime', label: 'Until' },
            atFrom: { type: 'text', label: 'Until, from a step output' },
        },
        output: ['waitedMs', 'until'],
    },
    {
        key: loop.TYPE,
        label: 'Repeat',
        config: {
            body: { type: 'steps', label: 'Repeat these', required: true },
            maxIterations: { type: 'number', label: 'At most', max: flag.maxLoopIterations() },
            budgetUsd: { type: 'number', label: 'Budget (USD)' },
            while: { type: 'condition', label: 'While' },
        },
        output: ['iterations', 'stoppedBy', 'budgetUsedUsd'],
    },
]);

const BY_KEY = new Map(CONTRACTS.map((contract) => [contract.key, contract]));

const get = (type) => BY_KEY.get(String(type)) || null;

const manifest = () => ({
    stepTypes: CONTRACTS,
    bounds: { maxFanOut: flag.maxFanOut(), maxLoopIterations: flag.maxLoopIterations() },
});

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const stepIdsIn = (value) => (Array.isArray(value) ? value.map(String) : []);

/* A step output is read as `$<stepId>.field`, and the expression language only
 * recognises that form when the id begins with "s" — anything else silently
 * reads a task field that is not there, which is the worst kind of wrong: a
 * condition that is quietly always false. So a reference is checked against the
 * ids in the definition here, at save time, rather than discovered in a run. */
const STEP_REF = /^\$([0-9a-zA-Z_-]+)/;

const checkRef = (value, ids, path, errors) => {
    if (typeof value !== 'string' || !value.startsWith('$')) return;
    const [, id] = value.match(STEP_REF) || [];
    if (!id || !ids.has(id)) errors.push(`${path}: no step "${id || value}" in this workflow`);
    else if (!/^s/i.test(id)) errors.push(`${path}: a step read as "$${id}" must have an id beginning with "s"`);
};

const checkRefsIn = (node, ids, path, errors, depth = 0) => {
    if (!isPlainObject(node) || depth > 10) return;
    if (Array.isArray(node.args)) node.args.forEach((child, i) => checkRefsIn(child, ids, `${path}.args[${i}]`, errors, depth + 1));
    checkRef(node.field, ids, `${path}.field`, errors);
};

/* Field-level errors, like the rule validator's, so a builder can mark the slot
 * that is wrong rather than refusing a whole definition with one sentence. */
const validateSteps = (steps = []) => {
    const errors = [];
    const list = Array.isArray(steps) ? steps : [];
    const ids = new Set(list.map((step) => step && String(step.id)).filter(Boolean));

    list.forEach((step, i) => {
        const at = `steps[${i}]`;
        if (!isPlainObject(step)) { errors.push(`${at}: must be an object`); return; }
        if (!step.id) errors.push(`${at}.id: required`);
        const contract = get(step.type);
        if (!contract) {
            if (!executors.has(step.type)) errors.push(`${at}.type: unknown step type "${step.type}"`);
            return;
        }

        const config = isPlainObject(step.config) ? step.config : {};
        Object.entries(contract.config).forEach(([field, spec]) => {
            const value = config[field];
            if (spec.required && (value === undefined || value === null || value === '')) errors.push(`${at}.config.${field}: required by "${contract.key}"`);
            if (spec.options && value && !spec.options.includes(value)) errors.push(`${at}.config.${field}: must be one of ${spec.options.join(', ')}`);
            if (spec.max && Number(value) > spec.max) errors.push(`${at}.config.${field}: at most ${spec.max}`);
        });

        stepIdsIn(step.dependsOn).forEach((id) => {
            if (!ids.has(id)) errors.push(`${at}.dependsOn: no step "${id}" in this workflow`);
        });

        if (step.type === condition.TYPE) {
            errors.push(...validateCondition(config.when, `${at}.config.when`));
            checkRefsIn(config.when, ids, `${at}.config.when`, errors);
            [...stepIdsIn(config.then), ...stepIdsIn(config.else)].forEach((id) => {
                if (!ids.has(id)) errors.push(`${at}.config: no step "${id}" in this workflow`);
            });
        }

        if (step.type === fanOut.FAN_OUT) {
            if (!Array.isArray(config.items) && !config.itemsFrom) errors.push(`${at}.config: needs "items" or "itemsFrom"`);
            if (config.type && !executors.has(config.type)) errors.push(`${at}.config.type: no executor for child type "${config.type}"`);
            if (config.type === fanOut.FAN_OUT) errors.push(`${at}.config.type: a fan-out cannot expand into fan-outs`);
            checkRef(config.itemsFrom, ids, `${at}.config.itemsFrom`, errors);
        }

        if (step.type === fanOut.FAN_IN) {
            const from = list.find((other) => other && String(other.id) === String(config.from));
            if (!from) errors.push(`${at}.config.from: no step "${config.from}" in this workflow`);
            else if (from.type !== fanOut.FAN_OUT) errors.push(`${at}.config.from: "${config.from}" is a ${from.type}, not a fan-out`);
            if (!stepIdsIn(step.dependsOn).includes(String(config.from))) errors.push(`${at}.dependsOn: a join must depend on the fan-out it joins`);
        }

        if (step.type === loop.TYPE) {
            const body = stepIdsIn(config.body);
            if (!body.length) errors.push(`${at}.config.body: at least one step`);
            body.forEach((id) => { if (!ids.has(id)) errors.push(`${at}.config.body: no step "${id}" in this workflow`); });
            if (body.includes(String(step.id))) errors.push(`${at}.config.body: a loop cannot repeat itself`);
            if (config.while) {
                errors.push(...validateCondition(config.while, `${at}.config.while`));
                checkRefsIn(config.while, ids, `${at}.config.while`, errors);
            }
        }

        if (step.type === wait.TIMER) {
            if (!config.at && !config.atFrom) errors.push(`${at}.config: needs "at" or "atFrom"`);
            checkRef(config.atFrom, ids, `${at}.config.atFrom`, errors);
        }
    });

    const seen = list.map((step) => step && step.id).filter(Boolean);
    if (new Set(seen).size !== seen.length) errors.push('steps: step ids must be unique');

    return { valid: errors.length === 0, errors };
};

module.exports = {
    CONTRACTS,
    TYPES: Object.freeze(CONTRACTS.map((contract) => contract.key)),
    get,
    manifest,
    validateSteps,
    blockedReason: waiting.blockedReason,
    waitingOn: waiting.waitingOn,
    AGENT_RUN: agentRun.TYPE,
    TOOL_CALL: toolCall.TYPE,
    HUMAN_APPROVAL: approval.TYPE,
    FAN_OUT: fanOut.FAN_OUT,
    FAN_IN: fanOut.FAN_IN,
    CONDITION: condition.TYPE,
    WAIT: wait.WAIT,
    TIMER: wait.TIMER,
    LOOP: loop.TYPE,
};
