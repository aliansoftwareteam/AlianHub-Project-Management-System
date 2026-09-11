const mockDeferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};

const mockState = { updateOne: null };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: jest.fn(async (companyId, { data }, method) => {
        if (method === 'find') return [];
        if (method === 'save') return { ...data, _id: data._id };
        if (method === 'updateOne') return mockState.updateOne ? mockState.updateOne.promise : {};
        if (method === 'insertMany') return data[0];
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

const { addSprintFun } = require('../Modules/Sprints/controller');
const { seedSampleTasks } = require('../utils/sampleTasks');
const { createProject } = require('../Modules/createProject/controller');

const CID = '6a8ee973d625fca52e519a12';
const OWNER = '6f0000000000000000000a01';

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

beforeEach(() => {
    jest.clearAllMocks();
    mockState.updateOne = null;
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

        sprint.resolve({ status: true, data: { _id: 'sprint1', name: 'List' } });
        await flush();

        expect(outcome.error).toBeUndefined();
        expect(outcome.value).toMatchObject({ status: true, statusText: 'createProject added successfully', data: { ProjectName: 'Launch' } });
        expect(Object.keys(outcome.value).sort()).toEqual(['data', 'status', 'statusText']);
    });

    it('does not resolve until the template statuses are added to the workspace settings', async () => {
        mockState.updateOne = mockDeferred();
        addSprintFun.mockResolvedValue({ status: true, data: { _id: 'sprint1', name: 'List' } });

        const outcome = track(createProject(request()));
        await flush();
        expect(outcome.settled).toBe(false);

        mockState.updateOne.resolve({});
        await flush();
        expect(outcome.value).toMatchObject({ status: true });
    });

    it('leaves sample-task seeding in the background', async () => {
        addSprintFun.mockResolvedValue({ status: true, data: { _id: 'sprint1', name: 'List' } });
        seedSampleTasks.mockReturnValue(new Promise(() => {}));

        const outcome = track(createProject(request({ includeSampleTasks: true, sampleFocus: 'software' })));
        await flush();

        expect(seedSampleTasks).toHaveBeenCalledTimes(1);
        expect(seedSampleTasks.mock.calls[0][1]).toMatchObject({ _id: 'sprint1' });
        expect(outcome.value).toMatchObject({ status: true });
    });

    it('still answers with the project when the sprint cannot be created', async () => {
        addSprintFun.mockRejectedValue({ status: false, statusText: 'boom' });

        const outcome = track(createProject(request()));
        await flush();

        expect(outcome.value).toMatchObject({ status: true, data: { ProjectName: 'Launch' } });
    });
});
