const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({
    getRoleType: jest.fn(async (companyId, uid) => ({ '6f0000000000000000000a01': 1, '6f0000000000000000000a02': 2, '6f0000000000000000000a03': 3 }[uid] ?? null)),
    isPrivileged: (r) => r === 1 || r === 2,
}));
jest.mock('../Modules/Agents/actor', () => ({
    resolveActor: jest.fn(async (req) => (req.agent ? { kind: 'agent', userId: req.uid, agentId: 'a1' } : { kind: 'human', userId: req.uid })),
    isAgent: (a) => a.kind === 'agent',
}));
jest.mock('../Modules/Agents/scope', () => ({ visibleProjectIds: jest.fn(async () => ['6f0000000000000000000701']) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { removeCache } = require('../utils/commonFunctions');
const persistence = require('../Modules/Agents/engine/persistence');
const memory = require('../Modules/Agents/memory');
const ctrl = require('../Modules/Agents/memoryController');

const C = '6f0000000000000000000c01';
const P = '6f0000000000000000000701';
const HIDDEN = '6f0000000000000000000702';
const OWNER = '6f0000000000000000000a01';
const ADMIN = '6f0000000000000000000a02';
const MEMBER = '6f0000000000000000000a03';
const STRANGER = '6f0000000000000000000a09';

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const req = (over = {}) => ({ headers: { companyid: C }, params: {}, query: {}, body: {}, uid: OWNER, ...over });
const call = async (handler, over) => { const r = res(); await handler(req(over), r); return r; };
const addConstraint = (text = 'Must use Shopify.', over = {}) => call(ctrl.addProjectMemory, { params: { projectId: P }, body: { kind: 'project.constraint', text }, ...over });
const putRow = (id, body, over = {}) => call(ctrl.updateMemory, { params: { id: encodeURIComponent(id) }, body: { scopeId: P, ...body }, ...over });

let mem;
beforeEach(() => {
    mem = persistence.useInMemory();
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: P, ProjectName: 'Bike shop', aiGuide: { markdown: '## Stages' }, aiAssumptions: [{ point: 'team', text: 'Owner alone.' }], deletedStatusKey: 0 });
});
afterEach(() => { mem.reset(); persistence.useMongo(); });

describe('GET /agents/memory/project/:projectId', () => {
    it('answers guide, assumptions, rows and episodes to a member, with canEdit only for owner/admin', async () => {
        await addConstraint();
        await memory.recordEpisode({ companyId: C, projectId: P, runId: 'r1', patch: { skill: 'qa-review', proposed: 2 } });
        const r = await call(ctrl.getProjectMemory, { params: { projectId: P }, uid: MEMBER });
        expect(r.code).toBe(200);
        expect(r.body.status).toBe(true);
        expect(r.body.data).toMatchObject({ projectName: 'Bike shop', guide: { markdown: '## Stages' }, assumptions: [{ point: 'team', text: 'Owner alone.' }], canEdit: false });
        expect(r.body.data.rows).toEqual([expect.objectContaining({ id: 'project.constraint:must-use-shopify', kind: 'project.constraint', text: 'Must use Shopify.', status: 'active', occurrences: 1, source: { origin: 'owner', userId: OWNER } })]);
        expect(r.body.data.episodes).toEqual([expect.objectContaining({ runId: 'r1', skill: 'qa-review', summary: 'proposed 2' })]);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: P }, uid: ADMIN })).body.data.canEdit).toBe(true);
    });

    it('refuses a non-member, a missing user, a foreign company, a bad id and a project the caller cannot see', async () => {
        expect((await call(ctrl.getProjectMemory, { params: { projectId: P }, uid: STRANGER })).code).toBe(403);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: P }, uid: null })).code).toBe(401);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: P }, headers: { companyid: 'nope' } })).code).toBe(403);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: P }, aud: ['6f0000000000000000000c02'] })).code).toBe(403);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: 'p1' } })).code).toBe(400);
        expect((await call(ctrl.getProjectMemory, { params: { projectId: HIDDEN } })).code).toBe(404);
    });
});

describe('POST /agents/memory/project/:projectId', () => {
    it('lets an owner or admin add a decision or constraint, sourced to them', async () => {
        const r = await addConstraint();
        expect(r.code).toBe(200);
        expect(r.body.data).toMatchObject({ id: 'project.constraint:must-use-shopify', kind: 'project.constraint', text: 'Must use Shopify.', status: 'active', source: { origin: 'owner', userId: OWNER } });
        const d = await call(ctrl.addProjectMemory, { params: { projectId: P }, body: { kind: 'project.decision', text: 'Ship the catalogue first.' }, uid: ADMIN });
        expect(d.body.data).toMatchObject({ id: 'project.decision:ship-the-catalogue-first', source: { userId: ADMIN } });
        expect(await memory.contextFor({ companyId: C, projectId: P })).toContain('- Must use Shopify. (added by the owner)');
    });

    it('refuses a member, an agent, a bad kind, empty text, and a project the caller cannot see', async () => {
        expect((await addConstraint('x', { uid: MEMBER })).code).toBe(403);
        expect((await addConstraint('x', { agent: true })).code).toBe(403);
        const kind = await call(ctrl.addProjectMemory, { params: { projectId: P }, body: { kind: 'user.preference', text: 'x' } });
        expect(kind.code).toBe(400);
        expect(kind.body.statusText).toMatch(/kind must be one of project.decision, project.constraint/);
        expect((await addConstraint('   ')).code).toBe(400);
        expect((await addConstraint('x', { params: { projectId: HIDDEN } })).code).toBe(404);
        expect((await memory.listProject({ companyId: C, projectId: P })).rows).toEqual([]);
    });

    it('answers 409 for a row already active, but lets a retired one come back', async () => {
        await addConstraint();
        const dup = await addConstraint('must use   SHOPIFY');
        expect(dup.code).toBe(409);
        expect(dup.body.statusText).toBe('This is already on record.');
        await putRow('project.constraint:must-use-shopify', { status: 'retired' });
        const back = await addConstraint();
        expect(back.code).toBe(200);
        expect(back.body.data).toMatchObject({ status: 'active', occurrences: 2 });
    });
});

describe('PUT /agents/memory/:id', () => {
    beforeEach(() => addConstraint());

    it('lets an owner edit the text and retire a project row', async () => {
        const edited = await putRow('project.constraint:must-use-shopify', { text: 'Must use Shopify for checkout.' });
        expect(edited.code).toBe(200);
        expect(edited.body.data).toMatchObject({ id: 'project.constraint:must-use-shopify', text: 'Must use Shopify for checkout.', status: 'active' });
        const retired = await putRow('project.constraint:must-use-shopify', { status: 'retired' });
        expect(retired.body.data.status).toBe('retired');
        expect(await memory.contextFor({ companyId: C, projectId: P })).toBe('');
    });

    it('refuses a member, an agent, a bad scope, a bad status, an empty patch, a malformed id and a hidden project', async () => {
        expect((await putRow('project.constraint:must-use-shopify', { text: 'x' }, { uid: MEMBER })).code).toBe(403);
        expect((await putRow('project.constraint:must-use-shopify', { text: 'x' }, { agent: true })).code).toBe(403);
        expect((await putRow('project.constraint:must-use-shopify', { scopeId: 'p1', text: 'x' })).code).toBe(400);
        const status = await putRow('project.constraint:must-use-shopify', { status: 'deleted' });
        expect(status.code).toBe(400);
        expect(status.body.statusText).toMatch(/status must be one of active, retired/);
        expect((await putRow('project.constraint:must-use-shopify', { text: '  ' })).code).toBe(400);
        expect((await putRow('project.constraint:must-use-shopify', {})).code).toBe(400);
        expect((await putRow('garbage', { text: 'x' })).code).toBe(400);
        expect((await putRow('project.constraint:missing', { text: 'x' })).code).toBe(404);
        expect((await putRow('project.constraint:must-use-shopify', { scopeId: HIDDEN, text: 'x' })).code).toBe(404);
    });

    it('lets a person accept or dismiss their own candidate preference, and nobody else\'s', async () => {
        for (let i = 0; i < 3; i++) await memory.preferenceCandidate({ companyId: C, userId: MEMBER, reasonKey: 'too_many_changes' }); // eslint-disable-line no-await-in-loop
        expect((await putRow('user.preference:too_many_changes', { scopeId: MEMBER, status: 'active' }, { uid: OWNER })).code).toBe(404);
        const accepted = await putRow('user.preference:too_many_changes', { scopeId: MEMBER, status: 'active' }, { uid: MEMBER });
        expect(accepted.code).toBe(200);
        expect(accepted.body.data).toMatchObject({ id: 'user.preference:too_many_changes', status: 'active', count: 3 });
        expect(await memory.contextFor({ companyId: C, userId: MEMBER })).toContain('- Prefers fewer changes per proposal');
        expect((await call(ctrl.getPreferences, { uid: MEMBER })).body.data.candidates).toEqual([]);
        expect((await putRow('user.preference:too_many_changes', { scopeId: MEMBER, status: 'retired' }, { uid: MEMBER })).body.data.status).toBe('retired');
        expect((await putRow('user.preference:nothing', { scopeId: MEMBER, status: 'active' }, { uid: MEMBER })).code).toBe(404);
    });
});

describe('GET /agents/preferences', () => {
    it('answers the defaults, with notify read from the notification settings', async () => {
        expect((await call(ctrl.getPreferences)).body).toEqual({ status: true, statusText: 'OK', data: { tone: null, reviewDepth: null, notify: true, candidates: [] } });
        mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: OWNER, agentActivity: false });
        expect((await call(ctrl.getPreferences)).body.data.notify).toBe(false);
        expect((await call(ctrl.getPreferences, { uid: STRANGER })).code).toBe(403);
    });

    it('lists candidate preferences from repeated declines', async () => {
        for (let i = 0; i < 3; i++) await memory.preferenceCandidate({ companyId: C, userId: OWNER, reasonKey: 'not_now' }); // eslint-disable-line no-await-in-loop
        await memory.preferenceCandidate({ companyId: C, userId: OWNER, reasonKey: 'wrong_tone' });
        expect((await call(ctrl.getPreferences)).body.data.candidates).toEqual([{ id: 'user.preference:not_now', key: 'not_now', text: 'Prefers proposals batched, not one at a time', count: 3 }]);
        expect((await call(ctrl.getPreferences, { uid: MEMBER })).body.data.candidates).toEqual([]);
    });
});

describe('PUT /agents/preferences', () => {
    it('validates every enum and says why', async () => {
        const tone = await call(ctrl.putPreferences, { body: { tone: 'loud' } });
        expect(tone.code).toBe(400);
        expect(tone.body.statusText).toBe('tone must be one of concise, detailed or null.');
        const depth = await call(ctrl.putPreferences, { body: { reviewDepth: 'all' } });
        expect(depth.code).toBe(400);
        expect(depth.body.statusText).toBe('reviewDepth must be one of summary, every_change or null.');
        const notify = await call(ctrl.putPreferences, { body: { notify: 'yes' } });
        expect(notify.code).toBe(400);
        expect(notify.body.statusText).toBe('notify must be true or false.');
        expect((await call(ctrl.putPreferences, { body: {} })).code).toBe(400);
        expect((await call(ctrl.putPreferences, { body: { tone: 'concise' }, agent: true })).code).toBe(403);
        expect((await call(ctrl.putPreferences, { body: { tone: 'concise' }, uid: STRANGER })).code).toBe(403);
        expect((await call(ctrl.getPreferences)).body.data).toEqual({ tone: null, reviewDepth: null, notify: true, candidates: [] });
    });

    it('stores the caller\'s own tone, review depth and notify, mirroring notify onto the notification settings', async () => {
        mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, { userId: OWNER, agentActivity: true });
        const r = await call(ctrl.putPreferences, { body: { tone: 'concise', reviewDepth: 'summary', notify: false } });
        expect(r.code).toBe(200);
        expect(r.body.data).toEqual({ tone: 'concise', reviewDepth: 'summary', notify: false, candidates: [] });
        expect(mockDb.store[SCHEMA_TYPE.NOTIFICATIONS_SETTINGS][0].agentActivity).toBe(false);
        expect(removeCache).toHaveBeenCalledWith(`notification:${OWNER}:${C}`);
        expect(await memory.contextFor({ companyId: C, userId: OWNER })).toBe(`${memory.HEADER}\nPreferences of the person you are working with:\n- Prefers concise output.\n- Wants a summary of the changes, not every one.`);
        expect((await call(ctrl.getPreferences, { uid: MEMBER })).body.data).toEqual({ tone: null, reviewDepth: null, notify: true, candidates: [] });

        const cleared = await call(ctrl.putPreferences, { body: { tone: null } });
        expect(cleared.body.data).toEqual({ tone: null, reviewDepth: 'summary', notify: false, candidates: [] });
        expect(await memory.contextFor({ companyId: C, userId: OWNER })).not.toContain('Prefers concise');
    });
});
