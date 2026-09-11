jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    ROLE_OWNER: 1,
    ROLE_ADMIN: 2,
    getRoleType: jest.fn(),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(),
    isWritable: (permission) => permission === true || permission === 1 || permission === 2,
}));
jest.mock('../utils/data', () => ({ importCompanyRules: jest.fn(), importSettingTemplate: jest.fn(), importUserNotifications: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: {} }));
jest.mock('../Config/config', () => ({ myCache: { get: jest.fn(), set: jest.fn(), getTtl: jest.fn() } }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { visibleProjectIds } = require('../Modules/Agents/scope');
const { getRoleType, evaluatePermission } = require('../Config/permissionGuard');
const importData = require('../utils/data');
const exportJobs = require('../Modules/ExportJobs/controller');
const importers = require('../Modules/Importers/controller');
const importSettings = require('../Modules/ImportSettings/controller');
const apps = require('../Modules/Apps/controller');

const COMPANY = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const ALICE = '6f00000000000000000000a1';
const BOB = '6f00000000000000000000b2';
const PROJECT = '6f0000000000000000000d01';
const JOB = '6f0000000000000000000e01';

const fakeReq = ({ uid, query = {}, body = {}, params = {} } = {}) => ({ uid, headers: { companyid: COMPANY }, query, body, params });

const fakeRes = () => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((body) => { res.body = body; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.set = jest.fn(() => res);
    res.download = jest.fn(() => res);
    return res;
};

const flush = () => new Promise((resolve) => setImmediate(resolve));
const saveCall = () => MongoDbCrudOpration.mock.calls.find((call) => call[2] === 'save');

beforeEach(() => {
    jest.resetAllMocks();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('PAG-01 export jobs belong to the session user', () => {
    it('refuses a list request for another user', async () => {
        const res = fakeRes();
        await exportJobs.listExports(fakeReq({ uid: ALICE, query: { uid: BOB } }), res);
        expect(res.statusCode).toBe(403);
        expect(res.body.status).toBe(false);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('lists the caller\'s own jobs by the session uid', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ _id: JOB }]);
        const res = fakeRes();
        await exportJobs.listExports(fakeReq({ uid: ALICE }), res);
        expect(res.body).toEqual({ status: true, statusText: expect.any(String), data: [{ _id: JOB }] });
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ userId: ALICE });
    });

    it('still accepts the caller\'s own uid in the query', async () => {
        MongoDbCrudOpration.mockResolvedValue([]);
        const res = fakeRes();
        await exportJobs.listExports(fakeReq({ uid: ALICE, query: { uid: ALICE } }), res);
        expect(res.body.status).toBe(true);
    });

    it('answers 404 to a download of another user\'s job', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, obj) => (obj.data[0].userId === BOB ? { status: 'done', filePath: '/x.csv', fileName: 'x.csv' } : null));
        const res = fakeRes();
        await exportJobs.downloadExport(fakeReq({ uid: ALICE, query: { uid: BOB }, params: { id: JOB } }), res);
        expect(res.statusCode).toBe(404);
        expect(res.download).not.toHaveBeenCalled();
    });

    it('downloads the caller\'s own finished job', async () => {
        MongoDbCrudOpration.mockImplementation(async (companyId, obj) => (obj.data[0].userId === ALICE ? { status: 'done', filePath: '/x.csv', fileName: 'x.csv' } : null));
        const res = fakeRes();
        await exportJobs.downloadExport(fakeReq({ uid: ALICE, params: { id: JOB } }), res);
        expect(res.download).toHaveBeenCalledWith('/x.csv', 'x.csv');
    });

    it('records a new job against the session uid, not userData', async () => {
        visibleProjectIds.mockResolvedValue([PROJECT]);
        MongoDbCrudOpration.mockImplementation(async (companyId, obj, method) => (method === 'save' ? { _id: JOB, ...obj.data } : null));
        const res = fakeRes();
        await exportJobs.createExport(fakeReq({ uid: ALICE, body: { format: 'csv', projectId: PROJECT, userData: { id: BOB } } }), res);
        expect(res.body.status).toBe(true);
        expect(saveCall()[1].data.userId).toBe(ALICE);
        await flush();
    });
});

describe('PAG-02 export requires a visible project', () => {
    it('answers 404 when the caller cannot see the project', async () => {
        visibleProjectIds.mockResolvedValue(['6f0000000000000000000d99']);
        const res = fakeRes();
        await exportJobs.createExport(fakeReq({ uid: ALICE, body: { format: 'csv', projectId: PROJECT } }), res);
        expect(visibleProjectIds).toHaveBeenCalledWith(COMPANY, ALICE);
        expect(res.statusCode).toBe(404);
        expect(res.body.status).toBe(false);
        expect(saveCall()).toBeUndefined();
    });

    it('queues an export of a project the caller can see', async () => {
        visibleProjectIds.mockResolvedValue([PROJECT]);
        MongoDbCrudOpration.mockImplementation(async (companyId, obj, method) => (method === 'save' ? { _id: JOB, ...obj.data } : null));
        const res = fakeRes();
        await exportJobs.createExport(fakeReq({ uid: ALICE, body: { format: 'xlsx', projectId: PROJECT } }), res);
        expect(res.body.status).toBe(true);
        expect(saveCall()[1].data.filters.projectId).toBe(PROJECT);
        await flush();
    });
});

describe('PAG-03 import history belongs to the session user', () => {
    it('refuses a list request for another user', async () => {
        const res = fakeRes();
        await importers.listImports(fakeReq({ uid: ALICE, query: { uid: BOB } }), res);
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('lists the caller\'s own imports by the session uid', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ source: 'csv' }]);
        const res = fakeRes();
        await importers.listImports(fakeReq({ uid: ALICE }), res);
        expect(res.body).toEqual({ status: true, statusText: expect.any(String), data: [{ source: 'csv' }] });
        expect(MongoDbCrudOpration.mock.calls[0][1].data[0]).toEqual({ userId: ALICE });
    });
});

describe('PAG-04 settings and rules imports are gated', () => {
    const templates = [{ TemplateName: 'T', TemplateId: 't1', category: 'category' }];

    it('refuses a template import from a member', async () => {
        getRoleType.mockResolvedValue(3);
        const res = fakeRes();
        await importSettings.importTemplate(fakeReq({ uid: ALICE, body: { companyId: COMPANY, templates } }), res);
        expect(res.statusCode).toBe(403);
        expect(importData.importSettingTemplate).not.toHaveBeenCalled();
    });

    it('imports templates for an admin into the header company', async () => {
        getRoleType.mockResolvedValue(2);
        importData.importSettingTemplate.mockImplementation((companyId, list, cb) => cb({ status: true, statusText: 'ok' }));
        const res = fakeRes();
        await importSettings.importTemplate(fakeReq({ uid: ALICE, body: { companyId: OTHER_COMPANY, templates } }), res);
        expect(importData.importSettingTemplate).toHaveBeenCalledWith(COMPANY, templates, expect.any(Function));
        expect(res.body.status).toBe(true);
    });

    it('refuses a company-wide rules import from a member', async () => {
        getRoleType.mockResolvedValue(3);
        const res = fakeRes();
        await importSettings.importSettingsProjectFunction(fakeReq({ uid: ALICE, body: { companyId: COMPANY } }), res);
        await flush();
        expect(res.statusCode).toBe(403);
        expect(importData.importCompanyRules).not.toHaveBeenCalled();
    });

    it('re-imports company rules for an admin', async () => {
        getRoleType.mockResolvedValue(2);
        importData.importCompanyRules.mockResolvedValue([]);
        const res = fakeRes();
        await importSettings.importSettingsProjectFunction(fakeReq({ uid: ALICE, body: { companyId: OTHER_COMPANY } }), res);
        await flush();
        expect(importData.importCompanyRules).toHaveBeenCalledWith(COMPANY, undefined, undefined);
        expect(res.body.status).toBe(true);
    });

    it('applies project rules for a member holding the security-permissions setting', async () => {
        getRoleType.mockResolvedValue(3);
        evaluatePermission.mockResolvedValue(true);
        importData.importCompanyRules.mockResolvedValue([]);
        const res = fakeRes();
        await importSettings.importSettingsProjectFunction(fakeReq({ uid: ALICE, body: { companyId: COMPANY, type: 'project', projectId: PROJECT } }), res);
        await flush();
        expect(evaluatePermission).toHaveBeenCalledWith(COMPANY, ALICE, 'settings.settings_security_permissions');
        expect(importData.importCompanyRules).toHaveBeenCalledWith(COMPANY, 'project', PROJECT);
        expect(res.body.status).toBe(true);
    });

    it('refuses project rules to a member without that setting', async () => {
        getRoleType.mockResolvedValue(3);
        evaluatePermission.mockResolvedValue(null);
        const res = fakeRes();
        await importSettings.importSettingsProjectFunction(fakeReq({ uid: ALICE, body: { companyId: COMPANY, type: 'project', projectId: PROJECT } }), res);
        await flush();
        expect(res.statusCode).toBe(403);
        expect(importData.importCompanyRules).not.toHaveBeenCalled();
    });

    it('refuses the full settings import to an admin, because it writes an owner row', async () => {
        getRoleType.mockResolvedValue(2);
        const run = jest.spyOn(importSettings, 'importSettingsFunction').mockImplementation((req, cb) => cb({ status: true }));
        const res = fakeRes();
        await importSettings.importSettings(fakeReq({ uid: ALICE, body: { companyId: COMPANY, uid: ALICE, email: 'a@x.io' } }), res);
        expect(res.statusCode).toBe(403);
        expect(run).not.toHaveBeenCalled();
    });

    it('runs the full settings import for the owner, as themselves, in the header company', async () => {
        getRoleType.mockResolvedValue(1);
        const run = jest.spyOn(importSettings, 'importSettingsFunction').mockImplementation((req, cb) => cb({ status: true }));
        const res = fakeRes();
        await importSettings.importSettings(fakeReq({ uid: ALICE, body: { companyId: OTHER_COMPANY, uid: BOB, email: 'a@x.io' } }), res);
        expect(run.mock.calls[0][0].body).toEqual(expect.objectContaining({ companyId: COMPANY, uid: ALICE }));
        expect(res.body.status).toBe(true);
    });
});

describe('PAG-06 projects-apps envelope', () => {
    it('wraps the app list in the standard envelope', async () => {
        MongoDbCrudOpration.mockResolvedValue([{ key: 'Priority' }, { key: 'IncompleteWarning' }]);
        const res = fakeRes();
        await apps.getApps(fakeReq({ uid: ALICE }), res);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ status: true, statusText: expect.any(String), data: [{ key: 'Priority' }] });
    });

    it('reports a failure as status false', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('boom'));
        const res = fakeRes();
        await apps.getApps(fakeReq({ uid: ALICE }), res);
        expect(res.statusCode).toBe(500);
        expect(res.body).toEqual(expect.objectContaining({ status: false, statusText: expect.any(String) }));
    });
});
