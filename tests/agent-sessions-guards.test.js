const mockDbs = {};
const mockDbFor = (id) => { mockDbs[id] = mockDbs[id] || require('./fixtures/fakeMongo').create(); return mockDbs[id]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../Config/config', () => ({ WEBURL: 'https://hub.test/', myCache: { get: () => undefined, set: () => {}, del: () => {}, getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(async () => 3) }));
jest.mock('../Config/projectAccess', () => ({ canEditProject: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../Modules/Mcp/visibility', () => ({ NOT_VISIBLE: 'not_visible', forCaller: jest.fn(async () => ({ allowsTask: () => true })) }));
jest.mock('../Modules/AgentSessions/clients', () => ({
    clientStanding: jest.fn(async () => ({ ok: true, name: 'Coder' })),
    liveGrantFor: jest.fn(async () => ({ grantId: 'grant-1' })),
    grantStanding: jest.fn(async () => true),
    privateSprintsOptIn: jest.fn(async () => true),
}));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { getRoleType } = require('../Config/permissionGuard');
const delegation = require('../Modules/AgentSessions/delegation');
const endpoints = require('../Modules/AgentSessions/endpoints');

const MINE = '6a0000000000000000000001';
const THEIRS = '6a0000000000000000000002';
const OWNER = '6a00000000000000000000a1';

beforeEach(() => Object.keys(mockDbs).forEach((key) => delete mockDbs[key]));

describe('another workspace', () => {
    it('cannot be reached with a task id from it', async () => {
        const foreign = mockDbFor(THEIRS).seed(SCHEMA_TYPE.TASKS, { CompanyId: THEIRS, ProjectID: '6a00000000000000000000d4', TaskName: 'Theirs', AssigneeUserId: [] });
        mockDbFor(MINE).seed(SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS, { clientId: 'ahc_coder', url: 'https://agent.example.com/hook', secret: 's' });
        await expect(delegation.delegate({ companyId: MINE, uid: OWNER, taskId: String(foreign._id), clientId: 'ahc_coder' })).rejects.toMatchObject({ statusCode: 404 });
        await expect(delegation.listForTask({ companyId: MINE, uid: OWNER, taskId: String(foreign._id) })).rejects.toMatchObject({ statusCode: 404 });
        expect(mockDbFor(THEIRS).store[SCHEMA_TYPE.AGENT_SESSIONS] || []).toHaveLength(0);
        expect(mockDbFor(MINE).store[SCHEMA_TYPE.AGENT_SESSIONS] || []).toHaveLength(0);
    });
});

describe('delivery URLs', () => {
    it.each([[3, 'a member'], [4, 'a guest'], [null, 'someone outside the workspace']])('are neither saved nor listed by role %s (%s)', async (roleType) => {
        getRoleType.mockResolvedValue(roleType);
        await expect(endpoints.save({ companyId: MINE, uid: OWNER, clientId: 'ahc_coder', url: 'https://agent.example.com/hook' })).rejects.toMatchObject({ statusCode: 403 });
        await expect(endpoints.list({ companyId: MINE, uid: OWNER })).rejects.toMatchObject({ statusCode: 403 });
        expect(mockDbFor(MINE).store[SCHEMA_TYPE.AGENT_SESSION_ENDPOINTS] || []).toHaveLength(0);
    });

    it('are saved and listed by an admin, without the secret in the list', async () => {
        getRoleType.mockResolvedValue(2);
        const saved = await endpoints.save({ companyId: MINE, uid: OWNER, clientId: 'ahc_coder', url: 'https://agent.example.com/hook' });
        const listed = await endpoints.list({ companyId: MINE, uid: OWNER });
        expect(listed).toEqual([expect.objectContaining({ clientId: 'ahc_coder', url: 'https://agent.example.com/hook' })]);
        expect(JSON.stringify(listed)).not.toContain(saved.secret);
    });
});

describe('the JWT prefix for /api/v2/agent-sessions', () => {
    const prefixes = (flag) => {
        let list;
        const saved = process.env.EXTERNAL_AGENT_SESSIONS;
        if (flag) process.env.EXTERNAL_AGENT_SESSIONS = flag; else delete process.env.EXTERNAL_AGENT_SESSIONS;
        jest.isolateModules(() => {
            jest.doMock('../Config/jwt', () => ({}));
            jest.doMock('../Modules/AICore/providerContext', () => ({}));
            list = require('../Config/setMiddleware').guardedPrefixes;
        });
        if (saved === undefined) delete process.env.EXTERNAL_AGENT_SESSIONS; else process.env.EXTERNAL_AGENT_SESSIONS = saved;
        return list;
    };

    it('is listed only with the flag on', () => {
        expect(prefixes('')).not.toContain('/api/v2/agent-sessions');
        expect(prefixes('on')).toContain('/api/v2/agent-sessions');
        expect(prefixes('on')).toContain('/api/v2/agents');
    });
});

describe('the Inbox row for a delegation notice', () => {
    it('carries the structured values through as data', async () => {
        jest.isolateModules(() => {
            jest.doMock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn() }));
        });
        const { __internals } = require('../Modules/Inbox/controller');
        const changeData = { taskKey: 'AH-7<b>', taskName: '<img src=x onerror=alert(1)>', clientName: 'Coder<script>', sessionId: 's1' };
        mockDbFor(MINE).seed(SCHEMA_TYPE.NOTIFICATIONS, {
            key: 'task_notification', message: 'A task delegated to an outside agent is now assigned to you.', changeType: 'agent_session_assigned', changeData,
            assigneeUsers: [OWNER], receiverID: OWNER, notSeen: [OWNER], notificationType: 'push', companyId: MINE, createdAt: new Date(),
        });
        const rows = await __internals.readNotifications(MINE, OWNER, { limit: 10 });
        expect(rows).toEqual([expect.objectContaining({ changeType: 'agent_session_assigned', changeData })]);
    });
});
