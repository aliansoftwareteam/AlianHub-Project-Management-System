/* Task 047, AI-run: a connected agent asks to make a list a sprint with a first and a last day, or to change a
   sprint's days. It waits as one proposal with one preview; approved, it runs the route the list menu calls, as the
   approver; undo makes the list what it was, unless someone has changed it since. */
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
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PRIVATE, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'list.sprint.set';
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const NO_LIST = 'not_visible: that list was not found in that project, or the person cannot open it. Ask the person which list they mean.';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const ASK = { projectId: P_OPEN, sprintId: L_OPEN, startDate: '2026-10-05', endDate: '2026-10-18', reason: 'Two weeks from Monday' };
const FIRST = '2026-10-05T00:00:00.000Z';
const LAST = '2026-10-18T23:59:59.999Z';

const list = (id = L_OPEN) => stored(SCHEMA_TYPE.SPRINTS, id);
const boxOf = (id = L_OPEN) => { const { isScrum, state, startDate, endDate } = list(id); return JSON.parse(JSON.stringify({ isScrum, state, startDate, endDate })); };
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const listsNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.SPRINTS]);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (caller, args = ASK) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};

beforeEach(() => {
    seed();
    setRule('project_sprint_create', false, [0]);
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect((await rpc(as(OWNER), TOOL, ASK)).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, it is a rated registry action that is always proposed, under the key the list menu asks for', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_sprint_create', write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:write');
    });
});

describe('a list is never changed before a person has seen it', () => {
    it('files one proposal and changes nothing', async () => {
        const before = listsNow();
        const id = await filed(as(INSIDER));
        expect(listsNow()).toBe(before);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes.map((change) => change.params)).toEqual([{ projectId: P_OPEN, sprintId: L_OPEN, startDate: '2026-10-05', endDate: '2026-10-18' }]);
    });

    it('waits for a person whatever the project is set to, and cannot be run directly', async () => {
        const params = { projectId: P_OPEN, sprintId: L_OPEN, startDate: '2026-10-05', endDate: '2026-10-18' };
        expect(await projectPolicy.ask({ companyId: CID, actor: as(INSIDER).actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        const call = (given) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params: given, reason: 'direct' });
        await expect(call(params)).rejects.toThrow(/has to be sent as a proposal/);
        await expect(call({ ...params, __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(list().isScrum).toBeUndefined();
    });
});

describe('who may ask', () => {
    it('files for an owner, for a member with the right, and for a member of a private list or project', async () => {
        await filed(as(OWNER));
        await filed(as(OUTSIDER));
        await filed(as(INSIDER), { ...ASK, sprintId: L_SECRET });
        await filed(as(INSIDER), { ...ASK, projectId: P_PRIVATE, sprintId: L_PRIVATE });
        expect(waiting()).toHaveLength(4);
    });

    it('refuses a member without the right, a guest, and a token that only reads', async () => {
        expect(await rpc(as(GUEST), TOOL, ASK)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: project\.project_sprint_create/) });
        setRule('project_sprint_create', false, [3]);
        expect(await rpc(as(OUTSIDER), TOOL, ASK)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: project\.project_sprint_create/) });
        expect(await rpc(readOnly(OWNER), TOOL, ASK)).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false, false]);
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project or a list the person cannot open, and one outside a token kept to some projects, as missing', async () => {
        expect(await rpc(as(OWNER), TOOL, { ...ASK, projectId: MISSING })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OUTSIDER), TOOL, { ...ASK, projectId: P_PRIVATE, sprintId: L_PRIVATE })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_PRIVATE]).projectIds }, TOOL, ASK)).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OUTSIDER), TOOL, { ...ASK, sprintId: L_SECRET })).toMatchObject({ refused: true, reason: NO_LIST });
        expect(await rpc(as(OWNER), TOOL, { ...ASK, sprintId: L_PRIVATE })).toMatchObject({ refused: true, reason: NO_LIST });
        expect(waiting()).toHaveLength(0);
    });

    it('says what is wrong with the days', async () => {
        const bad = async (over) => (await rpc(as(OWNER), TOOL, { ...ASK, ...over })).rpcError;
        expect(await bad({ startDate: '2026-10-19' })).toMatchObject({ code: -32602, message: expect.stringMatching(/startDate comes after endDate/) });
        expect(await bad({ endDate: '2026-02-30' })).toMatchObject({ code: -32602 });
        expect(await bad({ endDate: 'next week' })).toMatchObject({ code: -32602 });
        expect(await bad({ isScrum: false })).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving runs the route the list menu calls, as the person who approved', () => {
    it('makes the list a planned sprint from the first moment of the first day to the last of the last', async () => {
        const asked = mockDb.calls.length;
        const out = await approve(await filed(as(INSIDER)));
        expect(out.error).toBeUndefined();
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, sprintId: L_OPEN, name: 'Open list', sprint: true, startDate: '2026-10-05', endDate: '2026-10-18', wasSprint: false } });
        expect(boxOf()).toEqual({ isScrum: true, state: 'planned', startDate: FIRST, endDate: LAST });
        expect(audits(TOOL, 'applied')[0]).toMatchObject({
            entityType: 'sprint', entityId: L_OPEN,
            meta: { onBehalfOf: INSIDER, undo: { kind: 'listSprint', projectId: P_OPEN, sprintId: L_OPEN, set: { startDate: FIRST, endDate: LAST }, previous: { isScrum: false, startDate: null, endDate: null } } },
        });
        expect([...new Set(mockDb.calls.slice(asked).map((call) => String(call.companyId)))].sort()).toEqual([CID, 'global'].sort());
    });

    it('reads the days where the person who asked is', async () => {
        stored(SCHEMA_TYPE.USERS, INSIDER).Time_Zone = 'Asia/Kolkata';
        await approve(await filed(as(INSIDER)));
        expect(boxOf()).toMatchObject({ startDate: '2026-10-04T18:30:00.000Z', endDate: '2026-10-18T18:29:59.999Z' });
    });

    it('changes the days of a list that is already a sprint, and says the web app\'s reason for a completed one', async () => {
        Object.assign(list(), { isScrum: true, state: 'planned', startDate: new Date('2026-09-01T00:00:00.000Z'), endDate: new Date('2026-09-14T23:59:59.999Z') });
        const out = await approve(await filed(as(INSIDER)));
        expect(out.applied[0].result).toMatchObject({ wasSprint: true });
        expect(boxOf()).toEqual({ isScrum: true, state: 'planned', startDate: FIRST, endDate: LAST });

        list().state = 'closed';
        const closed = await approve(await filed(as(INSIDER), { ...ASK, endDate: '2026-10-25' }));
        expect(closed.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/completed sprint cannot be edited/) });
        expect(boxOf().endDate).toBe(LAST);
    });

    it('refuses an approver who may not do it by hand, or who cannot open the list, and changes nothing', async () => {
        const before = listsNow();
        expect(await approve(await filed(as(INSIDER)), GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver may not/) });
        expect(await approve(await filed(as(INSIDER), { ...ASK, sprintId: L_SECRET }), OUTSIDER)).toMatchObject({ status: 403, error: expect.stringMatching(/approver cannot open/) });
        expect(listsNow()).toBe(before);
        expect(waiting()).toHaveLength(2);
    });

    it('asks the person behind the token again, and the token\'s own list of projects', async () => {
        const id = await filed(as(OUTSIDER));
        setRule('project_sprint_create', false, [3]);
        expect((await approve(id)).applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });

        setRule('project_sprint_create', true, [3]);
        const kept = await filed(as(INSIDER));
        stored(SCHEMA_TYPE.API_TOKENS, tokenOf(INSIDER)).projectIds = [P_PRIVATE];
        expect(await approve(kept)).toMatchObject({ status: 403, error: expect.stringMatching(/outside the token's project list/) });
        expect(list().isScrum).toBeUndefined();
    });
});

describe('undo makes the list what it was', () => {
    it('makes it a plain list again', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, sprintId: L_OPEN, name: 'Open list', sprint: false } });
        expect(boxOf()).toEqual({ isScrum: false, state: '', startDate: null, endDate: null });
    });

    it('gives a sprint its former days back', async () => {
        Object.assign(list(), { isScrum: true, state: 'planned', startDate: new Date('2026-09-01T00:00:00.000Z'), endDate: new Date('2026-09-14T23:59:59.999Z') });
        const id = await filed(as(INSIDER));
        await approve(id);
        expect((await undo(id)).results[0]).toMatchObject({ ok: true, result: { sprint: true } });
        expect(boxOf()).toEqual({ isScrum: true, state: 'planned', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-14T23:59:59.999Z' });
    });

    it('leaves a sprint someone has changed or started since, and says why', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        list().endDate = new Date('2026-10-25T23:59:59.999Z');
        expect((await undo(id)).results[0]).toMatchObject({ ok: false, reason: '"Open list" was changed since, so it was kept as it is now.' });
        expect(boxOf()).toMatchObject({ isScrum: true, endDate: '2026-10-25T23:59:59.999Z' });

        const other = await filed(as(INSIDER), { ...ASK, sprintId: L_SECRET });
        await approve(other);
        list(L_SECRET).state = 'active';
        expect((await undo(other)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/Complete the sprint before/) });
        expect(list(L_SECRET).isScrum).toBe(true);
    });

    it('is not offered to someone who cannot open the list', async () => {
        const id = await filed(as(INSIDER), { ...ASK, sprintId: L_SECRET });
        await approve(id, INSIDER);
        const { undoAuditRow } = require('../Modules/Agents/undo');
        expect(await undoAuditRow(CID, audits(TOOL, 'applied')[0], human(OUTSIDER))).toMatchObject({ ok: false, reason: 'target_not_visible' });
        expect(list(L_SECRET).isScrum).toBe(true);
    });
});

describe('the preview', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the list, its project, the days asked for and the days it has now', async () => {
        await filed(as(INSIDER));
        expect(await previewFor(GUEST, waiting()[0])).toEqual([{
            kind: 'sprint', title: 'Open list',
            lines: [{ kind: 'place', project: 'Open', list: '' }, { kind: 'sprintDays', from: '2026-10-05', to: '2026-10-18' }],
        }]);
        Object.assign(list(), { isScrum: true, state: 'planned', startDate: new Date('2026-09-01T00:00:00.000Z'), endDate: new Date('2026-09-14T23:59:59.999Z') });
        expect((await previewFor(GUEST, waiting()[0]))[0].lines[2]).toEqual({ kind: 'sprintDaysNow', from: '2026-09-01T00:00:00.000Z', to: '2026-09-14T23:59:59.999Z' });
    });

    it('shows nothing to someone who cannot open the list or its project', async () => {
        await filed(as(INSIDER), { ...ASK, sprintId: L_SECRET });
        await filed(as(INSIDER), { ...ASK, projectId: P_PRIVATE, sprintId: L_PRIVATE });
        expect(await previewFor(OUTSIDER, waiting()[0])).toEqual([null]);
        expect(await previewFor(OUTSIDER, waiting()[1])).toEqual([null]);
        expect((await previewFor(INSIDER, waiting()[0]))[0]).toMatchObject({ kind: 'sprint', title: 'Private list' });
    });
});
