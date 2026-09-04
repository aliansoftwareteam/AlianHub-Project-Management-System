const { lifecycleOf, keyFor, isActive, ACTIVE, ARCHIVED, CLOSED, TRASHED } = require('../frontend/src/utils/lifecycle');

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
