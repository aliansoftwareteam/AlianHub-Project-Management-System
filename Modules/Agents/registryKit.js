const RISK = Object.freeze({ LOW: 'low', MEDIUM: 'medium', HIGH: 'high' });
const SCOPE = Object.freeze({ TASK: 'task', PROJECT: 'project', WORKSPACE: 'workspace' });
const read = (scope) => Object.freeze({ write: false, reversible: true, scope, money: false });
const write = (scope, reversible = true) => Object.freeze({ write: true, reversible, scope, money: false });

const group = (enabled, actions, ratings) => ({
    entries: actions.map((action) => ({ enabled, action: Object.freeze(action) })),
    ratings: Object.freeze(ratings),
});

module.exports = { RISK, SCOPE, read, write, group };
