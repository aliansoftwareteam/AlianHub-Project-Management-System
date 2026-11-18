const mockCrud = jest.fn(async () => []);

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async () => 1),
    evaluatePermission: jest.fn(async () => true),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => []) }));
jest.mock('../Modules/PersonalList/ownership', () => ({ ...jest.requireActual('../Modules/PersonalList/ownership'), othersPersonalListIds: jest.fn(async () => []) }));
jest.mock('../Modules/Agents/privateWork', () => ({
    ...jest.requireActual('../Modules/Agents/privateWork'),
    privateWorkOf: jest.fn(async (companyId, uid) => ({ uid: String(uid), personalLists: [], directSpaces: [], myChats: [], myRuns: [] })),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getTrackerTimeSheet } = require('../Modules/TimeSheet/controller/trackerTimeSheet');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    return r;
};

const pipelineOf = () => mockCrud.mock.calls.find(([, query, method]) => method === 'aggregate' && query.type === SCHEMA_TYPE.TIMESHEET)[1].data[0];

beforeEach(() => mockCrud.mockClear());

describe('the tracker timesheet of a whole day, asked for once', () => {
    it('answers each log with when it started and ended, so the screen can place it in its hours', async () => {
        const answer = res();
        await getTrackerTimeSheet({ headers: { companyid: C }, uid: OWNER, body: { selectedFilter: [], userArray: [], start: 0, end: 86400 } }, answer);
        expect(answer.code).toBe(200);
        const group = pipelineOf().find((stage) => stage.$group).$group;
        expect(group.data.$push).toMatchObject({ LogStartTime: '$LogStartTime', LogEndTime: '$LogEndTime', trackShots: '$trackShots', ProjectId: '$ProjectId' });
    });

    it('reads the logs that reach into the span asked for, in the caller\'s company', async () => {
        await getTrackerTimeSheet({ headers: { companyid: C }, uid: OWNER, body: { selectedFilter: [], userArray: [], start: 100, end: 200 } }, res());
        const [companyId] = mockCrud.mock.calls.find(([, query, method]) => method === 'aggregate' && query.type === SCHEMA_TYPE.TIMESHEET);
        expect(companyId).toBe(C);
        expect(pipelineOf()[0].$match).toMatchObject({ LogEndTime: { $gte: 100 }, LogStartTime: { $lte: 200 }, logAddType: 1 });
    });
});
