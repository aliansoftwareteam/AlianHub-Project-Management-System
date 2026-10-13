const {
    MONGO_FIELD_OPS, normalizeChangedFields, createSnapshotStore, COMPUTED_SOURCE, FIELD_REMOVED_SOURCE, isNotAnEdit,
} = require('../utils/entityEvents');

describe('normalizeChangedFields', () => {
    test('a plain update lists the fields it touched', () => {
        expect([...normalizeChangedFields({ TaskName: 'x', Task_Priority: 'High' })].sort()).toEqual(['TaskName', 'Task_Priority']);
    });

    test('fields inside $set, $push, $pull and $inc count as touched, without the operator', () => {
        const touched = normalizeChangedFields({ $set: { a: 1 }, $push: { b: 2 }, $pull: { c: 3 }, $inc: { d: 1 } });
        expect([...touched].sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    test('a dotted path is reduced to its top-level field and listed once', () => {
        const touched = normalizeChangedFields({ 'customField.x': 1, 'customField.y': 2, $set: { 'customField.z': 3 } });
        expect([...touched]).toEqual(['customField']);
    });

    test('an operator the list does not know is ignored', () => {
        expect(normalizeChangedFields({ $currentDate: { a: true }, $bit: { b: 1 } }).size).toBe(0);
    });

    test('an operator holding a non-object touches nothing and does not throw', () => {
        expect(normalizeChangedFields({ $set: null, $unset: 'a' }).size).toBe(0);
    });

    test('empty, null and undefined input give an empty set', () => {
        expect(normalizeChangedFields({}).size).toBe(0);
        expect(normalizeChangedFields(null).size).toBe(0);
        expect(normalizeChangedFields(undefined).size).toBe(0);
    });

    test('every operator it flattens is one MongoDB really has', () => {
        MONGO_FIELD_OPS.forEach((op) => expect(op.startsWith('$')).toBe(true));
        expect(new Set(MONGO_FIELD_OPS).size).toBe(MONGO_FIELD_OPS.length);
    });
});

describe('isNotAnEdit', () => {
    test('a recomputed formula and a removed field are not somebody editing the task', () => {
        expect(isNotAnEdit({ source: COMPUTED_SOURCE })).toBe(true);
        expect(isNotAnEdit({ source: FIELD_REMOVED_SOURCE })).toBe(true);
    });

    test('a person edit, a missing source or no payload at all counts as an edit', () => {
        expect(isNotAnEdit({ source: 'user' })).toBe(false);
        expect(isNotAnEdit({})).toBe(false);
        expect(isNotAnEdit(null)).toBe(false);
        expect(isNotAnEdit(undefined)).toBe(false);
    });
});

describe('createSnapshotStore', () => {
    test('remembers what it saw last for an id, and nothing for an id it never saw', () => {
        const store = createSnapshotStore();
        expect(store.get('t1')).toBeNull();
        store.remember('t1', { status: 'open' });
        store.remember('t1', { status: 'done' });
        expect(store.get('t1')).toEqual({ status: 'done' });
        expect(store.size).toBe(1);
    });

    test('an id given as a number and as text is the same entity', () => {
        const store = createSnapshotStore();
        store.remember(42, 'a');
        expect(store.get('42')).toBe('a');
    });

    test('past the limit the oldest entity is forgotten first', () => {
        const store = createSnapshotStore({ max: 2 });
        store.remember('a', 1);
        store.remember('b', 2);
        store.remember('c', 3);
        expect(store.get('a')).toBeNull();
        expect(store.get('b')).toBe(2);
        expect(store.get('c')).toBe(3);
        expect(store.size).toBe(2);
    });

    test('touching an entity again makes it the newest, so it outlives an untouched one', () => {
        const store = createSnapshotStore({ max: 2 });
        store.remember('a', 1);
        store.remember('b', 2);
        store.remember('a', 10);
        store.remember('c', 3);
        expect(store.get('b')).toBeNull();
        expect(store.get('a')).toBe(10);
    });

    test('two stores never share what they remember', () => {
        const webhooks = createSnapshotStore();
        const bus = createSnapshotStore();
        webhooks.remember('t1', 'delivered');
        expect(bus.get('t1')).toBeNull();
    });
});
