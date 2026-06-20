const R = require('../Modules/Automations/helpers/automationRules');

describe('validateRule', () => {
    test('valid rule', () => {
        const v = R.validateRule({ name: 'Bump P', conditions: { priority: 'LOW' }, actions: [{ type: 'set_priority', value: 'HIGH' }] });
        expect(v.valid).toBe(true);
        expect(v.value).toMatchObject({ name: 'Bump P', trigger: 'manual', conditions: { priority: 'LOW' }, actions: [{ type: 'set_priority', value: 'HIGH' }] });
    });
    test('missing name + no valid action → errors', () => {
        const v = R.validateRule({ conditions: {}, actions: [{ type: 'nope' }] });
        expect(v.valid).toBe(false);
        expect(v.errors.length).toBe(2);
    });
    test('filters unknown condition keys + bad priorities', () => {
        const v = R.validateRule({ name: 'x', conditions: { priority: 'URGENT', hacker: 'drop' }, actions: [{ type: 'set_priority', value: 'MEDIUM' }] });
        expect(v.value.conditions).toEqual({});
    });
    test('unknown trigger → manual', () => {
        expect(R.validateRule({ name: 'x', trigger: 'on_fire', actions: [{ type: 'set_priority', value: 'LOW' }] }).value.trigger).toBe('manual');
    });
});

describe('matchTask', () => {
    const task = { ProjectID: 'p1', Task_Priority: 'LOW', statusType: 'open' };
    test('matches when all conditions hold', () => { expect(R.matchTask(task, { priority: 'LOW', statusType: 'open' })).toBe(true); });
    test('fails on any mismatch', () => {
        expect(R.matchTask(task, { priority: 'HIGH' })).toBe(false);
        expect(R.matchTask(task, { projectId: 'p2' })).toBe(false);
    });
    test('empty conditions match anything', () => { expect(R.matchTask(task, {})).toBe(true); });
});

describe('buildMatch', () => {
    const oid = (x) => ({ _oid: x });
    test('always scopes to parent, non-deleted', () => {
        expect(R.buildMatch({}, oid)).toEqual({ deletedStatusKey: 0, isParentTask: true });
    });
    test('adds provided conditions', () => {
        const m = R.buildMatch({ projectId: 'p1', priority: 'HIGH', statusType: 'close' }, oid);
        expect(m).toMatchObject({ Task_Priority: 'HIGH', statusType: 'close', ProjectID: { _oid: 'p1' } });
    });
});

describe('describe', () => {
    test('renders a human summary', () => {
        expect(R.describe({ conditions: { priority: 'LOW' }, actions: [{ type: 'set_priority', value: 'HIGH' }] })).toBe('priority=LOW → set priority HIGH');
    });
});
