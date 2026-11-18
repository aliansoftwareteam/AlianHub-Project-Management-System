const M = require('../Modules/AgileReports/helpers/milestoneMoves');

const DAY = 86400000;
const changed = (over = {}) => ({
    Message: '<b>Ana</b> changed <b>Beta</b> milestone due date from <b>DATE_1000</b> to <b>DATE_2000</b>',
    createdAt: '2026-03-02T10:00:00Z',
    UserId: 'u1',
    ProjectId: 'p1',
    ...over,
});

describe('parseMove', () => {
    it('reads a "changed ... from ... to ..." history line', () => {
        expect(M.parseMove(changed())).toEqual({
            actor: 'Ana', milestoneName: 'Beta', field: 'dueDate', from: 1000, to: 2000,
            at: '2026-03-02T10:00:00Z', userId: 'u1', projectId: 'p1',
        });
    });

    it('maps start, end and due onto their stored field names', () => {
        const field = (word) => M.parseMove(changed({ Message: `<b>A</b> changed <b>B</b> milestone ${word} date from <b>DATE_1</b> to <b>DATE_2</b>` })).field;
        expect(field('start')).toBe('startDate');
        expect(field('end')).toBe('endDate');
        expect(field('DUE')).toBe('dueDate');
    });

    it('reads a "has set the ... date" line as a first date with no previous one', () => {
        const move = M.parseMove(changed({ Message: '<b>Ana</b> has set the end date of  milestone <b>Beta</b> to DATE_5000</b>.' }));
        expect(move).toMatchObject({ actor: 'Ana', milestoneName: 'Beta', field: 'endDate', from: null, to: 5000 });
    });

    it('strips markup from names', () => {
        const move = M.parseMove(changed({ Message: '<b><i>Ana</i></b> changed <b>Be<u>ta</u></b> milestone due date from <b>DATE_1</b> to <b>DATE_2</b>' }));
        expect(move.actor).toBe('Ana');
        expect(move.milestoneName).toBe('Beta');
    });

    it('returns null for other history lines, empty rows and nothing', () => {
        expect(M.parseMove({ Message: '<b>Ana</b> renamed the milestone' })).toBeNull();
        expect(M.parseMove({})).toBeNull();
        expect(M.parseMove(null)).toBeNull();
        expect(M.parseMove(undefined)).toBeNull();
    });

    it('leaves the time and ids blank when the row has none', () => {
        const move = M.parseMove({ Message: changed().Message });
        expect(move.at).toBeNull();
        expect(move.userId).toBe('');
        expect(move.projectId).toBe('');
    });
});

describe('parseMoves', () => {
    it('drops rows that are not date moves and orders the rest oldest first', () => {
        const rows = [
            changed({ createdAt: '2026-03-05T00:00:00Z', Message: '<b>A</b> changed <b>B</b> milestone due date from <b>DATE_2</b> to <b>DATE_3</b>' }),
            { Message: 'something else', createdAt: '2026-03-01T00:00:00Z' },
            changed({ createdAt: '2026-03-01T00:00:00Z', Message: '<b>A</b> changed <b>B</b> milestone due date from <b>DATE_1</b> to <b>DATE_2</b>' }),
        ];
        expect(M.parseMoves(rows).map((m) => m.from)).toEqual([1, 2]);
    });

    it('returns an empty list for anything that is not a list', () => {
        expect(M.parseMoves()).toEqual([]);
        expect(M.parseMoves(null)).toEqual([]);
        expect(M.parseMoves('rows')).toEqual([]);
    });
});

describe('indexMoves', () => {
    it('groups by project and milestone name, ignoring letter case of the name', () => {
        const a = { projectId: 'p1', milestoneName: 'Beta' };
        const b = { projectId: 'p1', milestoneName: 'beta' };
        const c = { projectId: 'p2', milestoneName: 'Beta' };
        const index = M.indexMoves([a, b, c]);
        expect(index.get(M.keyOf('p1', 'BETA'))).toEqual([a, b]);
        expect(index.get(M.keyOf('p2', 'Beta'))).toEqual([c]);
        expect(index.size).toBe(2);
    });

    it('is empty with no moves', () => {
        expect(M.indexMoves().size).toBe(0);
    });
});

describe('baselineFor', () => {
    it('uses the earliest recorded previous date for that field', () => {
        const moves = [
            { field: 'dueDate', from: 100, to: 200 },
            { field: 'dueDate', from: 200, to: 300 },
        ];
        expect(M.baselineFor(moves, 'dueDate', 300)).toBe(100);
    });

    it('ignores moves of other fields', () => {
        const moves = [{ field: 'startDate', from: 50, to: 60 }, { field: 'dueDate', from: 100, to: 200 }];
        expect(M.baselineFor(moves, 'dueDate', 200)).toBe(100);
    });

    it('falls back to the first date that was set when there was no previous one', () => {
        expect(M.baselineFor([{ field: 'endDate', from: null, to: 700 }], 'endDate', 900)).toBe(700);
    });

    it('falls back to the current date when the field never moved', () => {
        expect(M.baselineFor([], 'dueDate', 900)).toBe(900);
        expect(M.baselineFor([{ field: 'startDate', from: 1, to: 2 }], 'dueDate', 900)).toBe(900);
    });

    it('returns null when nothing is known', () => {
        expect(M.baselineFor([], 'dueDate', 0)).toBeNull();
        expect(M.baselineFor(undefined, 'dueDate', NaN)).toBeNull();
    });
});

describe('slipDays', () => {
    it('counts whole days later as positive and earlier as negative', () => {
        expect(M.slipDays(1000 * DAY, 1003 * DAY)).toBe(3);
        expect(M.slipDays(1003 * DAY, 1000 * DAY)).toBe(-3);
        expect(M.slipDays(1000 * DAY, 1000 * DAY)).toBe(0);
    });

    it('rounds part days to the nearest day', () => {
        expect(M.slipDays(0 + DAY, DAY + DAY * 0.6)).toBe(1);
        expect(M.slipDays(DAY, DAY + DAY * 0.4)).toBe(0);
    });

    it('returns null when either date is missing or not a number', () => {
        expect(M.slipDays(0, DAY)).toBeNull();
        expect(M.slipDays(DAY, 0)).toBeNull();
        expect(M.slipDays(NaN, DAY)).toBeNull();
        expect(M.slipDays(undefined, DAY)).toBeNull();
    });
});
