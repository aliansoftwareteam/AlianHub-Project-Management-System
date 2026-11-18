const PROJECT_ID = '6f0000000000000000000a09';

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { type, data }, method) => {
        if (method === 'find') return [];
        if (method === 'findOne' && type === 'users') return { _id: '6f0000000000000000000a01', Employee_Name: 'Olivia Owner' };
        if (method === 'findOne' && type === 'company_users') return { userId: '6f0000000000000000000a01' };
        if (method === 'save' && type === 'projects') return { ...data, _id: '6f0000000000000000000a09' };
        if (method === 'save') return { ...data, _id: data._id };
        return {};
    }),
}));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn(async () => ({ status: true, data: { _id: 'sprint1', name: 'List' } })) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../utils/enterpriseHelper', () => ({ getCachedGlobalTemplateData: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../utils/sampleTasks', () => ({ seedSampleTasks: jest.fn(), sampleTasksForTemplate: jest.fn(() => null) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/Auth/helper', () => ({ replaceObjectKey: jest.fn() }));
jest.mock('../Modules/CustomField/controller', () => ({ insertCustomFieldPromise: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCount: jest.fn(), unsetAllCounts: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const controller = require('../Modules/createProject/controller');

const C = '6a8ee973d625fca52e519a12';
const ME = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000a02';
const HTML = '<img src=x onerror=alert(1)>';

const projectBody = (overrides = {}) => ({
    CompanyId: C,
    ProjectName: 'Launch',
    ProjectCode: 'LCH',
    AssigneeUserId: [OTHER],
    LeadUserId: [ME],
    source: 'other',
    proposalId: '',
    skills: [],
    projectIcon: { type: 'color', data: '#6473e8' },
    TemplateName: '',
    TemplateId: 'blank',
    useTemplateProj: 'category',
    isPrivateSpace: false,
    customFiedlsValue: [],
    includeSampleTasks: false,
    apps: [],
    ...overrides,
});

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((payload) => { res.body = payload; return res; });
    res.json = res.send;
    return res;
};

const flush = async () => {
    for (let i = 0; i < 40; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const post = async (body, uid = ME) => {
    const res = response();
    await controller.createProjectFun({ headers: { companyid: C }, aud: C, uid, body }, res);
    await flush();
    return res;
};

const historyRows = () => MongoDbCrudOpration.mock.calls.filter(([, { type }, method]) => type === 'history' && method === 'save').map(([, { data }]) => data);

beforeEach(() => {
    jest.clearAllMocks();
});

describe('a new project is described on the server', () => {
    it('writes the created row and notice for the signed-in user', async () => {
        const res = await post(projectBody({ userData: { id: OTHER, Employee_Name: HTML }, message: HTML }));
        expect(res.body).toMatchObject({ status: true });

        expect(historyRows()).toEqual([expect.objectContaining({
            Type: 'project',
            Key: 'Project_Created',
            UserId: ME,
            ProjectId: PROJECT_ID,
            Message: '<b>Olivia Owner</b> has created new as <b>Launch</b> project',
        })]);
        const sent = HandleBothNotification.mock.calls.map(([args]) => args);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            type: 'project',
            companyId: C,
            projectId: PROJECT_ID,
            object: { key: 'project_create', message: '<p>Created a new project named <strong>Launch</strong>.</p>' },
            changeType: 'project_create',
            changeData: { ProjectName: 'Launch' },
            userData: { id: ME, Employee_Name: 'Olivia Owner', companyOwnerId: ME },
        });
    });

    it('escapes the stored name', async () => {
        await post(projectBody({ ProjectName: `Launch ${HTML}` }));
        expect(historyRows()[0].Message).toBe('<b>Olivia Owner</b> has created new as <b>Launch &lt;img src=x onerror=alert&#40;1&#41;&gt;</b> project');
        expect(HandleBothNotification.mock.calls[0][0].object.message).not.toContain('<img');
    });

    it('records nothing when the project is not created', async () => {
        const res = await post(projectBody(), null);
        expect(res.statusCode).toBe(401);
        expect(historyRows()).toEqual([]);
        expect(HandleBothNotification).not.toHaveBeenCalled();
    });
});
