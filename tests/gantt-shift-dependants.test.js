const { shiftDependants } = require('../frontend/src/views/Projects/composables/ganttShift');

/* Local dates, so the suite reads the same in every time zone. 2026-09-01 is a Tuesday. */
const day = (d, h = 0) => new Date(2026, 8, d, h);
const task = (id, start, end) => ({ id, startDate: start, DueDate: end });
const link = (source, target) => ({ source, target });
const WEEKDAYS = [1, 2, 3, 4, 5];

const plain = (result) => ({
    ...result,
    shifts: result.shifts.map((s) => ({ id: s.id, days: s.days, start: s.to.startDate.getTime(), end: s.to.DueDate.getTime() })),
});

describe('shiftDependants', () => {
    test('shifts a chain through every dependant and keeps each duration', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(5)), task('c', day(5), day(8))];
        const result = plain(shiftDependants(tasks, [link('a', 'b'), link('b', 'c')], 'a', { startDate: day(1), DueDate: day(5) }));
        expect(result.shifts).toEqual([
            { id: 'b', days: 2, start: day(5).getTime(), end: day(7).getTime() },
            { id: 'c', days: 2, start: day(7).getTime(), end: day(10).getTime() },
        ]);
        expect(result.conflicts).toEqual([]);
        expect(result.cycle).toEqual([]);
    });

    test('reports where each shifted task came from', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(5))];
        const [shift] = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(4) }).shifts;
        expect(shift.from).toEqual({ startDate: day(3), DueDate: day(5) });
    });

    test('a dependant with enough slack stays, and so does everything after it', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(6), day(8)), task('c', day(8), day(9))];
        const result = shiftDependants(tasks, [link('a', 'b'), link('b', 'c')], 'a', { startDate: day(1), DueDate: day(5) });
        expect(result.shifts).toEqual([]);
    });

    test('a slack task absorbs part of the push and passes on only the rest', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(4), day(6)), task('c', day(6), day(7))];
        const result = plain(shiftDependants(tasks, [link('a', 'b'), link('b', 'c')], 'a', { startDate: day(1), DueDate: day(6) }));
        expect(result.shifts.map((s) => [s.id, s.days])).toEqual([['b', 2], ['c', 2]]);
    });

    test('fans out to every dependant by the amount each one needs', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4)), task('c', day(4), day(6)), task('d', day(10), day(11))];
        const links = [link('a', 'b'), link('a', 'c'), link('a', 'd')];
        const result = plain(shiftDependants(tasks, links, 'a', { startDate: day(1), DueDate: day(6) }));
        expect(result.shifts.map((s) => [s.id, s.days])).toEqual([['b', 3], ['c', 2]]);
    });

    test('a task with two moved blockers starts after the later of them', () => {
        const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4)), task('c', day(3), day(7)), task('d', day(7), day(8))];
        const links = [link('a', 'b'), link('a', 'c'), link('b', 'd'), link('c', 'd')];
        const result = plain(shiftDependants(tasks, links, 'a', { startDate: day(1), DueDate: day(5) }));
        expect(result.shifts.find((s) => s.id === 'd')).toEqual({ id: 'd', days: 2, start: day(9).getTime(), end: day(10).getTime() });
    });

    test('an unmoved blocker that already overlaps is not this move\'s business', () => {
        const tasks = [task('a', day(1), day(3)), task('x', day(1), day(9)), task('b', day(3), day(4))];
        const result = plain(shiftDependants(tasks, [link('a', 'b'), link('x', 'b')], 'a', { startDate: day(1), DueDate: day(4) }));
        expect(result.shifts.map((s) => [s.id, s.days])).toEqual([['b', 1]]);
    });

    test('moving a blocker earlier never pulls its dependants back', () => {
        const tasks = [task('a', day(3), day(5)), task('b', day(5), day(7))];
        const result = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(3) });
        expect(result.shifts).toEqual([]);
        expect(result.conflicts).toEqual([]);
    });

    test('moving only the start leaves dependants alone', () => {
        const tasks = [task('a', day(3), day(5)), task('b', day(4), day(7))];
        expect(shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(2), DueDate: day(5) }).shifts).toEqual([]);
    });

    test('keeps the time of day when it shifts', () => {
        const tasks = [task('a', day(1, 9), day(3, 17)), task('b', day(3, 9), day(4, 17))];
        const [shift] = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1, 9), DueDate: day(4, 17) }).shifts;
        expect([shift.days, shift.to.startDate, shift.to.DueDate]).toEqual([2, day(5, 9), day(6, 17)]);
    });

    describe('working days', () => {
        test('a dependant pushed onto a weekend starts on Monday and keeps one working day', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4))];
            const [shift] = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(5) }, { workingDays: WEEKDAYS }).shifts;
            expect([shift.days, shift.to.startDate, shift.to.DueDate]).toEqual([2, day(7), day(8)]);
        });

        test('a task spanning a weekend keeps its working-day length', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(8))];
            const [shift] = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(4) }, { workingDays: WEEKDAYS }).shifts;
            expect([shift.days, shift.to.startDate, shift.to.DueDate]).toEqual([1, day(4), day(9)]);
        });

        test('without a working-days setting every day counts', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4))];
            const [shift] = shiftDependants(tasks, [link('a', 'b')], 'a', { startDate: day(1), DueDate: day(5) }, { workingDays: [] }).shifts;
            expect([shift.days, shift.to.startDate, shift.to.DueDate]).toEqual([2, day(5), day(6)]);
        });
    });

    describe('cycles', () => {
        test('stops at a loop, names it, and still shifts the branches outside it', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4)), task('c', day(4), day(5)), task('d', day(3), day(4))];
            const links = [link('a', 'b'), link('b', 'c'), link('c', 'b'), link('a', 'd')];
            const result = plain(shiftDependants(tasks, links, 'a', { startDate: day(1), DueDate: day(5) }));
            expect(result.cycle).toEqual(['b', 'c', 'b']);
            expect(result.shifts.map((s) => s.id)).toEqual(['d']);
        });

        test('a loop back to the moved task shifts nothing', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(4))];
            const result = shiftDependants(tasks, [link('a', 'b'), link('b', 'a')], 'a', { startDate: day(1), DueDate: day(5) });
            expect(result.cycle).toEqual(['a', 'b', 'a']);
            expect(result.shifts).toEqual([]);
        });
    });

    describe('permissions', () => {
        test('a task the person may not edit is a conflict, stays put, and holds nothing after it', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(5)), task('c', day(5), day(6))];
            const result = shiftDependants(tasks, [link('a', 'b'), link('b', 'c')], 'a', { startDate: day(1), DueDate: day(5) }, { canEdit: (id) => id !== 'b' });
            expect(result.shifts).toEqual([]);
            expect(result.conflicts).toEqual([{ id: 'b', days: 2 }]);
        });

        test('its editable siblings still shift', () => {
            const tasks = [task('a', day(1), day(3)), task('b', day(3), day(5)), task('d', day(3), day(4))];
            const result = shiftDependants(tasks, [link('a', 'b'), link('a', 'd')], 'a', { startDate: day(1), DueDate: day(4) }, { canEdit: (id) => id !== 'b' });
            expect(result.shifts.map((s) => s.id)).toEqual(['d']);
            expect(result.conflicts).toEqual([{ id: 'b', days: 1 }]);
        });
    });

    test('ignores links to tasks it does not know and tasks without usable dates', () => {
        const tasks = [task('a', day(1), day(3)), task('b', 'not a date', day(5)), task('c', day(3), day(4))];
        const links = [link('a', 'missing'), link('a', 'b'), link('a', 'c')];
        const result = shiftDependants(tasks, links, 'a', { startDate: day(1), DueDate: day(4) });
        expect(result.shifts.map((s) => s.id)).toEqual(['c']);
    });

    test('an unknown moved task shifts nothing', () => {
        expect(shiftDependants([], [], 'a', { startDate: day(1), DueDate: day(4) })).toEqual({ shifts: [], conflicts: [], cycle: [] });
    });
});
