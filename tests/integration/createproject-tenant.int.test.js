const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const COMPANY_B = crypto.randomBytes(12).toString('hex');
const EMPTY_COUNT = { projectCount: 0, publicCount: 0, privateCount: 0 };

let client;

const projectBody = (overrides = {}) => {
    const suffix = uniqueSuffix();
    return {
        AssigneeUserId: [],
        ProjectName: `Tenant pin ${suffix}`,
        ProjectCode: `T${suffix.toUpperCase()}`,
        ProjectType: 'Fix',
        LeadUserId: [],
        markAsStar: false,
        sprintsObj: {},
        sprintsfolders: {},
        DueDate: '',
        proposalId: '',
        skills: [],
        source: 'other',
        projectIcon: { type: 'color', data: '#6473e8' },
        TemplateName: '',
        TemplateId: 'blank',
        useTemplateProj: 'category',
        isPrivateSpace: false,
        TaskTypeTemplateId: '',
        statusType: 'active',
        lastTaskId: 0,
        ProjectRequiredDefaultComponent: 'ProjectListView',
        ProjectCurrency: {},
        isGlobalPermission: true,
        customFiedlsValue: [],
        includeSampleTasks: false,
        sampleFocus: '',
        apps: [],
        ...overrides,
    };
};

/* No route creates a second company without the preset-company pool, so company B is written straight to the global database. */
const seedCompanyB = () => client.db('global').collection('companies').insertOne({
    _id: new ObjectId(COMPANY_B),
    Cst_CompanyName: 'Tenant pin company B',
    projectCount: { ...EMPTY_COUNT },
});

const companyBCount = async () => (await client.db('global').collection('companies').findOne({ _id: new ObjectId(COMPANY_B) })).projectCount;
const companyBRows = (collection) => client.db(COMPANY_B).collection(collection).countDocuments({});

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    await seedCompanyB();
});

afterAll(async () => {
    if (!client) return;
    await client.db('global').collection('companies').deleteOne({ _id: new ObjectId(COMPANY_B) });
    await client.db(COMPANY_B).dropDatabase();
    await client.close();
});

describe('POST /api/v1/createproject takes the company from the companyid header', () => {
    it.each(['member', 'owner'])('refuses a %s of company A creating a project in company B, and writes nothing to B', async (role) => {
        const session = await loginAs(role);
        const res = await session.api.post('/api/v1/createproject', projectBody({ CompanyId: COMPANY_B, AssigneeUserId: [session.uid], projectCreatedBy: session.uid }));

        expect({
            status: res.status,
            answered: res.body && res.body.status,
            projectCount: await companyBCount(),
            projects: await companyBRows('projects'),
            sprints: await companyBRows('sprints'),
            settings: await companyBRows('settings'),
        }).toEqual({ status: 403, answered: false, projectCount: EMPTY_COUNT, projects: 0, sprints: 0, settings: 0 });
    });

    it('refuses a session aimed at company B through the header', async () => {
        const member = await loginAs('member');
        const res = await member.api.withCompany(COMPANY_B).post('/api/v1/createproject', projectBody({ CompanyId: COMPANY_B, AssigneeUserId: [member.uid], projectCreatedBy: member.uid }));

        expect(res.status).toBeGreaterThanOrEqual(401);
        expect(res.body.status).toBe(false);
        expect(await companyBCount()).toEqual(EMPTY_COUNT);
        expect(await companyBRows('projects')).toBe(0);
    });

    it('creates in the header company when the body leaves the company out', async () => {
        const owner = await loginAs('owner');
        const res = await owner.api.post('/api/v1/createproject', projectBody({ AssigneeUserId: [owner.uid], projectCreatedBy: owner.uid }));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ status: true });
        const stored = await client.db(state.companyId).collection('projects').findOne({ _id: new ObjectId(String(res.body.data._id)) });
        expect(stored).not.toBeNull();
        expect(await companyBRows('projects')).toBe(0);
    });
});
