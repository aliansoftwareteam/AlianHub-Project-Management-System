/* Task 046 M3, G7: an outside agent reads the goals the person behind its token can read, reports a
   target's value and changes what a target counts, through the goal routes' own handlers and no further.
   A token kept to some projects is given a goal only through the work it counts, and changes none. */
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
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../utils/planHelper', () => mockStub());
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/proposals', () => ({ create: jest.fn(async (companyId, proposal) => ({ _id: 'proposal-1', ...proposal })) }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleSingleNotification: jest.fn(async () => []) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const notices = require('../Modules/notification/prepare-notification-data/controllerV2');
const { inverses, undoStateOf } = require('../Modules/Agents/undo');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const workTools = require('../Modules/Mcp/workTools');
const approval = require('../Modules/Mcp/approval');
const server = require('../Modules/Mcp/server');
const counts = require('../Modules/Goals/goalCounts');
const goalTokens = require('../Modules/Goals/goalTokens');

const {
    CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_PRIVATE,
    MISSING, T_OPEN_2, BEFORE, FLAGS, EVERYONE, ctx, narrowed, readOnly, outside, routeTable, asPerson, settle,
} = world;
const { seed, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/Goals/routes').init));

const READS = ['goals.list', 'goal.get'];
const WRITES = ['goal.target.set', 'goal.target.sources.add', 'goal.target.sources.remove'];
const NAMES = [...READS, ...WRITES];
const NO_GOAL = { error: 'That goal was not found. Ask the person which goal they mean.' };
const OUTSIDE_TOKEN = 'not_visible: this connection is limited to some projects, so it cannot make changes outside them. Ask the person to widen it in AlianHub.';
const plain = (value) => JSON.parse(JSON.stringify(value));
const goalsNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.GOALS]);
const storedGoal = (id) => mockDb.store[SCHEMA_TYPE.GOALS].find((row) => String(row._id) === String(id));
const storedTarget = (id, targetId) => storedGoal(id).targets.find((target) => target.id === targetId);
const inProduct = (uid) => ({ kind: 'agent', userId: uid, agentName: 'Workspace agent' });
const namesOf = (answer) => answer.goals.map((goal) => goal.name);

const create = async (uid, body) => (await web('POST /api/v2/goals', uid, { body })).body.data;
const webList = async (uid, query = {}) => plain((await web('GET /api/v2/goals', uid, { query })).body.data);
const webGoal = async (uid, id) => plain((await web('GET /api/v2/goals/:id', uid, { params: { id } })).body.data);

/* The insider's own goal with a number and a true-or-false target, twice over so one can be changed through the
 * web route and the other through the tool; a goal shared with the member outside the private work, counting the
 * open list; the owner's workspace goal; and the insider's goal that counts work in two projects. */
let quiet;
let twin;
let shared;
let company;
let mixed;
const MANUAL = [{ name: 'Customers', kind: 'number', target: 10 }, { name: 'Signed', kind: 'boolean' }];

beforeEach(async () => {
    seed();
    proposals.create.mockClear();
    notices.handleSingleNotification.mockClear();
    counts.forgetTries();
    quiet = await create(INSIDER, { name: 'Quiet plan', targets: MANUAL });
    twin = await create(INSIDER, { name: 'Quiet plan, again', targets: MANUAL });
    shared = await create(INSIDER, { name: 'Ship the open work', visibility: 'people', sharedWith: [OUTSIDER], targets: [{ name: 'Open tasks', kind: 'tasks', sources: { sprintIds: [L_OPEN] } }, { name: 'Spare', kind: 'tasks' }] });
    company = await create(OWNER, { name: 'Company goal', visibility: 'workspace', targets: [{ name: 'Announced', kind: 'boolean' }, { name: 'Open tasks', kind: 'tasks', sources: { sprintIds: [L_OPEN] } }] });
    mixed = await create(INSIDER, { name: 'Across two projects', targets: [{ name: 'Both', kind: 'tasks', sources: { sprintIds: [L_OPEN, L_PRIVATE] } }] });
    await settle();
    notices.handleSingleNotification.mockClear();
});
afterEach(async () => { await counts.idle(); await settle(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tools exist', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_WORK;
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        NAMES.forEach((name) => {
            expect(registry.has(name)).toBe(false);
            expect(actions.rating(name)).toBeNull();
            expect(scopes.scopeForTool(name)).toBeNull();
        });
        expect((await rpc(ctx(INSIDER), 'goals.list', {})).rpcError).toMatchObject({ code: -32601 });
        expect((await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: quiet.targets[0].id, value: 5 })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, each tool is a rated registry action with a plain scope, and needs no grant', async () => {
        expect(await listed(ctx(OWNER))).toEqual(expect.arrayContaining(NAMES));
        NAMES.forEach((name) => expect(registry.permissionsFor(name)).toEqual([{ key: 'task.task_list', write: false }]));
        READS.forEach((name) => expect(actions.rating(name)).toEqual({ write: false, reversible: true, scope: 'workspace', money: false }));
        WRITES.forEach((name) => expect(actions.rating(name)).toEqual({ write: true, reversible: true, scope: 'workspace', money: false }));
        expect(NAMES.map((name) => scopes.scopeForTool(name))).toEqual(['projects:read', 'projects:read', 'tasks:write', 'tasks:write', 'tasks:write']);
        expect(tools.registered().filter((tool) => NAMES.includes(tool.name)).map((tool) => tool.grant)).toEqual([undefined, undefined, undefined, undefined, undefined]);
        expect(WRITES.map((name) => workTools.filedUnder(name))).toEqual(['tasks:manage', 'tasks:manage', 'tasks:manage']);
    });

    it('offers no tool that makes, archives or deletes a goal', () => {
        expect(tools.registered().map((tool) => tool.name).filter((name) => /^goals?\./.test(name)).sort()).toEqual([...NAMES].sort());
    });
});

describe('goals.list', () => {
    it.each(EVERYONE)('answers what the Goals page lists for %s, with the same names of what each target counts', async (label, uid) => {
        const answer = await rpc(ctx(uid), 'goals.list', {});
        expect(answer.goals).toEqual(await webList(uid));
    });

    it('holds each person to the goals they can read', async () => {
        expect(namesOf(await rpc(ctx(INSIDER), 'goals.list', {}))).toEqual(['Across two projects', 'Company goal', 'Quiet plan', 'Quiet plan, again', 'Ship the open work']);
        expect(namesOf(await rpc(ctx(OUTSIDER), 'goals.list', {}))).toEqual(['Company goal', 'Ship the open work']);
        for (const uid of [OWNER, ADMIN]) expect(namesOf(await rpc(ctx(uid), 'goals.list', {}))).toEqual(['Company goal']);
        expect(namesOf(await rpc(ctx(GUEST), 'goals.list', {}))).toEqual([]);

        await web('PATCH /api/v2/goals/:id', OWNER, { params: { id: company._id }, body: { sharedWith: [GUEST] } });
        expect(namesOf(await rpc(ctx(GUEST), 'goals.list', {}))).toEqual(['Company goal']);
    });

    it('names a counted list for those who can open it, as the web app does', async () => {
        const forOutsider = (await rpc(ctx(OUTSIDER), 'goals.list', {})).goals.find((goal) => goal.name === 'Ship the open work');
        expect(forOutsider.targets[0].sourceNames.sprintIds[L_OPEN]).toMatchObject({ name: 'Open list', projectName: 'Open' });
        expect(forOutsider.canEdit).toBe(false);
        const forInsider = (await rpc(ctx(INSIDER), 'goals.list', {})).goals.find((goal) => goal.name === 'Across two projects');
        expect(Object.keys(forInsider.targets[0].sourceNames.sprintIds).sort()).toEqual([L_OPEN, L_PRIVATE].sort());
    });

    it('takes the filters of the web list', async () => {
        expect(namesOf(await rpc(ctx(OUTSIDER), 'goals.list', { mine: true }))).toEqual(['Ship the open work']);
        await web('POST /api/v2/goals/:id/archive', INSIDER, { params: { id: twin._id } });
        expect(namesOf(await rpc(ctx(INSIDER), 'goals.list', { archived: true }))).toEqual(['Quiet plan, again']);
        expect(namesOf(await rpc(ctx(INSIDER), 'goals.list', { limit: 2 }))).toEqual(['Across two projects', 'Company goal']);
    });

    it('gives a token kept to some projects only the goals whose counted work is all inside them', async () => {
        expect(namesOf(await rpc(narrowed(INSIDER, [P_OPEN]), 'goals.list', {}))).toEqual(['Company goal', 'Ship the open work']);
        expect(namesOf(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'goals.list', {}))).toEqual([]);
        expect(namesOf(await rpc(narrowed(INSIDER, [P_OPEN, P_PRIVATE]), 'goals.list', {}))).toEqual(['Across two projects', 'Company goal', 'Ship the open work']);
        expect(namesOf(await rpc(narrowed(OUTSIDER, [P_PRIVATE]), 'goals.list', {}))).toEqual([]);
    });

    it('is refused to a person whose role may not list tasks, and takes no argument it does not publish', async () => {
        setRule('task_list', null);
        expect(await rpc(ctx(OUTSIDER), 'goals.list', {})).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_list/) });
        expect((await rpc(ctx(OWNER), 'goals.list', { all: true })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(OWNER), 'goals.list', { mine: 'yes' })).rpcError).toMatchObject({ code: -32602 });
    });

    it('needs the read scope, and stays inside the actions an agent was given', async () => {
        expect(namesOf(await rpc(readOnly(OUTSIDER), 'goals.list', {}))).toEqual(['Company goal', 'Ship the open work']);
        expect(await rpc(outside(OUTSIDER, ['tasks:read', 'tasks:write']), 'goals.list', {})).toMatchObject({ isError: true, error: 'This connection was not given the projects:read permission. Ask the person to connect you again and allow it.' });
        expect(namesOf(await rpc(outside(OUTSIDER, ['projects:read']), 'goals.list', {}))).toEqual(['Company goal', 'Ship the open work']);
        expect(await rpc(ctx(OUTSIDER, { allowedActions: ['tasks.search'] }), 'goals.list', {})).toMatchObject({ refused: true, reason: expect.stringMatching(/is not switched on for this connection/) });
    });
});

describe('goal.get', () => {
    it.each(EVERYONE)('answers the workspace goal for %s as the web app does, or as a missing goal', async (label, uid) => {
        const viaWeb = await web('GET /api/v2/goals/:id', uid, { params: { id: company._id } });
        const answer = await rpc(ctx(uid), 'goal.get', { goalId: company._id });
        if (viaWeb.code === 200) expect(answer).toEqual({ goal: plain(viaWeb.body.data) });
        else expect(answer).toEqual(NO_GOAL);
        expect(viaWeb.code).toBe(uid === GUEST ? 404 : 200);
    });

    it('answers a goal the person cannot read exactly as an id that does not exist', async () => {
        const missing = await rpc(ctx(OWNER), 'goal.get', { goalId: MISSING });
        expect(missing).toEqual(NO_GOAL);
        for (const uid of [OWNER, ADMIN, OUTSIDER, GUEST]) expect(await rpc(ctx(uid), 'goal.get', { goalId: quiet._id })).toEqual(missing);
        for (const uid of [OWNER, ADMIN, GUEST]) expect(await rpc(ctx(uid), 'goal.get', { goalId: shared._id })).toEqual(missing);
        expect(await rpc(ctx(INSIDER), 'goal.get', { goalId: quiet._id })).toEqual({ goal: await webGoal(INSIDER, quiet._id) });
        expect((await rpc(ctx(OUTSIDER), 'goal.get', { goalId: shared._id })).goal).toMatchObject({ name: 'Ship the open work', canEdit: false, isOwner: false });
    });

    it('answers a token kept to some projects only for a goal whose counted work is all inside them', async () => {
        expect((await rpc(narrowed(INSIDER, [P_OPEN]), 'goal.get', { goalId: shared._id })).goal).toMatchObject({ name: 'Ship the open work' });
        expect(await rpc(narrowed(INSIDER, [P_PRIVATE]), 'goal.get', { goalId: shared._id })).toEqual(NO_GOAL);
        expect(await rpc(narrowed(INSIDER, [P_OPEN]), 'goal.get', { goalId: mixed._id })).toEqual(NO_GOAL);
        expect((await rpc(narrowed(INSIDER, [P_PRIVATE, P_OPEN]), 'goal.get', { goalId: mixed._id })).goal).toMatchObject({ name: 'Across two projects' });
        expect(await rpc(narrowed(INSIDER, [P_OPEN, P_PRIVATE]), 'goal.get', { goalId: quiet._id })).toEqual(NO_GOAL);
        expect((await rpc(ctx(INSIDER), 'goal.get', { goalId: 'nope' })).rpcError).toMatchObject({ code: -32602 });
    });
});

describe('a token kept to some projects, by the rule the Goals module keeps', () => {
    it('is not narrowed when it names no project', async () => {
        expect(goalTokens.isNarrowed([])).toBe(false);
        expect(goalTokens.isNarrowed(undefined)).toBe(false);
        expect([...(await goalTokens.readableIds(CID, [quiet._id, mixed._id], []))].sort()).toEqual([quiet._id, mixed._id].sort());
    });

    it('reads a goal that counts a task only when the task is in its projects', async () => {
        const made = await create(INSIDER, { name: 'One task', targets: [{ name: 'T', kind: 'tasks', sources: { taskIds: [T_PRIVATE] } }] });
        expect([...(await goalTokens.readableIds(CID, [made._id], [P_PRIVATE]))]).toEqual([made._id]);
        expect([...(await goalTokens.readableIds(CID, [made._id], [P_OPEN]))]).toEqual([]);
    });

    it('does not read a goal that links a list which is gone, or a goal that links nothing', async () => {
        mockDb.store[SCHEMA_TYPE.SPRINTS] = mockDb.store[SCHEMA_TYPE.SPRINTS].filter((row) => String(row._id) !== L_OPEN);
        expect([...(await goalTokens.readableIds(CID, [shared._id, quiet._id], [P_OPEN]))]).toEqual([]);
    });

    it('judges every linked source, a source left out of the count among them', async () => {
        storedGoal(mixed._id).targets[0].counted.skipped = { sprintIds: [L_PRIVATE], taskIds: [] };
        expect([...(await goalTokens.readableIds(CID, [mixed._id], [P_OPEN]))]).toEqual([]);
    });

    it('names the workspace as the target of every write, which such a token is refused', () => {
        expect(goalTokens.WRITE_TARGET).toEqual({ companyWide: true });
        tools.registered().filter((tool) => WRITES.includes(tool.name)).forEach((tool) => expect(tool.target({ goalId: quiet._id })).toEqual({ companyWide: true }));
        expect(approval.targetOf({ goalId: quiet._id, targetId: 'x' })).toEqual({ companyWide: true });
    });
});

describe('goal.target.set', () => {
    const number = (goal) => goal.targets[0].id;
    const box = (goal) => goal.targets[1].id;

    it('stores what the value route stores for the same person, and records it', async () => {
        const viaWeb = await web('PUT /api/v2/goals/:id/targets/:targetId/value', INSIDER, { params: { id: twin._id, targetId: number(twin) }, body: { current: 5 } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5, reason: 'Weekly numbers' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { goalId: quiet._id, targetId: number(quiet), progressPct: 50, reached: false, goalProgressPct: 25 } });
        const { id: ours, updatedAt: at, ...stored } = storedTarget(quiet._id, number(quiet));
        const { id: theirs, updatedAt: then, ...viaRoute } = storedTarget(twin._id, number(twin));
        expect(stored).toEqual(viaRoute);
        expect([ours, at, theirs, then].every(Boolean)).toBe(true);
        expect(stored).toMatchObject({ current: 5, progressPct: 50, updatedBy: INSIDER });
        expect(storedGoal(quiet._id).progressPct).toBe(storedGoal(twin._id).progressPct);

        const [row] = audits('goal.target.set', 'applied');
        expect(row.meta).toMatchObject({ onBehalfOf: INSIDER, reason: 'Weekly numbers', state: 'applied', undo: { kind: 'goalValue', goalId: quiet._id, targetId: number(quiet), previous: 0 } });
        expect(row).toMatchObject({ entityType: 'goal', entityId: quiet._id });
    });

    it('names the goal in the audit log only while the whole workspace can read it', async () => {
        await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: box(quiet), value: true });
        await rpc(ctx(OWNER), 'goal.target.set', { goalId: company._id, targetId: company.targets[0].id, value: true });
        const [ofQuiet, ofCompany] = audits('goal.target.set', 'applied');
        expect(ofQuiet.entityName || '').toBe('');
        expect(JSON.stringify(ofQuiet)).not.toContain('Quiet plan');
        expect(ofCompany.entityName).toBe('Company goal');
    });

    it('takes true or false for a true-or-false target and a number for a measured one', async () => {
        expect(await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: box(quiet), value: true })).toMatchObject({ ok: true, result: { progressPct: 100, reached: true } });
        expect(storedTarget(quiet._id, box(quiet))).toMatchObject({ done: true, progressPct: 100 });
        const before = goalsNow();
        expect(await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: box(quiet), value: 1 })).toMatchObject({ isError: true });
        expect(await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: true })).toMatchObject({ isError: true });
        expect((await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: '5' })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet) })).rpcError).toMatchObject({ code: -32602 });
        expect(goalsNow()).toBe(before);
    });

    it('refuses a target counted from tasks with the route\'s own code', async () => {
        const before = goalsNow();
        const out = await rpc(ctx(INSIDER), 'goal.target.set', { goalId: shared._id, targetId: shared.targets[0].id, value: 3 });
        expect(out).toMatchObject({ isError: true, error: expect.stringMatching(/^counted_from_tasks: /) });
        expect(goalsNow()).toBe(before);
    });

    it('answers a goal the person cannot read as a missing goal, and one they can only read as not theirs to change', async () => {
        const before = goalsNow();
        const missing = await rpc(ctx(OWNER), 'goal.target.set', { goalId: MISSING, targetId: number(quiet), value: 5 });
        expect(missing).toMatchObject({ isError: true, error: 'Goal not found.' });
        for (const uid of [OWNER, ADMIN, OUTSIDER, GUEST]) {
            expect(await rpc(ctx(uid), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 })).toEqual(missing);
        }
        expect(await rpc(ctx(OUTSIDER), 'goal.target.set', { goalId: company._id, targetId: company.targets[0].id, value: true }))
            .toMatchObject({ isError: true, error: 'You do not have permission to perform this action.' });
        expect(await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: MISSING, value: 5 })).toMatchObject({ isError: true, error: 'Target not found.' });
        expect(goalsNow()).toBe(before);
        expect(await rpc(ctx(ADMIN), 'goal.target.set', { goalId: company._id, targetId: company.targets[0].id, value: true })).toMatchObject({ ok: true });
    });

    it('is refused to a token kept to some projects, whatever the goal counts', async () => {
        const before = goalsNow();
        expect(await rpc(narrowed(OWNER, [P_OPEN]), 'goal.target.set', { goalId: company._id, targetId: company.targets[0].id, value: true })).toMatchObject({ refused: true, reason: OUTSIDE_TOKEN });
        expect(await rpc(narrowed(INSIDER, [P_OPEN, P_PRIVATE]), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 })).toMatchObject({ refused: true, reason: OUTSIDE_TOKEN });
        expect(goalsNow()).toBe(before);
        expect(audits('goal.target.set', 'applied')).toEqual([]);
    });

    it('needs the write scope: a read-only token and an OAuth token without it are refused', async () => {
        const before = goalsNow();
        expect(await rpc(readOnly(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 })).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(await rpc(outside(INSIDER, ['projects:read']), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 })).toMatchObject({ isError: true, error: 'This connection was not given the tasks:write permission. Ask the person to connect you again and allow it.' });
        expect(await rpc(ctx(INSIDER, { allowedActions: ['goals.list'] }), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 })).toMatchObject({ refused: true, reason: expect.stringMatching(/is not switched on for this connection/) });
        expect(goalsNow()).toBe(before);
    });

    it('runs for an outside client, and under taint routing waits for a person or is refused', async () => {
        expect(await rpc(outside(INSIDER, ['tasks:write']), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 2 })).toMatchObject({ ok: true });

        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = goalsNow();
        expect(await rpc(outside(INSIDER, ['tasks:write']), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 }))
            .toMatchObject({ refused: true, reason: expect.stringMatching(/reaches the whole workspace.*needs a person's approval/) });
        expect(proposals.create).not.toHaveBeenCalled();

        expect(await rpc(outside(INSIDER, ['tasks:write', 'tasks:manage']), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 5 }))
            .toMatchObject({ ok: false, pending: true, proposalId: 'proposal-1' });
        expect(proposals.create.mock.calls[0][1]).toMatchObject({ requestedBy: INSIDER, changes: [{ action: 'goal.target.set', params: { goalId: quiet._id, targetId: number(quiet), value: 5 } }] });
        expect(goalsNow()).toBe(before);
    });

    it('tells the goal\'s readers when it reaches a target, as a person\'s change does, and the audit row names the agent', async () => {
        const viaWeb = await web('PUT /api/v2/goals/:id/targets/:targetId/value', OWNER, { params: { id: company._id, targetId: company.targets[0].id }, body: { done: true } });
        expect(viaWeb.code).toBe(200);
        const byPerson = notices.handleSingleNotification.mock.calls.map(([body]) => body);
        await web('PUT /api/v2/goals/:id/targets/:targetId/value', OWNER, { params: { id: company._id, targetId: company.targets[0].id }, body: { done: false } });
        storedGoal(company._id).targets[0].notifiedAt = undefined;
        notices.handleSingleNotification.mockClear();

        await rpc(ctx(OWNER), 'goal.target.set', { goalId: company._id, targetId: company.targets[0].id, value: true });
        const byAgent = notices.handleSingleNotification.mock.calls.map(([body]) => body);
        expect(byAgent).toHaveLength(1);
        expect(byAgent).toEqual(byPerson);
        expect(byAgent[0]).toMatchObject({ key: 'goal_target_reached', userId: OWNER, changeData: { goalName: 'Company goal', targetName: 'Announced', byCount: false } });

        const [row] = audits('goal.target.set', 'applied');
        expect(row.meta).toMatchObject({ onBehalfOf: OWNER });
        expect(JSON.stringify(row)).toContain('Claude');
    });

    it('keeps the goal route\'s own guard when the action is reached without an MCP token', async () => {
        const before = goalsNow();
        await expect(actions.perform({ companyId: CID, actor: inProduct(OUTSIDER), action: 'goal.target.set', params: { goalId: quiet._id, targetId: number(quiet), value: 5 } })).rejects.toThrow('Goal not found.');
        await expect(actions.perform({ companyId: CID, actor: inProduct(OUTSIDER), action: 'goal.target.set', params: { goalId: company._id, targetId: company.targets[0].id, value: true } })).rejects.toThrow(/permission/);
        expect(goalsNow()).toBe(before);
    });

    it('is undone by someone who can edit the goal, through the same route', async () => {
        await rpc(ctx(INSIDER), 'goal.target.set', { goalId: quiet._id, targetId: number(quiet), value: 7 });
        const [row] = audits('goal.target.set', 'applied');
        expect(await undoStateOf(CID, row, { userId: INSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        for (const uid of [OWNER, OUTSIDER]) expect(await undoStateOf(CID, row, { userId: uid }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        await inverses.goalValue(CID, row.meta.undo, { userId: INSIDER });
        expect(storedTarget(quiet._id, number(quiet))).toMatchObject({ current: 0, progressPct: 0 });
    });
});

describe('goal.target.sources.add and goal.target.sources.remove', () => {
    const counted = (goal) => goal.targets[0].id;
    const spare = (goal) => goal.targets[1].id;
    const sourcesOf = (goal, targetId) => plain(storedTarget(goal._id, targetId).sources);

    it('stores what the target route stores for the same person when it is sent the whole set', async () => {
        const viaWeb = await web('PATCH /api/v2/goals/:id/targets/:targetId', INSIDER, { params: { id: shared._id, targetId: spare(shared) }, body: { sources: { sprintIds: [L_OPEN], taskIds: [T_OPEN_2] } } });
        expect(viaWeb.body).toMatchObject({ status: true });

        const out = await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: counted(shared), kind: 'task', sourceId: T_OPEN_2, reason: 'Counts the follow-up' });
        expect(out).toMatchObject({ ok: true, undoable: true, result: { changed: true, sources: { sprintIds: [L_OPEN], taskIds: [T_OPEN_2] }, notCounted: 0 } });
        expect(sourcesOf(shared, counted(shared))).toEqual(sourcesOf(shared, spare(shared)));
        const { done, total } = storedTarget(shared._id, spare(shared)).counted;
        expect(storedTarget(shared._id, counted(shared)).counted).toMatchObject({ done, total });
        expect(out.result.counted).toEqual({ done, total });

        const [row] = audits('goal.target.sources.add', 'applied');
        expect(row.meta).toMatchObject({ onBehalfOf: INSIDER, reason: 'Counts the follow-up', undo: { kind: 'goalSource', goalId: shared._id, targetId: counted(shared), sourceKind: 'task', sourceId: T_OPEN_2, operation: 'add' } });
    });

    it('adds and removes one list or task at a time, and says when nothing changed', async () => {
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: counted(shared), kind: 'list', sourceId: L_OPEN })).toMatchObject({ ok: true, undoable: false, result: { changed: false } });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'list', sourceId: L_OPEN })).toMatchObject({ ok: true, result: { changed: true } });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.remove', { goalId: shared._id, targetId: spare(shared), kind: 'list', sourceId: L_OPEN })).toMatchObject({ ok: true, undoable: true, result: { changed: true, sources: { sprintIds: [], taskIds: [] } } });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.remove', { goalId: shared._id, targetId: spare(shared), kind: 'task', sourceId: T_OPEN })).toMatchObject({ ok: true, undoable: false, result: { changed: false } });
        expect(sourcesOf(shared, counted(shared))).toEqual({ sprintIds: [L_OPEN], taskIds: [] });
        expect((await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'folder', sourceId: L_OPEN })).rpcError).toMatchObject({ code: -32602 });
        expect((await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'list' })).rpcError).toMatchObject({ code: -32602 });
    });

    it('refuses with the route\'s own codes', async () => {
        const before = goalsNow();
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'list', sourceId: L_SECRET }))
            .toMatchObject({ isError: true, error: expect.stringMatching(/^source_not_shared: /) });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'task', sourceId: T_PRIVATE }))
            .toMatchObject({ isError: true, error: expect.stringMatching(/^source_not_shared: /) });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: spare(shared), kind: 'list', sourceId: MISSING }))
            .toMatchObject({ isError: true, error: expect.stringMatching(/^source_not_found: /) });
        expect(await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: quiet._id, targetId: quiet.targets[0].id, kind: 'list', sourceId: L_OPEN }))
            .toMatchObject({ isError: true, error: expect.stringMatching(/not counted from tasks/) });
        expect(goalsNow()).toBe(before);
    });

    it('answers a list the person cannot open as it answers one that does not exist', async () => {
        const own = await create(OUTSIDER, { name: 'Mine', targets: [{ name: 'Mine', kind: 'tasks' }] });
        const before = goalsNow();
        const missing = await rpc(ctx(OUTSIDER), 'goal.target.sources.add', { goalId: own._id, targetId: own.targets[0].id, kind: 'list', sourceId: MISSING });
        expect(missing).toMatchObject({ isError: true, error: expect.stringMatching(/^source_not_found: /) });
        for (const [kind, sourceId] of [['list', L_PRIVATE], ['list', L_SECRET]]) {
            expect(await rpc(ctx(OUTSIDER), 'goal.target.sources.add', { goalId: own._id, targetId: own.targets[0].id, kind, sourceId })).toEqual(missing);
        }
        expect(await rpc(ctx(OUTSIDER), 'goal.target.sources.add', { goalId: own._id, targetId: own.targets[0].id, kind: 'task', sourceId: T_PRIVATE }))
            .toMatchObject({ isError: true, error: expect.stringMatching(/^source_not_found: /) });
        expect(goalsNow()).toBe(before);
    });

    it('is the owner\'s to change: a reader is refused, and a goal the person cannot read answers as missing', async () => {
        const before = goalsNow();
        for (const name of ['goal.target.sources.add', 'goal.target.sources.remove']) {
            expect(await rpc(ctx(OUTSIDER), name, { goalId: shared._id, targetId: counted(shared), kind: 'list', sourceId: L_OPEN }))
                .toMatchObject({ isError: true, error: 'You do not have permission to perform this action.' });
            for (const uid of [OWNER, ADMIN, GUEST]) {
                expect(await rpc(ctx(uid), name, { goalId: shared._id, targetId: counted(shared), kind: 'list', sourceId: L_OPEN })).toMatchObject({ isError: true, error: 'Goal not found.' });
            }
        }
        expect(goalsNow()).toBe(before);
    });

    it('is refused to a token kept to some projects, though the goal counts only work inside them', async () => {
        const before = goalsNow();
        for (const name of ['goal.target.sources.add', 'goal.target.sources.remove']) {
            expect(await rpc(narrowed(INSIDER, [P_OPEN]), name, { goalId: shared._id, targetId: counted(shared), kind: 'task', sourceId: T_OPEN })).toMatchObject({ refused: true, reason: OUTSIDE_TOKEN });
        }
        expect(goalsNow()).toBe(before);
    });

    it('under taint routing waits for a person when the connection holds the manage scope, and is refused without it', async () => {
        process.env.AGENT_TAINT_ROUTING = 'on';
        const before = goalsNow();
        const args = { goalId: shared._id, targetId: counted(shared), kind: 'task', sourceId: T_OPEN };
        expect(await rpc(outside(INSIDER, ['tasks:write']), 'goal.target.sources.add', args)).toMatchObject({ refused: true, reason: expect.stringMatching(/needs a person's approval/) });
        expect(await rpc(outside(INSIDER, ['tasks:write', 'tasks:manage']), 'goal.target.sources.add', args)).toMatchObject({ ok: false, pending: true });
        expect(proposals.create).toHaveBeenCalledTimes(1);
        expect(goalsNow()).toBe(before);
    });

    it('is undone by someone who can edit the goal, through the same route', async () => {
        await rpc(ctx(INSIDER), 'goal.target.sources.add', { goalId: shared._id, targetId: counted(shared), kind: 'task', sourceId: T_OPEN });
        const [added] = audits('goal.target.sources.add', 'applied');
        expect(await undoStateOf(CID, added, { userId: INSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: true });
        expect(await undoStateOf(CID, added, { userId: OUTSIDER }, { undoHours: 24, run: null })).toMatchObject({ undoable: false });
        await inverses.goalSource(CID, added.meta.undo, { userId: INSIDER });
        expect(sourcesOf(shared, counted(shared))).toEqual({ sprintIds: [L_OPEN], taskIds: [] });

        await rpc(ctx(INSIDER), 'goal.target.sources.remove', { goalId: shared._id, targetId: counted(shared), kind: 'list', sourceId: L_OPEN });
        const [removed] = audits('goal.target.sources.remove', 'applied');
        await inverses.goalSource(CID, removed.meta.undo, { userId: INSIDER });
        expect(sourcesOf(shared, counted(shared))).toEqual({ sprintIds: [L_OPEN], taskIds: [] });
    });
});
