const registry = require('../Modules/Agents/registry');
const policy = require('../Modules/Agents/policy');

const neverMatches = (key) => registry.NEVER.some((n) => n === key || (n.endsWith('.*') && key.startsWith(n.slice(0, -1))));

describe('never-list vs action table', () => {
    it('no registered action key is on the never-list, exactly or under a wildcard', () => {
        const overlap = registry.ACTIONS.map((a) => a.key).filter(neverMatches);
        expect(overlap).toEqual([]);
    });

    it('every never-list entry has no counterpart in the action table', () => {
        const keys = registry.keys();
        const reachable = registry.NEVER.filter((n) => (n.endsWith('.*')
            ? keys.some((k) => k.startsWith(n.slice(0, -1)))
            : keys.includes(n)));
        expect(reachable).toEqual([]);
    });

    it('isNever matches exact keys and wildcard prefixes only', () => {
        expect(registry.isNever('project.delete')).toBe(true);
        expect(registry.isNever('billing.refund')).toBe(true);
        expect(registry.isNever('billing')).toBe(false);
        expect(registry.isNever('task.comment')).toBe(false);
        expect(registry.isNever('')).toBe(false);
        expect(policy.isNever).toBe(registry.isNever);
    });
});

describe('registering a never-listed key', () => {
    it.each(['project.delete', 'billing.charge', 'task.delete'])('throws at load for %s', (key) => {
        const actions = [...registry.ACTIONS, { key, label: 'x', risk: registry.RISK.LOW, undoable: false, write: true, cost: 'write' }];
        expect(() => registry.indexActions(actions)).toThrow(`never-listed action(s) cannot be registered: ${key}`);
    });

    it('indexes the real table without throwing', () => {
        expect(registry.indexActions(registry.ACTIONS).size).toBe(registry.ACTIONS.length);
    });
});

describe('evaluate refuses never-listed keys before consulting the table', () => {
    it.each(['project.delete', 'billing.charge', 'deploy.production', 'status.set("Done")'])('%s is refused with never_listed', (key) => {
        expect(registry.evaluate(key, {}, { allowedActions: [key] })).toEqual({
            allowed: false, code: 'never_listed', reason: `Agents cannot perform ${key} (never_listed)`, action: null,
        });
    });

    it('mayActDirectly is false for a never-listed key at every level', () => {
        [0, 1, 2, 3].forEach((l) => expect(registry.mayActDirectly(l, 'task.delete')).toBe(false));
    });
});
