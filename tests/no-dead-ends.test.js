/* Task 047 S-5: a company seeded with the bare minimum creates what a person makes in the first hour.
   The handlers run over fakeMongo, and a save is held against the real schema, as Mongoose would. */
const verified = require('./fixtures/verifiedRequest');
process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mockDb = require('./fixtures/fakeMongo').create();
const mockNotify = jest.fn(async () => true);

jest.mock('../utils/mongo-handler/mongoQueries', () => {
    const mongoose = require('mongoose');
    const { checkType } = jest.requireActual('../utils/mongo-handler/mongoQueries');
    const models = {};
    const refusalOf = (type, doc) => {
        models[type] = models[type] || mongoose.model(`bare_company_${type}`, checkType(type));
        return new models[type](doc).validateSync() || null;
    };
    return {
        MongoDbCrudOpration: async (companyId, query, method) => {
            const refused = method === 'save' ? refusalOf(query.type, query.data) : null;
            if (refused) throw refused;
            return mockDb.crud(companyId, query, method);
        },
        validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
    };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ addSprintFun: jest.fn(async () => ({ status: true, data: { _id: 'list1', name: 'List' } })) }));
jest.mock('../Modules/Company/controller/updateCompany', () => ({ updateCompanyFun: jest.fn(async () => ({})) }));
jest.mock('../utils/enterpriseHelper', () => ({ getCachedGlobalTemplateData: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async (companyId, skills) => skills || []) }));
jest.mock('../utils/sampleTasks', () => ({ seedSampleTasks: jest.fn(), sampleTasksForTemplate: jest.fn(() => null) }));
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectCreated: jest.fn(async () => undefined) }));
jest.mock('../Modules/Project/helpers/projectQuota', () => ({ stepProjectCount: jest.fn(async () => ({})) }));
jest.mock('../Modules/Tasks/helpers/helper', () => ({ HandleHistory: jest.fn(async () => true) }));
jest.mock('../Modules/Tasks/helpers/handleNotification', () => ({ HandleBothNotification: (...args) => mockNotify(...args) }));
jest.mock('../Modules/Tasks/helpers/notificationTemplate', () => ({ loggedHours: () => 'added', loggedHoursUpdated: () => 'edited', loggedHoursDeleted: () => 'deleted' }));
jest.mock('../Modules/TimesheetApproval/helpers/lockGuard', () => ({ isPeriodLocked: jest.fn(async () => false) }));
jest.mock('../Modules/LogTime/controllerV2/helpers', () => ({
    updateProjectForTimelog: jest.fn(), findAndUpdateProjectOrTaskStartDate: jest.fn(), updateRemainingTime: jest.fn(),
}));
jest.mock('../Modules/EstimatedTime/aiTaskEstimator', () => ({ estimateAndPersist: jest.fn() }));
jest.mock('../Modules/AIProjectGenerator/executeAgents', () => ({ projectFields: () => ({}) }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { schema } = require('../utils/mongo-handler/schema');
const { defaultCurrencyOf } = require('../Modules/Company/helpers/companyCurrency');
const projects = require('../Modules/createProject/controller');
const generator = require('../Modules/AIProjectGenerator/orchestrator');
const goals = require('../Modules/Goals/controller');
const { manualLogTime } = require('../Modules/LogTime/controllerV2/manualLogtime');

const C = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const MEMBER = '6f0000000000000000000003';
const PROJECT = '6f0000000000000000000b01';
const TASK = '6f0000000000000000000d01';
const LIST = '6f0000000000000000000a01';

const RUPEE = { code: 'INR', symbol: '₹', symbol_native: '₹', name: 'Indian Rupee', name_plural: 'Indian rupees', decimal_digits: 2, rounding: 0, count: 1 };
const EURO = { code: 'EUR', symbol: '€', symbol_native: '€', name: 'Euro', name_plural: 'euros', decimal_digits: 2, rounding: 0, count: 0 };
const DOLLAR = { code: 'USD', symbol: '$', symbol_native: '$', name: 'US Dollar', name_plural: 'US dollars', decimal_digits: 2, rounding: 0, count: 0 };

/* On a currency row `isDelete: true` means the company uses it: the settings screen sets it when a currency is added. */
const IN_USE = { isDelete: true };
const NOT_IN_USE = { isDelete: false };
const asSeeded = () => {
    mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...DOLLAR, isDefault: false, ...NOT_IN_USE });
    mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...RUPEE, isDefault: true, ...IN_USE });
    mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...EURO, isDefault: false, ...NOT_IN_USE });
};

const stored = (type) => mockDb.store[type] || [];
const flush = async () => { for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const answered = (handler, { body, uid = MEMBER, params = {} } = {}) => new Promise((resolve, reject) => {
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (sent) => { res.body = sent; resolve(res); return res; };
    res.json = res.send;
    Promise.resolve(handler(verified({ headers: { companyid: C }, body, query: {}, params, uid }), res)).catch(reject);
});

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: MEMBER, Employee_Name: 'Mina' });
});

describe('the currency a company works in', () => {
    it('is the seeded default, which the company uses', async () => {
        asSeeded();
        expect(await defaultCurrencyOf(C)).toEqual(RUPEE);
    });

    it('is the one currency in use when the default was switched off', async () => {
        mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...RUPEE, isDefault: true, ...NOT_IN_USE });
        mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...EURO, isDefault: false, ...IN_USE });
        expect(await defaultCurrencyOf(C)).toMatchObject({ code: 'EUR' });
    });

    it('stays the default when several others are in use and it is not', async () => {
        mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...RUPEE, isDefault: true, ...NOT_IN_USE });
        mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...EURO, isDefault: false, ...IN_USE });
        mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { ...DOLLAR, isDefault: false, ...IN_USE });
        expect(await defaultCurrencyOf(C)).toMatchObject({ code: 'INR' });
    });

    it('is nothing in a company with no currency', async () => {
        expect(await defaultCurrencyOf(C)).toEqual({});
    });
});

describe('a project', () => {
    const body = (overrides = {}) => ({
        CompanyId: C, ProjectName: 'Launch', ProjectCode: 'LCH', source: 'other', projectIcon: { type: 'color', data: '#6473e8' },
        ProjectType: 'Fix', statusType: 'active', ProjectRequiredDefaultComponent: 'ProjectListView', TemplateId: 'blank', useTemplateProj: 'category',
        projectCreatedBy: MEMBER, AssigneeUserId: [MEMBER], customFiedlsValue: [], includeSampleTasks: false,
        ...overrides,
    });
    const made = async (overrides) => (await projects.createProject({ body: body(overrides) })).data;

    it('takes the currency of the company when none is chosen', async () => {
        asSeeded();
        expect((await made()).ProjectCurrency).toEqual(RUPEE);
        expect((await made({ ProjectCode: 'TWO', ProjectCurrency: {} })).ProjectCurrency).toEqual(RUPEE);
    });

    it('keeps the currency that was chosen', async () => {
        asSeeded();
        expect((await made({ ProjectCurrency: { code: 'USD', symbol: '$' } })).ProjectCurrency).toEqual({ code: 'USD', symbol: '$' });
    });

    it('is created in a company with no currency at all', async () => {
        expect(await made()).toMatchObject({ ProjectName: 'Launch', status: 'open' });
        expect(stored(SCHEMA_TYPE.PROJECTS)).toHaveLength(1);
    });

    it('is created without the fields a caller may leave out', async () => {
        asSeeded();
        expect(await made({ customFiedlsValue: undefined, AssigneeUserId: undefined })).toMatchObject({ ProjectName: 'Launch' });
    });

    it('says in words what is missing when it cannot be saved', async () => {
        jest.spyOn(projects, 'removeProjectCount').mockImplementation(() => {});
        const res = await answered(projects.createProjectFun, { body: body({ CompanyId: undefined, ProjectType: undefined, statusType: undefined }) });
        expect(res.body.status).toBe(false);
        expect(typeof res.body.statusText).toBe('string');
        expect(res.body.statusText).toMatch(/ProjectType/);
        expect(res.body.statusText).toMatch(/statusType/);
        expect(stored(SCHEMA_TYPE.PROJECTS)).toHaveLength(0);
    });

    it('made by the AI is in the currency of the company', async () => {
        asSeeded();
        const context = await generator.loadCompanyContext(C);
        const { projectDoc } = generator.buildProjectDoc({ plan: { project: { ProjectName: 'Launch', taskTypeCounts: [] } }, context, companyId: C, uid: MEMBER, projectCode: 'LCH' });
        expect(projectDoc.ProjectCurrency).toEqual(RUPEE);
    });
});

describe('a goal', () => {
    const REVENUE = { name: 'Revenue', kind: 'currency', target: 5000 };

    it('counts money in the currency of the company when its target names none', async () => {
        asSeeded();
        const res = await answered(goals.createGoal, { body: { name: 'Grow revenue', targets: [REVENUE] } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ name: 'Revenue', currencyCode: 'INR' });
    });

    it('takes a money target added later the same way', async () => {
        asSeeded();
        const goal = (await answered(goals.createGoal, { body: { name: 'Grow revenue' } })).body.data;
        const res = await answered(goals.addTarget, { body: REVENUE, params: { id: goal._id } });
        expect(res.statusCode).toBe(200);
        expect(res.body.data.targets[0]).toMatchObject({ currencyCode: 'INR' });
    });

    it('keeps the currency a target names', async () => {
        asSeeded();
        const res = await answered(goals.createGoal, { body: { name: 'Grow revenue', targets: [{ ...REVENUE, currencyCode: 'EUR' }] } });
        expect(res.body.data.targets[0]).toMatchObject({ currencyCode: 'EUR' });
    });

    it('says the currency is missing in a company that has none', async () => {
        const res = await answered(goals.createGoal, { body: { name: 'Grow revenue', targets: [REVENUE] } });
        expect(res.statusCode).toBe(400);
        expect(res.body).toMatchObject({ status: false, field: 'targets.0.currencyCode' });
        expect(res.body.message).toMatch(/currencyCode is required/);
    });
});

describe('a time entry', () => {
    const entry = (overrides = {}) => ({
        logTimeDate: '2026-03-02', description: 'Wrote the brief', startLogTime: '09:00', endLogTime: '10:00', timeDuration: '1:00',
        ticketId: TASK, projectId: PROJECT, companyId: C, userId: MEMBER, isEdit: false, userName: 'Mina', dateFormat: 'DD/MM/YYYY',
        taskName: 'Brief', projectName: 'Launch', sprintId: LIST, timeZone: 'UTC',
        ...overrides,
    });

    it('is logged when the page has not loaded who owns the company', async () => {
        const res = await answered(manualLogTime, { body: entry({ companyOwnerId: '' }) });
        expect(res.body).toMatchObject({ status: true });
        expect(stored(SCHEMA_TYPE.TIMESHEET)).toHaveLength(1);
        await flush();
        expect(mockNotify.mock.calls[0][0].userData).toMatchObject({ id: MEMBER, companyOwnerId: OWNER });
    });
});

describe('the first-hour kinds', () => {
    /* Who supplies each required field with no default in the schema. `given` is what the person types or picks, `server`
       is filled by the create route, `form` is sent by the web form from the project or the company, never typed.
       A new required field belongs in one of them: a field nobody supplies stops the person who creates the kind. */
    const KINDS = {
        projects: {
            given: ['ProjectName', 'ProjectCode'],
            server: ['CompanyId', 'projectCreatedBy', 'ProjectCurrency', 'status'],
            form: ['ProjectType', 'statusType', 'ProjectRequiredDefaultComponent', 'projectIcon'],
        },
        sprints: { given: ['name', 'projectId'], server: ['private', 'deletedStatusKey'] },
        folders: { given: ['name', 'projectId'], server: ['deletedStatusKey'] },
        tasks: {
            given: ['TaskName', 'ProjectID', 'sprintId'],
            server: ['CompanyId'],
            form: ['TaskKey', 'TaskType', 'TaskTypeKey', 'status', 'statusKey', 'statusType', 'Task_Priority', 'Task_Leader', 'isParentTask', 'sprintArray', 'deletedStatusKey'],
        },
        pages: { given: ['title'] },
        customFields: {},
        everything_views: { given: ['name'], server: ['userId'] },
        goals: { given: ['name'], server: ['ownerUserId', 'visibility'] },
        timesheet: { given: ['LogStartTime', 'LogEndTime', 'LogTimeDuration', 'TicketID', 'ProjectId'], server: ['Loggeduser'], form: ['LogDescription'] },
        comments: { given: ['projectId'], server: ['userId'], form: ['project', 'type'] },
        companyUsers: { given: ['userEmail', 'roleType'], server: ['companyId', 'status'], form: ['designation'] },
    };

    const isRequired = (path) => Boolean(path) && typeof path === 'object' && !Array.isArray(path)
        && (path.required === true || (Array.isArray(path.required) && path.required[0] === true));
    const requiredWithoutDefault = (kind) => Object.entries(schema[kind])
        .filter(([, path]) => isRequired(path) && path.default === undefined)
        .map(([field]) => field)
        .sort();

    it.each(Object.keys(KINDS))('%s: every required field is supplied by someone', (kind) => {
        const { given = [], server = [], form = [] } = KINDS[kind];
        expect([...given, ...server, ...form].sort()).toEqual(requiredWithoutDefault(kind));
    });
});
