const mockCrud = jest.fn();
const mockPrepared = { companyId: undefined };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ getCompanyDataFun: jest.fn(async () => []) }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => {
    const actual = jest.requireActual('../Modules/Tasks/helpers/taskWriteFields');
    // The prepared payload is the body the handler goes on with; a payload naming some other company must not steer it.
    return { ...actual, prepareOrRefuse: jest.fn(async (req) => ({ ...req.body, ...(mockPrepared.companyId ? { companyId: mockPrepared.companyId } : {}) })) };
});

const ctrl = require('../Modules/taskIndex/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const TASK = '6f0000000000000000000d01';
const PROJECT = '6f0000000000000000000b01';

const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise(setImmediate); };

const call = async (handler, body, { headers = { companyid: C }, aud = C } = {}) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    await handler({ headers, aud, uid: '6f0000000000000000000001', body, query: {}, params: {} }, r);
    await settle();
    return r;
};

const reorder = (over = {}) => ({
    taskId: TASK, projectId: PROJECT, sprintId: 's1', relevantIndex: 10, indexName: 'groupByStatusIndex',
    relevantKey: 1, searchKey: 'statusKey', taskKey: 'T-1', isFirst: false, isFirstWithRecord: false, updateData: {}, ...over,
});
const onload = (over = {}) => ({ taskUpdate: { data: TASK, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 } }, ...over });

const companiesUsed = () => [...new Set(mockCrud.mock.calls.map(([companyId]) => String(companyId)))];

beforeEach(() => {
    jest.clearAllMocks();
    mockPrepared.companyId = undefined;
    mockCrud.mockImplementation(async (companyId, q, method) => {
        if (method === 'aggregate') return [];
        if (method === 'findOne') return { _id: TASK, ProjectID: PROJECT, TaskKey: 'T-1' };
        return { _id: TASK, groupByStatusIndex: 0 };
    });
});

describe.each([
    ['updateTaskIndex', () => ctrl.updateTaskIndex, reorder],
    ['updateTaskIndexWhenLoad', () => ctrl.updateTaskIndexWhenLoad, onload],
])('%s takes the company from the verified request', (name, handler, body) => {
    it('works on the header company for a normal call', async () => {
        const r = await call(handler(), body());

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a body naming another company and touches nothing', async () => {
        const r = await call(handler(), body({ companyId: OTHER_COMPANY }));

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('stays on the verified company even when the prepared payload names another', async () => {
        mockPrepared.companyId = OTHER_COMPANY;
        const r = await call(handler(), body());

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });
});
