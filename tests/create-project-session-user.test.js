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
const { addSprintFun } = require('../Modules/Sprints/controller');
const { updateCompanyFun } = require('../Modules/Company/controller/updateCompany');
const controller = require('../Modules/createProject/controller');

const C = '6a8ee973d625fca52e519a12';
const OTHER_COMPANY = '6b8ee973d625fca52e519b34';
const ME = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000a02';
const LEAD = '6f0000000000000000000a03';

const projectBody = (overrides = {}) => ({
    CompanyId: C,
    ProjectName: 'Launch',
    ProjectCode: 'LCH',
    AssigneeUserId: [OTHER, LEAD],
    LeadUserId: [LEAD],
    source: 'other',
    proposalId: '',
    skills: [],
    projectIcon: { type: 'color', data: '#6473e8' },
    TemplateName: '',
    TemplateId: 'blank',
    useTemplateProj: 'category',
    isPrivateSpace: false,
    projectCreatedBy: ME,
    customFiedlsValue: [{ fieldTitle: 'Budget', fieldType: 'number' }],
    includeSampleTasks: false,
    apps: [],
    ...overrides,
});

const request = (body, uid = ME) => ({ headers: { companyid: C }, aud: C, uid, body });

const response = () => {
    const res = { statusCode: 200, body: undefined };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((payload) => { res.body = payload; return res; });
    res.json = res.send;
    return res;
};

const flush = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const post = async (body, uid) => {
    const res = response();
    await controller.createProjectFun(request(body, uid), res);
    await flush();
    return res;
};

const callsOf = (method) => MongoDbCrudOpration.mock.calls.filter(([, , m]) => m === method);
const savedProject = () => callsOf('save')[0][1].data;
const customFieldRows = () => callsOf('insertMany')[0][1].data[0];
const companiesTouched = () => [...new Set(MongoDbCrudOpration.mock.calls.map(([companyId]) => String(companyId)))];

beforeEach(() => {
    jest.clearAllMocks();
});

describe('POST /createproject takes the creator from the session', () => {
    it('records the signed-in user as the creator when the body names another user', async () => {
        const res = await post(projectBody({ projectCreatedBy: OTHER }));

        expect(res.body).toMatchObject({ status: true });
        expect(savedProject().projectCreatedBy).toBe(ME);
        customFieldRows().forEach((row) => expect(row.userId).toBe(ME));
    });

    it('records the signed-in user when the body leaves the creator out', async () => {
        const body = projectBody();
        delete body.projectCreatedBy;
        const res = await post(body);

        expect(res.body).toMatchObject({ status: true });
        expect(savedProject().projectCreatedBy).toBe(ME);
    });

    it('refuses a request without a signed-in user and writes nothing', async () => {
        const res = await post(projectBody(), undefined);

        expect(res.statusCode).toBe(401);
        expect(res.body).toMatchObject({ status: false });
        expect(updateCompanyFun).not.toHaveBeenCalled();
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(addSprintFun).not.toHaveBeenCalled();
    });

    it('keeps the members and leads the body names, since creating a project assigns other people', async () => {
        const res = await post(projectBody());

        expect(res.body).toMatchObject({ status: true });
        expect(savedProject().AssigneeUserId).toEqual([OTHER, LEAD]);
        expect(savedProject().LeadUserId).toEqual([LEAD]);
    });
});

describe('POST /createproject takes the company from the verified header', () => {
    it('reads and writes only the header company, and makes the default sprint there', async () => {
        const res = await post(projectBody());

        expect(res.body).toMatchObject({ status: true });
        expect(companiesTouched()).toEqual([C]);
        expect(updateCompanyFun.mock.calls[0][3]).toBe(C);
        expect(addSprintFun.mock.calls[0][0].body.companyId).toBe(C);
    });

    it('works the same when the body leaves the company out', async () => {
        const body = projectBody();
        delete body.CompanyId;
        const res = await post(body);

        expect(res.body).toMatchObject({ status: true });
        expect(companiesTouched()).toEqual([C]);
        expect(savedProject().CompanyId).toBe(C);
    });

    it('refuses a body that names another company and writes nothing', async () => {
        const res = await post(projectBody({ CompanyId: OTHER_COMPANY }));

        expect(res.statusCode).toBe(403);
        expect(updateCompanyFun).not.toHaveBeenCalled();
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });
});

describe('createProject called in-process keeps the company and creator its caller built', () => {
    it('uses the body the caller built', async () => {
        const outcome = await controller.createProject({ body: projectBody({ projectCreatedBy: OTHER }) });

        expect(outcome).toMatchObject({ status: true });
        expect(savedProject().projectCreatedBy).toBe(OTHER);
        expect(companiesTouched()).toEqual([C]);
    });
});
