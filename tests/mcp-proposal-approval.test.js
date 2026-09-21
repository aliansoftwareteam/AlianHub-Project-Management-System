const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {} } }));
jest.mock('../Modules/Agents/actions', () => ({ perform: jest.fn(async () => ({ auditId: 'aud1', result: {} })) }));
jest.mock('../Modules/Agents/agentAudit', () => ({ recordProposalDecision: jest.fn(async () => 'dec1'), findById: jest.fn() }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(), visibleProjects: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn() }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { ROLE_OWNER, ROLE_MEMBER } = require('../Config/roleTypes');
const actions = require('../Modules/Agents/actions');
const memory = require('../Modules/Agents/memory');
const scope = require('../Modules/Agents/scope');
const guard = require('../Config/permissionGuard');
const permissions = require('../Modules/Agents/permissions');
const proposals = require('../Modules/Agents/proposals');

const C = '6f0000000000000000000c01';
const REQUESTER = '6f0000000000000000000001';
const APPROVER = '6f0000000000000000000002';
const P = '6f00000000000000000000a1';
const OTHER_P = '6f00000000000000000000a2';
const T = '6f00000000000000000000d1';
const TOKEN = '6f0000000000000000000101';

const roles = { [REQUESTER]: ROLE_MEMBER, [APPROVER]: ROLE_MEMBER };
const visible = { [REQUESTER]: [P, OTHER_P], [APPROVER]: [P, OTHER_P] };

const decider = { kind: 'human', userId: APPROVER };
const approve = (id, over = {}) => proposals.approve(C, id, { decider, isPrivileged: false, ip: '', ...over });

const seedToken = (over = {}) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
    _id: TOKEN, userId: REQUESTER, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000), ...over,
});

const filed = (over = {}) => mockDb.seed(SCHEMA_TYPE.AGENT_PROPOSALS, {
    agentId: `mcp:${TOKEN}`, agentName: 'Laptop (MCP)', runId: null, taskId: T, projectId: P, status: 'pending', gate: null,
    source: 'mcp', requestedBy: REQUESTER, tokenId: TOKEN, tokenProjectIds: [], allowedActions: [],
    changes: [{ action: 'task.comment', params: { taskId: T, body: 'Retire this' }, label: 'task.comment via MCP' }],
    ...over,
});

const statusOf = (id) => mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS].find((r) => String(r._id) === String(id)).status;

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    roles[REQUESTER] = ROLE_MEMBER;
    roles[APPROVER] = ROLE_MEMBER;
    visible[REQUESTER] = [P, OTHER_P];
    visible[APPROVER] = [P, OTHER_P];
    guard.getRoleType.mockImplementation(async (companyId, uid) => (uid in roles ? roles[uid] : null));
    scope.visibleProjectIds.mockImplementation(async (companyId, uid) => visible[uid] || []);
    permissions.holderMay.mockResolvedValue({ allowed: true, reason: '' });
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: T, ProjectID: P, sprintId: null, deletedStatusKey: 0 });
    seedToken();
});

const refusedUntouched = async (p, out, pattern) => {
    expect(out).toMatchObject({ error: expect.stringMatching(pattern), status: expect.any(Number) });
    expect(actions.perform).not.toHaveBeenCalled();
    expect(statusOf(p._id)).toBe('pending');
};

describe('approving a proposal an MCP call filed', () => {
    it('runs the change as filed, as the token user', async () => {
        const p = filed();
        const out = await approve(p._id);
        expect(out.error).toBeUndefined();
        expect(actions.perform).toHaveBeenCalledWith(expect.objectContaining({ action: 'task.comment', actor: expect.objectContaining({ userId: REQUESTER, tokenId: TOKEN }) }));
        expect(statusOf(p._id)).toBe('approved');
    });

    it('refuses edited changes: an MCP proposal is approved or declined as filed', async () => {
        const p = filed();
        const out = await approve(p._id, { changes: [{ action: 'task.comment', params: { taskId: T, body: 'something else' } }] });
        await refusedUntouched(p, out, /as filed/);
    });

    it('computes the owner/admin gate from the changes that will run, not the stored gate', async () => {
        const p = filed({ gate: null, changes: [{ action: 'deploy.staging', params: {}, label: 'deploy' }] });
        await refusedUntouched(p, await approve(p._id), /Owner or Admin/);
        roles[APPROVER] = ROLE_OWNER;
        expect((await approve(p._id, { isPrivileged: true })).error).toBeUndefined();
    });

    it('refuses an approver who may not make that change themselves', async () => {
        const p = filed();
        permissions.holderMay.mockImplementation(async (companyId, actor) => (actor.userId === APPROVER ? { allowed: false, reason: 'permission_denied: task.task_comment' } : { allowed: true }));
        await refusedUntouched(p, await approve(p._id), /permission_denied/);
    });

    it('refuses an approver who cannot open the target project', async () => {
        const p = filed();
        visible[APPROVER] = [OTHER_P];
        await refusedUntouched(p, await approve(p._id), /approver/i);
    });

    it('refuses once the token has been revoked', async () => {
        const p = filed();
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].active = false;
        await refusedUntouched(p, await approve(p._id), /token/i);
    });

    it('refuses once the token has been deleted or has expired', async () => {
        const p = filed();
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].expiresAt = new Date(Date.now() - 1000);
        await refusedUntouched(p, await approve(p._id), /token/i);
        mockDb.store[SCHEMA_TYPE.API_TOKENS].length = 0;
        await refusedUntouched(p, await approve(p._id), /token/i);
    });

    it('refuses a token that no longer has the write scope', async () => {
        const p = filed();
        mockDb.store[SCHEMA_TYPE.API_TOKENS][0].scopes = ['read'];
        await refusedUntouched(p, await approve(p._id), /write/i);
    });

    it('refuses a target outside the token\'s project list', async () => {
        const p = filed({ tokenProjectIds: [OTHER_P] });
        await refusedUntouched(p, await approve(p._id), /token/i);
    });

    it('refuses a target outside what the requester can open now', async () => {
        const p = filed();
        visible[REQUESTER] = [OTHER_P];
        await refusedUntouched(p, await approve(p._id), /requester|person behind/i);
    });
});
