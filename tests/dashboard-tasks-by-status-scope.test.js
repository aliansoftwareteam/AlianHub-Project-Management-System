const fakeMongo = require('./fixtures/fakeMongo');

const mockDb = fakeMongo.create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getTasksByStatus } = require('../Modules/UserDashboard/controller');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const P_OPEN = '6f0000000000000000000b01';
const PL_MEMBER = '6f0000000000000000000b02';
const PL_OWNER = '6f0000000000000000000b03';
const CHAT = '6f0000000000000000000b09';
const T_OPEN = '6f0000000000000000000a01';
const T_MEMBER = '6f0000000000000000000a02';
const T_OWNER = '6f0000000000000000000a03';
const T_CHAT = '6f0000000000000000000a04';

const WINDOW = { dateFrom: '2026-09-01T00:00:00Z', dateTo: '2026-09-03T00:00:00Z' };
const LOGGED_AT = Date.parse('2026-09-02T09:00:00Z') / 1000;

const card = async (uid, body = {}) => {
    const res = { code: 200, body: null };
    res.status = (code) => { res.code = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    mockDb.crud.mockClear();
    await getTasksByStatus({ headers: { companyid: C }, uid, body: { ...WINDOW, ...body }, query: {}, params: {} }, res);
    expect(res.code).toBe(200);
    return res.body.data;
};

/* Every task the card's queries could have read, whatever shape they were asked in. */
const tasksRead = () => {
    const seen = new Set();
    mockDb.crud.mock.calls.filter(([, query]) => query.type === SCHEMA_TYPE.TASKS).forEach(([, { data }, method]) => {
        const filters = method === 'aggregate' ? data[0].filter((stage) => stage.$match).map((stage) => stage.$match) : [data[0]];
        mockDb.store[SCHEMA_TYPE.TASKS].filter((task) => filters.every((filter) => fakeMongo.matches(task, filter))).forEach((task) => seen.add(task.TaskName));
    });
    return [...seen].sort();
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    myCache.flushAll();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    const project = (_id, ProjectName, extra = {}) => mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id, ProjectName, isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0, ...extra });
    project(P_OPEN, 'Open');
    project(PL_MEMBER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: MEMBER, AssigneeUserId: [MEMBER] });
    project(PL_OWNER, 'Personal', { isPrivateSpace: true, isPersonal: true, personalOwner: OWNER, AssigneeUserId: [OWNER] });
    const task = (_id, TaskName, ProjectID, AssigneeUserId, extra = {}) => mockDb.seed(SCHEMA_TYPE.TASKS, { _id, TaskName, ProjectID, AssigneeUserId, statusKey: 1, statusType: 'active', deletedStatusKey: 0, ...extra });
    task(T_OPEN, 'Shared work', P_OPEN, [MEMBER, OWNER]);
    task(T_MEMBER, 'Private errand', PL_MEMBER, [MEMBER]);
    task(T_OWNER, 'Owner errand', PL_OWNER, [OWNER]);
    task(T_CHAT, 'A chat', CHAT, [MEMBER, ADMIN], { mainChat: true });
    [[MEMBER, T_OPEN, P_OPEN], [MEMBER, T_MEMBER, PL_MEMBER], [OWNER, T_OWNER, PL_OWNER], [MEMBER, T_CHAT, CHAT]].forEach(([Loggeduser, TicketID, ProjectId]) => {
        mockDb.seed(SCHEMA_TYPE.TIMESHEET, { Loggeduser, TicketID, ProjectId, LogStartTime: LOGGED_AT, LogTimeDuration: 60 });
    });
});

describe('the tasks-by-status card', () => {
    it('counts every project for an owner, their own personal list, and nobody else\'s', async () => {
        const data = await card(OWNER);
        expect(data).toMatchObject({ total: 2, scope: 'company' });
        expect(tasksRead()).toEqual(['Owner errand', 'Shared work']);
    });

    it('counts every project for an admin, and no personal list or chat of someone else', async () => {
        const data = await card(ADMIN);
        expect(data).toMatchObject({ total: 1, scope: 'company' });
        expect(tasksRead()).toEqual(['Shared work']);
    });

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('opens no row of someone else\'s personal list for %s', async (_who, uid) => {
        const data = await card(uid, { drillStatusKey: 1, userId: MEMBER, drill: true, statusKey: 1 });
        expect(JSON.stringify(data)).not.toContain('Private errand');
        expect(tasksRead()).not.toContain('Private errand');
    });

    it('still counts a member\'s own personal list for them', async () => {
        const data = await card(MEMBER);
        expect(data).toMatchObject({ total: 2, scope: 'self' });
        expect(tasksRead()).toEqual(['Private errand', 'Shared work']);
    });
});
