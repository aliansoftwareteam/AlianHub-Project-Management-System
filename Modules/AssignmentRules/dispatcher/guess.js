const { isAnyProviderConfigured } = require('../../AICore/llmProvider');
const { modelGuesser } = require('./modelGuesser');

// The model's guess at a role, asked only with a server key set and the project's model guess switched on (./gate).
// It is given the task's title, type, tags and description and each enabled role's name and 'who it is', nothing else.
// `use` swaps the guesser; tests use it to stand in for the model.

let guesser = modelGuesser;

const use = (fn) => { guesser = typeof fn === 'function' ? fn : null; };

/* { role, confidence 0-100, reason } naming one of `roles`, or null. */
const guess = async ({ companyId, task, roles }) => {
    if (!guesser || !roles.length || !isAnyProviderConfigured()) return null;
    const answer = await guesser({ companyId, task, roles });
    if (!answer || !roles.some((role) => role.key === answer.role)) return null;
    const confidence = Math.max(0, Math.min(100, Number(answer.confidence) || 0));
    return { role: answer.role, confidence, reason: String(answer.reason || '') };
};

module.exports = { use, guess };
