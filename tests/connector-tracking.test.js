const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn(), recordAuditFromReq: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '', permission: null })), REASON: 'permission_denied' }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn(), markBackoff: jest.fn(), recordHealth: jest.fn(async () => {}) }));
jest.mock('../Modules/Agents/engine/safeFetch', () => ({
    ...jest.requireActual('../Modules/Agents/engine/safeFetch'),
    safeFetch: jest.fn(),
}));
jest.mock('../Config/permissionGuard', () => ({ ...jest.requireActual('../Config/permissionGuard'), getRoleType: jest.fn(), isPrivileged: jest.fn((role) => role === 1) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { safeFetch } = require('../Modules/Agents/engine/safeFetch');
const { resolveConnection, markBackoff, recordHealth } = require('../Modules/Connectors/resolveConnection');
const { recordAudit } = require('../Modules/Audit/recorder');
const { getRoleType } = require('../Config/permissionGuard');
const runner = require('../Modules/Connectors/toolRunner');
const quotas = require('../Modules/Connectors/quotas');
const usage = require('../Modules/Connectors/usage');
const rateLimits = require('../Modules/Connectors/rateLimits');
const controller = require('../Modules/Connectors/controller');
const egressContext = require('../Modules/Agents/engine/egressContext');
const proposals = require('../Modules/Agents/proposals');

/* Every connector call leaves one audit row and one count, a call over a limit is refused with the limit and when it
 * resets, and a provider's "slow down" holds the next call. */

const C = '6f0000000000000000000c01';
const PRISHA = '6f0000000000000000000a01';
const MEMBER = '6f0000000000000000000a03';
const ADMIN = '6f0000000000000000000a02';
const AGENT_ID = '6f0000000000000000000b01';
const RUN = '6f0000000000000000000d01';
const MINE = 'conn-prisha';
const READ = 'fake.notes.list';
const WRITE = 'fake.notes.create';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on' };
const CEILING_NAMES = ['CONNECTOR_QUOTA_MAX_READS', 'CONNECTOR_QUOTA_MAX_WRITE_PROPOSALS', 'CONNECTOR_QUOTA_MAX_AGENT_READS'];
const before = Object.fromEntries([...Object.keys(ENV), ...CEILING_NAMES].map((k) => [k, process.env[k]]));

const NOTES = { status: 200, headers: {}, body: JSON.stringify({ notes: [{ title: 'Board meeting' }] }) };
const connectorError = (code) => Object.assign(new Error(code), { name: 'ConnectorError', code, provider: 'fake' });
const connected = (scopes = ['notes.read', 'notes.write']) => resolveConnection.mockResolvedValue({ connectionId: MINE, scopes, getAccessToken: async () => 'secret-token' });
const mcpRead = (input = {}) => egressContext.run({ companyId: C }, () => runner.read({ companyId: C, userId: PRISHA, via: runner.VIA.MCP, callerId: 'oauth:client-1', key: READ, input }));
const agentRead = () => egressContext.run({ companyId: C }, () => runner.read({ companyId: C, userId: PRISHA, via: runner.VIA.AGENT, runId: RUN, callerId: AGENT_ID, key: READ, input: {} }));
const callRows = () => recordAudit.mock.calls.map(([, row]) => row).filter((row) => row.action === 'connector.call');
const usageRows = () => mockDb.store[SCHEMA_TYPE.CONNECTOR_USAGE] || [];
const counted = (field) => usageRows().reduce((sum, row) => sum + (row[field] || 0), 0);
const seedUsage = (over) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_USAGE, { connectionId: 'other', userId: PRISHA, actor: { type: 'mcp', id: 'other' }, day: usage.dayOf(), reads: 0, writeProposals: 0, ...over });
const fileWrite = () => proposals.create(C, {
    agent: { _id: AGENT_ID, name: 'Digest' }, projectId: null, what: 'Save the minutes', why: 'The meeting ended',
    changes: [{ action: WRITE, params: { title: 'Minutes', body: 'Approved the budget.' } }], connectionOwner: PRISHA,
});
const setQuota = async (body, { uid = ADMIN, role = 1, apiToken } = {}) => {
    getRoleType.mockResolvedValue(role);
    const res = { status: jest.fn(() => res), send: jest.fn(() => res) };
    await controller.setQuotas({ headers: { companyid: C }, aud: C, uid, body, apiToken, get: () => '', ip: '' }, res);
    return { code: res.status.mock.calls.length ? res.status.mock.calls[0][0] : 200, body: res.send.mock.calls[0][0] };
};

beforeEach(() => {
    Object.assign(process.env, ENV);
    CEILING_NAMES.forEach((name) => delete process.env[name]);
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    connected();
    safeFetch.mockImplementation(async () => NOTES);
    markBackoff.mockImplementation(async ({ connectionId, until }) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: connectionId, backoffUntil: until }));
    mockDb.seed(SCHEMA_TYPE.AGENT_RUNS, { _id: RUN, status: 'running', connectorReads: [] });
    mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT_ID, name: 'Digest', allowedActions: [], autonomy: 3 });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: MEMBER, status: 2 });
});

afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('the audit row of a call', () => {
    it('is written once per read, with a hash and counts but no content', async () => {
        const out = await mcpRead({ limit: 3 });
        const rows = callRows();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ actorId: PRISHA, entityId: 'fake', meta: { action: READ, phase: 'read', via: 'mcp', callerId: 'oauth:client-1', connectionId: MINE, provider: 'fake', state: 'applied', chars: out.chars } });
        expect(rows[0].meta.inputHash).toMatch(/^[a-f0-9]{16}$/);
        expect(JSON.stringify(rows[0])).not.toContain('Board meeting');
        expect(JSON.stringify(rows[0])).not.toContain('secret-token');
    });

    it('names the agent and the run, so the run trace can show it', async () => {
        await agentRead();
        expect(callRows()[0].meta).toMatchObject({ via: 'agent', agentId: AGENT_ID, runId: RUN, state: 'applied' });
    });

    it('records a refusal before the provider as refused, with the code alone', async () => {
        resolveConnection.mockRejectedValue(connectorError('not_connected'));
        await expect(mcpRead()).rejects.toMatchObject({ code: 'not_connected' });
        expect(callRows()).toHaveLength(1);
        expect(callRows()[0].meta).toMatchObject({ state: 'refused', reason: 'not_connected', connectionId: '' });
        expect(counted('reads')).toBe(0);
    });

    it('records a provider failure as failed, and the call still counts', async () => {
        safeFetch.mockRejectedValue(Object.assign(new Error('boom with a secret'), { code: 'ECONNRESET' }));
        await expect(mcpRead()).rejects.toThrow('boom');
        expect(callRows()[0].meta).toMatchObject({ state: 'failed', reason: 'ECONNRESET' });
        expect(JSON.stringify(callRows()[0])).not.toContain('boom');
        expect(counted('reads')).toBe(1);
    });
});

describe('usage', () => {
    it('keeps one row per connection, caller and day, counting every read', async () => {
        await mcpRead();
        await mcpRead();
        await agentRead();
        expect(usageRows()).toHaveLength(2);
        expect(usageRows().find((row) => row.actor.type === 'mcp')).toMatchObject({ companyId: C, connectionId: MINE, userId: PRISHA, day: usage.dayOf(), reads: 2, actor: { type: 'mcp', id: 'oauth:client-1' } });
        expect(usageRows().find((row) => row.actor.type === 'agent')).toMatchObject({ reads: 1, actor: { type: 'agent', id: AGENT_ID } });
        expect(callRows().filter((row) => row.meta.phase === 'read')).toHaveLength(counted('reads'));
    });

    it('counts a write proposal when it is filed, with an audit row, and not when it is sent or edited', async () => {
        await fileWrite();
        expect(counted('writeProposals')).toBe(1);
        expect(callRows()).toHaveLength(1);
        expect(callRows()[0].meta).toMatchObject({ action: WRITE, phase: 'propose', state: 'filed', connectionId: MINE, via: 'agent' });
        expect(JSON.stringify(callRows()[0])).not.toContain('budget');
        await egressContext.run({ companyId: C }, () => runner.write({ companyId: C, userId: PRISHA, key: WRITE, params: { title: 'Minutes', body: 'Approved.' } }));
        expect(counted('writeProposals')).toBe(1);
        expect(callRows()[1].meta).toMatchObject({ phase: 'send', via: 'approved', state: 'applied' });
    });
});

describe('the daily limits', () => {
    it('refuse a person\'s read over the limit, naming the limit and the reset, and give the count back', async () => {
        seedUsage({ reads: quotas.DEFAULTS.reads });
        const error = await mcpRead().catch((e) => e);
        expect(error).toMatchObject({ code: 'quota_reached', deterministic: true, limit: 500, resetsAt: usage.nextReset() });
        expect(error.message).toContain('500');
        expect(error.message).toContain(usage.nextReset().toISOString());
        expect(safeFetch).not.toHaveBeenCalled();
        expect(counted('reads')).toBe(500);
        expect(callRows()[0].meta).toMatchObject({ state: 'refused', reason: 'quota_reached' });
    });

    it('add up a person\'s connections and let the last place be taken', async () => {
        seedUsage({ reads: 200, connectionId: 'a' });
        seedUsage({ reads: 299, connectionId: 'b' });
        await expect(mcpRead()).resolves.toBeTruthy();
        await expect(mcpRead()).rejects.toMatchObject({ code: 'quota_reached' });
    });

    it('refuse an agent over its own limit while the person still has room', async () => {
        seedUsage({ reads: 200, actor: { type: 'agent', id: AGENT_ID }, userId: MEMBER });
        await expect(agentRead()).rejects.toMatchObject({ code: 'quota_reached', limit: 200 });
        expect(safeFetch).not.toHaveBeenCalled();
        await expect(mcpRead()).resolves.toBeTruthy();
    });

    it('do not hold a run\'s place for a read the limit refused, or count a read the run refused', async () => {
        const run = mockDb.store[SCHEMA_TYPE.AGENT_RUNS][0];
        run.connectorReads = [1, 2, 3].map((i) => ({ slot: `s${i}`, state: 'applied', chars: 1 }));
        await expect(agentRead()).rejects.toMatchObject({ code: 'run_call_cap' });
        expect(counted('reads')).toBe(0);
    });

    it('refuse a write proposal over the limit: nothing is filed', async () => {
        seedUsage({ writeProposals: 50 });
        await expect(fileWrite()).rejects.toMatchObject({ code: 'quota_reached', limit: 50 });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
        expect(callRows()[0].meta).toMatchObject({ phase: 'propose', state: 'refused', reason: 'quota_reached' });
    });

    it('take a member or agent limit before the workspace one, and the workspace one before the default', async () => {
        const save = (scope, targetId, fields) => mockDb.seed(SCHEMA_TYPE.CONNECTOR_QUOTAS, { scope, targetId, ...fields });
        expect(await quotas.limitsFor(C, PRISHA, AGENT_ID)).toEqual({ reads: 500, writeProposals: 50, agentReads: 200 });
        save('workspace', '', { reads: 100, agentReads: 30 });
        save('member', PRISHA, { writeProposals: 5 });
        save('agent', AGENT_ID, { agentReads: 7 });
        expect(await quotas.limitsFor(C, PRISHA, AGENT_ID)).toEqual({ reads: 100, writeProposals: 5, agentReads: 7 });
        expect(await quotas.limitsFor(C, MEMBER, '')).toEqual({ reads: 100, writeProposals: 50, agentReads: 30 });
    });

    it('never pass a ceiling lowered after a limit was saved', async () => {
        mockDb.seed(SCHEMA_TYPE.CONNECTOR_QUOTAS, { scope: 'workspace', targetId: '', reads: 900 });
        process.env.CONNECTOR_QUOTA_MAX_READS = '40';
        expect((await quotas.limitsFor(C, PRISHA, '')).reads).toBe(40);
    });
});

describe('PUT /api/v2/connectors/admin/quotas', () => {
    it('saves a workspace limit and audits it', async () => {
        const { code, body } = await setQuota({ scope: 'workspace', reads: 700 });
        expect(code).toBe(200);
        expect(body.data).toMatchObject({ scope: 'workspace', limits: { reads: 700, writeProposals: null, agentReads: null }, ceilings: { reads: 5000 } });
        expect((await quotas.limitsFor(C, PRISHA, '')).reads).toBe(700);
        expect(recordAudit.mock.calls.map(([, row]) => row).find((row) => row.action === 'connector.quota_set')).toMatchObject({ actorId: ADMIN, meta: { scope: 'workspace', set: { reads: 700 } } });
    });

    it('refuses a limit above the instance ceiling', async () => {
        process.env.CONNECTOR_QUOTA_MAX_READS = '600';
        const { code, body } = await setQuota({ scope: 'workspace', reads: 601 });
        expect(code).toBe(400);
        expect(body.statusText).toContain('600');
        expect(mockDb.store[SCHEMA_TYPE.CONNECTOR_QUOTAS] || []).toHaveLength(0);
    });

    it('takes a limit away with null, so the wider one applies again', async () => {
        await setQuota({ scope: 'member', targetId: MEMBER, reads: 9 });
        expect((await quotas.limitsFor(C, MEMBER, '')).reads).toBe(9);
        const { body } = await setQuota({ scope: 'member', targetId: MEMBER, reads: null });
        expect(body.data.limits.reads).toBeNull();
        expect((await quotas.limitsFor(C, MEMBER, '')).reads).toBe(500);
    });

    it.each([
        [{ scope: 'galaxy', reads: 1 }, /scope/],
        [{ scope: 'workspace' }, /at least one/],
        [{ scope: 'workspace', reads: -1 }, /whole number/],
        [{ scope: 'workspace', reads: 1.5 }, /whole number/],
        [{ scope: 'workspace', reads: '5' }, /whole number/],
        [{ scope: 'member', targetId: 'nope', reads: 1 }, /id/],
        [{ scope: 'member', targetId: '6f0000000000000000000a09', reads: 1 }, /not in this workspace/],
        [{ scope: 'agent', targetId: '6f0000000000000000000b09', agentReads: 1 }, /not in this workspace/],
        [{ scope: 'agent', targetId: AGENT_ID, reads: 1 }, /does not take reads/],
    ])('refuses %j', async (body, why) => {
        const out = await setQuota(body);
        expect(out.code).toBe(400);
        expect(out.body.statusText).toMatch(why);
    });

    it('is for an owner or admin in person', async () => {
        expect((await setQuota({ scope: 'workspace', reads: 5 }, { role: 3 })).code).toBe(403);
        expect((await setQuota({ scope: 'workspace', reads: 5 }, { apiToken: { _id: 't' } })).code).toBe(403);
        expect(mockDb.store[SCHEMA_TYPE.CONNECTOR_QUOTAS] || []).toHaveLength(0);
    });
});

describe('a provider that says to slow down', () => {
    const limited = { status: 429, headers: { 'retry-after': '120' }, body: '{}' };

    it('holds the connection for the time it named, and the next call never reaches it', async () => {
        safeFetch.mockResolvedValueOnce(limited);
        const started = Date.now();
        await expect(mcpRead()).rejects.toMatchObject({ code: 'provider_busy' });
        const { until } = markBackoff.mock.calls[0][0];
        expect(markBackoff.mock.calls[0][0]).toMatchObject({ companyId: C, connectionId: MINE });
        expect(until.getTime()).toBeGreaterThanOrEqual(started + 120000);
        expect(until.getTime()).toBeLessThanOrEqual(Date.now() + 120000);
        expect(callRows()[0].meta).toMatchObject({ state: 'failed', reason: 'provider_busy' });

        safeFetch.mockClear();
        const error = await mcpRead().catch((e) => e);
        expect(error).toMatchObject({ code: 'provider_busy', retryAt: until });
        expect(error.message).toContain(until.toISOString());
        expect(safeFetch).not.toHaveBeenCalled();
        expect(callRows()[1].meta).toMatchObject({ state: 'refused', reason: 'provider_busy' });
        expect(counted('reads')).toBe(1);
    });

    it('lets calls through again once the time has passed', async () => {
        mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: MINE, backoffUntil: new Date(Date.now() - 1000) });
        await expect(mcpRead()).resolves.toBeTruthy();
    });

    it('holds a send back before the approval is spent', async () => {
        mockDb.seed(SCHEMA_TYPE.CONNECTOR_CONNECTIONS, { _id: MINE, backoffUntil: new Date(Date.now() + 60000) });
        const beforeSend = jest.fn(async () => {});
        await expect(egressContext.run({ companyId: C }, () => runner.write({ companyId: C, userId: PRISHA, key: WRITE, params: { title: 'T', body: 'B' }, beforeSend }))).rejects.toMatchObject({ code: 'provider_busy' });
        expect(beforeSend).not.toHaveBeenCalled();
        expect(safeFetch).not.toHaveBeenCalled();
    });

    it('catches it on a send too', async () => {
        safeFetch.mockResolvedValueOnce(limited);
        await expect(egressContext.run({ companyId: C }, () => runner.write({ companyId: C, userId: PRISHA, key: WRITE, params: { title: 'T', body: 'B' } }))).rejects.toMatchObject({ code: 'provider_busy' });
        expect(markBackoff).toHaveBeenCalledTimes(1);
    });

    describe('what counts as slowing down', () => {
        const fake = require('./fixtures/connectors/fake');

        it('is a 429, or a listed status that says so', () => {
            expect(rateLimits.isRateLimited({}, { status: 429 })).toBe(true);
            expect(rateLimits.isRateLimited(fake, { status: 403, headers: { 'retry-after': '5' } })).toBe(true);
            expect(rateLimits.isRateLimited(fake, { status: 403, headers: {}, body: '{"reason":"rateLimitExceeded"}' })).toBe(true);
        });

        it('is not a 403 for missing rights, or a status the provider did not list', () => {
            expect(rateLimits.isRateLimited(fake, { status: 403, headers: {}, body: '{"reason":"forbidden"}' })).toBe(false);
            expect(rateLimits.isRateLimited({}, { status: 403, headers: { 'retry-after': '5' } })).toBe(false);
            expect(rateLimits.isRateLimited(fake, { status: 200, headers: {} })).toBe(false);
        });

        it('waits for the reset of the window when no Retry-After is sent, and never past the ceiling', () => {
            const now = Date.parse('2026-10-31T10:00:00Z');
            expect(rateLimits.untilOf({ headers: { 'x-ratelimit-reset': String(now / 1000 + 300) } }, now).getTime()).toBe(now + 300000);
            expect(rateLimits.untilOf({ headers: { 'retry-after': '999999' } }, now).getTime()).toBe(now + 6 * 60 * 60 * 1000);
        });
    });
});

describe('health', () => {
    it('notes the use of a connection once the provider answered', async () => {
        await mcpRead();
        expect(recordHealth).toHaveBeenCalledWith({ companyId: C, connectionId: MINE, lastUsedAt: expect.any(Date), lastError: '' });
    });

    it('keeps only the code of a failure, and a failing note never fails the call', async () => {
        safeFetch.mockRejectedValueOnce(Object.assign(new Error('Authorization: Bearer secret-token'), { code: 'ECONNRESET' }));
        await expect(mcpRead()).rejects.toThrow();
        expect(recordHealth).toHaveBeenLastCalledWith(expect.objectContaining({ lastError: 'ECONNRESET' }));
        recordHealth.mockRejectedValueOnce(new Error('db down'));
        await expect(mcpRead()).resolves.toBeTruthy();
    });

    it('notes nothing when the provider was never reached', async () => {
        resolveConnection.mockRejectedValue(connectorError('not_connected'));
        await expect(mcpRead()).rejects.toBeTruthy();
        expect(recordHealth).not.toHaveBeenCalled();
    });

    it('tells the person of a broken connection once a day, however many calls hit it', async () => {
        resolveConnection.mockRejectedValue(connectorError('broken'));
        await expect(mcpRead()).rejects.toMatchObject({ code: 'broken' });
        await expect(mcpRead()).rejects.toMatchObject({ code: 'broken' });
        const told = (mockDb.store[SCHEMA_TYPE.NOTIFICATIONS] || []).filter((row) => !row.notificationId);
        expect(told).toHaveLength(1);
        expect(told[0]).toMatchObject({ key: 'connector_broken', changeData: { provider: 'fake', name: 'Fake' }, assigneeUsers: [PRISHA] });
        expect(told[0].message).toContain('Reconnect');
    });

    it('tells the person when a token refresh finds the connection broken', async () => {
        resolveConnection.mockResolvedValue({ connectionId: MINE, scopes: ['notes.read'], getAccessToken: async () => { throw connectorError('broken'); } });
        await expect(mcpRead()).rejects.toMatchObject({ code: 'broken' });
        expect(mockDb.store[SCHEMA_TYPE.NOTIFICATIONS].length).toBeGreaterThan(0);
        expect(safeFetch).not.toHaveBeenCalled();
    });
});

describe('the strict schema and the contract', () => {
    it('keeps every quota field and one row per target', () => {
        const { connectorQuotasSchema } = require('../utils/mongo-handler/createSchema');
        ['companyId', 'scope', 'targetId', 'reads', 'writeProposals', 'agentReads', 'setBy', 'updatedAt'].forEach((field) => expect(connectorQuotasSchema.path(field)).toBeDefined());
        const [keys, options] = connectorQuotasSchema.indexes().find(([, o]) => o.name === 'one_per_target');
        expect(keys).toEqual({ scope: 1, targetId: 1 });
        expect(options.unique).toBe(true);
    });

    it('never sets actor on the insert: the filter already builds it', async () => {
        await mcpRead();
        const write = mockDb.calls.find((call) => call.type === SCHEMA_TYPE.CONNECTOR_USAGE && call.method === 'updateOne');
        expect(write.data[0]).toMatchObject({ 'actor.type': 'mcp', 'actor.id': 'oauth:client-1' });
        expect(write.data[1].$setOnInsert.actor).toBeUndefined();
    });
});
