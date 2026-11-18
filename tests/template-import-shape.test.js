const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), log: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Modules/MainChats/controller', () => ({ updateMainChat: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    ROLE_OWNER: 1,
    getRoleType: jest.fn(async () => 2),
    isPrivileged: (roleType) => roleType === 1 || roleType === 2,
    evaluatePermission: jest.fn(),
    isWritable: () => false,
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const { importTemplate } = require('../Modules/ImportSettings/controller');

const C = '6f0000000000000000000c01';
const ADMIN = '6f00000000000000000000a1';
const MEMBER = '6f00000000000000000000a2';
const LEFT = '6f00000000000000000000a3';
const STORED = '6f0000000000000000000e01';
const OTHER_STORED = '6f0000000000000000000e02';
const T = SCHEMA_TYPE.PROJECT_TEMPLATES;

const template = (overrides = {}) => ({
    TemplateName: 'Website build',
    AssigneeUserId: [MEMBER],
    LeadUserId: [ADMIN],
    ProjectCurrency: { code: 'USD', name: 'US Dollar', symbol: '$' },
    ProjectRequiredDefaultComponent: 'ProjectListView',
    TemplateRequiredComponent: [{ keyName: 'ProjectListView' }],
    TemplateTaskType: [{ key: 1, name: 'Task' }],
    apps: [{ key: 'Priority', appStatus: true }],
    projectStatusData: [{ name: 'Active', type: 'default_active', value: 'active' }],
    taskStatusData: [{ name: 'To do', key: 1 }],
    ...overrides,
});

const send = async (templates) => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    res.send = res.json;
    await new Promise((resolve) => {
        const done = res.json;
        res.json = (body) => { done(body); resolve(); return res; };
        res.send = res.json;
        Promise.resolve(importTemplate(verified({ uid: ADMIN, headers: { companyid: C }, body: { templates } }), res)).catch(resolve);
    });
    return res;
};

const rows = () => mockDb.store[T] || [];
const writes = () => mockDb.calls.filter((call) => call.type === T && !['find', 'findOne'].includes(call.method));
const refused = (res) => res.statusCode === 400 && res.body.status === false;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    [ADMIN, MEMBER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType: 3, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 3, isDelete: true });
    mockDb.store[T] = [
        { _id: STORED, TemplateName: 'Kept', apps: [{ key: 'Priority', appStatus: true }] },
        { _id: OTHER_STORED, TemplateName: 'Also kept', apps: [] },
    ];
});

describe('a template import is written from the fields a template has', () => {
    it('stores a new template with its known fields and the session company', async () => {
        const res = await send([template({ somethingElse: 'x', CompanyId: 'another' })]);

        expect(res.body.status).toBe(true);
        const [write] = writes();
        expect(write.method).toBe('save');
        expect(write.data).toMatchObject({ TemplateName: 'Website build', CompanyId: C, apps: [{ key: 'Priority', appStatus: true }] });
        expect(write.data.somethingElse).toBeUndefined();
        expect(rows()).toHaveLength(3);
    });

    it('updates the template an id names, and only that one', async () => {
        const res = await send([template({ _id: STORED, TemplateName: 'Renamed' })]);

        expect(res.body.status).toBe(true);
        const [write] = writes();
        expect(write.method).toBe('findOneAndUpdate');
        expect(Object.keys(write.data[0])).toEqual(['_id']);
        expect(String(write.data[0]._id)).toBe(STORED);
        expect(Object.keys(write.data[1])).toEqual(['$set']);
        expect(write.data[2]).toEqual({ upsert: true, returnDocument: 'after' });
        expect(rows().find((row) => String(row._id) === STORED).TemplateName).toBe('Renamed');
        expect(rows().find((row) => String(row._id) === OTHER_STORED).TemplateName).toBe('Also kept');
    });

    it('drops the stored list cache after an import', async () => {
        await send([template()]);
        expect(removeCache).toHaveBeenCalledWith(`project_template_${C}`);
    });

    it('keeps only people who hold a seat here', async () => {
        await send([template({ AssigneeUserId: [MEMBER, LEFT, '6f00000000000000000000ff'], LeadUserId: [LEFT] })]);

        expect(writes()[0].data.AssigneeUserId).toEqual([MEMBER]);
        expect(writes()[0].data.LeadUserId).toEqual([]);
    });

    it.each([
        ['a list in place of a template', [[{}, { $set: { TemplateName: 'Changed' } }, { upsert: true }]]],
        ['a numbered object in place of a template', [{ 0: {}, 1: { $set: { TemplateName: 'Changed' } }, length: 2 }]],
        ['a template with an id that is not an id', [template({ _id: { $ne: null } })]],
        ['a template with no name', [template({ TemplateName: '   ' })]],
        ['a template missing a field every template has', [(({ apps, ...rest }) => rest)(template())]],
        ['a field of the wrong kind', [template({ apps: 'all' })]],
        ['a field that holds an operator', [template({ apps: [{ $where: 'sleep(1000)' }] })]],
        ['a good template beside a bad one', [template(), template({ _id: 'nope' })]],
        ['more templates than one request takes', Array.from({ length: 101 }, () => template())],
    ])('answers 400 to %s and writes nothing', async (name, templates) => {
        const res = await send(templates);

        expect(refused(res)).toBe(true);
        expect(writes()).toHaveLength(0);
        expect(rows().map((row) => row.TemplateName)).toEqual(['Kept', 'Also kept']);
    });
});
