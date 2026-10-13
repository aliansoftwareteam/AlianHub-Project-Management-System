const fakeMongo = require('./fixtures/fakeMongo');

let dbs;
const dbOf = (companyId) => { dbs[companyId] = dbs[companyId] || fakeMongo.create(); return dbs[companyId]; };
const mockCrud = jest.fn((companyId, ...rest) => dbOf(companyId).crud(companyId, ...rest));
const mockChat = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockCrud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/AICore/llmProvider', () => ({ getProvider: () => ({ chat: (...args) => mockChat(...args) }) }));

const { myCache } = require('../Config/config');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { settingsCollectionDocs } = require('../Config/collections');

const COMPANY = 'c00000000000000000000001';
const OTHER_COMPANY = 'c00000000000000000000002';
const USERS = { owner: 'a00000000000000000000001', admin: 'a00000000000000000000002', member: 'a00000000000000000000003', guest: 'a00000000000000000000004' };
const ROLES = { owner: 1, admin: 2, member: 3, guest: 0 };
const TEMPLATE_ID = 'b00000000000000000000001';

const routesOf = (modulePath) => {
    const table = {};
    const register = (method) => (path, ...handlers) => { table[`${method} ${path}`] = handlers; };
    const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') };
    require(modulePath).init(app);
    return table;
};

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.json = jest.fn((body) => { res.body = body; return res; });
    res.send = res.json;
    res.set = jest.fn(() => res);
    return res;
};

const run = async (handlers, request) => {
    const res = response();
    for (const handler of handlers) {
        let advanced = false;
        await handler(request, res, () => { advanced = true; });
        if (!advanced) break;
    }
    return res;
};

const AI_TEMPLATE = {
    TemplateName: 'Launch',
    Description: 'A launch plan',
    taskStatusData: [{ type: 'default_active', name: 'To Do' }, { type: 'active', name: 'Doing' }, { type: 'close', name: 'Complete' }],
    TemplateTaskType: [{ name: 'Task', value: 'task' }],
    projectStatusData: [{ type: 'default_active', name: 'Open', value: 'open' }, { type: 'active', name: 'Live', value: 'live' }, { type: 'close', name: 'Close', value: 'close' }],
};

const REQUESTS = {
    create: { path: 'POST /api/v1/project/template/custom', body: { data: { TemplateName: 'Client onboarding' } }, params: {} },
    aiGenerate: { path: 'POST /api/v1/project/template/custom/ai-generate', body: { category: 'Marketing', useCaseDescription: 'A product launch' }, params: {} },
    delete: { path: 'DELETE /api/v1/project/template/custom/:id', body: {}, params: { id: TEMPLATE_ID } },
};

const call = (name, role, companyId = COMPANY) => {
    const { path, body, params } = REQUESTS[name];
    return run(routesOf('../Modules/ProjectTemplates/routes')[path], { uid: USERS[role], headers: { companyid: companyId }, body, params, query: {} });
};

const templateWrites = () => mockCrud.mock.calls.filter(([, { type }, method]) => type === SCHEMA_TYPE.PROJECT_TEMPLATES && method !== 'find');
const storedTemplates = (companyId = COMPANY) => dbOf(companyId).store[SCHEMA_TYPE.PROJECT_TEMPLATES] || [];

const seedCompany = (companyId, roles) => {
    Object.entries(roles).forEach(([role, roleType]) => {
        dbOf(companyId).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: USERS[role], roleType, status: 2, isDelete: false });
    });
    dbOf(companyId).seed(SCHEMA_TYPE.PROJECT_TEMPLATES, { _id: TEMPLATE_ID, TemplateName: 'Existing' });
    [settingsCollectionDocs.TASK_STATUS, settingsCollectionDocs.TASK_TYPE, settingsCollectionDocs.PROJECT_STATUS].forEach((name) => {
        dbOf(companyId).seed(SCHEMA_TYPE.SETTINGS, { name, settings: [] });
    });
};

beforeEach(() => {
    myCache.flushAll();
    dbs = {};
    mockCrud.mockClear();
    mockChat.mockReset();
    mockChat.mockResolvedValue({ content: JSON.stringify(AI_TEMPLATE) });
    seedCompany(COMPANY, ROLES);
});

describe.each(Object.keys(REQUESTS))('project template %s follows the company template role rule', (name) => {
    it.each(['member', 'guest'])('refuses a %s with 403, writing nothing and calling no model', async (role) => {
        const res = await call(name, role);
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual(expect.objectContaining({ status: false }));
        expect(templateWrites()).toHaveLength(0);
        expect(storedTemplates()).toHaveLength(1);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('refuses a caller with no seat in the company', async () => {
        const res = await call(name, 'admin', OTHER_COMPANY);
        expect(res.statusCode).toBe(403);
        expect(templateWrites()).toHaveLength(0);
        expect(mockChat).not.toHaveBeenCalled();
    });

    it('judges the role in the company the request names, not another company the caller administers', async () => {
        seedCompany(OTHER_COMPANY, { member: ROLES.admin });
        const res = await call(name, 'member');
        expect(res.statusCode).toBe(403);
        expect(templateWrites()).toHaveLength(0);
        expect(storedTemplates(OTHER_COMPANY)).toHaveLength(1);
    });

    it.each(['owner', 'admin'])('lets an %s through', async (role) => {
        const res = await call(name, role);
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ status: true }));
    });
});

describe('an owner or admin writes in their own company only', () => {
    it('saves a new template to the request company', async () => {
        await call('create', 'admin');
        expect(storedTemplates().map((t) => t.TemplateName)).toEqual(['Existing', 'Client onboarding']);
        expect(templateWrites().every(([companyId]) => companyId === COMPANY)).toBe(true);
    });

    it('deletes the template from the request company', async () => {
        seedCompany(OTHER_COMPANY, {});
        await call('delete', 'owner');
        expect(storedTemplates()).toHaveLength(0);
        expect(storedTemplates(OTHER_COMPANY)).toHaveLength(1);
    });

    it('bills the AI draft to the request company', async () => {
        await call('aiGenerate', 'admin');
        expect(mockChat).toHaveBeenCalledTimes(1);
        expect(mockChat.mock.calls[0][0].spend).toEqual(expect.objectContaining({ companyId: COMPANY, userId: USERS.admin }));
    });
});

describe('reads stay open to every member', () => {
    it.each(['member', 'guest'])('lists the company templates for a %s', async (role) => {
        const res = await run(routesOf('../Modules/ProjectTemplates/routes')['GET /api/v1/project/template/custom'], { uid: USERS[role], headers: { companyid: COMPANY }, body: {}, params: {}, query: {} });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.map((t) => t.TemplateName)).toEqual(['Existing']);
    });
});
