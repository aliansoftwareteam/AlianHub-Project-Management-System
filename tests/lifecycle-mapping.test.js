const { lifecycleOf, keyFor, isActive, reopenStatusOf, ACTIVE, ARCHIVED, CLOSED, TRASHED } = require('../frontend/src/utils/lifecycle');

describe('lifecycleOf — projects', () => {
    test.each([
        [{ deletedStatusKey: 0 }, ACTIVE],
        [{}, ACTIVE],
        [{ deletedStatusKey: 2 }, ARCHIVED],
        [{ deletedStatusKey: 1 }, TRASHED],
        [{ deletedStatusKey: 0, statusType: 'close' }, CLOSED],
        [{ deletedStatusKey: 1, statusType: 'close' }, TRASHED]
    ])('%o → %s', (doc, state) => {
        expect(lifecycleOf(doc, 'project')).toBe(state);
    });
});

describe('lifecycleOf — tasks', () => {
    test.each([
        [0, ACTIVE], [1, TRASHED], [2, ARCHIVED], [3, ARCHIVED], [4, ARCHIVED], [6, ARCHIVED], [7, ARCHIVED], [5, CLOSED], [8, CLOSED]
    ])('deletedStatusKey %i → %s', (key, state) => {
        expect(lifecycleOf({ deletedStatusKey: key }, 'task')).toBe(state);
    });

    test('a string key is coerced', () => {
        expect(lifecycleOf({ deletedStatusKey: '7' }, 'task')).toBe(ARCHIVED);
    });
});

describe('lifecycleOf — sprints', () => {
    test.each([[0, ACTIVE], [1, TRASHED], [2, ARCHIVED], [5, CLOSED]])('deletedStatusKey %i → %s', (key, state) => {
        expect(lifecycleOf({ deletedStatusKey: key }, 'sprint')).toBe(state);
    });
});

describe('keyFor', () => {
    test('round-trips with lifecycleOf for every writable state', () => {
        const writable = { project: [ACTIVE, ARCHIVED, TRASHED], sprint: [ACTIVE, ARCHIVED, CLOSED, TRASHED], task: [ACTIVE, ARCHIVED, TRASHED] };
        Object.entries(writable).forEach(([kind, states]) => {
            states.forEach((state) => expect(lifecycleOf({ deletedStatusKey: keyFor(kind, state) }, kind)).toBe(state));
        });
    });

    test('refuses a state the kind cannot store', () => {
        expect(() => keyFor('task', CLOSED)).toThrow(/task\/closed/);
        expect(() => keyFor('doc', ACTIVE)).toThrow();
    });
});

test('isActive is the ACTIVE shorthand', () => {
    expect(isActive({ deletedStatusKey: 0 }, 'task')).toBe(true);
    expect(isActive({ deletedStatusKey: 2 }, 'project')).toBe(false);
});

describe('reopenStatusOf', () => {
    const statuses = [
        { value: 'open', type: 'default_active' },
        { value: 'in_testing', type: 'active' },
        { value: 'planning', type: 'active', default: true },
        { value: 'close', type: 'close' }
    ];

    test('returns the status the project had when it was closed', () => {
        expect(reopenStatusOf({ projectStatusData: statuses, statusBeforeClose: 'in_testing' }).value).toBe('in_testing');
    });

    test.each([
        ['nothing was kept', undefined],
        ['the kept status was removed', 'in_review'],
        ['the kept status is a close one', 'close']
    ])('falls back to the default when %s', (_why, kept) => {
        expect(reopenStatusOf({ projectStatusData: statuses, statusBeforeClose: kept }).value).toBe('planning');
    });

    test('then to the default active status, then to the first open one', () => {
        expect(reopenStatusOf({ projectStatusData: statuses.map(({ default: _d, ...status }) => status) }).value).toBe('open');
        expect(reopenStatusOf({ projectStatusData: [{ value: 'close', type: 'close' }, { value: 'doing', type: 'active' }] }).value).toBe('doing');
    });

    test('a project with no open status has nothing to reopen to', () => {
        expect(reopenStatusOf({ projectStatusData: [{ value: 'close', type: 'close' }] })).toBeNull();
        expect(reopenStatusOf({})).toBeNull();
    });
});
