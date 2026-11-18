/* A new project starts with the fields the server keeps as the server sets them. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { data }, method) => {
        if (method === 'find') return [];
        if (method === 'save') return { ...data, _id: data._id };
        if (method === 'insertMany') return data[0];
        return {};
    }),
}));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn(async () => ({ status: true, data: { _id: 'sprint1', name: 'List' } })) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({}));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../utils/enterpriseHelper', () => ({ getCachedGlobalTemplateData: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../utils/sampleTasks', () => ({ seedSampleTasks: jest.fn(), sampleTasksForTemplate: jest.fn(() => null) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const controller = require('../Modules/createProject/controller');
const { fieldKeptFromNewProject } = require('../Config/projectAccess');
const e2eFixtures = require('fs').readFileSync(require('path').join(__dirname, '../e2e/support/fixtures.js'), 'utf8');

const C = '6a8ee973d625fca52e519a12';
const ME = '6f0000000000000000000a01';
const SOMEONE = '6f0000000000000000000a02';
const MADE_AHEAD = '6f0000000000000000000d77';

/* What the create form sends (frontend CreateProjectSidebar.vue); the template form sends the same with lastTaskId 1. */
const formBody = (overrides = {}) => ({
    _id: MADE_AHEAD, AssigneeUserId: [ME], ProjectName: 'Launch', CompanyId: C, ProjectCode: 'LCH', ProjectType: 'Fix', LeadUserId: [], markAsStar: false,
    sprintsObj: {}, sprintsfolders: {}, DueDate: '', proposalId: '', skills: [], source: 'other', projectIcon: { type: 'color', data: '#6473e8' },
    TemplateName: '', TemplateId: 'blank', isPrivateSpace: false, TaskTypeTemplateId: '', statusType: 'active', lastTaskId: 0,
    ProjectRequiredDefaultComponent: 'ProjectListView', ProjectCurrency: {}, useTemplateProj: 'category', projectCreatedBy: ME, isGlobalPermission: true,
    customFiedlsValue: [], includeSampleTasks: false, sampleFocus: '', apps: [], isTemplate: false, ...overrides,
});

const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const post = async (body, caller = {}) => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((payload) => { res.body = payload; return res; });
    res.json = res.send;
    await controller.createProjectFun({ headers: { companyid: C }, aud: C, uid: ME, body, ...caller }, res);
    await flush();
    return res;
};

const saves = () => MongoDbCrudOpration.mock.calls.filter(([, , method]) => method === 'save');
const saved = () => saves()[0][1].data;

const KEPT = {
    isPersonal: true,
    personalOwner: SOMEONE,
    deletedStatusKey: 1,
    isRestrict: true,
    milestoneAmount: 5000,
    proposalIdNumeric: 7,
    lastProjectActivity: '2099-01-01T00:00:00.000Z',
    userActivity: [{ userId: SOMEONE }],
    legacyId: 'old-1',
    demo: true,
};
const STARTING = { sprintsObj: { s1: { name: 'Hidden list' } }, sprintsfolders: { f1: { name: 'Hidden folder' } }, lastTaskId: 999 };
const CALLERS = [
    ['a signed-in person', {}],
    ['a person\'s API token', { apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: ME, scopes: ['read', 'write'] } }],
];

beforeEach(() => { jest.clearAllMocks(); });

describe('the fields of a project the server keeps', () => {
    it.each(CALLERS.flatMap(([who, caller]) => Object.keys(KEPT).map((field) => [who, field, caller])))('%s does not create a project with %s', async (_who, field, caller) => {
        const res = await post(formBody({ [field]: KEPT[field] }), caller);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: `${field} cannot be set here.` });
        expect(saves()).toHaveLength(0);
    });

    it.each(Object.keys(KEPT))('a part of %s is refused the same way', async (field) => {
        const res = await post(formBody({ [`${field}.x`]: 1 }));
        expect(res.statusCode).toBe(400);
        expect(saves()).toHaveLength(0);
    });

    it.each(CALLERS)('%s creates a project whose lists and task counter start as the server has them', async (_who, caller) => {
        const res = await post(formBody({ ...STARTING, 'sprintsObj.s2': { name: 'Another' } }), caller);
        expect(res.body).toMatchObject({ status: true });
        Object.keys(STARTING).forEach((field) => expect(saved()[field]).toBeUndefined());
        expect(saved()['sprintsObj.s2']).toBeUndefined();
    });
});

describe('the bodies the app sends', () => {
    it.each([
        ['the create form', formBody()],
        ['the template form', formBody({ lastTaskId: 1, sampleFocus: undefined, apps: undefined })],
        ['a body with no id, company or creator', formBody({ _id: undefined, CompanyId: undefined, projectCreatedBy: undefined })],
    ])('%s still creates a project', async (_what, body) => {
        const res = await post(JSON.parse(JSON.stringify(body)));
        expect(res.body).toMatchObject({ status: true });
        expect(saved()).toMatchObject({ ProjectName: 'Launch', CompanyId: C, projectCreatedBy: ME });
        expect(saved().lastTaskId).toBeUndefined();
    });

    it('keeps the id the create form made ahead for the project', async () => {
        await post(formBody());
        expect(String(saved()._id)).toBe(MADE_AHEAD);
    });

    it('creates the project as the caller, whoever the body names', async () => {
        await post(formBody({ projectCreatedBy: SOMEONE }));
        expect(saved().projectCreatedBy).toBe(ME);
    });

    it('refuses no field the end-to-end fixture sends', () => {
        const [, literal] = e2eFixtures.match(/api\.post\('\/api\/v1\/createproject', \{([\s\S]*?)\n {4}\}\);/);
        const sent = [...literal.matchAll(/^\s{8}([A-Za-z_]+)[:,]/gm)].map(([, field]) => field);
        expect(sent).toEqual(expect.arrayContaining(['ProjectName', 'sprintsObj', 'sprintsfolders', 'lastTaskId', 'CompanyId', 'projectCreatedBy']));
        expect(fieldKeptFromNewProject(Object.fromEntries(sent.map((field) => [field, 1])))).toBeUndefined();
    });
});
