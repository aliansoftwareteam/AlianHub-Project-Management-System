/* Task 047, AI-2: "where is the person". A connected agent asks which project, list or task the person behind it
   last had open, from the visits the web app already records, and is told to ask when that is old or unknown. */
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
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const {
    OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE,
    T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, outside, settle,
} = world;
const { seed, rows, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'person.place';
const MINUTE = 60 * 1000;

const visit = (uid, entityType, entityId, minutesAgo) => mockDb.seed(SCHEMA_TYPE.RECENTVISITS, {
    userId: uid, entityType, entityId, visitedAt: new Date(Date.now() - minutesAgo * MINUTE),
});
const where = (caller) => rpc(caller, TOOL, {});
const kinds = (answer) => [answer.place, ...answer.earlier].filter(Boolean).map((place) => `${place.kind}:${(place.task || place.sprint || place.project).id}`);

beforeEach(() => {
    seed();
    delete process.env.MCP_TOOLS_WORK;
    process.env.MCP_TOOLS_DATA = 'on';
});
afterEach(settle);
afterAll(() => FLAGS.forEach((flag) => { delete process.env[flag]; }));

describe('the tool exists with the read tools', () => {
    it('off, the tool list and the registry are what they were', async () => {
        delete process.env.MCP_TOOLS_DATA;
        expect(tools.names()).toEqual(BEFORE);
        expect(await listed(ctx(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect(await where(ctx(OWNER))).toEqual({ rpcError: { code: -32601, message: `Unknown tool "${TOOL}"` } });
    });

    it('on, it is a read that needs the right to read projects and reaches only this workspace', async () => {
        expect(await listed(ctx(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ write: false, risk: 'low', undoable: false });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_list', write: false }]);
        expect(actions.rating(TOOL)).toEqual({ write: false, reversible: true, scope: 'workspace', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('projects:read');
        expect(tools.registered().find((tool) => tool.name === TOOL).visibility).toBe('filtered');
    });

    it('takes no argument, so nobody else can be asked about', async () => {
        visit(INSIDER, 'task', T_OPEN, 2);
        const answer = await rpc(ctx(OWNER), TOOL, { userId: INSIDER });
        expect(answer.rpcError).toMatchObject({ code: -32602 });
    });

    it('answers a connection that only reads, and refuses one that may not read projects', async () => {
        visit(OWNER, 'project', P_OPEN, 2);
        expect((await where(readOnly(OWNER))).place).toMatchObject({ kind: 'project' });
        expect(await where(outside(OWNER, ['tasks:read']))).toMatchObject({ isError: true, error: expect.stringMatching(/projects:read permission/) });
        expect((await where(ctx(OWNER, { allowedActions: ['tasks.next'] }))).refused).toBe(true);
    });
});

describe('what it answers', () => {
    it('a task the person just had open, with its project and list by name and how long ago', async () => {
        visit(OWNER, 'task', T_OPEN, 5);
        const answer = await where(ctx(OWNER));
        expect(answer.place).toMatchObject({
            kind: 'task', project: { id: P_OPEN, name: 'Open' }, sprint: { id: L_OPEN, name: 'Open list' }, task: { id: T_OPEN, name: 'Open task' }, minutesAgo: 5,
        });
        expect(new Date(answer.place.openedAt).getTime()).toBeGreaterThan(Date.now() - 6 * MINUTE);
        expect(answer.fresh).toBe(true);
        expect(answer.note).toMatch(/5 minutes ago/);
    });

    it('a list and a project, each as the kind of place it is', async () => {
        visit(OWNER, 'sprint', L_OPEN, 1);
        visit(OWNER, 'project', P_PRIVATE, 3);
        const answer = await where(ctx(OWNER));
        expect(answer.place).toMatchObject({ kind: 'sprint', project: { id: P_OPEN, name: 'Open' }, sprint: { id: L_OPEN, name: 'Open list' }, task: null });
        expect(answer.earlier).toEqual([expect.objectContaining({ kind: 'project', project: { id: P_PRIVATE, name: 'Private' }, sprint: null, task: null })]);
    });

    it('the newest place first, and a few earlier ones to offer', async () => {
        visit(OWNER, 'task', T_PRIVATE, 30);
        visit(OWNER, 'task', T_OPEN, 2);
        visit(OWNER, 'sprint', L_SECRET, 10);
        expect(kinds(await where(ctx(OWNER)))).toEqual([`task:${T_OPEN}`, `sprint:${L_SECRET}`, `task:${T_PRIVATE}`]);
    });

    it('says so when the newest place is old, and tells the agent to ask', async () => {
        visit(OWNER, 'task', T_OPEN, 3 * 60);
        const answer = await where(ctx(OWNER));
        expect(answer.fresh).toBe(false);
        expect(answer.place).toMatchObject({ kind: 'task', task: { id: T_OPEN, name: 'Open task' }, minutesAgo: 180 });
        expect(answer.note).toMatch(/ask/i);
    });

    it('says it does not know for a person with no recent place, and tells the agent to ask', async () => {
        visit(INSIDER, 'task', T_OPEN, 2);
        const answer = await where(ctx(OWNER));
        expect(answer).toEqual({ place: null, fresh: false, earlier: [], note: expect.stringMatching(/ask/i) });
    });

    it('keeps no record of the question', async () => {
        visit(OWNER, 'task', T_OPEN, 5);
        const before = JSON.stringify(rows(SCHEMA_TYPE.RECENTVISITS));
        await where(ctx(OWNER));
        expect(JSON.stringify(rows(SCHEMA_TYPE.RECENTVISITS))).toBe(before);
    });
});

describe('only the caller\'s own places, and only what they can still open', () => {
    it('never another person\'s visits', async () => {
        visit(INSIDER, 'task', T_SECRET, 1);
        visit(OWNER, 'task', T_OPEN, 20);
        expect(kinds(await where(ctx(OWNER)))).toEqual([`task:${T_OPEN}`]);
        expect(kinds(await where(ctx(INSIDER)))).toEqual([`task:${T_SECRET}`]);
    });

    it('a member on the private work is told the private places they visited', async () => {
        visit(INSIDER, 'task', T_PERSONAL, 1);
        visit(INSIDER, 'sprint', L_SECRET, 2);
        visit(INSIDER, 'project', P_PRIVATE, 3);
        const answer = await where(ctx(INSIDER));
        expect(kinds(answer)).toEqual([`task:${T_PERSONAL}`, `sprint:${L_SECRET}`, `project:${P_PRIVATE}`]);
        expect(answer.place.project).toEqual({ id: P_PERSONAL, name: 'Personal' });
    });

    it.each([['a member outside the private work', OUTSIDER], ['a guest', GUEST]])('%s is told only the open places, whatever they once visited', async (_who, uid) => {
        visit(uid, 'task', T_PRIVATE, 1);
        visit(uid, 'task', T_SECRET, 2);
        visit(uid, 'sprint', L_SECRET, 3);
        visit(uid, 'sprint', L_PRIVATE, 4);
        visit(uid, 'project', P_PRIVATE, 5);
        visit(uid, 'task', T_PERSONAL, 6);
        visit(uid, 'task', T_OPEN, 7);
        const answer = await where(ctx(uid));
        expect(kinds(answer)).toEqual([`task:${T_OPEN}`]);
        expect(answer.place.minutesAgo).toBe(7);
        expect(JSON.stringify(answer)).not.toMatch(/Private|Secret|Personal/);
    });

    it('a person whose every visit is closed to them now is told nothing, exactly as a person with no visit', async () => {
        const none = await where(ctx(OUTSIDER));
        visit(OUTSIDER, 'task', T_PRIVATE, 1);
        visit(OUTSIDER, 'project', P_PRIVATE, 2);
        expect(await where(ctx(OUTSIDER))).toEqual(none);
    });

    it('an owner is not told another person\'s personal list', async () => {
        visit(OWNER, 'task', T_PERSONAL, 1);
        visit(OWNER, 'project', P_PERSONAL, 2);
        expect((await where(ctx(OWNER))).place).toBeNull();
    });

    it('a token kept to some projects is told only places inside them', async () => {
        visit(OWNER, 'task', T_OPEN, 1);
        visit(OWNER, 'sprint', L_OPEN, 2);
        visit(OWNER, 'project', P_PRIVATE, 3);
        expect(kinds(await where(narrowed(OWNER, [P_PRIVATE])))).toEqual([`project:${P_PRIVATE}`]);
        expect(kinds(await where(narrowed(OWNER, [P_OPEN])))).toEqual([`task:${T_OPEN}`, `sprint:${L_OPEN}`]);
    });

    it('a deleted task, list or project, or one that is gone, drops out', async () => {
        visit(OWNER, 'task', MISSING, 1);
        visit(OWNER, 'task', T_OPEN, 2);
        visit(OWNER, 'sprint', L_PRIVATE, 3);
        visit(OWNER, 'project', P_PRIVATE, 4);
        rows(SCHEMA_TYPE.TASKS).find((row) => String(row._id) === T_OPEN).deletedStatusKey = 1;
        rows(SCHEMA_TYPE.PROJECTS).find((row) => String(row._id) === P_PRIVATE).deletedStatusKey = 1;
        expect((await where(ctx(OWNER))).place).toBeNull();
    });

    it('a doc or anything else the visits hold is not a place for a task', async () => {
        visit(OWNER, 'doc', MISSING, 1);
        expect((await where(ctx(OWNER))).place).toBeNull();
    });
});
