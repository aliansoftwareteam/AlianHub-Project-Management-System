const executors = require('../executors');
const store = require('../store');
const { readField } = require('../../Automations/engine/expression');
const { waitUntil } = require('./waiting');
const { num, deterministic, contextFor } = require('./graph');

// Two shapes of the same idea: a step that is only ever late.
//
// wait  config: { forMs }            output: { waitedMs, until }
// timer config: { at | atFrom }      output: { waitedMs, until }
//
// A wait counts from the moment the step became runnable, which is its first
// claim — not from the run's start, so "wait an hour after the review finishes"
// means what it says. That moment is written on the row the first time through,
// because a worker that dies mid-wait must not restart the clock.

const WAIT = 'wait';
const TIMER = 'timer';

const untilFor = async (companyId, run, step, resolve) => {
    if (step.waitUntil) return new Date(step.waitUntil);
    return resolve(await store.outputsOf(companyId, run._id));
};

const settle = (step, until, reason) => {
    const now = new Date();
    if (until <= now) {
        const since = step.waitingSince ? new Date(step.waitingSince) : now;
        return { waitedMs: Math.max(0, now.getTime() - since.getTime()), until };
    }
    return waitUntil(reason, until, { set: step.waitingSince ? {} : { waitingSince: now } });
};

const hold = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const forMs = num(config.forMs, 0);
    if (!forMs) throw deterministic(`wait ${step.stepId}: needs a positive "forMs"`);
    const until = await untilFor(companyId, run, step, () => new Date(Date.now() + forMs));
    return settle(step, until, `waiting ${forMs}ms`);
};

const timer = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const until = await untilFor(companyId, run, step, (outputs) => {
        const raw = config.atFrom ? readField(config.atFrom, contextFor(run, outputs)) : config.at;
        const parsed = raw instanceof Date ? raw : new Date(raw);
        if (!raw || Number.isNaN(parsed.getTime())) throw deterministic(`timer ${step.stepId}: "${config.atFrom || config.at}" is not a moment`);
        return parsed;
    });
    return settle(step, until, `waiting until ${until.toISOString()}`);
};

executors.register(WAIT, hold);
executors.register(TIMER, timer);

module.exports = { WAIT, TIMER, hold, timer };
