const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const OTHER_COMPANY = new ObjectId().toHexString();

let client;
let owner;
let member;

const projectBody = (overrides = {}) => {
    const suffix = uniqueSuffix();
    return {
        AssigneeUserId: [owner.userId, member.userId],
        ProjectName: `Session creator ${suffix}`,
        ProjectCode: `S${suffix.toUpperCase()}`,
        ProjectType: 'Fix',
        LeadUserId: [member.userId],
        DueDate: '',
        proposalId: '',
        skills: [],
        source: 'other',
        projectIcon: { type: 'color', data: '#6473e8' },
        TemplateName: '',
        TemplateId: 'blank',
        useTemplateProj: 'category',
        isPrivateSpace: false,
        statusType: 'active',
        lastTaskId: 0,
        ProjectRequiredDefaultComponent: 'ProjectListView',
        ProjectCurrency: {},
        isGlobalPermission: true,
        customFiedlsValue: [],
        includeSampleTasks: false,
        apps: [],
        ...overrides,
    };
};

const storedProject = (id) => client.db(state.companyId).collection('projects').findOne({ _id: new ObjectId(String(id)) });
const projectsNamed = (name) => client.db(state.companyId).collection('projects').countDocuments({ ProjectName: name });

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    owner = await loginAs('owner');
    member = await loginAs('member');
});

afterAll(async () => {
    if (client) await client.close();
});

describe('POST /api/v1/createproject takes the company and user from the verified request', () => {
    it('stores the signed-in user as the creator when the body names another member', async () => {
        const res = await owner.api.post('/api/v1/createproject', projectBody({ CompanyId: state.companyId, projectCreatedBy: member.userId }));

        expect(res.body).toMatchObject({ status: true });
        const stored = await storedProject(res.body.data._id);
        expect(String(stored.projectCreatedBy)).toBe(String(owner.userId));
        expect(stored.AssigneeUserId.map(String)).toEqual([owner.userId, member.userId].map(String));
        expect(stored.LeadUserId.map(String)).toEqual([String(member.userId)]);
    });

    it('creates the project with the session creator when the body sends neither company nor creator', async () => {
        const res = await owner.api.post('/api/v1/createproject', projectBody());

        expect(res.body).toMatchObject({ status: true });
        const stored = await storedProject(res.body.data._id);
        expect(String(stored.projectCreatedBy)).toBe(String(owner.userId));
    });

    it('refuses a body that names another company and stores nothing', async () => {
        const body = projectBody({ CompanyId: OTHER_COMPANY, projectCreatedBy: owner.userId });
        const res = await owner.api.post('/api/v1/createproject', body);

        expect(res.status).toBe(403);
        expect(await projectsNamed(body.ProjectName)).toBe(0);
    });
});
