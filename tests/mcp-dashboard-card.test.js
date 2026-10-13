require('./fixtures/mcpFlagsOff');
/* Task 047, job 22: a connected agent asks for a card on a dashboard. It waits for the person who owns the
   dashboard, is added by the dashboard editor's own routes as that person, and they alone can take it back. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();
const mockElsewhere = require('./fixtures/fakeMongo').create();
const mockOtherCompany = '6f00000000000000000000c2';

/* One database per company, as in production: a call that names another company reads that company's rows only. */
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => (String(companyId) === mockOtherCompany ? mockElsewhere : mockDb).crud(companyId, q, method),
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

const fs = require('fs');
const path = require('path');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const intentPreview = require('../Modules/Agents/intentPreview');
const dashboards = require('../Modules/Agents/dashboardRequests');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, outside, routeTable, asPerson, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);
const web = asPerson(routeTable(require('../Modules/UserDashboard/routes').init));

const TOOL = 'dashboard.card.add';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const D_MINE = '6f0000000000000000000e01';
const D_SHARED = '6f0000000000000000000e02';
const D_HIDDEN = '6f0000000000000000000e03';
const BOARD = { newDashboard: '[AI bench] Board', card: 'tasks_by_status' };
const HELD_CARD = { componentId: 'DueSoonCard', cardId: '', uid: '100000001', config: { cardData: {}, filterData: [], position: { x: 0, y: 0, w: 4, h: 9, minW: 3, maxW: 12, minH: 7, maxH: 22 } } };

const boards = () => rows(SCHEMA_TYPE.USERDASHBOARD);
const liveBoards = () => boards().filter((board) => board.isDeleted !== true);
const boardNamed = (title) => boards().find((board) => board.title === title);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = INSIDER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = INSIDER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid) } };
};
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const seedBoard = (_id, title, ownerId, extra = {}) => mockDb.seed(SCHEMA_TYPE.USERDASHBOARD, {
    _id, title, userId: ownerId, ownerId, visibility: 'private', projectId: '', sharedWith: [], cards: [], isDeleted: false, ...extra,
});

beforeEach(() => {
    seed();
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, { _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], projectIds: [], expiresAt: new Date(Date.now() + 86400000) }));
    seedBoard(D_MINE, 'My board', INSIDER, { cards: [JSON.parse(JSON.stringify(HELD_CARD))] });
    seedBoard(D_SHARED, 'Team board', OUTSIDER, { visibility: 'workspace' });
    seedBoard(D_HIDDEN, 'Kept to myself', OUTSIDER);
    Object.keys(mockElsewhere.store).forEach((type) => { mockElsewhere.store[type].length = 0; });
    mockElsewhere.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: INSIDER, roleType: 3, status: 2, isDelete: false });
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        expect(await listed(as(INSIDER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect((await rpc(as(INSIDER), TOOL, BOARD)).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, it is an action that always waits for a person, rated as a change to the workspace', async () => {
        expect(await listed(as(INSIDER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'low', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'task.task_list', write: false }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'workspace', money: false });
        await expect(actions.perform({ companyId: CID, actor: as(INSIDER).actor, action: TOOL, params: BOARD, reason: 'direct' })).rejects.toThrow(/has to be sent as a proposal/);
    });

    it('offers the cards the editor\'s picker adds with nothing more to fill in, each as the picker adds it', () => {
        const source = fs.readFileSync(path.join(__dirname, '../frontend/src/plugins/dashboard/cardCatalog.js'), 'utf8').replace(/export const/g, 'const');
        // eslint-disable-next-line no-new-func
        const { CARD_CATALOG, PERIOD_OPTIONS } = new Function(`${source}; return { CARD_CATALOG, PERIOD_OPTIONS };`)();
        const ready = CARD_CATALOG.filter((card) => card.built && !card.settings);
        expect(Object.values(dashboards.CARDS).map((card) => card.key).sort()).toEqual(ready.map((card) => card.key).sort());
        Object.values(dashboards.CARDS).forEach((card) => {
            const entry = ready.find((candidate) => candidate.key === card.key);
            expect({ size: card.size, period: card.period }).toEqual({ size: entry.size, period: entry.period });
        });
        expect(Object.values(dashboards.PERIODS)).toEqual(PERIOD_OPTIONS.map((option) => option.id));
    });
});

describe('asking for a card', () => {
    it('files it as one proposal for a new dashboard, and makes nothing', async () => {
        const id = await filed(as(INSIDER), { ...BOARD, reason: 'See where the work stands' });
        expect(boards()).toHaveLength(3);
        expect(waiting()).toHaveLength(1);
        expect(waiting()[0]).toMatchObject({ _id: id, source: 'mcp', requestedBy: INSIDER, projectId: null });
        expect(waiting()[0].changes[0]).toMatchObject({ action: TOOL, reversible: true, params: BOARD });
    });

    it('says at once what is wrong with the request', async () => {
        const wrong = async (args, why) => expect((await rpc(as(INSIDER), TOOL, args)).rpcError).toMatchObject({ code: -32602, message: expect.stringMatching(why) });
        await wrong({ card: 'tasks_by_status' }, /not both and not neither/);
        await wrong({ ...BOARD, dashboardId: D_MINE }, /not both and not neither/);
        await wrong({ newDashboard: 'Board', card: 'burndown' }, /card/);
        await wrong({ newDashboard: 'Board', card: 'due_soon', period: 'today' }, /leave the period out/);
        await wrong({ ...BOARD, period: 'next_year' }, /period/);
        expect(waiting()).toHaveLength(0);
    });

    it('answers a dashboard that is not there and one the person cannot open alike, and one that is another person\'s or full', async () => {
        const answer = (dashboardId) => rpc(as(INSIDER), TOOL, { dashboardId, card: 'due_soon' });
        expect(await answer(MISSING)).toEqual({ ok: false, error: 'That dashboard was not found.' });
        expect(await answer(D_HIDDEN)).toEqual(await answer(MISSING));
        expect(await answer(D_SHARED)).toMatchObject({ ok: false, error: expect.stringMatching(/belongs to someone else/) });
        stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE).cards = Array.from({ length: 60 }, (v, at) => ({ ...HELD_CARD, uid: String(200000000 + at) }));
        expect(await answer(D_MINE)).toMatchObject({ ok: false, error: expect.stringMatching(/60 cards/) });
        expect(waiting()).toHaveLength(0);
    });
});

describe('who may ask for one', () => {
    it('files for an owner, a member and a guest, each for a dashboard of their own', async () => {
        for (const uid of [OWNER, OUTSIDER, GUEST]) await filed(as(uid), BOARD);
        expect(waiting().map((row) => row.requestedBy)).toEqual([OWNER, OUTSIDER, GUEST]);
    });

    it('refuses a member whose role may not list tasks', async () => {
        setRule('task_list', null, [3]);
        expect(await rpc(as(OUTSIDER), TOOL, BOARD)).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_list/) });
        expect(waiting()).toHaveLength(0);
    });

    it('refuses a token kept to some projects, and tells it nothing of a dashboard', async () => {
        const kept = { ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds };
        for (const args of [BOARD, { dashboardId: D_MINE, card: 'due_soon' }, { dashboardId: D_SHARED, card: 'due_soon' }]) {
            expect(await rpc(kept, TOOL, args)).toMatchObject({ refused: true, reason: expect.stringMatching(/limited to some projects/) });
        }
        expect(waiting()).toHaveLength(0);
    });

    it('answers a dashboard of another company as one that is not there', async () => {
        expect(await rpc(as(INSIDER, { companyId: mockOtherCompany }), TOOL, { dashboardId: D_MINE, card: 'due_soon' })).toEqual({ ok: false, error: 'That dashboard was not found.' });
        expect(mockElsewhere.store[SCHEMA_TYPE.AGENT_PROPOSALS] || []).toHaveLength(0);
    });

    it('refuses an outside client that holds no manage scope', async () => {
        expect(await rpc(outside(INSIDER, ['tasks:write']), TOOL, BOARD)).toMatchObject({ refused: true, reason: expect.stringMatching(/needs a person's approval/) });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving adds the card the editor would add', () => {
    it('makes a new private dashboard for the person, holding the card as the picker adds it', async () => {
        const byHand = { componentId: 'TasksByStatusCard', cardId: '', uid: '300000001', config: { cardData: { timerange: 3 }, filterData: [], position: { x: 0, y: 0, w: 6, h: 9, minW: 4, maxW: 12, minH: 6, maxH: 22 } } };
        expect((await web('POST /api/v1/dashboards', INSIDER, { body: { title: 'By hand', visibility: 'private', cards: [byHand] } })).code).toBe(200);
        const out = await approve(await filed(as(INSIDER), BOARD));
        expect(out.error).toBeUndefined();
        const made = boardNamed('[AI bench] Board');
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { dashboardId: String(made._id), card: 'tasks_by_status', madeDashboard: true } });
        ['userId', 'ownerId', 'visibility', 'projectId', 'sharedWith', 'isDeleted'].forEach((key) => expect(made[key]).toEqual(boardNamed('By hand')[key]));
        expect(made).toMatchObject({ ownerId: INSIDER, visibility: 'private' });
        expect(made.cards).toEqual([{ ...byHand, uid: expect.stringMatching(/^\d{9}$/) }]);
    });

    it('puts the card under the cards a dashboard already holds, on the span of time that was asked for', async () => {
        const out = await approve(await filed(as(INSIDER), { dashboardId: D_MINE, card: 'my_time', period: 'last_week' }));
        expect(out.applied[0]).toMatchObject({ ok: true, result: { dashboardId: D_MINE, madeDashboard: false } });
        expect(JSON.stringify([out.applied, audits(TOOL)])).not.toMatch(/My board/);
        const { cards } = stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE);
        expect(cards).toHaveLength(2);
        expect(cards[0]).toEqual(HELD_CARD);
        expect(cards[1]).toMatchObject({ componentId: 'MyTimeCard', config: { cardData: { timerange: 4 }, filterData: [], position: { x: 0, y: 9, w: 4, h: 8, minW: 3, maxW: 12, minH: 6, maxH: 18 } } });
    });

    it('is approved only by the person it was asked for, and stays waiting when someone else tries', async () => {
        const id = await filed(as(INSIDER), BOARD);
        for (const uid of [OWNER, OUTSIDER]) expect(await approve(id, uid)).toMatchObject({ error: dashboards.NOT_THEIRS, status: 403 });
        expect(waiting()).toHaveLength(1);
        expect(boardNamed('[AI bench] Board')).toBeUndefined();
        expect((await approve(id)).applied[0].ok).toBe(true);
    });

    it('adds nothing where the dashboard is no longer the person\'s to change', async () => {
        const id = await filed(as(INSIDER), { dashboardId: D_MINE, card: 'due_soon' });
        stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE).ownerId = OUTSIDER;
        stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE).userId = OUTSIDER;
        expect((await approve(id)).applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/not found/) });
        expect(stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE).cards).toEqual([HELD_CARD]);
    });
});

describe('undo', () => {
    it('removes a dashboard the change made while its card is all it holds', async () => {
        const id = await filed(as(INSIDER), BOARD);
        await approve(id);
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: true, result: { removed: true, dashboardRemoved: true } });
        expect(boardNamed('[AI bench] Board').isDeleted).toBe(true);
        expect(liveBoards()).toHaveLength(3);
    });

    it('removes only the card where the dashboard has gained another since, or was there before', async () => {
        const fresh = await filed(as(INSIDER), BOARD);
        await approve(fresh);
        boardNamed('[AI bench] Board').cards.push({ ...HELD_CARD });
        expect((await undo(fresh)).results[0]).toMatchObject({ ok: true, result: { removed: true, dashboardRemoved: false } });
        expect(boardNamed('[AI bench] Board')).toMatchObject({ isDeleted: false, cards: [HELD_CARD] });

        const held = await filed(as(INSIDER), { dashboardId: D_MINE, card: 'at_risk' });
        await approve(held);
        expect((await undo(held)).results[0]).toMatchObject({ ok: true, result: { removed: true, dashboardRemoved: false } });
        expect(stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE)).toMatchObject({ isDeleted: false, cards: [HELD_CARD] });
    });

    it('is refused to anyone but the dashboard\'s owner, and changes nothing', async () => {
        const id = await filed(as(INSIDER), { dashboardId: D_MINE, card: 'at_risk' });
        await approve(id);
        expect((await undo(id, OWNER)).results[0]).toMatchObject({ ok: false, reason: 'target_not_visible' });
        expect(stored(SCHEMA_TYPE.USERDASHBOARD, D_MINE).cards).toHaveLength(2);
    });
});

describe('the card in the Inbox', () => {
    const cardFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id))[0];

    it('names the dashboard and the card for a viewer who can open the dashboard, and is not there for one who cannot', async () => {
        await filed(as(INSIDER), { dashboardId: D_MINE, card: 'tasks_by_status', period: 'today' });
        expect(await cardFor(INSIDER, waiting()[0])).toEqual({
            kind: 'dashboardCard', title: 'My board',
            lines: [{ kind: 'dashboard', name: 'My board', isNew: false }, { kind: 'card', card: 'TasksByStatusCard', period: 1 }],
        });
        expect(await cardFor(OWNER, waiting()[0])).toBeNull();
        expect(await cardFor(OUTSIDER, waiting()[0])).toBeNull();
    });

    it('shows a dashboard that is not there yet by the name it was asked for', async () => {
        await filed(as(INSIDER), { newDashboard: '[AI bench] Board', card: 'due_soon' });
        expect(await cardFor(INSIDER, waiting()[0])).toEqual({
            kind: 'dashboardCard', title: '[AI bench] Board',
            lines: [{ kind: 'dashboard', name: '[AI bench] Board', isNew: true }, { kind: 'card', card: 'DueSoonCard' }],
        });
    });
});
