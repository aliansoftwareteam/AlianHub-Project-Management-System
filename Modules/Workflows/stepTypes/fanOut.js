const executors = require('../executors');
const store = require('../store');
const flag = require('../flag');
const { readField } = require('../../Automations/engine/expression');
const { waitFor } = require('./waiting');
const { num, deterministic, contextFor } = require('./graph');

// Fan-out and fan-in: one step becomes N, and one step waits for all of them.
//
// fan_out config: { items | itemsFrom, type, config, maxChildren, maxAttempts }
// fan_out output: { children, count }
// fan_in  config: { from, onChildFailure, pollMs }
// fan_in  output: { total, succeeded, failed, results }
//
// The children are real step rows, written when the fan-out runs: they claim,
// lease, retry and record exactly as a step the definition named, so the engine
// needs to know nothing about fan-out at all. They depend on the step that
// expanded them, and the join depends on that same step, which is what lets the
// join exist in a definition written before anybody knew how many children there
// would be.
//
// The fan is bounded, and over the bound is a failure rather than a truncation:
// a workflow that quietly did nine of a hundred things is worse than one that
// said it would not.

const FAN_OUT = 'fan_out';
const FAN_IN = 'fan_in';

const RUNNING = Object.freeze(['pending', 'running']);

const itemsFor = async (companyId, run, step) => {
    const config = step.config || {};
    if (Array.isArray(config.items)) return config.items;
    if (typeof config.itemsFrom === 'string' && config.itemsFrom) {
        const outputs = await store.outputsOf(companyId, run._id);
        const value = readField(config.itemsFrom, contextFor(run, outputs));
        if (!Array.isArray(value)) throw deterministic(`fan-out ${step.stepId}: "${config.itemsFrom}" is not a list`);
        return value;
    }
    throw deterministic(`fan-out ${step.stepId}: needs "items" or "itemsFrom"`);
};

const expand = async ({ companyId, run, step }) => {
    const config = step.config || {};
    if (!config.type) throw deterministic(`fan-out ${step.stepId}: needs the "type" its children are`);
    if (!executors.has(config.type)) throw deterministic(`fan-out ${step.stepId}: no executor is registered for child type "${config.type}"`);

    const existing = await store.listChildren(companyId, run._id, step.stepId);
    if (existing.length) return { children: existing.map((child) => String(child.stepId)), count: existing.length, reused: true };

    const items = await itemsFor(companyId, run, step);
    const bound = Math.min(num(config.maxChildren, flag.maxFanOut()), flag.maxFanOut());
    if (items.length > bound) throw deterministic(`fan-out ${step.stepId}: ${items.length} items is over the bound of ${bound}`);

    const rows = store.childRowsFor(run._id, step, items, { type: config.type, config: config.config || {}, maxAttempts: config.maxAttempts });
    await store.addSteps(companyId, rows);
    return { children: rows.map((row) => row.stepId), count: rows.length };
};

const join = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const from = String(config.from || '');
    if (!from) throw deterministic(`fan-in ${step.stepId}: needs the "from" step it joins`);

    const children = await store.listChildren(companyId, run._id, from);
    const outstanding = children.filter((child) => RUNNING.includes(child.status));
    if (outstanding.length) {
        return waitFor(
            `waiting for ${outstanding.length} of ${children.length} ${from} children`,
            num(config.pollMs, flag.joinPollMs()),
            { set: step.waitingSince ? {} : { waitingSince: new Date() } },
        );
    }

    const results = children.map((child) => ({ stepId: String(child.stepId), status: child.status, output: child.output || {} }));
    const failed = results.filter((child) => child.status !== 'success');
    if (failed.length && config.onChildFailure !== 'continue') {
        throw deterministic(`fan-in ${step.stepId}: ${failed.map((child) => `${child.stepId} is ${child.status}`).join(', ')}`);
    }
    return { total: results.length, succeeded: results.length - failed.length, failed: failed.length, results };
};

executors.register(FAN_OUT, expand);
executors.register(FAN_IN, join);

module.exports = { FAN_OUT, FAN_IN, expand, join };
