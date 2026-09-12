const mockCrud = jest.fn(async (companyId, mongoObj) => ({ _id: 'row', TaskId: mongoObj.data[1].$set.TaskId }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(),
    evaluatePermission: jest.fn(),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({ estimateAndPersist: jest.fn(), _internal: {} }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({ updateRemainingTime: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const estimates = require('../Modules/EstimatedTime/controller');

const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const OTHER = '6f0000000000000000000002';
const P1 = '6f0000000000000000000b01';
const P2 = '6f0000000000000000000b02';
const T1 = '6f0000000000000000000a01';
const ROW = '6f0000000000000000000d01';
const DATE = '2026-05-01T00:00:00.000Z';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};

const save = async (body, uid = ME) => {
    const r = res();
    await estimates.updateEstimatedTime({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r);
    return r;
};

const plan = (over = {}) => ({ userId: ME, taskId: T1, projectId: P1, date: DATE, minutes: 60, ...over });
const grant = (byKey) => evaluatePermission.mockImplementation(async (company, uid, key) => (key in byKey ? byKey[key] : null));
const sent = () => {
    expect(mockCrud).toHaveBeenCalledTimes(1);
    return { filter: mockCrud.mock.calls[0][1].data[0], update: mockCrud.mock.calls[0][1].data[1], options: mockCrud.mock.calls[0][1].data[2] };
};

beforeEach(() => {
    jest.clearAllMocks();
    visibleProjectIds.mockResolvedValue([P1]);
    grant({});
});

describe('PUT /api/v1/estimatedTime', () => {
    it.each([
        ['a raw Mongo query in place of the row', { key: '$set', compareObj: { _id: ROW }, updateObject: { EstimatedTime: 1 } }],
        ['an options object', { ...plan(), newObj: { upsert: true } }],
        ['an operator where the person should be', plan({ userId: { $ne: null } })],
        ['an operator where the row should be', plan({ id: { $gt: '' } })],
        ['an operator where the project should be', plan({ projectId: { $in: [P1, P2] } })],
        ['minutes that are not a number', plan({ minutes: { $inc: 5 } })],
        ['minutes below zero', plan({ minutes: -1 })],
        ['minutes beyond a day', plan({ minutes: 1441 })],
        ['a date that is not a date', plan({ date: 'whenever' })],
        ['a missing task', plan({ taskId: undefined })],
        ['a body that is not an object', 'UserId'],
    ])('refuses %s and writes nothing', async (label, body) => {
        getRoleType.mockResolvedValue(3);
        const r = await save(body);
        expect([label, r.code]).toEqual([label, 400]);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a member planning for someone else', async () => {
        getRoleType.mockResolvedValue(3);
        const r = await save(plan({ userId: OTHER }));
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a member on a project they cannot open', async () => {
        getRoleType.mockResolvedValue(3);
        const r = await save(plan({ projectId: P2 }));
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses someone who is not in the company', async () => {
        getRoleType.mockResolvedValue(null);
        visibleProjectIds.mockResolvedValue([]);
        const r = await save(plan());
        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('upserts a member\'s own row on the person, day and task', async () => {
        getRoleType.mockResolvedValue(3);
        const r = await save(plan());
        expect(r.code).toBe(200);
        const { filter, update, options } = sent();
        expect(filter).toEqual({ userId: ME, Date: new Date(DATE), TaskId: T1 });
        expect(update).toEqual({ $set: { UserId: ME, userId: ME, TaskId: T1, ProjectId: P1, Date: new Date(DATE), EstimatedTime: 60 } });
        expect(options.upsert).toBe(true);
    });

    it('keeps a member\'s own scope in the filter when they name a row by id', async () => {
        getRoleType.mockResolvedValue(3);
        await save(plan({ id: ROW }));
        const { filter, options } = sent();
        expect(String(filter._id)).toBe(ROW);
        expect(filter.$or).toEqual([{ UserId: ME }, { UserId: { $exists: false }, userId: ME }]);
        expect(filter.ProjectId).toEqual({ $in: [P1] });
        expect(options.upsert).toBe(false);
    });

    it('answers 404 when the named row is not one the caller may write', async () => {
        getRoleType.mockResolvedValue(3);
        mockCrud.mockResolvedValueOnce(null);
        const r = await save(plan({ id: ROW }));
        expect(r.code).toBe(404);
    });

    it('lets an admin plan anyone\'s time company-wide', async () => {
        getRoleType.mockResolvedValue(2);
        const r = await save(plan({ userId: OTHER, projectId: P2, id: ROW }));
        expect(r.code).toBe(200);
        const { filter, update } = sent();
        expect(filter.$or).toBeUndefined();
        expect(filter.ProjectId).toBeUndefined();
        expect(update.$set.UserId).toBe(OTHER);
    });

    it.each([
        ['workload', 'sheet_settings.workload_timesheet'],
        ['project', 'sheet_settings.project_timesheet'],
    ])('lets a member granted Everyone on the %s timesheet plan for others on visible projects only', async (label, key) => {
        getRoleType.mockResolvedValue(3);
        grant({ [key]: 2 });
        const ok = await save(plan({ userId: OTHER }));
        expect(ok.code).toBe(200);
        expect(sent().update.$set.UserId).toBe(OTHER);

        mockCrud.mockClear();
        const hidden = await save(plan({ userId: OTHER, projectId: P2 }));
        expect(hidden.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('never lets the body reach Mongo as an update operator', async () => {
        getRoleType.mockResolvedValue(1);
        await save({ ...plan(), $where: 'true', EstimatedTime: 5 });
        expect(Object.keys(sent().update)).toEqual(['$set']);
    });
});
