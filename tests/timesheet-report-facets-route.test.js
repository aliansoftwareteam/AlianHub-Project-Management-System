jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/tenant', () => {
    class TenantError extends Error {}
    return { sessionTenantOf: (req) => req.headers.companyid, TenantError };
});
jest.mock('../Modules/TimeSheet/helpers/timeScope', () => ({
    SHEET_PERMISSION: { user: 'u' },
    resolveSheetScope: jest.fn(async () => ({ uid: 'me', everyone: false })),
    scopedTimeMatch: jest.fn(() => ({ Loggeduser: 'me' })),
    scopedEstimateMatch: jest.fn(() => ({ $or: [{ UserId: 'me' }] })),
}));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { getReportFacets } = require('../Modules/TimeSheet/controller/reportFacets');

const call = async (body) => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await getReportFacets({ headers: { companyid: 'c1' }, uid: 'me', body }, res);
    return res;
};

describe('POST /api/v1/timesheet/report-facets', () => {
    beforeEach(() => MongoDbCrudOpration.mockReset());

    it('needs a range and reads nothing without people', async () => {
        expect((await call({ start: 'x', end: '2026-11-08', userIds: ['a'] })).code).toBe(400);
        const res = await call({ start: '2026-11-02', end: '2026-11-08', userIds: [] });
        expect(res.body.data).toEqual({ projectsByUser: {} });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('joins logged and planned projects per person, read in the session company inside the scope', async () => {
        MongoDbCrudOpration
            .mockResolvedValueOnce([{ _id: { u: 'me', p: 'p1' } }, { _id: { u: 'me', p: 'p2' } }])
            .mockResolvedValueOnce([{ _id: { u: 'me', p: 'p2' } }, { _id: { u: 'me', p: 'p3' } }]);
        const res = await call({ start: '2026-11-02', end: '2026-11-08', userIds: ['me'] });
        expect(res.body.data.projectsByUser.me.sort()).toEqual(['p1', 'p2', 'p3']);
        const [[companyA, logs], [companyB, plans]] = MongoDbCrudOpration.mock.calls;
        expect([companyA, companyB]).toEqual(['c1', 'c1']);
        expect(logs.data[0][0].$match.Loggeduser).toBe('me');
        expect(plans.data[0][0].$match.$or).toEqual([{ UserId: 'me' }]);
        expect(plans.data[0][0].$match.$and).toEqual([{ UserId: { $in: ['me'] } }]);
    });
});
