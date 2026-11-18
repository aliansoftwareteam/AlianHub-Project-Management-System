const { fsCollisionLinks } = require('../frontend/src/views/Projects/composables/ganttCollisions');

const task = (id, start, end, blocks = []) => ({ id, startDate: start, DueDate: end, blocks });

describe('fsCollisionLinks', () => {
    test('flags a successor that starts before its blocker is due', () => {
        const links = fsCollisionLinks([
            task('a', '2026-09-01', '2026-09-10', ['b']),
            task('b', '2026-09-05', '2026-09-12'),
        ]);
        expect([...links]).toEqual(['a_b']);
    });

    test('a successor starting on or after the due date is fine', () => {
        const links = fsCollisionLinks([
            task('a', '2026-09-01', '2026-09-10', ['b', 'c']),
            task('b', '2026-09-10', '2026-09-12'),
            task('c', '2026-09-11', '2026-09-12'),
        ]);
        expect(links.size).toBe(0);
    });

    test('ignores links to tasks outside the set and rows with unusable dates', () => {
        const links = fsCollisionLinks([
            task('a', '2026-09-01', '2026-09-10', ['missing', 'b']),
            task('b', 'not a date', '2026-09-12'),
        ]);
        expect(links.size).toBe(0);
    });

    test('accepts _id rows and Date values', () => {
        const links = fsCollisionLinks([
            { _id: 'a', startDate: new Date('2026-09-01'), DueDate: new Date('2026-09-10'), blocks: ['b'] },
            { _id: 'b', startDate: new Date('2026-09-02'), DueDate: new Date('2026-09-03') },
        ]);
        expect(links.has('a_b')).toBe(true);
    });

    test('is empty for no tasks', () => {
        expect(fsCollisionLinks(undefined).size).toBe(0);
    });
});
