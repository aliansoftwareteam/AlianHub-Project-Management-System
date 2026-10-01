/* Task 047, AI-4c: a project's own rule for agents. Two settings, read through one function that every
   agent write asks, and never looser than the workspace's switch. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Sprints/controller', () => mockStub());
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publish: jest.fn() }));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpManageWorld');
const mongoHelper = require('../Modules/Tasks/helpers/mongo_helper');
const socketEmitter = require('../event/socketEventEmitter');
const actions = require('../Modules/Agents/actions');
const policy = require('../Modules/Agents/policy');
const proposals = require('../Modules/Agents/proposals');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const controller = require('../Modules/Agents/projectPolicyController');
const guard = require('../Modules/Agents/guard');
const server = require('../Modules/Mcp/server');

mongoHelper.getTotalSprintCount = async () => true;

const { CID, OWNER, ADMIN, MEMBER, OUTSIDER, TOKEN, P_OPEN, P_DEST, S_DEST, TASKS_GRANT, PLAIN_SCOPES, settle, ctx, olderToken, outside } = world;
const { seed, stored, rows, audits, rpcThrough, seedGrant } = world.create(mockDb);
const rpc = rpcThrough(server);

const { DONE, CONNECTED, DECISION } = projectPolicy;
const NEVER = DONE.NEVER;
const APPROVAL = DONE.APPROVAL;
const YES = DONE.YES;

const project = (id) => rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === String(id));
const setProject = (id, agentPolicy) => { project(id).agentPolicy = agentPolicy; };
const setCompany = (requireCheckBeforeDone) => { mockDb.store.companies[0].agentPolicy = { requireCheckBeforeDone }; };
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentId: '6f0000000000000000000a91', agentName: 'Triage', runId: '6f0000000000000000000a92', viaAccount: 'workspace', tokenId: null });
const outcomeOf = (reply) => (reply.pending ? 'proposed' : reply.refused ? 'refused' : reply.ok ? 'applied' : 'failed');
const closeBy = (caller, taskId) => rpc(caller, 'task.status.set', { taskId, status: 'Done' });

let fx;

beforeEach(() => {
    jest.clearAllMocks();
    fx = seed();
    process.env.MCP_TOOLS_WORK = 'on';
});
afterEach(settle);
afterAll(() => { ['MCP_TOOLS_MANAGE', 'MCP_TOOLS_WORK', 'MCP_TOOLS_V2', 'AGENT_TAINT_ROUTING'].forEach((key) => { delete process.env[key]; }); });

describe('what a project stores', () => {
    it('behaves as the defaults when nothing is stored, and when what is stored is not a value it knows', async () => {
        expect(await projectPolicy.read(CID, P_OPEN)).toEqual({ done: APPROVAL, connected: CONNECTED.SINGLE_TASK });
        setProject(P_OPEN, { done: 'always', connected: 7 });
        expect(await projectPolicy.read(CID, P_OPEN)).toEqual({ done: APPROVAL, connected: CONNECTED.SINGLE_TASK });
        setProject(P_OPEN, { done: YES, connected: CONNECTED.PROPOSE_ALL });
        expect(await projectPolicy.read(CID, P_OPEN)).toEqual({ done: YES, connected: CONNECTED.PROPOSE_ALL });
    });

    it.each([
        [YES, false, YES], [APPROVAL, false, APPROVAL], [NEVER, false, NEVER],
        [YES, true, NEVER], [APPROVAL, true, NEVER], [NEVER, true, NEVER],
    ])('project %s with the workspace switch %s holds agents to %s', async (done, company, held) => {
        setProject(P_OPEN, { done });
        setCompany(company);
        expect(await projectPolicy.effective(CID, P_OPEN)).toMatchObject({ done: held, workspaceChecksBeforeDone: company });
    });
});

describe('a close, by project, by workspace and by who asks', () => {
    const TABLE = [
        [YES, false, 'applied'], [APPROVAL, false, 'proposed'], [NEVER, false, 'refused'],
        [YES, true, 'refused'], [APPROVAL, true, 'refused'], [NEVER, true, 'refused'],
    ];

    it.each(TABLE)('a connected agent that holds the manage grant: project %s, workspace switch %s, is %s', async (done, company, outcome) => {
        setProject(P_OPEN, { done });
        setCompany(company);
        expect(outcomeOf(await closeBy(ctx(OWNER), fx.top._id))).toBe(outcome);
        expect(stored(fx.top._id).statusType).toBe(outcome === 'applied' ? 'close' : 'active');
        expect(proposals.create).toHaveBeenCalledTimes(outcome === 'proposed' ? 1 : 0);
        if (outcome === 'applied') expect(stored(fx.top._id).completion).toMatchObject({ checkedBy: null, badge: 'UNCHECKED', closedBy: { viaAgent: true } });
    });

    it.each(TABLE)('a connected agent without the manage grant: project %s, workspace switch %s, is refused', async (done, company) => {
        setProject(P_OPEN, { done });
        setCompany(company);
        expect(outcomeOf(await closeBy(olderToken(OWNER), fx.top._id))).toBe('refused');
        expect(stored(fx.top._id).statusType).toBe('active');
        expect(proposals.create).not.toHaveBeenCalled();
    });

    it('an outside client that holds the manage grant files its close where the project asks for approval', async () => {
        seedGrant(OWNER, [...PLAIN_SCOPES, TASKS_GRANT]);
        const out = await closeBy(outside(OWNER, [...PLAIN_SCOPES, TASKS_GRANT]), fx.top._id);
        expect(out).toMatchObject({ pending: true, approval: 'pending' });
        expect(proposals.create.mock.calls[0][1]).toMatchObject({ changes: [{ action: 'task.status.change' }], oauthGrantId: world.GRANT_ID });
        expect(stored(fx.top._id).statusType).toBe('active');
    });

    const agentAt = (autonomy) => ({ autonomy, projectIds: [P_OPEN], allowedActions: [] });
    const reviewed = async (autonomy, action, params) => {
        const verdict = policy.decide({ agent: agentAt(autonomy), action, params: { ...params, projectId: P_OPEN }, rating: actions.rating(action) });
        return (await projectPolicy.review({ companyId: CID, actor: inProduct(OWNER), action, params, verdict })).decision;
    };
    const IN_PRODUCT = [0, 1, 2, 3].flatMap((level) => [
        [level, YES, false, level < 2 ? DECISION.PROPOSE : DECISION.ACT],
        [level, APPROVAL, false, DECISION.PROPOSE],
        [level, NEVER, false, DECISION.REFUSE],
        [level, YES, true, DECISION.REFUSE],
        [level, APPROVAL, true, DECISION.REFUSE],
        [level, NEVER, true, DECISION.REFUSE],
    ]);

    it.each(IN_PRODUCT)('an in-product agent at L%i: project %s, workspace switch %s, is held to %s', async (level, done, company, decision) => {
        setProject(P_OPEN, { done });
        setCompany(company);
        expect(await reviewed(level, 'task.status.change', { taskId: String(fx.top._id), status: { name: 'Done' } })).toBe(decision);
    });

    it('leaves every other status, and a close the task already holds, to the rules that were there', async () => {
        setProject(P_OPEN, { done: NEVER });
        expect(outcomeOf(await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'To Do' }))).toBe('applied');
        Object.assign(stored(fx.top._id), { status: { key: 3, text: 'Done', type: 'close' }, statusKey: 3, statusType: 'close' });
        expect(await closeBy(ctx(OWNER), fx.top._id)).toMatchObject({ ok: true, result: { changed: false } });
        expect(await reviewed(2, 'task.status.change', { taskId: String(fx.top._id), status: { name: 'To Do' } })).toBe(DECISION.ACT);
    });

    it('never loosens a verdict it is handed', async () => {
        setProject(P_OPEN, { done: YES });
        const refused = { decision: DECISION.REFUSE, reason: 'task.status.change is outside this agent\'s allowed actions', rating: null };
        expect(await projectPolicy.review({ companyId: CID, actor: inProduct(OWNER), action: 'task.status.change', params: { taskId: String(fx.top._id), status: { name: 'Done' } }, verdict: refused })).toBe(refused);
        expect(await reviewed(1, 'task.comment', { taskId: String(fx.top._id), body: 'x' })).toBe(DECISION.PROPOSE);
    });
});

describe('where every agent write asks', () => {
    const close = (taskId) => ({ companyId: CID, actor: ctx(OWNER).actor, action: 'task.status.change', params: { taskId: String(taskId), status: { name: 'Done' } } });

    it('the action layer refuses a close the project holds for approval, and applies it once a person has approved', async () => {
        await expect(actions.perform(close(fx.top._id))).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/approv/) });
        expect(stored(fx.top._id).statusType).toBe('active');
        expect(audits('task.status.change', 'applied')).toHaveLength(0);
        await actions.perform({ ...close(fx.top._id), approved: true });
        expect(stored(fx.top._id).statusType).toBe('close');
        expect(stored(fx.top._id).completion).toMatchObject({ checkedBy: null, badge: 'UNCHECKED' });
    });

    it.each([['the project says never', () => setProject(P_OPEN, { done: NEVER })], ['the workspace has a person check first', () => { setProject(P_OPEN, { done: YES }); setCompany(true); }]])(
        'an approval does not close a task where %s', async (_why, arrange) => {
            arrange();
            await expect(actions.perform({ ...close(fx.top._id), approved: true })).rejects.toMatchObject({ name: 'RefusedError', message: expect.stringMatching(/a person closes this task/) });
            expect(stored(fx.top._id).statusType).toBe('active');
        },
    );

    it('a caller cannot mark its own call approved through the arguments it sends', async () => {
        const out = await rpc(ctx(OWNER), 'task.status.set', { taskId: fx.top._id, status: 'Done', approved: true, __proposal: true });
        expect(outcomeOf(out)).not.toBe('applied');
        expect(stored(fx.top._id).statusType).toBe('active');
    });

    it('a task created already done counts as a close', async () => {
        const create = () => rpc(ctx(OWNER), 'task.create', { projectId: P_OPEN, title: 'Born done', status: 'Done' });
        expect(outcomeOf(await create())).toBe('proposed');
        setProject(P_OPEN, { done: NEVER });
        expect(outcomeOf(await create())).toBe('refused');
        setProject(P_OPEN, { done: YES });
        setCompany(true);
        expect(outcomeOf(await create())).toBe('refused');
        expect(rows(SCHEMA_TYPE.TASKS).filter((task) => task.TaskName === 'Born done')).toHaveLength(0);
        setCompany(false);
        expect(outcomeOf(await create())).toBe('applied');
    });

    describe('with the project set to propose everything', () => {
        beforeEach(() => setProject(P_OPEN, { done: YES, connected: CONNECTED.PROPOSE_ALL }));

        it.each([
            ['the older path', 'task.comment', () => ({ taskId: fx.top._id, body: 'Hello' }), 'task.comment'],
            ['the task route path', 'task.update', () => ({ taskId: fx.top._id, title: 'Renamed' }), 'task.edit'],
            ['the work route path', 'task.tags.add', () => ({ taskId: fx.top._id, tag: 'urgent' }), 'task.tags.add'],
            ['a close', 'task.status.set', () => ({ taskId: fx.top._id, status: 'Done' }), 'task.status.change'],
        ])('a connected agent\'s write on %s waits for a person', async (_path, tool, args, action) => {
            const before = JSON.stringify([stored(fx.top._id), rows(SCHEMA_TYPE.COMMENTS)]);
            const out = await rpc(ctx(OWNER), tool, args());
            expect(out).toMatchObject({ pending: true, approval: 'pending', proposalId: 'proposal-1' });
            expect(proposals.create.mock.calls[0][1]).toMatchObject({ source: 'mcp', changes: [{ action }], tokenId: TOKEN });
            expect(JSON.stringify([stored(fx.top._id), rows(SCHEMA_TYPE.COMMENTS)])).toBe(before);
        });

        it('reads are answered as before, and a write in another project is applied as before', async () => {
            expect(await rpc(ctx(OWNER), 'task.get', { taskId: fx.top._id })).not.toMatchObject({ pending: true });
            const made = await rpc(ctx(OWNER), 'task.create', { projectId: P_DEST, sprintId: S_DEST, title: 'Elsewhere' });
            expect(outcomeOf(made)).toBe('applied');
        });

        it('a write that reaches two projects waits when either asks', async () => {
            const out = await rpc(ctx(OWNER), 'task.move', { taskId: fx.bug._id, projectId: P_DEST, sprintId: S_DEST });
            expect(outcomeOf(out)).toBe('proposed');
            setProject(P_OPEN, {});
            setProject(P_DEST, { connected: CONNECTED.PROPOSE_ALL });
            expect(outcomeOf(await rpc(ctx(OWNER), 'task.move', { taskId: fx.bug._id, projectId: P_DEST, sprintId: S_DEST }))).toBe('proposed');
            expect(String(stored(fx.bug._id).ProjectID)).toBe(P_OPEN);
        });

        it('an outside client that cannot file a proposal is refused, and changes nothing', async () => {
            seedGrant(OWNER, PLAIN_SCOPES);
            const out = await rpc(outside(OWNER, PLAIN_SCOPES), 'task.comment', { taskId: fx.top._id, body: 'Hello' });
            expect(out).toMatchObject({ refused: true });
            expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
            expect(proposals.create).not.toHaveBeenCalled();
        });

        it('the action layer refuses the write unless a person approved it, and an in-product agent is not held by this setting', async () => {
            const comment = { companyId: CID, action: 'task.comment', params: { taskId: String(fx.top._id), body: 'Hello' } };
            await expect(actions.perform({ ...comment, actor: ctx(OWNER).actor })).rejects.toMatchObject({ name: 'RefusedError' });
            expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(0);
            expect((await actions.perform({ ...comment, actor: ctx(OWNER).actor, approved: true })).auditId).toBeTruthy();
            expect((await actions.perform({ ...comment, actor: inProduct(OWNER) })).auditId).toBeTruthy();
            expect(rows(SCHEMA_TYPE.COMMENTS)).toHaveLength(2);
        });

        it('an agent\'s token on the web app\'s own task route is refused, and a person is not', async () => {
            const body = { action: 'updatePriority', task: { _id: String(fx.top._id) } };
            const request = (extra) => ({ uid: OWNER, method: 'PATCH', originalUrl: '/api/v2/tasks', url: '/api/v2/tasks', headers: { companyid: CID }, body, ip: '1.1.1.1', ...extra });
            const through = async (req) => {
                const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, on() {} };
                let passed = false;
                await guard.taskPatchGuard((sent) => sent.task._id)(req, res, () => { passed = true; });
                return { passed, code: res.statusCode, body: res.body };
            };
            const refused = await through(request({ apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } }));
            expect(refused).toMatchObject({ passed: false, code: 403, body: { message: expect.stringMatching(/propose/) } });
            expect((await through(request({}))).passed).toBe(true);
            setProject(P_OPEN, {});
            expect((await through(request({ apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } }))).passed).toBe(true);
        });
    });

    it('an outside client\'s wide write still waits where it waited before, whatever the project says', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        setProject(P_OPEN, { done: YES, connected: CONNECTED.SINGLE_TASK });
        seedGrant(OWNER, [...PLAIN_SCOPES, TASKS_GRANT]);
        const out = await rpc(outside(OWNER, [...PLAIN_SCOPES, TASKS_GRANT]), 'task.archive', { taskId: fx.bug._id });
        expect(out).toMatchObject({ pending: true });
        expect(proposals.create.mock.calls[0][1].why).toMatch(/outside client/);
        delete process.env.AGENT_TAINT_ROUTING;
    });
});

describe('who may change a project\'s policy', () => {
    const GUEST = OUTSIDER;
    const request = (uid, body, extra = {}) => ({
        uid, method: 'PUT', originalUrl: `/api/v2/agents/project-policy/${P_OPEN}`, url: `/api/v2/agents/project-policy/${P_OPEN}`,
        headers: { companyid: CID }, params: { projectId: P_OPEN }, body, ip: '1.1.1.1', ...extra,
    });
    const through = async (handlers, req) => {
        const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(sent) { this.body = sent; return this; }, send(sent) { this.body = sent; return this; }, on() {} };
        for (const handler of [].concat(handlers)) {
            let passed = false;
            // eslint-disable-next-line no-await-in-loop
            await handler(req, res, () => { passed = true; });
            if (!passed) break;
        }
        await settle();
        return { code: res.statusCode, body: res.body };
    };
    const put = (uid, body, extra) => through(controller.putProjectPolicy, request(uid, body, extra));
    const get = (uid, extra) => through(controller.getProjectPolicy, { ...request(uid, undefined, extra), method: 'GET' });
    const STRICT = { done: NEVER, connected: CONNECTED.PROPOSE_ALL };
    const changes = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.project_policy_changed');

    beforeEach(() => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GUEST, roleType: 0, status: 2, isDelete: false }));

    it.each([['an owner', OWNER], ['an admin', ADMIN]])('%s changes it, and the change is recorded and announced', async (_who, uid) => {
        const out = await put(uid, STRICT);
        expect(out).toMatchObject({ code: 200, body: { status: true, data: { project: STRICT, canEdit: true } } });
        expect(project(P_OPEN).agentPolicy).toMatchObject({ ...STRICT, updatedBy: uid });
        expect(changes()).toHaveLength(1);
        expect(changes()[0]).toMatchObject({ actorId: uid, entityType: 'project', entityId: P_OPEN, meta: { from: { done: APPROVAL, connected: CONNECTED.SINGLE_TASK }, to: STRICT } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: { agentPolicy: expect.objectContaining(STRICT) } }));
    });

    it.each([['a member', MEMBER], ['a guest', GUEST]])('%s is refused, and reads it without being offered the change', async (_who, uid) => {
        expect(await put(uid, STRICT)).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentPolicy).toBeUndefined();
        expect(changes()).toHaveLength(0);
        if (uid === MEMBER) expect(await get(uid)).toMatchObject({ code: 200, body: { data: { project: { done: APPROVAL, connected: CONNECTED.SINGLE_TASK }, canEdit: false } } });
    });

    it('an API token is refused, whoever holds it', async () => {
        expect(await put(OWNER, STRICT, { apiToken: { _id: TOKEN, userId: OWNER, name: 'Script' } })).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentPolicy).toBeUndefined();
    });

    it('an agent\'s token is refused, whoever holds it, and the attempt is recorded', async () => {
        const out = await put(OWNER, { done: YES, connected: CONNECTED.SINGLE_TASK }, { apiToken: { _id: TOKEN, kind: 'agent', userId: OWNER, name: 'CLI' } });
        expect(out).toMatchObject({ code: 403, body: { status: false } });
        expect(project(P_OPEN).agentPolicy).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === 'agent.action_refused' && row.meta.action === 'project.agent_policy.edit')).toHaveLength(1);
    });

    it('refuses a value it does not know, a project of another kind and one the caller cannot open', async () => {
        expect(await put(OWNER, { done: 'always' })).toMatchObject({ code: 400 });
        expect(await put(OWNER, { connected: 'anything' })).toMatchObject({ code: 400 });
        expect(await put(OWNER, {})).toMatchObject({ code: 400 });
        expect(await through(controller.putProjectPolicy, { ...request(OWNER, STRICT), params: { projectId: 'nope' } })).toMatchObject({ code: 400 });
        expect(await through(controller.putProjectPolicy, { ...request(OWNER, STRICT), params: { projectId: '6f0000000000000000000dff' } })).toMatchObject({ code: 404 });
        expect(await get(GUEST, { params: { projectId: world.P_PRIVATE } })).toMatchObject({ code: 404 });
        expect(project(P_OPEN).agentPolicy).toBeUndefined();
    });

    it('answers what holds once the workspace switch is counted', async () => {
        await put(OWNER, { done: YES });
        setCompany(true);
        expect((await get(OWNER)).body.data).toMatchObject({ project: { done: YES, connected: CONNECTED.SINGLE_TASK }, effective: { done: NEVER, connected: CONNECTED.SINGLE_TASK }, workspaceChecksBeforeDone: true, canEdit: true });
    });
});
