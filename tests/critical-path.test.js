const R = require('../frontend/src/views/Projects/composables/criticalPath');

const task = (id, start, end, blocks = []) => ({ id, startDate: start, DueDate: end, blocks });

describe('durationDays', () => {
    test('counts inclusive days', () => {
        expect(R.durationDays('2026-09-01', '2026-09-03')).toBe(3);
        expect(R.durationDays('2026-09-01', '2026-09-01')).toBe(1);
    });
    test('never returns less than a day, even for junk dates', () => {
        expect(R.durationDays('2026-09-05', '2026-09-01')).toBe(1);
        expect(R.durationDays('', null)).toBe(1);
    });
});

describe('criticalPath', () => {
    test('is empty for no tasks', () => {
        expect(R.criticalPath([]).path).toEqual([]);
        expect(R.criticalPath(undefined).path).toEqual([]);
    });

    test('follows the longest chain, not the first one', () => {
        // a → b → d (2+4+2 = 8 days) versus a → c → d (2+1+2 = 5)
        const tasks = [
            task('a', '2026-09-01', '2026-09-02', ['b', 'c']),
            task('b', '2026-09-03', '2026-09-06', ['d']),
            task('c', '2026-09-03', '2026-09-03', ['d']),
            task('d', '2026-09-07', '2026-09-08'),
        ];
        const { path, durationDays } = R.criticalPath(tasks);
        expect(path).toEqual(['a', 'b', 'd']);
        expect(durationDays).toBe(8);
        expect(R.criticalTaskIds(tasks).has('c')).toBe(false);
    });

    test('reports slack on the branch that is not critical', () => {
        const { nodes } = R.schedule([
            task('a', '2026-09-01', '2026-09-02', ['b', 'c']),
            task('b', '2026-09-03', '2026-09-06', ['d']),
            task('c', '2026-09-03', '2026-09-03', ['d']),
            task('d', '2026-09-07', '2026-09-08'),
        ]);
        expect(nodes.get('c').slack).toBe(3);
        expect(nodes.get('b').slack).toBe(0);
        expect(nodes.get('a').critical).toBe(true);
    });

    test('with no dependencies only the longest task is critical', () => {
        const ids = R.criticalTaskIds([
            task('short', '2026-09-01', '2026-09-02'),
            task('long', '2026-09-01', '2026-09-10'),
        ]);
        expect([...ids]).toEqual(['long']);
    });

    test('ignores relations pointing outside the visible set', () => {
        const { path } = R.criticalPath([task('a', '2026-09-01', '2026-09-04', ['gone'])]);
        expect(path).toEqual(['a']);
    });

    test('survives a cycle instead of hanging', () => {
        const { path, nodes } = R.criticalPath([
            task('a', '2026-09-01', '2026-09-02', ['b']),
            task('b', '2026-09-03', '2026-09-04', ['a']),
        ]);
        expect(nodes.size).toBe(2);
        expect(path.length).toBeGreaterThan(0);
        expect(new Set(path).size).toBe(path.length);
    });

    test('deduplicates repeated relations and self-links', () => {
        const { nodes } = R.schedule([
            task('a', '2026-09-01', '2026-09-02', ['b', 'b', 'a']),
            task('b', '2026-09-03', '2026-09-04'),
        ]);
        expect(nodes.get('a').succs).toEqual(['b']);
        expect(nodes.get('b').preds).toEqual(['a']);
    });
});
