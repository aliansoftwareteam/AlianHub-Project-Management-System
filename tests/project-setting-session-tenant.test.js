const mockCrud = jest.fn();
const mockEmit = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: (...a) => mockEmit(...a) }));
jest.mock('../Modules/Comments/controller', () => ({ updateCommentSprint: jest.fn(async () => true) }));

const ctrl = require('../Modules/projectSetting/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const PROJECT = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';

const BODIES = {
    changeTaskType: () => ({
        companyId: C,
        projectId: PROJECT,
        taskTypeKey: [1],
        oldTaskType: [{ key: 1, convertType: { key: 2, value: 'Bug' } }],
    }),
    changeTaskStatus: () => ({
        companyId: C,
        projectId: PROJECT,
        taskStatusKey: [1],
        oldTaskStatus: [{ key: 1, convertStatus: { key: 2, name: 'Done', type: 'close' } }],
    }),
};

const settle = () => new Promise((resolve) => setImmediate(resolve));

const call = async (handler, { body, headers = { companyid: C }, aud = C, uid = ME } = {}) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    await handler({ headers, body, query: {}, params: {}, uid, aud }, r);
    await settle();
    return r;
};

const companiesUsed = () => [...new Set(mockCrud.mock.calls.map(([companyId]) => String(companyId)))];
const updates = () => mockCrud.mock.calls.filter(([, , method]) => method === 'findOneAndUpdate');

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async (companyId, { type }, method) => {
        if (method === 'find' && type === 'tasks') {
            const doc = { _id: TASK, TaskTypeKey: 1, statusKey: 1 };
            return [{ ...doc, _doc: doc }];
        }
        if (method === 'find') return [];
        return { _id: TASK };
    });
});

describe.each(Object.keys(BODIES))('%s takes the company from the verified request', (name) => {
    const handler = ctrl[name];

    it('updates the tasks of the header company for a normal call', async () => {
        const r = await call(handler, { body: BODIES[name]() });

        expect(r.body).toMatchObject({ status: true });
        expect(updates()).toHaveLength(1);
        expect(companiesUsed()).toEqual([C]);
    });

    it('works when the body leaves companyId out', async () => {
        const body = BODIES[name]();
        delete body.companyId;
        const r = await call(handler, { body });

        expect(r.body).toMatchObject({ status: true });
        expect(updates()).toHaveLength(1);
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a body companyId naming another company and touches nothing', async () => {
        const r = await call(handler, { body: { ...BODIES[name](), companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(r.body).toMatchObject({ status: false });
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a body CompanyId naming another company and touches nothing', async () => {
        const body = BODIES[name]();
        delete body.companyId;
        const r = await call(handler, { body: { ...body, CompanyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a header company outside the session audience', async () => {
        const r = await call(handler, { body: { ...BODIES[name](), companyId: OTHER_COMPANY }, headers: { companyid: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('migrateSprintsFun takes the company from the verified request', () => {
    it('migrates the header company when the body names none', async () => {
        const r = await call(ctrl.migrateSprintsFun, { body: {} });

        expect(r.body).toMatchObject({ status: true });
        expect(mockCrud).toHaveBeenCalled();
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a signed-in body naming another company than the header', async () => {
        const r = await call(ctrl.migrateSprintsFun, { body: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('still lets an instance admin key script name the company in the body', async () => {
        const r = await call(ctrl.migrateSprintsFun, { body: { companyId: C }, headers: {}, aud: undefined, uid: undefined });

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });
});
