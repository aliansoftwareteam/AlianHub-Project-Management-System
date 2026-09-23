const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/notification-count/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const TEAMMATE = '6f0000000000000000000002';
const OUTSIDER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000d01';
const TASK = '6f0000000000000000000e01';
const ACTIVE_MEMBERS = [ME, TEAMMATE];

const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const call = async (body, uid = ME) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    await ctrl.updateUnReadCommentsCount({ headers: { companyid: C }, body, query: {}, params: {}, uid }, r);
    await settle();
    return r;
};

const countWrites = () => mockCrud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.USERID && method === 'findOneAndUpdate');
const writtenUsers = () => countWrites().map(([, { data }]) => String(data[0].userId));
const writtenCompanies = () => [...new Set(countWrites().map(([companyId]) => String(companyId)))];

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === SCHEMA_TYPE.COMPANY_USERS && method === 'find') {
            const asked = (data[0].userId && data[0].userId.$in) || [];
            return asked.filter((id) => ACTIVE_MEMBERS.includes(String(id))).map((userId) => ({ userId }));
        }
        if (type === SCHEMA_TYPE.USERID && method === 'find') return [{ _id: 'row', userId: ME }];
        if (method === 'findOneAndUpdate') return { _id: 'row', userId: data[0].userId };
        return null;
    });
});

describe('updateunreadcommentscount takes the company and user from the verified request', () => {
    it('refuses a body that names another company and writes nothing', async () => {
        const r = await call({ companyId: OTHER_COMPANY, key: 1, projectId: PROJECT, userIds: [TEAMMATE] });

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(countWrites()).toHaveLength(0);
    });

    it.each([
        ['marking a project read', { key: 1, projectId: PROJECT, read: true }],
        ['marking a task read', { key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, read: true, prevCount: 2 }],
        ['marking a task unread', { key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, set: true, messageCount: 3 }],
        ['clearing all mentions', { key: 4, readAll: true }],
        ['reading one notification', { key: 5, read: true, readAll: false }],
    ])('refuses %s for someone other than the signed-in user', async (_label, body) => {
        const r = await call({ companyId: C, userIds: [TEAMMATE], ...body });

        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
        expect(countWrites()).toHaveLength(0);
    });

    it('marks the signed-in user read, as the comment panel sends it', async () => {
        const r = await call({ companyId: C, key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, userIds: [ME], read: true, messageCount: 0, prevCount: 0 });

        expect(r.body.status).toBe(true);
        expect(writtenUsers()).toEqual([ME]);
        expect(writtenCompanies()).toEqual([C]);
    });

    it('clears the signed-in user\'s mentions when the body names no user', async () => {
        const r = await call({ companyId: C, key: 4, readAll: true });

        expect(r.body.status).toBe(true);
        expect(writtenUsers()).toEqual([ME]);
    });

    it('bumps the unread count of other active members, as sending a comment does', async () => {
        const r = await call({ companyId: C, key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, userIds: [TEAMMATE], prevCount: 0 });

        expect(r.body.status).toBe(true);
        expect(writtenUsers()).toEqual([TEAMMATE]);
        expect(writtenCompanies()).toEqual([C]);
    });

    it('ignores recipients who are not active members of the session company', async () => {
        const r = await call({ companyId: C, key: 1, projectId: PROJECT, userIds: [TEAMMATE, OUTSIDER] });

        expect(r.body.status).toBe(true);
        expect(writtenUsers()).toEqual([TEAMMATE]);
    });

    it('works when the body carries no companyId at all', async () => {
        const r = await call({ key: 4, userIds: [TEAMMATE], readAll: false });

        expect(r.body.status).toBe(true);
        expect(writtenUsers()).toEqual([TEAMMATE]);
        expect(writtenCompanies()).toEqual([C]);
    });

    it('still serves server-side callers that build the body themselves', async () => {
        const result = await ctrl.updateUnReadCommentsCountFun({ body: { companyId: C, key: 5, userIds: [OUTSIDER], readAll: false } });

        expect(result.status).toBe(true);
        expect(writtenUsers()).toEqual([OUTSIDER]);
    });
});
