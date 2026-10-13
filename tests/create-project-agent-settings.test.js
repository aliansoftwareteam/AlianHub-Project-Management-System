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
const { PROJECT_AGENT_FIELDS } = require('../Config/projectAgentFields');

const C = '6a8ee973d625fca52e519a12';
const ME = '6f0000000000000000000a01';

const projectBody = (overrides = {}) => ({
    CompanyId: C, ProjectName: 'Launch', ProjectCode: 'LCH', AssigneeUserId: [], LeadUserId: [], source: 'other', proposalId: '', skills: [],
    projectIcon: { type: 'color', data: '#6473e8' }, TemplateName: '', TemplateId: 'blank', useTemplateProj: 'category', isPrivateSpace: false,
    projectCreatedBy: ME, customFiedlsValue: [], includeSampleTasks: false, apps: [], ...overrides,
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

const SENT = {
    agentPolicy: { done: 'yes', connected: 'single_task' },
    agentManager: { on: true },
    agentLimits: { atOnce: 9, paused: false },
    agentManagerLookedOn: '2099-01-01',
    agentManagerTriagedOn: '2099-01-01',
    agentManagerTriagedAt: '2099-01-01T00:00:00.000Z',
    agentManagerTriagedIds: ['6a9954186dd786246031e4f1'],
};
const CALLERS = [
    ['a signed-in person', {}],
    ['a person\'s API token', { apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: ME, scopes: ['read', 'write'] } }],
    ['an agent\'s token', { apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: ME, scopes: ['read', 'write'] } }],
];

beforeEach(() => { jest.clearAllMocks(); });

describe('a new project starts on the defaults for agents', () => {
    it('names every setting for agents a project stores', () => {
        expect([...PROJECT_AGENT_FIELDS].sort()).toEqual(Object.keys(SENT).sort());
    });

    it.each(CALLERS.flatMap(([who, caller]) => Object.keys(SENT).map((field) => [who, field, caller])))('%s does not create one with %s', async (_who, field, caller) => {
        const res = await post(projectBody({ [field]: SENT[field] }), caller);
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, statusText: `${field} cannot be set here.` });
        expect(saves()).toHaveLength(0);
    });

    it.each(Object.keys(SENT))('a part of %s is refused the same way', async (field) => {
        const res = await post(projectBody({ [`${field}.on`]: true }));
        expect(res.statusCode).toBe(400);
        expect(saves()).toHaveLength(0);
    });

    it('a project without them is created, and stores none', async () => {
        const res = await post(projectBody());
        expect(res.body).toMatchObject({ status: true });
        const [[, { data: saved }]] = saves();
        Object.keys(SENT).forEach((field) => expect(saved[field]).toBeUndefined());
    });
});
