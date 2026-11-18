const Q = require('../frontend/src/views/Timesheet/report/reportQuery');
const T = require('../frontend/src/views/Timesheet/report/reportTable');

const today = '2026-11-04';

describe('report filters in the URL', () => {
    it('reads the default when the query names nothing', () => {
        expect(Q.readFilters({}, { today })).toMatchObject({ preset: 'this_week', start: '2026-11-02', end: '2026-11-08', people: [], billable: '' });
        expect(Q.readFilters({}, { today, defaultPreset: 'today' })).toMatchObject({ preset: 'today', start: today, end: today });
    });

    it('round-trips every filter, keeps keys the tab owns and leaves defaults out', () => {
        const filters = { ...Q.emptyFilters(), preset: 'custom', start: '2026-10-01', end: '2026-10-15', people: ['u1', 'u2'], projects: ['p1'], lists: ['l1'], status: ['In progress'], tags: ['t1'], billable: 'non_billable' };
        const query = Q.writeFilters(filters, { task: 'abc', people: ['old'] });
        expect(query).toEqual({ task: 'abc', range: 'custom', from: '2026-10-01', to: '2026-10-15', people: ['u1', 'u2'], projects: ['p1'], lists: ['l1'], status: ['In progress'], tags: ['t1'], billable: 'non_billable' });
        expect(Q.readFilters(query, { today })).toEqual(filters);
        expect(Q.writeFilters(Q.readFilters({}, { today }), {})).toEqual({});
    });

    it('reads one value or many the same way, and drops what is not allowed', () => {
        const filters = Q.readFilters({ range: 'last_year', people: 'u1', status: ['A', 'A', ' ', 'B'], billable: 'maybe', from: '2020-01-01' }, { today });
        expect(filters).toMatchObject({ preset: 'last_year', start: '2025-01-01', end: '2025-12-31', people: ['u1'], status: ['A', 'B'], billable: '' });
        expect(Q.readFilters({ range: 'this_year' }, { today, presets: ['today', 'yesterday', 'custom'], defaultPreset: 'today' }).preset).toBe('today');
    });

    it('carries only the range, people and projects to another tab', () => {
        expect(Q.sharedQuery({ range: 'custom', from: 'a', to: 'b', people: ['u'], projects: ['p'], status: ['x'], task: 't' }))
            .toEqual({ range: 'custom', from: 'a', to: 'b', people: ['u'], projects: ['p'] });
    });

    it('sends the server only the filters that narrow by task or billable', () => {
        expect(Q.serverFilters({ ...Q.emptyFilters(), people: ['u'], lists: ['l'], status: ['Done'], billable: 'billable' })).toEqual({ lists: ['l'], status: ['Done'], billable: 'billable' });
        expect(Q.serverFilters(Q.emptyFilters())).toEqual({});
        expect(Q.activeCount({ ...Q.emptyFilters(), people: ['u'], tags: ['t'], billable: 'billable' })).toBe(3);
    });
});

describe('report export table', () => {
    const columns = [
        { key: 'name', label: 'Task' },
        { key: 'hours', label: 'Hours', value: (row) => T.hoursOf(row.minutes) },
    ];

    it('holds exactly the columns and rows on screen, with the total last', () => {
        const table = T.tableOf({ columns, rows: [{ name: 'Write spec', minutes: 90 }, { name: null, minutes: 20 }], total: { name: 'Total', minutes: 110 } });
        expect(table).toEqual({
            tableHead: ['Task', 'Hours'],
            tableRows: [['Write spec', 1.5], ['', 0.33]],
            totalRow: ['Total', 1.83],
        });
        expect(T.tableOf({ columns, rows: [] })).toEqual({ tableHead: ['Task', 'Hours'], tableRows: [], totalRow: null });
    });

    it('names the file after the report and its range', () => {
        expect(T.fileNameOf('My timesheet', { start: '2026-11-02', end: '2026-11-08' })).toBe('my-timesheet_2026-11-02_2026-11-08');
        expect(T.fileNameOf('tracker', { start: '2026-11-04', end: '2026-11-04' })).toBe('tracker_2026-11-04');
        expect(T.fileNameOf('', null)).toBe('report');
    });

    it('lists the range and each narrowing filter for the PDF header', () => {
        const lines = T.filterLines({ start: '2026-11-02', end: '2026-11-08', people: ['u1'], projects: [], status: ['Done'], billable: 'billable' }, (field, value) => `${field}=${value}`);
        expect(lines).toEqual(['range=2026-11-02 – 2026-11-08', 'people=u1', 'status=Done', 'billable=billable']);
    });

    it('goes through the shared export rules, which quote and neutralise formulas', () => {
        const { toCsv } = require('../Modules/Export/helpers/exportRules');
        const table = T.tableOf({ columns, rows: [{ name: '=SUM(A1), "x"', minutes: 60 }] });
        expect(toCsv(table.tableHead, table.tableRows, table.totalRow)).toBe('Task,Hours\r\n"\'=SUM(A1), ""x""",1');
    });
});
