/* Reviewing a submission from a public form, reviewing a timesheet and removing the sample data are a signed-in person's to do. */
const verified = require('./fixtures/verifiedRequest');
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Project/controller/updateProject', () => ({ updateProjectInternal: jest.fn() }));
jest.mock('../Modules/Sprints/controller', () => ({ updateSprintFun: jest.fn(), updateFolderFun: jest.fn(), announceFolders: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/task_class_Mongo', () => ({ taskMongo: {} }));
jest.mock('../Modules/Tasks/helpers/taskListsLeft', () => ({ leaveLists: jest.fn(async () => 0) }));
jest.mock('../Modules/Pages/controller', () => ({ restorePage: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/taskWriteFields', () => ({ sessionActor: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { updateProjectInternal } = require('../Modules/Project/controller/updateProject');

const COMPANY = '6f0000000000000000000c01';
const OWNER = '6f0000000000000000000001';
const ADMIN = '6f0000000000000000000002';
const MEMBER = '6f0000000000000000000003';
const GUEST = '6f0000000000000000000004';
const TOKEN = '6f0000000000000000000101';
const PROJECT = '6f00000000000000000000a1';
const SAMPLE = '6f00000000000000000000a2';

const REVIEW = 'POST /api/v2/intake/review';
const REMOVE_SAMPLE = 'DELETE /api/v2/sample-data';
const REVIEW_TIMESHEET = 'POST /api/v2/timesheet-approval/:id/review';
const REVIEW_TIMESHEETS = 'POST /api/v2/timesheet-approval/bulk-review';

const routes = {};
const register = (method) => (path, ...handlers) => { routes[`${method} ${path}`] = handlers.flat(); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: () => {} };
['PublicShares', 'Trash', 'TimesheetApproval'].forEach((name) => require(`../Modules/${name}/routes`).init(app));

const send = async (route, caller, body = {}, params = {}) => {
    const [method, path] = route.split(' ');
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
    const req = verified({ ...caller, method, originalUrl: path, url: path, query: {}, params, headers: { companyid: COMPANY }, ip: '1.1.1.1', body });
    for (const handler of routes[route]) {
        let passed = false;
        // eslint-disable-next-line no-await-in-loop
        await handler(req, res, () => { passed = true; });
        if (!passed) break;
    }
    return { code: res.statusCode, body: res.body };
};

const personalToken = { _id: TOKEN, userId: OWNER, name: 'A script', scopes: ['read', 'write'] };
const agentToken = { ...personalToken, kind: 'agent', name: 'Claude' };

/* [who, the request's identity, whether an agent's attempt is recorded] */
const NOT_A_SESSION = [
    ['an owner\'s own API token', { uid: OWNER, apiToken: personalToken }, false],
    ['an agent\'s token', { uid: OWNER, apiToken: agentToken }, true],
];

const rows = (type) => mockDb.store[type] || [];
const refusals = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused');

beforeEach(() => {
    Object.keys(mockDb.store).forEach((type) => { mockDb.store[type].length = 0; });
    jest.clearAllMocks();
    [[OWNER, 1], [ADMIN, 2], [MEMBER, 3], [GUEST, 0]].forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: PROJECT, ProjectName: 'Launch', ProjectCode: 'LCH', isPrivateSpace: true, AssigneeUserId: [MEMBER], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: SAMPLE, ProjectName: 'Welcome', ProjectCode: 'WELCOME', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    updateProjectInternal.mockImplementation(async (companyId, id, patch) => Object.assign(rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id)), patch));
});

describe('a submission sent through a public link', () => {
    const waiting = () => {
        const list = mockDb.seed(SCHEMA_TYPE.SPRINTS, { projectId: PROJECT, name: 'Requests', deletedStatusKey: 0 });
        const share = mockDb.seed(SCHEMA_TYPE.PUBLIC_SHARES, { entityType: 'sprint', entityId: list._id, token: 'ab'.repeat(32), enabled: true, allowIntake: true, createdBy: OWNER });
        return mockDb.seed(SCHEMA_TYPE.INTAKE_ITEMS, { publicShareId: share._id, title: 'Please add export', status: 'pending' });
    };
    const statusOf = (item) => rows(SCHEMA_TYPE.INTAKE_ITEMS).find((row) => String(row._id) === String(item._id)).status;
    const ANSWERS = [['accept', 'accepted'], ['reject', 'rejected']];

    it.each(ANSWERS.flatMap(([action, left]) => [['an owner', OWNER], ['an admin', ADMIN], ['a member who can edit the project', MEMBER]].map(([who, uid]) => [action, who, uid, left])))(
        '%s: %s signed in decides it',
        async (action, _who, uid, left) => {
            const item = waiting();
            expect(await send(REVIEW, { uid }, { intakeId: String(item._id), action })).toMatchObject({ code: 200, body: { status: true } });
            expect(statusOf(item)).toBe(left);
        },
    );

    it.each(ANSWERS)('%s: a guest who cannot open the project does not decide it', async (action) => {
        const item = waiting();
        expect(await send(REVIEW, { uid: GUEST }, { intakeId: String(item._id), action })).toMatchObject({ code: 404, body: { status: false } });
        expect(statusOf(item)).toBe('pending');
    });

    it.each(ANSWERS.flatMap(([action]) => NOT_A_SESSION.map(([who, caller, recorded]) => [action, who, caller, recorded])))(
        '%s: %s does not decide it',
        async (action, _who, caller, recorded) => {
            const item = waiting();
            expect(await send(REVIEW, caller, { intakeId: String(item._id), action })).toMatchObject({ code: 403, body: { status: false } });
            expect(statusOf(item)).toBe('pending');
            expect(refusals()).toHaveLength(recorded ? 1 : 0);
        },
    );
});

describe('the sample data', () => {
    const sampleProject = () => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === SAMPLE);

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s signed in removes it', async (_who, uid) => {
        expect(await send(REMOVE_SAMPLE, { uid })).toMatchObject({ code: 200, body: { status: true, data: { projects: 1 } } });
        expect(sampleProject().deletedStatusKey).toBe(1);
    });

    it.each([
        ['a member signed in', { uid: MEMBER }, false],
        ['a guest signed in', { uid: GUEST }, false],
        ...NOT_A_SESSION,
    ])('%s does not remove it', async (_who, caller, recorded) => {
        expect(await send(REMOVE_SAMPLE, caller)).toMatchObject({ code: 403, body: { status: false } });
        expect(sampleProject().deletedStatusKey).toBe(0);
        expect(updateProjectInternal).not.toHaveBeenCalled();
        expect(refusals()).toHaveLength(recorded ? 1 : 0);
    });
});

describe('a submitted timesheet', () => {
    const submitted = () => mockDb.seed(SCHEMA_TYPE.TIMESHEET_APPROVAL, {
        userId: MEMBER, periodType: 'week', periodStart: new Date(2026, 0, 5), periodEnd: new Date(2026, 0, 11), status: 'submitted',
        totalMinutes: 60, reviewedAt: null, reviewedBy: '', reviewerName: '', rejectionReason: '', deletedStatusKey: 0,
    });
    const statusOf = (sheet) => rows(SCHEMA_TYPE.TIMESHEET_APPROVAL).find((row) => String(row._id) === String(sheet._id)).status;
    /* [how it is reviewed, the request for one sheet] */
    const REVIEWS = [
        ['one at a time', (sheet) => [REVIEW_TIMESHEET, { action: 'approve' }, { id: String(sheet._id) }]],
        ['several at once', (sheet) => [REVIEW_TIMESHEETS, { action: 'approve', ids: [String(sheet._id)] }, {}]],
    ];

    it.each(REVIEWS.flatMap(([how, request]) => [['an owner', OWNER], ['an admin', ADMIN]].map(([who, uid]) => [how, who, request, uid])))(
        '%s: %s signed in approves it',
        async (_how, _who, request, uid) => {
            const sheet = submitted();
            const [route, body, params] = request(sheet);
            expect(await send(route, { uid }, body, params)).toMatchObject({ code: 200, body: { status: true } });
            expect(statusOf(sheet)).toBe('approved');
        },
    );

    it.each(REVIEWS.flatMap(([how, request]) => [['a member', MEMBER], ['a guest', GUEST]].map(([who, uid]) => [how, who, request, uid])))(
        '%s: %s signed in does not approve it',
        async (_how, _who, request, uid) => {
            const sheet = submitted();
            const [route, body, params] = request(sheet);
            await send(route, { uid }, body, params);
            expect(statusOf(sheet)).toBe('submitted');
        },
    );

    it.each(REVIEWS.flatMap(([how, request]) => NOT_A_SESSION.map(([who, caller, recorded]) => [how, who, request, caller, recorded])))(
        '%s: %s does not approve it',
        async (_how, _who, request, caller, recorded) => {
            const sheet = submitted();
            const [route, body, params] = request(sheet);
            expect(await send(route, caller, body, params)).toMatchObject({ code: 403, body: { status: false } });
            expect(statusOf(sheet)).toBe('submitted');
            expect(refusals()).toHaveLength(recorded ? 1 : 0);
        },
    );
});
