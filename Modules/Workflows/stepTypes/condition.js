const executors = require('../executors');
const store = require('../store');
const { evaluate, validate } = require('../../Automations/engine/expression');
const { ids, deterministic, contextFor } = require('./graph');

// A branch, expressed as skipping the path not taken.
//
// Config: { when, then, else } — `when` is the same JSON condition AST automation
// rules use, never a string, so a tenant-authored condition can express nothing
// the operator table does not contain.
// Output: { matched, taken, skipped }
//
// There is no "branch" concept in the engine and there does not need to be: the
// scheduler already refuses to run a step whose dependency was skipped, and
// refuses transitively. So a condition that says no skips the head of the branch
// it rejected, and the whole tail of that branch settles itself.

const TYPE = 'condition';

const execute = async ({ companyId, run, step }) => {
    const config = step.config || {};
    const errors = validate(config.when, `${step.stepId}.when`);
    if (errors.length) throw deterministic(`condition ${step.stepId}: ${errors.join('; ')}`);

    const outputs = await store.outputsOf(companyId, run._id);
    const matched = Boolean(evaluate(config.when, contextFor(run, outputs)));

    const taken = matched ? ids(config.then) : ids(config.else);
    const dropped = matched ? ids(config.else) : ids(config.then);
    const skipped = [];
    for (const id of dropped) {
        // eslint-disable-next-line no-await-in-loop
        await store.skipStep(companyId, run._id, id, `skipped: ${step.stepId} was ${matched ? 'true' : 'false'}`);
        skipped.push(id);
    }
    return { matched, taken, skipped };
};

executors.register(TYPE, execute);

module.exports = { TYPE, execute };
