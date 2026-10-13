const mockCrud = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async () => 1), isPrivileged: (roleType) => roleType === 1 || roleType === 2 }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: { create: jest.fn() } }));

const mongoose = require('mongoose');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const cloud = require('../Modules/CloudStorage/controller');
const emailIn = require('../Modules/EmailIn/controller');
const integrations = require('../Modules/Integrations/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const SOMEONE_ELSE = '6f0000000000000000000002';
const PROJECT = '6f0000000000000000000b01';
const SPRINT = '6f0000000000000000000e01';
const ROW = '6f0000000000000000000a01';

const call = async (handler, { body = {}, query = {}, params = {}, headers = { companyid: C }, aud = C, uid = ME } = {}) => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    r.json = r.send;
    await handler({ headers, aud, uid, body, query, params, ip: '' }, r);
    return r;
};

const companiesUsed = () => [...new Set(mockCrud.mock.calls.map(([companyId]) => String(companyId)))];
const saved = (type) => mockCrud.mock.calls.filter(([, q, method]) => q.type === type && method === 'save').map(([, q]) => q.data);

beforeEach(() => {
    jest.clearAllMocks();
    mockCrud.mockImplementation(async (companyId, { type, data }, method) => {
        if (type === SCHEMA_TYPE.PROJECTS && method === 'findOne') return { _id: new mongoose.Types.ObjectId(PROJECT), ProjectName: 'Shop', ProjectCode: 'SHP' };
        if (type === SCHEMA_TYPE.SPRINTS && method === 'find') return [{ _id: SPRINT, name: 'Sprint 1' }];
        if (method === 'save') return data;
        if (method === 'find') return [];
        if (method === 'findOneAndUpdate') return { _id: ROW, type: 'zapier', config: {}, enabled: false };
        return null;
    });
});

describe('cloud storage takes the company from the verified request', () => {
    it('lists providers for the header company', async () => {
        const r = await call(cloud.listProviders);

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a query naming another company and reads nothing', async () => {
        const r = await call(cloud.listProviders, { query: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a body naming another company and writes nothing', async () => {
        const r = await call(cloud.clearSettings, { params: { provider: 'google_drive' }, body: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});

describe('email-in inboxes take the company and user from the verified request', () => {
    const inbox = (over = {}) => ({ projectId: PROJECT, userData: { id: ME, Employee_Name: 'Me' }, ...over });

    it('creates an inbox in the header company for the signed-in user', async () => {
        const r = await call(emailIn.createInbox, { body: inbox() });

        expect(r.body).toMatchObject({ status: true });
        const [doc] = saved(SCHEMA_TYPE.EMAIL_INBOXES);
        expect(doc).toMatchObject({ companyId: C, createdBy: ME, userSnapshot: { id: ME } });
    });

    it('attributes the inbox to the signed-in user when the body names none', async () => {
        const r = await call(emailIn.createInbox, { body: inbox({ userData: { Employee_Name: 'Me' } }) });

        expect(r.body).toMatchObject({ status: true });
        const [doc] = saved(SCHEMA_TYPE.EMAIL_INBOXES);
        expect(doc).toMatchObject({ createdBy: ME, userSnapshot: { id: ME } });
    });

    it('refuses an inbox whose tasks would be created as another user', async () => {
        const r = await call(emailIn.createInbox, { body: inbox({ userData: { id: SOMEONE_ELSE, Employee_Name: 'Them' } }) });

        expect(r.code).toBe(403);
        expect(saved(SCHEMA_TYPE.EMAIL_INBOXES)).toHaveLength(0);
    });

    it('refuses a body naming another company and writes nothing', async () => {
        const r = await call(emailIn.createInbox, { body: inbox({ companyId: OTHER_COMPANY }) });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a list query naming another company', async () => {
        const r = await call(emailIn.listInboxes, { query: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('lists the header company inboxes for a normal call', async () => {
        const r = await call(emailIn.listInboxes);

        expect(r.body).toMatchObject({ status: true });
        expect(mockCrud.mock.calls[0][1].data[0]).toMatchObject({ companyId: C });
    });
});

describe('integrations take the company from the verified request', () => {
    it('lists the header company connections', async () => {
        const r = await call(integrations.listConnections);

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });

    it('updates a connection in the header company', async () => {
        const r = await call(integrations.updateConnection, { params: { id: ROW }, body: { enabled: false } });

        expect(r.body).toMatchObject({ status: true });
        expect(companiesUsed()).toEqual([C]);
    });

    it('refuses a list query naming another company', async () => {
        const r = await call(integrations.listConnections, { query: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });

    it('refuses a write whose body names another company', async () => {
        const r = await call(integrations.updateConnection, { params: { id: ROW }, body: { enabled: false, companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
        expect(mockCrud).not.toHaveBeenCalled();
    });
});
