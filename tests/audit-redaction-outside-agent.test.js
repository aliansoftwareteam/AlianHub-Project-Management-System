const mockDbs = {};
const mockDbFor = (companyId) => {
    const id = String(companyId);
    if (!mockDbs[id]) mockDbs[id] = require('./fixtures/fakeMongo').create();
    return mockDbs[id];
};

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDbFor(companyId).crud(companyId, q, method),
}));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));

const { SCHEMA_TYPE } = require('../Config/schemaType');

/* An outside client's row names the client as actor and the person it acts for inside actorName. */

const CID = '6f00000000000000000000d7';
const KEY = 'test-audit-chain-key-0123456789abcdef';
const ALICE = '6f0000000000000000000021';
const BOB = '6f0000000000000000000022';
const ADMIN = '6f0000000000000000000002';
const CLIENT = 'ahc_coder0001';

let rules;
let chain;
let agentAudit;
let recorder;
let redact;
const loaded = [];

const load = () => {
    jest.resetModules();
    rules = require('../Modules/Audit/helpers/chainRules');
    chain = require('../Modules/Audit/chain');
    recorder = require('../Modules/Audit/recorder');
    agentAudit = require('../Modules/Agents/agentAudit');
    redact = require('../Modules/Audit/redact');
    loaded.push(chain);
};

const rowsOf = () => mockDbFor(CID).store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const byId = (id) => rowsOf().find((r) => String(r._id) === String(id));
const hashedOf = (row) => rules.canonical(rules.hashedContent(CID, row));
const settle = async () => { for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

const outsideClient = (userId, personName) => ({
    kind: 'agent', userId, tokenId: null, tokenName: null, runId: null, agentId: null, agentName: 'Coder',
    viaAccount: 'external', provider: null, personName, projectIds: [], clientId: CLIENT, grantId: `grant-${userId}`, delegatedBy: userId,
});

const writeRows = async () => {
    const alices = await agentAudit.openAction(CID, outsideClient(ALICE, 'Alice Doe'), { action: 'task.comment', reason: 'asked', params: { taskId: 't1' }, entityType: 'task', entityId: 't1', entityName: 'Fix the door', ip: '10.0.0.7' });
    const bobs = await agentAudit.openAction(CID, outsideClient(BOB, 'Bob Roe'), { action: 'task.comment', reason: 'asked', params: { taskId: 't2' }, entityType: 'task', entityId: 't2', entityName: 'Oil the hinge', ip: '10.0.0.9' });
    const own = await chain.saveAuditRow(CID, { actorId: ALICE, actorName: 'Alice Doe', action: 'task.update', entityType: 'task', entityId: 't3', entityName: 'Paint the fence', meta: {}, ip: '10.0.0.7' });
    const system = await chain.saveAuditRow(CID, { actorId: 'system', actorName: 'Agent sessions', action: 'agent_session.expired', entityType: 'task', entityId: 't1', entityName: 'Fix the door', meta: { sessionId: 's1', clientId: CLIENT, grantId: `grant-${ALICE}`, delegatedBy: ALICE } });
    return { alices: String(alices), bobs: String(bobs), own: String(own._id), system: String(system._id) };
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    process.env.AUDIT_CHAIN = 'true';
    process.env.AUDIT_CHAIN_KEY = KEY;
    load();
    mockDbFor('global').seed(SCHEMA_TYPE.USERS, { _id: ALICE, Employee_Name: 'Alice Doe', Employee_Email: 'alice@example.com' });
    const schemas = require('../utils/mongo-handler/createSchema');
    mockDbFor(CID).uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
    mockDbFor(CID).unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
    mockDbFor('global').unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
});

afterEach(async () => {
    await Promise.all(loaded.splice(0).map((instance) => instance.flushMirrors()));
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('erasing a person who delegated to an outside client', () => {
    it('removes the person\'s name from the outside client\'s rows', async () => {
        const ids = await writeRows();
        expect(byId(ids.alices)).toMatchObject({ actorId: CLIENT, actorName: 'Coder for Alice Doe' });

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const alias = redact.pseudonymOf(ALICE);

        const row = byId(ids.alices);
        expect(row).toMatchObject({ actorId: CLIENT, actorName: alias, ip: alias, entityName: 'Fix the door' });
        expect(row.meta).toMatchObject({ agentName: 'Coder', clientId: CLIENT, delegatedBy: ALICE, onBehalfOf: ALICE });
        expect(JSON.stringify(rowsOf().filter((r) => r.action !== redact.REDACTED_ACTION))).not.toMatch(/Alice Doe/);
    });

    it('leaves the chain verifying and every hashed field unchanged', async () => {
        await writeRows();
        const before = await chain.verifyChain(CID);
        expect(before.state).toBe('verified');
        const hashed = new Map(rowsOf().map((r) => [String(r._id), hashedOf(r)]));

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        rowsOf().filter((r) => hashed.has(String(r._id))).forEach((r) => expect(hashedOf(r)).toBe(hashed.get(String(r._id))));
        const after = await chain.verifyChain(CID);
        expect(after).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: before.verifiedThrough + 1 });
    });

    it('leaves a row the same client wrote for someone else untouched', async () => {
        const ids = await writeRows();
        const bobs = JSON.parse(JSON.stringify(byId(ids.bobs)));

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(JSON.parse(JSON.stringify(byId(ids.bobs)))).toEqual(bobs);
        expect(byId(ids.bobs)).toMatchObject({ actorName: 'Coder for Bob Roe', ip: '10.0.0.9' });
    });

    it('treats ordinary rows as before: the person\'s own row is redacted, a system row that names no one is kept', async () => {
        const ids = await writeRows();

        const result = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const alias = redact.pseudonymOf(ALICE);

        expect(byId(ids.own)).toMatchObject({ actorName: alias, ip: alias, entityName: 'Paint the fence' });
        expect(byId(ids.system)).toMatchObject({ actorId: 'system', actorName: 'Agent sessions', entityName: 'Fix the door' });
        expect(result).toMatchObject({ rows: 2, fields: 4 });
    });

    it('finds nothing on a second run', async () => {
        await writeRows();
        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const again = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        expect(again).toMatchObject({ rows: 0, fields: 0, recorded: null });
    });

    it('covers plain rows with AUDIT_CHAIN off', async () => {
        process.env.AUDIT_CHAIN = 'false';
        load();
        const outside = await agentAudit.openAction(CID, outsideClient(ALICE, 'Alice Doe'), { action: 'task.comment', reason: 'asked', params: {}, entityType: 'task', entityId: 't1', entityName: 'Fix the door' });
        recorder.recordAudit(CID, { actorId: BOB, actorName: 'Bob Roe', action: 'task.update', entityType: 'task', entityId: 't2' });
        await settle();

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(byId(outside).actorName).toBe(redact.pseudonymOf(ALICE));
        expect(rowsOf().find((r) => r.actorId === BOB).actorName).toBe('Bob Roe');
    });
});
