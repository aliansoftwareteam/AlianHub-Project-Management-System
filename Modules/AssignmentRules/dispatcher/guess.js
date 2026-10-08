const { isAnyProviderConfigured } = require('../../AICore/llmProvider');

// The model's guess at a role. No guesser ships yet: one is plugged in with `use`, and it is asked only with a server
// key set and the project's model guess switched on (./gate). It is given the task's title, type, tags and description
// and the role names, nothing else.

let guesser = null;

const use = (fn) => { guesser = typeof fn === 'function' ? fn : null; };

/* { role, confidence 0-100 } naming one of `roles`, or null. */
const guess = async ({ companyId, task, roles }) => {
    if (!guesser || !roles.length || !isAnyProviderConfigured()) return null;
    const answer = await guesser({ companyId, task, roles });
    if (!answer || !roles.some((role) => role.key === answer.role)) return null;
    const confidence = Math.max(0, Math.min(100, Number(answer.confidence) || 0));
    return { role: answer.role, confidence };
};

module.exports = { use, guess };
