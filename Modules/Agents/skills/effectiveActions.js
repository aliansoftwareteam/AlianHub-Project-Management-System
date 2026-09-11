// What a skill may actually change when an agent runs it: the skill's emits,
// cut to the agent's allowed actions and to the registry's writes. Code skills
// and data skills, the engine, the manifest and save-time checks all read it here.

const registry = require('../registry');

const isEmittable = (key) => {
    if (registry.isNever(key)) return false;
    const action = registry.get(key);
    return Boolean(action && action.write);
};

/* An agent with no allowed actions is un-narrowed, the same reading registry.evaluate gives it. */
const allowedSetOf = (agent) => (agent && Array.isArray(agent.allowedActions) && agent.allowedActions.length ? new Set(agent.allowedActions.map(String)) : null);

const effectiveActions = (agent, skill) => {
    const emits = skill && Array.isArray(skill.emits) ? skill.emits.map(String) : [];
    const allowed = allowedSetOf(agent);
    return [...new Set(emits)].filter((key) => isEmittable(key) && (!allowed || allowed.has(key)));
};

const reasonOutside = (agent, skill, action) => {
    if (!isEmittable(action)) return `${action} is not an action an agent can emit`;
    const declared = skill && Array.isArray(skill.emits) ? skill.emits.map(String) : [];
    if (!declared.includes(action)) return `${action} is not an action this skill declares`;
    return `${action} is outside this agent's allowed actions`;
};

const narrowChanges = (agent, skill, changes) => {
    const effective = new Set(effectiveActions(agent, skill));
    const kept = [];
    const dropped = [];
    (Array.isArray(changes) ? changes : []).forEach((change) => {
        const action = String((change && change.action) || '');
        if (effective.has(action)) { kept.push(change); return; }
        dropped.push({ text: (change && change.label) || action, reason: reasonOutside(agent, skill, action) });
    });
    return { changes: kept, dropped };
};

module.exports = { effectiveActions, narrowChanges };
