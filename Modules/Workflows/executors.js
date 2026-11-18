// What a step type actually does, behind an interface.
//
// The engine knows how to claim a step, lease it, retry it and record it; it
// knows nothing about what the step is. Sprint 5 step 1 registers exactly one
// executor — the automation rule that is today's one-node workflow — and the
// step types the rest of the sprint adds (approval, fan-out, condition, wait,
// loop, agent run) register here without the engine changing.
//
// An executor is `async ({ companyId, run, step, claim, context }) => output`.
// Throwing is how it fails; `error.deterministic` is how it says whether that
// failure is worth retrying, and a provider error carries its own answer.

const executors = new Map();

const register = (type, executor) => {
    if (typeof executor !== 'function') throw new Error(`workflow executor "${type}" must be a function`);
    executors.set(String(type), executor);
    return executor;
};

const get = (type) => executors.get(String(type)) || null;

const has = (type) => executors.has(String(type));

const types = () => [...executors.keys()];

const unregister = (type) => executors.delete(String(type));

/* Kept apart from the executors so a step that started under a switch still cleans up after the switch goes off. */
const endings = new Map();

const onEnd = (type, ending) => {
    if (typeof ending !== 'function') throw new Error(`workflow step ending "${type}" must be a function`);
    endings.set(String(type), ending);
};

/* Told whenever a step ends without succeeding (failed, skipped, refused, or its run ended under it). Must be safe to call twice. */
const ended = async ({ companyId, run, step, why }) => {
    const ending = step ? endings.get(String(step.type)) : null;
    return ending ? ending({ companyId, run, step, why: String(why || '') }) : null;
};

module.exports = { register, get, has, types, unregister, onEnd, ended };
