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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

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

describe('approving a proposal an outside client filed under a person\'s grant', () => {
    const ISSUER = 'https://hub.approval.test';
    const CLIENT = 'https://agent.approval.test/oauth/client.json';
    const GRANT = 'fedcba9876543210fedcba9876543210';
    const SCOPES = ['tasks:read', 'tasks:write', 'tasks:manage'];
    const ENV = ['MCP_OAUTH', 'MCP_OAUTH_ISSUER', 'MCP_TOOLS_MANAGE'];
    const savedEnv = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
    const grantRow = () => mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS][0];
    const approvalRow = () => mockDb.store[SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS][0];
    const filedOutside = (over = {}) => filed({
        agentId: `oauth:${CLIENT}`, agentName: 'Outside agent (MCP)', tokenId: '', oauthClientId: CLIENT, oauthGrantId: GRANT,
        changes: [{ action: 'task.archive', params: { taskId: T }, label: 'task.archive via MCP' }], ...over,
    });

    beforeEach(() => {
        Object.assign(process.env, { MCP_OAUTH: 'on', MCP_OAUTH_ISSUER: ISSUER, MCP_TOOLS_MANAGE: 'on' });
        mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: C, clientId: CLIENT, clientKind: 'metadata_document', status: 'approved', scopes: [...SCOPES], privateSprints: false });
        mockDb.seed(SCHEMA_TYPE.OAUTH_GRANTS, {
            grantId: GRANT, clientId: CLIENT, companyId: C, userId: REQUESTER, scopes: [...SCOPES], resource: `${ISSUER}/mcp`,
            createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000), revokedAt: null,
        });
    });
    afterAll(() => { ENV.forEach((key) => { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }); });

    it('runs the change as that client acting for the person, marked as coming from outside', async () => {
        const p = filedOutside();
        const out = await approve(p._id);
        expect(out.error).toBeUndefined();
        expect(actions.perform).toHaveBeenCalledWith(expect.objectContaining({
            action: 'task.archive',
            actor: expect.objectContaining({ userId: REQUESTER, viaAccount: 'external', clientId: CLIENT, grantId: GRANT, delegatedBy: REQUESTER, tokenId: null }),
            taint: { tainted: true, taintSources: [expect.objectContaining({ kind: 'client', ref: CLIENT })] },
        }));
        expect(statusOf(p._id)).toBe('approved');
    });

    it.each([
        ['the person revoked the grant', () => { grantRow().revokedAt = new Date(); }],
        ['the grant expired', () => { grantRow().expiresAt = new Date(Date.now() - 1000); }],
        ['the person withdrew the scope', () => { grantRow().scopes = ['tasks:read', 'tasks:write']; }],
        ['the workspace revoked its approval of the client', () => { approvalRow().status = 'revoked'; }],
        ['the workspace took the scope out of its approval', () => { approvalRow().scopes = ['tasks:read', 'tasks:write']; }],
        ['the person lost their seat', () => { require('../Config/jwt').verifyCompanyMembership.mockResolvedValueOnce(false); }],
    ])('refuses once %s, and nothing runs', async (_what, change) => {
        const p = filedOutside();
        change();
        await refusedUntouched(p, await approve(p._id), /connection/);
    });

    it('refuses a change the grant\'s manage scope does not reach, and a target the person can no longer open', async () => {
        const comment = filedOutside({ changes: [{ action: 'task.comment', params: { taskId: T, body: 'x' }, label: 'task.comment via MCP' }] });
        await refusedUntouched(comment, await approve(comment._id), /connection/);
        const p = filedOutside();
        visible[REQUESTER] = [OTHER_P];
        await refusedUntouched(p, await approve(p._id), /requester|person behind/i);
    });

    it('is not carried by a live personal token of the same person', async () => {
        const p = filedOutside({ tokenId: TOKEN });
        grantRow().revokedAt = new Date();
        await refusedUntouched(p, await approve(p._id), /connection/);
    });

    it('leaves a proposal a personal token filed checked against that token, as before', async () => {
        mockDb.store[SCHEMA_TYPE.OAUTH_GRANTS].length = 0;
        const p = filed();
        expect((await approve(p._id)).error).toBeUndefined();
        expect(actions.perform).toHaveBeenCalledWith(expect.objectContaining({ actor: expect.objectContaining({ viaAccount: 'personal', tokenId: TOKEN }) }));
        expect(actions.perform.mock.calls[0][0].taint).toBeUndefined();
    });
});
