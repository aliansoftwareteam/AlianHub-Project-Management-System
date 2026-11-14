process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleStoredFileCopy: jest.fn(), handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));
jest.mock('../Modules/Connectors/tools', () => {
    const real = jest.requireActual('../Modules/Connectors/tools');
    return { ...real, ...real.make(require('path').join(__dirname, 'fixtures', 'connectors')) };
});
jest.mock('../Modules/Connectors/registry', () => {
    const real = jest.requireActual('../Modules/Connectors/registry');
    return { ...real, ...real.createRegistry({ dir: require('path').join(__dirname, 'fixtures', 'connectors') }) };
});
jest.mock('../Modules/Connectors/apps', () => ({ ...jest.requireActual('../Modules/Connectors/apps'), companyProviders: jest.fn(async () => ['fake']) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const ctrl = require('../Modules/Agents/controller');
const apps = require('../Modules/Connectors/apps');
const { createAgentRecord } = require('../Modules/Agents/agentRecord');

/* Which connected apps an agent may use is saved with the agent: only keys this server knows, only by someone who
 * may edit the agent, and a member's change to an approved agent waits like any other. */

const { CID, OWNER, INSIDER, OUTSIDER } = world;
const { seed, rows } = world.create(mockDb);
const READ = 'fake.notes.list';
const WRITE = 'fake.notes.create';
const ENV = { CONNECTORS: 'fake', AGENT_TAINT_ROUTING: 'on' };
const before = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (uid, over = {}) => ({ headers: { companyid: CID }, aud: CID, params: {}, query: {}, body: {}, uid, ip: '', ...over });
const call = async (handler, request) => { const r = res(); await handler(request, r); await world.settle(); return r; };
const agentRow = (id) => rows(SCHEMA_TYPE.AGENTS).find((row) => String(row._id) === String(id));
const revisionsOf = (id) => rows(SCHEMA_TYPE.AGENT_REVISIONS).filter((row) => String(row.agentId) === String(id));
const grant = (key, permission) => {
    const rule = rows(SCHEMA_TYPE.RULES).find((row) => row.key === key);
    rule.roles = [...rule.roles.filter((role) => role.key !== 3), { key: 3, permission }];
};
const create = async (uid, body = {}) => call(ctrl.createAgent, req(uid, { body: { name: 'Notes keeper', autonomy: 1, spendCapUsd: 5, ...body } }));
const update = (uid, id, body) => call(ctrl.updateAgent, req(uid, { params: { id }, body }));

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());
beforeEach(() => {
    Object.assign(process.env, ENV);
    seed();
    jest.clearAllMocks();
});
afterAll(() => Object.entries(before).forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; }));

describe('a new agent', () => {
    it('has no app ticked, from the route and from every other road that makes one', async () => {
        const made = await create(OWNER);
        expect(agentRow(made.body.data._id).connectors).toEqual([]);
        const recorded = await createAgentRecord(CID, { name: 'Pack agent' }, { ownerId: OWNER });
        expect(agentRow(recorded._id).connectors).toEqual([]);
    });

    it('can be made with ticks, stored in one order without repeats', async () => {
        const made = await create(OWNER, { connectors: [{ provider: 'fake', tools: [READ, WRITE, READ] }, { provider: 'fake', tools: [] }] });
        expect(agentRow(made.body.data._id).connectors).toEqual([{ provider: 'fake', tools: [WRITE, READ] }]);
    });

    it('is not made when its ticks name something this server does not have', async () => {
        const r = await create(OWNER, { connectors: [{ provider: 'fake', tools: ['fake.notes.burn'] }] });
        expect(r.code).toBe(400);
        expect(rows(SCHEMA_TYPE.AGENTS)).toHaveLength(0);
        await expect(createAgentRecord(CID, { name: 'Pack agent', connectors: [{ provider: 'nope', tools: [] }] })).rejects.toMatchObject({ status: 400 });
    });
});

describe('saving the ticks', () => {
    it('stores them, and the revision a run pins carries them', async () => {
        const id = String((await create(OWNER)).body.data._id);
        const r = await update(OWNER, id, { connectors: [{ provider: 'fake', tools: [READ] }] });
        expect(r.body.statusText).toBe('Agent updated.');
        expect(agentRow(id).connectors).toEqual([{ provider: 'fake', tools: [READ] }]);
        expect(revisionsOf(id).find((row) => row.state === 'live').snapshot.connectors).toEqual([{ provider: 'fake', tools: [READ] }]);
    });

    it.each([
        ['an app this server does not have', [{ provider: 'github', tools: ['github.pull_request.read'] }], /"github" is not a connected app/],
        ['a tool the app does not have', [{ provider: 'fake', tools: ['fake.notes.burn'] }], /"fake.notes.burn" is not a tool of Fake/],
        ['a tool of another app under this one', [{ provider: 'fake', tools: ['slack.channel.read'] }], /is not a tool of Fake/],
        ['tools that are not a list', [{ provider: 'fake', tools: READ }], /tools as a list/],
        ['ticks that are not a list', { fake: [READ] }, /must be a list/],
    ])('refuses %s, and changes nothing', async (_, connectors, message) => {
        const id = String((await create(OWNER, { connectors: [{ provider: 'fake', tools: [WRITE] }] })).body.data._id);
        const r = await update(OWNER, id, { connectors });
        expect(r.code).toBe(400);
        expect(r.body.statusText).toMatch(message);
        expect(agentRow(id).connectors).toEqual([{ provider: 'fake', tools: [WRITE] }]);
    });

    it('clears them with an empty list', async () => {
        const id = String((await create(OWNER, { connectors: [{ provider: 'fake', tools: [READ] }] })).body.data._id);
        await update(OWNER, id, { connectors: [] });
        expect(agentRow(id).connectors).toEqual([]);
    });
});

describe('who may change them', () => {
    const approvedMemberAgent = async () => {
        grant('ai_agents', true);
        const id = String((await create(INSIDER, { visibility: 'everyone' })).body.data._id);
        await call(ctrl.decideAgent(true), req(OWNER, { params: { id } }));
        return id;
    };

    it('a member\'s tick on their approved agent waits for an owner or admin, and the agent keeps working without it', async () => {
        const id = await approvedMemberAgent();
        const r = await update(INSIDER, id, { connectors: [{ provider: 'fake', tools: [READ] }] });
        expect(r.body.statusText).toMatch(/waits for an Owner or an Admin/);
        expect(agentRow(id).connectors).toEqual([]);
        const candidate = revisionsOf(id).find((row) => row.state === 'candidate');
        expect(candidate.snapshot.connectors).toEqual([{ provider: 'fake', tools: [READ] }]);

        await call(ctrl.promoteRevision, req(OWNER, { params: { id, n: String(candidate.n) } }));
        expect(agentRow(id).connectors).toEqual([{ provider: 'fake', tools: [READ] }]);
    });

    it('is refused for a member who did not make the agent', async () => {
        const id = await approvedMemberAgent();
        const r = await update(OUTSIDER, id, { connectors: [{ provider: 'fake', tools: [READ] }] });
        expect(r.code).toBe(403);
        expect(agentRow(id).connectors).toEqual([]);
    });
});

describe('the apps offered for ticking', () => {
    const list = (uid, over) => call(ctrl.getConnectors, req(uid, over));

    it('are the workspace\'s offered apps with their turned-on reads and writes', async () => {
        const r = await list(INSIDER);
        expect(r.body.data.providers).toEqual([{
            provider: 'fake', name: 'Fake',
            tools: [
                expect.objectContaining({ key: READ, kind: 'read', label: 'Connectors.tool.fakeNotesList' }),
                expect.objectContaining({ key: WRITE, kind: 'write', label: 'Connectors.tool.fakeNotesCreate' }),
            ],
        }]);
    });

    it('are none while the app is switched off, or the workspace has no app for it', async () => {
        process.env.CONNECTORS = '';
        expect((await list(OWNER)).body.data.providers).toEqual([]);
        process.env.CONNECTORS = 'fake';
        apps.companyProviders.mockResolvedValueOnce([]);
        expect((await list(OWNER)).body.data.providers).toEqual([]);
    });

    it('are not listed to an agent', async () => {
        const r = await list(OWNER, { apiToken: { _id: 't1', kind: 'agent', userId: OWNER, name: 'Claude' } });
        expect(r.code).toBe(403);
    });
});
