process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Pages/helpers/pageAi', () => ({ composePage: jest.fn(), isAiConfigured: () => false }));

const { EventEmitter } = require('events');
const { composePage } = require('../Modules/Pages/helpers/pageAi');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, T_OPEN, T_SECRET, settle } = world;
const { seed, rows } = world.create(mockDb);

const P_NOWHERE = '6f0000000000000000000aff';
const PAGE = '6f0000000000000000000e01';
const VERSION = '6f0000000000000000000e03';
const DRAFT = '6f0000000000000000000e04';
const T_NOWHERE = '6f0000000000000000000dff';
const COMPOSE = 'POST /api/v2/pages/ai';
const CHANGE = 'PUT /api/v2/pages/:id';
const REACHED = 'reached its handler';
const CREATE = 'POST /api/v2/pages';

const routes = {};
const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers; };
require('../Modules/Pages/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: register('USE') });

const session = (uid) => ({ uid });
const agentToken = (uid, extra = {}) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'], ...extra } });
const personalToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000102', name: 'A script', userId: uid, scopes: ['read', 'write'] } });

/* `handlers` picks how much of the route runs: all of it, or its guards alone. */
const run = (handlers) => (route, caller, body = {}, params = {}) => new Promise((resolve) => {
    const [method, url] = route.split(' ');
    const res = new EventEmitter();
    res.statusCode = 200;
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (answer) => { res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    res.json = res.send;
    const req = { ...caller, method, originalUrl: url, url, baseUrl: '', route: { path: url }, query: {}, params, headers: { companyid: CID }, aud: CID, ip: '1.1.1.1', body };
    const chain = handlers(routes[route]);
    const step = (at) => (at === chain.length ? (res.emit('finish'), resolve(REACHED)) : Promise.resolve(chain[at](req, res, () => step(at + 1))));
    step(0);
}).then(async (result) => { await settle(); return result; });

const send = run((handlers) => handlers);
const through = run((handlers) => handlers.slice(0, -1));

/* [route, body, params]: the doc writes no registry action covers on a route. */
const NO_ACTION = {
    'changing a doc': ['PUT /api/v2/pages/:id', { title: 'Renamed' }, { id: PAGE }],
    'setting the sign-off of a doc': ['PUT /api/v2/pages/:id', { agentStatus: 'approved' }, { id: PAGE }],
    'keeping a version of a doc': ['POST /api/v2/pages/:id/versions', {}, { id: PAGE }],
    'putting a version of a doc back': ['POST /api/v2/pages/:id/versions/:versionId/restore', {}, { id: PAGE, versionId: VERSION }],
    'naming a version of a doc': ['PUT /api/v2/pages/:id/versions/:versionId', { name: 'First' }, { id: PAGE, versionId: VERSION }],
    'marking a doc reviewed': ['PUT /api/v2/pages/:id/review', {}, { id: PAGE }],
    'taking a doc out of the trash': ['PUT /api/v2/pages/:id/restore', {}, { id: PAGE }],
    'adding an image to a doc': ['POST /api/v2/pages/:id/images', {}, { id: PAGE }],
    'composing a doc with the assistant': [COMPOSE, { action: 'draft', title: 'Plan' }, {}],
};

const DRAFTED = {
    'a title alone': { title: 'Plan' },
    'a title and a project': { title: 'Plan', projectId: P_OPEN },
    'a body and the task it is for': { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_OPEN], contentBlocks: [{ type: 'paragraph', data: { text: 'First' } }] },
    'the company named beside it': { title: 'Plan', projectId: P_OPEN, companyId: CID },
};

/* New docs that carry more than a draft does. */
const BEYOND_A_DRAFT = {
    'under another doc': { title: 'Plan', projectId: P_OPEN, parentPageId: PAGE },
    'made private': { title: 'Plan', projectId: P_OPEN, visibility: 'private' },
    'as a wiki page': { title: 'Plan', projectId: P_OPEN, isWiki: true },
    'owned by someone': { title: 'Plan', projectId: P_OPEN, ownerId: OWNER },
    'with a review date': { title: 'Plan', projectId: P_OPEN, reviewDate: '2027-01-01' },
    'linked to several tasks': { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_OPEN, T_SECRET] },
    'already signed off': { title: 'Plan', projectId: P_OPEN, agentStatus: 'approved' },
};

const audits = (action) => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => row.action === action);
const agentAudits = () => rows(SCHEMA_TYPE.AUDIT_LOGS).filter((row) => String(row.action).startsWith('agent.'));
const pages = () => rows(SCHEMA_TYPE.PAGES).filter((row) => ![PAGE, DRAFT].includes(String(row._id)));
const stored = (id) => rows(SCHEMA_TYPE.PAGES).find((row) => String(row._id) === id);
const seedDraft = () => mockDb.seed(SCHEMA_TYPE.PAGES, {
    _id: DRAFT, title: 'Drafted doc', ProjectID: P_OPEN, visibility: 'project', createdBy: INSIDER, updatedBy: INSIDER, deletedStatusKey: 0, order: 2, createdByAgent: true, agentName: 'Claude', agentStatus: 'draft',
});
const AGENTS_OF = [['an owner', OWNER], ['an admin', ADMIN], ['a member', INSIDER], ['a member outside the private work', OUTSIDER], ['a guest', GUEST]];

beforeEach(() => {
    seed();
    mockDb.seed(SCHEMA_TYPE.PAGES, { _id: PAGE, title: 'Existing doc', ProjectID: P_OPEN, visibility: 'project', createdBy: OWNER, updatedBy: OWNER, deletedStatusKey: 0, order: 1 });
});
afterEach(() => {
    delete process.env.MCP_TOOLS_MANAGE;
    composePage.mockReset();
});

describe('a token created for an agent, on the doc write routes', () => {
    it.each(Object.keys(NO_ACTION).flatMap((name) => AGENTS_OF.map(([label, uid]) => [name, label, uid])))('%s is refused for the agent of %s, and recorded', async (name, label, uid) => {
        const [route, body, params] = NO_ACTION[name];

        const answer = await send(route, agentToken(uid), body, params);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^(An agent is not allowed to do this|An agent is never allowed to do this|That action is not available to agents)/);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: route, onBehalfOf: uid });
        expect(audits('agent.action')).toHaveLength(0);
        expect(rows(SCHEMA_TYPE.PAGES)).toEqual([expect.objectContaining({ title: 'Existing doc', updatedBy: OWNER })]);
    });

    it('keeps refusing them whatever a flag or a grant on the token says', async () => {
        process.env.MCP_TOOLS_MANAGE = 'on';
        const granted = agentToken(OWNER, { grants: ['tasks:manage', 'docs:manage'] });

        for (const [route, body, params] of Object.values(NO_ACTION)) {
            expect([route, (await send(route, granted, body, params)).code]).toEqual([route, 403]);
        }
        for (const body of Object.values(BEYOND_A_DRAFT)) {
            expect((await send(CREATE, granted, body)).code).toBe(403);
        }
        expect(pages()).toEqual([]);
    });

    it('never reaches the assistant, whoever the agent is of', async () => {
        for (const [, uid] of AGENTS_OF) await send(COMPOSE, agentToken(uid), { action: 'draft', title: 'Plan', pageId: PAGE });

        expect(composePage).not.toHaveBeenCalled();
    });

    it.each([
        ['listing docs', 'GET /api/v2/pages'],
        ['reading a doc', 'GET /api/v2/pages/:id'],
        ['listing the versions of a doc', 'GET /api/v2/pages/:id/versions'],
    ])('%s, a read, still goes through and leaves no record', async (label, route) => {
        expect(await through(route, agentToken(OWNER), {}, { id: PAGE })).toBe(REACHED);
        expect(agentAudits()).toHaveLength(0);
    });
});

describe('a doc created by an agent through the create route', () => {
    it.each(Object.keys(DRAFTED).flatMap((name) => [[name, 'an owner', OWNER], [name, 'a member', INSIDER]]))('with %s is stored as a draft for the agent of %s, and recorded', async (name, label, uid) => {
        const answer = await send(CREATE, agentToken(uid), DRAFTED[name]);

        expect(answer.body.status).toBe(true);
        expect(pages()).toEqual([expect.objectContaining({ title: 'Plan', createdBy: uid, createdByAgent: true, agentStatus: 'draft', agentName: expect.stringContaining('Claude'), visibility: 'project' })]);
        expect(audits('agent.action_refused')).toHaveLength(0);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'page.draft', state: 'applied', reason: 'via REST', onBehalfOf: uid });
    });

    it.each([
        ['says it is a person\'s', { createdByAgent: false }],
        ['names the agent itself', { createdByAgent: true, agentName: 'Olive Owner' }],
    ])('is a draft under the token\'s own name when the body %s', async (label, said) => {
        expect((await send(CREATE, agentToken(INSIDER), { title: 'Plan', projectId: P_OPEN, ...said })).body.status).toBe(true);

        expect(pages()).toEqual([expect.objectContaining({ createdByAgent: true, agentStatus: 'draft', agentName: expect.stringContaining('Claude') })]);
        expect(pages()[0].agentName).not.toBe('Olive Owner');
    });

    it.each(Object.keys(BEYOND_A_DRAFT).flatMap((name) => [[name, 'an owner', OWNER], [name, 'an admin', ADMIN], [name, 'a member', INSIDER]]))('%s is refused for the agent of %s, and recorded', async (name, label, uid) => {
        const answer = await send(CREATE, agentToken(uid), BEYOND_A_DRAFT[name]);

        expect(answer.code).toBe(403);
        expect(answer.body.statusText).toMatch(/^That action is not available to agents \(page\.create\)/);
        expect(pages()).toEqual([]);
        expect(audits('agent.action_refused')).toHaveLength(1);
        expect(audits('agent.action_refused')[0].meta).toMatchObject({ ran: false, path: CREATE, onBehalfOf: uid });
    });

    it('into a project its person cannot open is answered as one into a project that does not exist', async () => {
        const hidden = await send(CREATE, agentToken(OUTSIDER), { title: 'Plan', projectId: P_PRIVATE });
        const missing = await send(CREATE, agentToken(OUTSIDER), { title: 'Plan', projectId: P_NOWHERE });

        expect(hidden).toEqual(missing);
        expect(hidden.body).toMatchObject({ status: false, statusCode: 404 });
        expect(pages()).toEqual([]);
    });

    it.each([
        ['into a project its person cannot open', OUTSIDER, { title: 'Plan', projectId: P_PRIVATE }, 'Project not found.'],
        ['by the agent of a guest', GUEST, { title: 'Plan', projectId: P_OPEN }, 'You do not have permission to add a doc here.'],
        ['with no title', INSIDER, { title: '  ', projectId: P_OPEN }, expect.any(String)],
        ['for a task its person cannot open', OUTSIDER, { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_SECRET] }, 'Task not found.'],
    ])('%s, which the doc rules turn down, is recorded as one that did not happen', async (label, uid, body, failed) => {
        const answer = await send(CREATE, agentToken(uid), body);

        expect(answer.body.status).toBe(false);
        expect(pages()).toEqual([]);
        expect(audits('agent.action')).toHaveLength(1);
        expect(audits('agent.action')[0].meta).toMatchObject({ action: 'page.draft', state: 'failed', failed, undoable: false });
    });
});

describe('the tasks a doc is linked to', () => {
    const CALLERS = [['a signed-in member', session(OUTSIDER)], ['a personal token of a member', personalToken(OUTSIDER)], ['the agent of a member', agentToken(OUTSIDER)]];

    it.each(CALLERS)('a new doc of %s for a task they cannot open is answered as one for a task that does not exist', async (label, caller) => {
        const hidden = await send(CREATE, caller, { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_SECRET] });
        const missing = await send(CREATE, caller, { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_NOWHERE] });

        expect(hidden).toEqual(missing);
        expect(hidden.body).toMatchObject({ status: false, statusCode: 404, statusText: 'Task not found.' });
        expect(pages()).toEqual([]);
    });

    it.each(CALLERS)('a new doc of %s for a task they can open is linked to it', async (label, caller) => {
        expect((await send(CREATE, caller, { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_OPEN] })).body.status).toBe(true);

        expect(pages()[0].linkedTasks.map(String)).toEqual([T_OPEN]);
    });

    it('one task of several that the person cannot open keeps the whole doc from being created', async () => {
        const answer = await send(CREATE, session(OUTSIDER), { title: 'Plan', projectId: P_OPEN, linkedTasks: [T_OPEN, T_SECRET] });

        expect(answer.body).toMatchObject({ status: false, statusCode: 404 });
        expect(pages()).toEqual([]);
    });

    it.each([['a signed-in member', session(OUTSIDER)], ['a personal token of a member', personalToken(OUTSIDER)]])('a doc is not linked by %s to a task they cannot open', async (label, caller) => {
        const hidden = await send(CHANGE, caller, { linkedTasks: [T_SECRET] }, { id: PAGE });
        const missing = await send(CHANGE, caller, { linkedTasks: [T_NOWHERE] }, { id: PAGE });

        expect(hidden).toEqual(missing);
        expect(hidden.body).toMatchObject({ status: false, statusCode: 404, statusText: 'Task not found.' });
        expect(stored(PAGE).linkedTasks || []).toEqual([]);
        expect(stored(PAGE).updatedBy).toBe(OWNER);
    });

    it('a link the doc already holds stays when someone who cannot open that task saves the list', async () => {
        expect((await send(CHANGE, session(INSIDER), { linkedTasks: [T_SECRET] }, { id: PAGE })).body.status).toBe(true);

        expect((await send(CHANGE, session(OUTSIDER), { linkedTasks: [T_SECRET, T_OPEN] }, { id: PAGE })).body.status).toBe(true);
        expect(stored(PAGE).linkedTasks.map(String)).toEqual([T_SECRET, T_OPEN]);

        expect((await send(CHANGE, session(OUTSIDER), { linkedTasks: [T_OPEN] }, { id: PAGE })).body.status).toBe(true);
        expect(stored(PAGE).linkedTasks.map(String)).toEqual([T_OPEN]);
    });
});

describe('the draft mark of a doc', () => {
    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s can ask for a draft, and it carries no agent\'s name', async (label, caller) => {
        expect((await send(CREATE, caller, { title: 'From an answer', projectId: P_OPEN, createdByAgent: true, agentName: 'Claude' })).body.status).toBe(true);

        expect(pages()).toEqual([expect.objectContaining({ title: 'From an answer', createdBy: INSIDER, createdByAgent: true, agentStatus: 'draft', agentName: '' })]);
    });

    it('a name alone marks nothing', async () => {
        expect((await send(CREATE, session(INSIDER), { title: 'Handbook', projectId: P_OPEN, agentName: 'Claude', agentStatus: 'draft' })).body.status).toBe(true);

        expect(pages()[0].createdByAgent).toBeUndefined();
        expect(pages()[0].agentName).toBeUndefined();
        expect(pages()[0].agentStatus).toBeUndefined();
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a signed-in owner', session(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('is not changed by %s saving the doc', async (label, caller) => {
        seedDraft();

        expect((await send(CHANGE, caller, { title: 'Renamed draft', agentStatus: 'approved' }, { id: DRAFT })).body.status).toBe(true);
        expect((await send(CHANGE, caller, { agentStatus: 'approved' }, { id: DRAFT })).body.status).toBe(true);
        expect((await send(CHANGE, caller, { title: 'Renamed', agentStatus: 'draft' }, { id: PAGE })).body.status).toBe(true);

        expect(stored(DRAFT)).toMatchObject({ title: 'Renamed draft', agentStatus: 'draft', createdByAgent: true, agentName: 'Claude' });
        expect(stored(DRAFT).approvedBy).toBeUndefined();
        expect(stored(PAGE).title).toBe('Renamed');
        expect(stored(PAGE).agentStatus).toBeUndefined();
    });

    it('is signed off through the approve route', async () => {
        seedDraft();

        expect((await send('PUT /api/v2/pages/:id/approve', session(OWNER), {}, { id: DRAFT })).body.status).toBe(true);

        expect(stored(DRAFT)).toMatchObject({ agentStatus: 'approved', approvedBy: OWNER });
    });

    it.each([
        ['a personal token of an owner', personalToken(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
        ['an agent\'s token', agentToken(OWNER)],
        ['a connected app\'s token', { uid: OWNER, mcp: true }],
    ])('is not signed off by %s', async (label, caller) => {
        seedDraft();

        expect(await send('PUT /api/v2/pages/:id/approve', caller, {}, { id: DRAFT })).toMatchObject({ code: 403, body: { status: false } });

        expect(stored(DRAFT).agentStatus).toBe('draft');
        expect(stored(DRAFT).approvedBy).toBeUndefined();
    });
});

describe('everyone else on the doc routes', () => {
    it.each([
        ['a signed-in owner', session(OWNER)],
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of an owner', personalToken(OWNER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s reaches every one of them, and nothing is recorded as an agent\'s', async (label, caller) => {
        for (const [route, body, params] of Object.values(NO_ACTION)) {
            expect([route, await through(route, caller, body, params)]).toEqual([route, REACHED]);
        }
        for (const body of [...Object.values(BEYOND_A_DRAFT), ...Object.values(DRAFTED)]) {
            expect(await through(CREATE, caller, body)).toBe(REACHED);
        }
        expect(agentAudits()).toHaveLength(0);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('a doc %s creates is stored as theirs, with what they sent', async (label, caller) => {
        const answer = await send(CREATE, caller, { title: 'Handbook', projectId: P_OPEN, parentPageId: PAGE, isWiki: true, linkedTasks: [T_OPEN, T_SECRET] });

        expect(answer.body.status).toBe(true);
        expect(pages()).toHaveLength(1);
        expect(pages()[0]).toMatchObject({ title: 'Handbook', createdBy: INSIDER, isWiki: true });
        expect(pages()[0].createdByAgent).toBeUndefined();
        expect(pages()[0].agentStatus).toBeUndefined();
        expect(String(pages()[0].parentPageId)).toBe(PAGE);
        expect(pages()[0].linkedTasks.map(String)).toEqual([T_OPEN, T_SECRET]);
    });

    it.each([
        ['a signed-in member', session(INSIDER)],
        ['a signed-in guest', session(GUEST)],
        ['a personal token of a member', personalToken(INSIDER)],
    ])('%s composes with the assistant as before', async (label, caller) => {
        composePage.mockResolvedValue({ status: true, data: { html: '<p>Drafted</p>' } });

        const answer = await send(COMPOSE, caller, { action: 'draft', title: 'Plan' });

        expect(answer.body).toMatchObject({ status: true, data: { html: '<p>Drafted</p>' } });
        expect(composePage).toHaveBeenCalledTimes(1);
    });

    it('a person changes a doc as before', async () => {
        const answer = await send('PUT /api/v2/pages/:id', session(INSIDER), { title: 'Renamed' }, { id: PAGE });

        expect(answer.body.status).toBe(true);
        expect(rows(SCHEMA_TYPE.PAGES)[0]).toMatchObject({ title: 'Renamed', updatedBy: INSIDER });
    });
});
