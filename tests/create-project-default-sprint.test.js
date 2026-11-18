const mockDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const mockState = { updateOne: null, insertMany: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { data }, method) => {
        if (method === 'find') return [];
        if (method === 'save') return { ...data, _id: data._id };
        if (method === 'updateOne') return mockState.updateOne ? mockState.updateOne.promise : {};
        if (method === 'insertMany') return mockState.insertMany ? mockState.insertMany.promise : data[0];
        return null;
    }),
}));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({}));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../utils/enterpriseHelper', () => ({ getCachedGlobalTemplateData: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../utils/sampleTasks', () => ({ seedSampleTasks: jest.fn(), sampleTasksForTemplate: jest.fn(() => null) }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { addSprintFun } = require('../Modules/Sprints/controller');
const logger = require('../Config/loggerConfig');
const { removeCache } = require('../utils/commonFunctions');
const { seedSampleTasks } = require('../utils/sampleTasks');
const { createProject } = require('../Modules/createProject/controller');

const CID = '6a8ee973d625fca52e519a12';
const OWNER = '6f0000000000000000000a01';
const SPRINT = { status: true, data: { _id: 'sprint1', name: 'List' } };
const CREATE_FAILED = { status: false, statusText: 'error in creating project' };

const request = (overrides = {}) => ({
    body: {
        CompanyId: CID,
        ProjectName: 'Launch',
        ProjectCode: 'LCH',
        AssigneeUserId: [OWNER],
        LeadUserId: [],
        source: 'other',
        proposalId: '',
        skills: [],
        projectIcon: { type: 'color', data: '#6473e8' },
        TemplateName: '',
        TemplateId: 'blank',
        useTemplateProj: 'category',
        isPrivateSpace: false,
        projectCreatedBy: OWNER,
        customFiedlsValue: [],
        includeSampleTasks: false,
        apps: [],
        ...overrides,
    },
});

const flush = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const track = (promise) => {
    const outcome = { settled: false, value: undefined, error: undefined };
    promise.then((value) => { outcome.settled = true; outcome.value = value; }, (error) => { outcome.settled = true; outcome.error = error; });
    return outcome;
};

const deletedProjects = () => MongoDbCrudOpration.mock.calls.filter(([, , method]) => method === 'deleteOne');
const loggedErrors = () => logger.error.mock.calls.map((call) => call.map((part) => (typeof part === 'string' ? part : JSON.stringify(part))).join(' ')).join('\n');

const expectRolledBack = (outcome) => {
    expect(outcome.value).toBeUndefined();
    expect(outcome.error).toEqual(CREATE_FAILED);
    expect(deletedProjects()).toHaveLength(1);
    expect(deletedProjects()[0][0]).toBe(CID);
    expect(seedSampleTasks).not.toHaveBeenCalled();
};

beforeEach(() => {
    jest.clearAllMocks();
    mockState.updateOne = null;
    mockState.insertMany = null;
});

describe('createProject default rows', () => {
    it('does not resolve until the default List sprint is saved', async () => {
        const sprint = mockDeferred();
        addSprintFun.mockReturnValue(sprint.promise);

        const outcome = track(createProject(request()));
        await flush();

        expect(addSprintFun).toHaveBeenCalledTimes(1);
        expect(addSprintFun.mock.calls[0][0].body).toMatchObject({ companyId: CID, sprintName: 'List', projectName: 'Launch' });
        expect(outcome.settled).toBe(false);

        sprint.resolve(SPRINT);
        await flush();

        expect(outcome.error).toBeUndefined();
        expect(outcome.value).toMatchObject({ status: true, statusText: 'createProject added successfully', data: { ProjectName: 'Launch' } });
        expect(Object.keys(outcome.value).sort()).toEqual(['data', 'status', 'statusText']);
    });

    it('does not resolve until the template statuses are added to the workspace settings', async () => {
        mockState.updateOne = mockDeferred();
        addSprintFun.mockResolvedValue(SPRINT);

        const outcome = track(createProject(request()));
        await flush();
        expect(outcome.settled).toBe(false);

        mockState.updateOne.resolve({});
        await flush();
        expect(outcome.value).toMatchObject({ status: true });
    });

    it('leaves sample-task seeding in the background', async () => {
        addSprintFun.mockResolvedValue(SPRINT);
        seedSampleTasks.mockReturnValue(new Promise(() => {}));

        const outcome = track(createProject(request({ includeSampleTasks: true, sampleFocus: 'software' })));
        await flush();

        expect(seedSampleTasks).toHaveBeenCalledTimes(1);
        expect(seedSampleTasks.mock.calls[0][1]).toMatchObject({ _id: 'sprint1' });
        expect(outcome.value).toMatchObject({ status: true });
    });

    it('answers customFieldVal with the inserted custom fields', async () => {
        addSprintFun.mockResolvedValue(SPRINT);
        const fields = [{ fieldName: 'Budget' }, { fieldName: 'Client' }];

        const outcome = track(createProject(request({ customFiedlsValue: fields })));
        await flush();

        expect(Object.keys(outcome.value).sort()).toEqual(['customFieldVal', 'data', 'status', 'statusText']);
        const projectId = String(outcome.value.data._id);
        expect(outcome.value.customFieldVal).toEqual(fields.map((field) => ({ ...field, userId: OWNER, type: 'task', global: false, projectId: [projectId] })));
        expect(removeCache).toHaveBeenCalledWith(`customField:${CID}`);
    });
});

describe('createProject deletes the project and answers an error when a default row cannot be written', () => {
    it('when the template settings write rejects', async () => {
        mockState.updateOne = mockDeferred();
        addSprintFun.mockResolvedValue(SPRINT);

        const outcome = track(createProject(request()));
        await flush();
        mockState.updateOne.reject(new Error('settings down'));
        await flush();

        expectRolledBack(outcome);
        expect(addSprintFun).not.toHaveBeenCalled();
    });

    it('when the custom fields insert rejects', async () => {
        mockState.insertMany = mockDeferred();
        addSprintFun.mockResolvedValue(SPRINT);

        const outcome = track(createProject(request({ customFiedlsValue: [{ fieldName: 'Budget' }] })));
        await flush();
        mockState.insertMany.reject(new Error('insert down'));
        await flush();

        expectRolledBack(outcome);
        expect(addSprintFun).not.toHaveBeenCalled();
        expect(removeCache).not.toHaveBeenCalledWith(`customField:${CID}`);
    });

    it('when the default sprint rejects', async () => {
        addSprintFun.mockRejectedValue({ status: false, statusText: 'boom' });

        const outcome = track(createProject(request()));
        await flush();

        expectRolledBack(outcome);
        expect(loggedErrors()).toContain('boom');
    });

    it('when the default sprint resolves as failed', async () => {
        addSprintFun.mockResolvedValue({ status: false, statusText: 'Upgrade your plan', isUpgrade: true });

        const outcome = track(createProject(request()));
        await flush();

        expectRolledBack(outcome);
        expect(loggedErrors()).toContain('Upgrade your plan');
    });

    it('when the default sprint resolves without a saved sprint', async () => {
        addSprintFun.mockResolvedValue({ status: true, data: {} });

        const outcome = track(createProject(request()));
        await flush();

        expectRolledBack(outcome);
    });
});
