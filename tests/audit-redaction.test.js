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

/* Erasure by person redacts the person's personal fields in audit rows. Those fields sit outside the hash,
 * so every chain still verifies, and the redaction is recorded as one new chained row. */

const CID = '6f00000000000000000000c7';
const OTHER_CID = '6f00000000000000000000c8';
const KEY = 'test-audit-chain-key-0123456789abcdef';
const ALICE = '6f0000000000000000000011';
const BOB = '6f0000000000000000000012';
const ADMIN = '6f0000000000000000000001';
const ALICE_EMAIL = 'alice@example.com';
const AGENT = '6f0000000000000000000a01';

let rules;
let redactRules;
let chain;
let recorder;
let agentAudit;
let redact;
const loaded = [];

const load = () => {
    jest.resetModules();
    rules = require('../Modules/Audit/helpers/chainRules');
    redactRules = require('../Modules/Audit/helpers/redactRules');
    chain = require('../Modules/Audit/chain');
    recorder = require('../Modules/Audit/recorder');
    agentAudit = require('../Modules/Agents/agentAudit');
    redact = require('../Modules/Audit/redact');
    loaded.push(chain);
};

const rowsOf = (companyId = CID) => mockDbFor(companyId).store[SCHEMA_TYPE.AUDIT_LOGS] || [];
const byAction = (action, companyId = CID) => rowsOf(companyId).filter((r) => r.action === action);
const one = (action, companyId = CID) => byAction(action, companyId)[0];
const snapshot = (companyId = CID) => JSON.parse(JSON.stringify(rowsOf(companyId)));
const hashedOf = (companyId, row) => rules.canonical(rules.hashedContent(companyId, row));
const settle = async () => { for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setImmediate(resolve)); };
const withCrud = async (companyId, override, fn) => {
    const crud = mockDbFor(companyId).crud;
    const real = crud.getMockImplementation();
    crud.mockImplementation((id, query, method) => override(id, query, method, () => real(id, query, method)));
    try {
        return await fn();
    } finally {
        crud.mockImplementation(real);
    }
};

const personalAgent = { kind: 'agent', userId: ALICE, personName: 'Alice Doe', provider: 'Claude', agentId: AGENT, agentName: 'Claude', runId: null, viaAccount: 'personal' };
const workspaceAgent = { kind: 'agent', userId: ALICE, agentId: AGENT, agentName: 'Reviewer', runId: '6f0000000000000000000c01', viaAccount: 'workspace' };

/* One row of every shape that can carry Alice's personal data, and rows of Bob's that must not change. */
const writeRows = async (companyId = CID) => {
    await chain.saveAuditRow(companyId, { actorId: ALICE, actorName: 'Alice Doe', action: 'member.update', entityType: 'member', entityId: BOB, entityName: 'Bob Roe', meta: { fields: ['role'] }, ip: '10.0.0.7' });
    await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'scim.user_provision', entityType: 'member', entityId: ALICE, entityName: ALICE_EMAIL, meta: {}, ip: '10.0.0.1' });
    await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'pto.create', entityType: 'pto', entityId: 'p1', entityName: '', meta: { target: { userId: ALICE, email: ALICE_EMAIL, userAgent: 'Firefox' }, userId: BOB }, ip: '10.0.0.1' });
    await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'member.invite', entityType: 'invite', entityId: 'i1', entityName: 'Invite', meta: { invited: [{ email: ALICE_EMAIL.toUpperCase() }, { email: 'bob@example.com' }] }, ip: '10.0.0.1' });
    await chain.saveAuditRow(companyId, { actorId: BOB, actorName: 'Bob Roe', action: 'invoice.create', entityType: 'invoice', entityId: 'inv1', entityName: 'INV-1', meta: { total: 3 }, ip: '10.0.0.9' });
    const personal = await agentAudit.openAction(companyId, personalAgent, { action: 'task.comment', reason: 'asked', params: { taskId: 't1' }, entityType: 'task', entityId: 't1', entityName: 'Fix the door', ip: '10.0.0.7' });
    await agentAudit.openAction(companyId, workspaceAgent, { action: 'task.comment', reason: 'asked', params: { taskId: 't2' }, entityType: 'task', entityId: 't2', entityName: 'Oil the hinge', ip: '10.0.0.7' });
    const member = await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'member.update', entityType: 'member', entityId: ALICE, entityName: '', meta: {}, ip: '10.0.0.1' });
    await chain.amend(companyId, String(member._id), { entityName: 'Alice Doe' });
    return { personal };
};

beforeEach(() => {
    Object.keys(mockDbs).forEach((key) => delete mockDbs[key]);
    process.env.AUDIT_CHAIN = 'true';
    process.env.AUDIT_CHAIN_KEY = KEY;
    load();
    mockDbFor('global').seed(SCHEMA_TYPE.USERS, { _id: ALICE, Employee_Name: 'Alice Doe', Employee_Email: ALICE_EMAIL });
    const schemas = require('../utils/mongo-handler/createSchema');
    [CID, OTHER_CID].forEach((id) => {
        mockDbFor(id).uniqueFromSchema(SCHEMA_TYPE.AUDIT_LOGS, schemas.auditLogsSchema);
        mockDbFor(id).unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
    });
    mockDbFor('global').unique(SCHEMA_TYPE.AUDIT_CHAIN_HEADS, ['_id']);
});

afterEach(async () => {
    await Promise.all(loaded.splice(0).map((instance) => instance.flushMirrors()));
});

afterAll(() => {
    delete process.env.AUDIT_CHAIN;
    delete process.env.AUDIT_CHAIN_KEY;
});

describe('the pseudonym', () => {
    it('is stable per person, keyed, and names no id', () => {
        const a = redact.pseudonymOf(ALICE);
        expect(a).toMatch(/^erased-user-[0-9a-f]{16}$/);
        expect(redact.pseudonymOf(ALICE)).toBe(a);
        expect(redact.pseudonymOf(BOB)).not.toBe(a);
        expect(a).not.toContain(ALICE);
        process.env.AUDIT_CHAIN_KEY = `${KEY}-other`;
        expect(redact.pseudonymOf(ALICE)).not.toBe(a);
    });
});

describe('redacting a person under AUDIT_CHAIN', () => {
    it('replaces the person\'s personal fields in every row type and nothing of anyone else\'s', async () => {
        await writeRows();
        const result = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'knowledge.erase_person' });
        const alias = redact.pseudonymOf(ALICE);

        const [own] = byAction('member.update').filter((r) => r.actorId === ALICE);
        expect(own).toMatchObject({ actorName: alias, ip: alias, entityName: 'Bob Roe' });

        expect(one('scim.user_provision')).toMatchObject({ entityName: alias, actorName: 'Ada Admin', ip: '10.0.0.1' });

        const pto = one('pto.create');
        expect(pto.meta.target).toEqual({ userId: ALICE, email: alias, userAgent: alias });
        expect(pto.actorName).toBe('Ada Admin');

        expect(one('member.invite').meta.invited).toEqual([{ email: alias }, { email: 'bob@example.com' }]);
        expect(one('invoice.create')).toMatchObject({ actorName: 'Bob Roe', entityName: 'INV-1', ip: '10.0.0.9' });

        const [personal, onBehalf] = byAction('agent.action');
        expect(personal).toMatchObject({ actorId: ALICE, actorName: alias, ip: alias, entityName: 'Fix the door' });
        expect(onBehalf).toMatchObject({ actorId: AGENT, actorName: 'Reviewer', ip: alias, entityName: 'Oil the hinge' });

        const amendment = one(rules.AMENDED_ACTION);
        expect(amendment.meta.setRow.entityName).toBe(alias);
        const folded = await chain.readForList(CID, [amendment.meta.amends]);
        expect(folded[0].entityName).toBe(alias);

        expect(JSON.stringify(rowsOf(CID).filter((r) => r.action !== redact.REDACTED_ACTION))).not.toMatch(/Alice Doe|alice@example\.com|10\.0\.0\.7|Firefox/i);
        expect(result).toMatchObject({ rows: 7, fields: 10, pseudonym: alias });
    });

    it('leaves every hashed field as it was, so the chain verifies before and after', async () => {
        await writeRows();
        const before = await chain.verifyChain(CID);
        expect(before.state).toBe('verified');
        const hashed = new Map(rowsOf(CID).map((r) => [String(r._id), { content: hashedOf(CID, r), link: { ...r.chain } }]));

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        rowsOf(CID).filter((r) => hashed.has(String(r._id))).forEach((r) => {
            expect(hashedOf(CID, r)).toBe(hashed.get(String(r._id)).content);
            expect(r.chain).toEqual(hashed.get(String(r._id)).link);
        });
        const after = await chain.verifyChain(CID);
        expect(after).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: before.verifiedThrough + 1 });
        const listed = await chain.annotateRows(CID, rowsOf(CID).filter((r) => r.action !== rules.AMENDED_ACTION), { integrity: true });
        listed.forEach((r) => expect(r.integrity).toEqual({ state: 'verified' }));
    });

    it('records the redaction as one new chained row: who, when, counts and reason', async () => {
        await writeRows();
        const tip = Math.max(...rowsOf(CID).map((r) => r.chain.seq));
        const result = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'knowledge.erase_person' });

        const recorded = byAction(redact.REDACTED_ACTION);
        expect(recorded).toHaveLength(1);
        const alias = redact.pseudonymOf(ALICE);
        expect(recorded[0]).toMatchObject({
            actorId: ADMIN, entityType: 'user', entityId: alias, entityName: alias,
            meta: { reason: 'knowledge.erase_person', rows: 7, fields: 10 },
            chain: { seq: tip + 1 },
        });
        expect(recorded[0].createdAt).toBeInstanceOf(Date);
        expect(JSON.stringify(recorded[0])).not.toContain(ALICE);
        expect(result.recorded).toBe(String(recorded[0]._id));
    });

    it('changes nothing on a second run and records no second row', async () => {
        await writeRows();
        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const before = snapshot();

        const again = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(again).toMatchObject({ rows: 0, fields: 0, recorded: null });
        expect(snapshot()).toEqual(before);
    });

    it('leaves another company\'s rows alone', async () => {
        await writeRows(CID);
        await writeRows(OTHER_CID);
        const other = snapshot(OTHER_CID);

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(snapshot(OTHER_CID)).toEqual(other);
        expect(await chain.verifyChain(OTHER_CID)).toMatchObject({ state: 'verified' });
        expect(mockDbFor(OTHER_CID).calls.filter((c) => c.method === 'updateOne' && c.type === SCHEMA_TYPE.AUDIT_LOGS)).toHaveLength(0);
    });

    it('resumes from its progress marker after failing partway, and records one row with the full counts', async () => {
        await writeRows();
        let updates = 0;
        const failed = await withCrud(CID, (id, query, method, real) => {
            if (query.type === SCHEMA_TYPE.AUDIT_LOGS && method === 'updateOne' && (updates += 1) > 3) throw new Error('connection lost');
            return real();
        }, () => redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure', batchSize: 3 }).catch((e) => e));
        expect(failed).toBeInstanceOf(Error);
        expect(byAction(redact.REDACTED_ACTION)).toHaveLength(0);
        const marker = (mockDbFor(CID).store[SCHEMA_TYPE.AUDIT_REDACTIONS] || [])[0];
        expect(marker).toMatchObject({ _id: redact.pseudonymOf(ALICE), rows: 3 });
        expect(marker.after).toBeTruthy();

        mockDbFor(CID).calls.length = 0;
        const resumed = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure', batchSize: 3 });

        expect(resumed).toMatchObject({ rows: 7, fields: 10 });
        const firstRead = mockDbFor(CID).calls.find((c) => c.type === SCHEMA_TYPE.AUDIT_LOGS && c.method === 'find');
        expect(firstRead.data[0]).toEqual({ _id: { $gt: expect.anything() } });
        expect(byAction(redact.REDACTED_ACTION)).toHaveLength(1);
        expect(one(redact.REDACTED_ACTION).meta).toMatchObject({ rows: 7, fields: 10 });
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified' });
    });

    it('refuses to write a path that is inside the hash', async () => {
        await writeRows();
        const before = snapshot();
        jest.spyOn(redactRules, 'personalPaths').mockImplementation((row) => [{ path: 'action', value: row.action }]);

        await expect(redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' })).rejects.toThrow(/inside the hash/);

        expect(snapshot()).toEqual(before);
    });

    it('shows the pseudonym in the audit export', async () => {
        await writeRows();
        mockDbFor(CID).seed(SCHEMA_TYPE.COMPANY_USERS, { userId: ADMIN, roleType: 1, status: 2, isDelete: false });
        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const ctrl = require('../Modules/Audit/controller');
        const chunks = [];
        const res = { headers: {} };
        res.status = () => res;
        res.json = (b) => { res.body = b; return res; };
        res.setHeader = (k, v) => { res.headers[k] = v; };
        res.write = (b) => { chunks.push(String(b)); return true; };
        res.end = (b) => { if (b) chunks.push(String(b)); };
        await ctrl.exportAuditCsv({ uid: ADMIN, headers: { companyid: CID }, query: {}, body: {} }, res);
        const csv = chunks.join('');
        const alias = redact.pseudonymOf(ALICE);
        expect(res.body).toBeUndefined();
        expect(csv).toContain(alias);
        expect(csv).not.toMatch(/Alice Doe|alice@example\.com/i);
        csv.split('\n').slice(1).forEach((line) => expect(line).toMatch(/,verified$/));
    });
});

describe('redacting a person with AUDIT_CHAIN off', () => {
    beforeEach(() => {
        process.env.AUDIT_CHAIN = 'false';
        delete process.env.AUDIT_CHAIN_KEY;
        load();
    });

    it('redacts plain rows the same way and records a plain row', async () => {
        recorder.recordAudit(CID, { actorId: ALICE, actorName: 'Alice Doe', action: 'member.update', entityType: 'member', entityId: BOB, ip: '10.0.0.7' });
        recorder.recordAudit(CID, { actorId: ADMIN, actorName: 'Ada Admin', action: 'scim.user_provision', entityType: 'member', entityId: ALICE, entityName: ALICE_EMAIL });
        await settle();

        const result = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        const alias = redact.pseudonymOf(ALICE);
        expect(alias).toMatch(/^erased-user-[0-9a-f]{16}$/);
        expect(one('member.update')).toMatchObject({ actorName: alias, ip: alias });
        expect(one('scim.user_provision')).toMatchObject({ entityName: alias, actorName: 'Ada Admin' });
        expect(result).toMatchObject({ rows: 2, fields: 3 });
        const recorded = one(redact.REDACTED_ACTION);
        expect(recorded).toMatchObject({ actorId: ADMIN, meta: { rows: 2, fields: 3, reason: 'erasure' } });
        expect(recorded.chain).toBeUndefined();
    });
});
