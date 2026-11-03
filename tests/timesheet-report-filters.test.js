jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const F = require('../Modules/TimeSheet/helpers/reportFilters');

const LIST = '6ae8961357468519b6619de1';
const TASK = '6ae8961357468519b6619de2';

describe('time report filters (task 086)', () => {
    beforeEach(() => MongoDbCrudOpration.mockReset());

    it('keeps only lists, status names, tags and billable, from an object or a JSON string', () => {
        expect(F.normalizeReportFilters({ lists: [LIST, 'not-an-id'], status: ['Done', '', 3, { $ne: 1 }], tags: ['t1', 't1'], billable: 'billable', people: ['u'] }))
            .toEqual({ lists: [LIST], status: ['Done', '3'], tags: ['t1'], billable: 'billable' });
        expect(F.normalizeReportFilters(JSON.stringify({ billable: 'non_billable' }))).toEqual({ lists: [], status: [], tags: [], billable: 'non_billable' });
        expect(F.normalizeReportFilters('{oops')).toEqual({ lists: [], status: [], tags: [], billable: '' });
        expect(F.normalizeReportFilters({ billable: { $exists: true } }).billable).toBe('');
    });

    it('adds nothing and reads nothing when no filter is set', async () => {
        const result = await F.reportTimeClauses('c1', { companyWide: true }, F.normalizeReportFilters({}));
        expect(result).toEqual({ clauses: [], taskIds: null });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('resolves task filters inside the session company and the projects the scope reads', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ _id: TASK }]);
        const filters = F.normalizeReportFilters({ lists: [LIST], status: ['Done'], tags: ['t1'], billable: 'non_billable' });
        const { clauses, taskIds } = await F.reportTimeClauses('company-1', { visible: ['p1'] }, filters);

        const [companyId, query] = MongoDbCrudOpration.mock.calls[0];
        expect(companyId).toBe('company-1');
        expect(query.data[0].ProjectID.$in).toContain('p1');
        expect(query.data[0].$and).toEqual(expect.arrayContaining([{ 'status.text': { $in: ['Done'] } }, { tagsArray: { $in: ['t1'] } }]));
        expect(taskIds).toEqual([TASK]);
        expect(clauses[0].TicketID.$in.map(String)).toContain(TASK);
        expect(clauses[1]).toEqual({ billable: false });
    });

    it('matches no time when no task passes, rather than lifting the filter', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        const { clauses } = await F.reportTimeClauses('c1', { companyWide: true, hidden: ['p9'] }, F.normalizeReportFilters({ status: ['Done'] }));
        expect(clauses).toEqual([{ TicketID: { $in: [] } }]);
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0].ProjectID.$nin).toContain('p9');
    });

    it('only ever narrows: clauses go under $and next to the scope match, never over its fields', () => {
        const scoped = { Loggeduser: 'me', $or: [{ Loggeduser: 'me' }, { TicketID: { $nin: ['x'] } }], $and: [{ a: 1 }] };
        const narrowed = F.narrowMatch(scoped, [{ TicketID: { $in: ['t'] } }, { billable: false }]);
        expect(narrowed.Loggeduser).toBe('me');
        expect(narrowed.$or).toBe(scoped.$or);
        expect(narrowed.$and).toEqual([{ a: 1 }, { TicketID: { $in: ['t'] } }, { billable: false }]);
        expect(F.narrowMatch(scoped, [])).toBe(scoped);
    });

    it('reads billable as the CSV export does: only an explicit false is non-billable', () => {
        expect(F.billableClause('billable')).toEqual({ billable: { $ne: false } });
        expect(F.billableClause('non_billable')).toEqual({ billable: false });
        expect(F.billableClause('')).toBeNull();
        expect(F.estimateClausesOf(null)).toEqual([]);
        expect(F.estimateClausesOf([TASK])[0].TaskId.$in.map(String)).toContain(TASK);
    });
});

describe('task filters read only the tasks the report rows name', () => {
    beforeEach(() => MongoDbCrudOpration.mockReset());

    it('looks up the candidate tasks of the base match, not every task of the company', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce([{ _id: TASK }, { _id: null }])
            .mockResolvedValueOnce([{ _id: TASK }]);
        const base = { Loggeduser: 'me', LogStartTime: { $gte: 1, $lte: 2 } };
        const { taskIds } = await F.reportTimeClauses('c1', {}, F.normalizeReportFilters({ status: ['Done'] }), { baseMatch: base });
        const [[, group], [, tasks]] = MongoDbCrudOpration.mock.calls;
        expect(group.data[0][0]).toEqual({ $match: base });
        expect(tasks.data[0]._id.$in.map(String)).toEqual([TASK]);
        expect(taskIds).toEqual([TASK]);
    });

    it('reads no tasks when the range has no rows', async () => {
        MongoDbCrudOpration.mockResolvedValueOnce([]);
        const { clauses } = await F.reportTimeClauses('c1', {}, F.normalizeReportFilters({ tags: ['t'] }), { baseMatch: { a: 1 } });
        expect(MongoDbCrudOpration).toHaveBeenCalledTimes(1);
        expect(clauses).toEqual([{ TicketID: { $in: [] } }]);
    });
});
