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
const markers = (companyId = CID) => mockDbFor(companyId).store[SCHEMA_TYPE.AUDIT_REDACTIONS] || [];
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

    it('resumes from its progress marker after failing mid-batch, and records one row with the full counts', async () => {
        await writeRows();
        let updates = 0;
        const failed = await withCrud(CID, (id, query, method, real) => {
            if (query.type === SCHEMA_TYPE.AUDIT_LOGS && method === 'updateOne' && (updates += 1) > 4) throw new Error('connection lost');
            return real();
        }, () => redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure', batchSize: 3 }).catch((e) => e));
        expect(failed).toBeInstanceOf(Error);
        expect(byAction(redact.REDACTED_ACTION)).toHaveLength(0);
        const marker = markers()[0];
        expect(marker).toMatchObject({ _id: redact.pseudonymOf(ALICE), rows: 4 });
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

    it('counts a row whose redaction landed just before a crash, on the next run', async () => {
        await writeRows();
        let crashed = false;
        const failed = await withCrud(CID, (id, query, method, real) => {
            if (!crashed && query.type === SCHEMA_TYPE.AUDIT_REDACTIONS && method === 'updateOne' && query.data[1].$set.rows === 2) {
                crashed = true;
                throw new Error('process killed');
            }
            return real();
        }, () => redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure', batchSize: 3 }).catch((e) => e));
        expect(failed).toBeInstanceOf(Error);
        expect(rowsOf().find((r) => r.action === 'scim.user_provision').entityName).toBe(redact.pseudonymOf(ALICE));

        const resumed = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure', batchSize: 3 });

        expect(resumed).toMatchObject({ rows: 7, fields: 10 });
        expect(one(redact.REDACTED_ACTION).meta).toMatchObject({ rows: 7, fields: 10 });
    });

    it('writes no second row when a crash falls between recording the row and finishing the marker', async () => {
        await writeRows();
        const failed = await withCrud(CID, (id, query, method, real) => {
            if (query.type === SCHEMA_TYPE.AUDIT_REDACTIONS && method === 'updateOne' && query.data[1].$set.finishedAt) throw new Error('process killed');
            return real();
        }, () => redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' }).catch((e) => e));
        expect(failed).toBeInstanceOf(Error);
        const [first] = byAction(redact.REDACTED_ACTION);
        expect(first).toBeTruthy();

        const again = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(byAction(redact.REDACTED_ACTION)).toHaveLength(1);
        expect(again).toMatchObject({ rows: 7, fields: 10, recorded: String(first._id) });
        expect(markers()[0].finishedAt).toBeTruthy();
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified' });
    });

    it('lets one of two runs at once proceed and refuses the other with a stable code', async () => {
        await writeRows();
        const results = await Promise.allSettled([
            redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' }),
            redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' }),
        ]);
        const done = results.filter((r) => r.status === 'fulfilled');
        const refused = results.filter((r) => r.status === 'rejected');
        expect(done).toHaveLength(1);
        expect(done[0].value).toMatchObject({ rows: 7, fields: 10 });
        expect(refused).toHaveLength(1);
        expect(refused[0].reason).toMatchObject({ code: 'redaction_running', status: 409 });
        expect(byAction(redact.REDACTED_ACTION)).toHaveLength(1);
    });

    it('refuses while another run holds the lease, and resumes once it has expired', async () => {
        await writeRows();
        const alias = redact.pseudonymOf(ALICE);
        const marker = mockDbFor(CID).seed(SCHEMA_TYPE.AUDIT_REDACTIONS, {
            _id: alias, owner: 'another-server', leaseUntil: new Date(Date.now() + 60000), after: '', rows: 0, fields: 0, startedAt: new Date(), finishedAt: null,
        });
        await expect(redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' })).rejects.toMatchObject({ code: 'redaction_running', status: 409 });
        expect(byAction('member.update').find((r) => r.actorId === ALICE).actorName).toBe('Alice Doe');

        marker.leaseUntil = new Date(Date.now() - 1000);
        const result = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(result).toMatchObject({ rows: 7, fields: 10 });
        expect(markers()[0].finishedAt).toBeInstanceOf(Date);
    });

    it('leaves a row that changed after it was read, and counts only what it wrote', async () => {
        await writeRows();
        let changed = false;
        const result = await withCrud(CID, async (id, query, method, real) => {
            const answer = await real();
            if (!changed && query.type === SCHEMA_TYPE.AUDIT_LOGS && method === 'find') {
                changed = true;
                rowsOf().find((r) => r.actorId === ALICE && r.action === 'member.update').actorName = 'Alice Renamed';
            }
            return answer;
        }, () => redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' }));

        expect(rowsOf().find((r) => r.actorId === ALICE && r.action === 'member.update').actorName).toBe('Alice Renamed');
        expect(result).toMatchObject({ rows: 6, fields: 8 });
        const again = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        expect(again).toMatchObject({ rows: 1, fields: 2 });
    });

    it('takes ownership from an amendment that moves a row\'s entity to the person', async () => {
        const row = await chain.saveAuditRow(CID, { actorId: ADMIN, actorName: 'Ada Admin', action: 'agent.action', entityType: 'task', entityId: 't9', entityName: 'Task nine', meta: {}, ip: '10.0.0.1' });
        await chain.amend(CID, String(row._id), { entityType: 'member', entityId: ALICE, entityName: 'Alice Doe' });

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(one(rules.AMENDED_ACTION).meta.setRow).toEqual({ entityType: 'member', entityId: ALICE, entityName: redact.pseudonymOf(ALICE) });
        expect(one('agent.action')).toMatchObject({ entityName: 'Task nine', actorName: 'Ada Admin' });
        expect(await chain.verifyChain(CID)).toMatchObject({ state: 'verified' });
    });

    it('scopes a userId in meta to the object that carries it, never to the row\'s own fields', async () => {
        await chain.saveAuditRow(CID, {
            actorId: ADMIN, actorName: 'Ada Admin', action: 'pto.create', entityType: 'pto', entityId: 'p2', entityName: '', ip: '10.0.0.1',
            meta: { userId: ALICE, ip: '10.0.0.1', userAgent: 'Admin browser', subject: { userId: ALICE, userAgent: 'Alice browser', detail: { userAgent: 'Admin browser' } } },
        });

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const alias = redact.pseudonymOf(ALICE);
        expect(one('pto.create').meta).toEqual({ userId: ALICE, ip: '10.0.0.1', userAgent: 'Admin browser', subject: { userId: ALICE, userAgent: alias, detail: { userAgent: 'Admin browser' } } });

        await redact.redactPerson(CID, ADMIN, { by: ALICE, reason: 'erasure' });
        const admin = redact.pseudonymOf(ADMIN);
        expect(one('pto.create')).toMatchObject({ actorName: admin, ip: admin });
        expect(one('pto.create').meta).toEqual({ userId: ALICE, ip: admin, userAgent: admin, subject: { userId: ALICE, userAgent: alias, detail: { userAgent: admin } } });
    });

    it('covers member rows that name the member document rather than the user', async () => {
        const MEMBER_DOC = '6f0000000000000000000e11';
        const BOB_DOC = '6f0000000000000000000e12';
        mockDbFor(CID).seed(SCHEMA_TYPE.COMPANY_USERS, { _id: MEMBER_DOC, userId: ALICE, roleType: 3, status: 2 });
        mockDbFor(CID).seed(SCHEMA_TYPE.COMPANY_USERS, { _id: BOB_DOC, userId: BOB, roleType: 3, status: 2 });
        mockDbFor(OTHER_CID).seed(SCHEMA_TYPE.COMPANY_USERS, { _id: BOB_DOC, userId: ALICE, roleType: 3, status: 2 });
        await chain.saveAuditRow(CID, { actorId: ADMIN, actorName: 'Ada Admin', action: 'member.update', entityType: 'member', entityId: MEMBER_DOC, entityName: 'Alice Doe', meta: { fields: ['role'] }, ip: '10.0.0.1' });
        await chain.saveAuditRow(CID, { actorId: ADMIN, actorName: 'Ada Admin', action: 'member.update', entityType: 'member', entityId: BOB_DOC, entityName: 'Bob Roe', meta: {}, ip: '10.0.0.1' });

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        const [alice, bob] = byAction('member.update');
        expect(alice.entityName).toBe(redact.pseudonymOf(ALICE));
        expect(bob.entityName).toBe('Bob Roe');
    });

    it('gives an email to the entity when the entity is a person, and to the actor otherwise', async () => {
        await chain.saveAuditRow(CID, { actorId: ALICE, actorName: '', action: 'member.update', entityType: 'member', entityId: BOB, entityName: '', meta: { email: 'bob.other@example.com' }, ip: '' });
        await chain.saveAuditRow(CID, { actorId: ALICE, actorName: '', action: 'sso.config_update', entityType: 'sso', entityId: '', entityName: '', meta: { email: 'alice.other@example.com' }, ip: '' });

        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        expect(one('member.update').meta.email).toBe('bob.other@example.com');
        expect(one('sso.config_update').meta.email).toBe(redact.pseudonymOf(ALICE));

        await redact.redactPerson(CID, BOB, { by: ADMIN, reason: 'erasure' });
        expect(one('member.update').meta.email).toBe(redact.pseudonymOf(BOB));
    });

    it('changes nothing after the key is rotated, though the person gets a new pseudonym', async () => {
        await writeRows();
        await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });
        const before = snapshot();
        const old = redact.pseudonymOf(ALICE);
        process.env.AUDIT_CHAIN_KEY = `${KEY}-rotated`;

        const again = await redact.redactPerson(CID, ALICE, { by: ADMIN, reason: 'erasure' });

        expect(redact.pseudonymOf(ALICE)).not.toBe(old);
        expect(again).toMatchObject({ rows: 0, fields: 0, recorded: null });
        expect(snapshot()).toEqual(before);
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

    it('keys the pseudonym on JWT_SECRET when there is no chain key', () => {
        const crypto = require('crypto');
        const saved = process.env.JWT_SECRET;
        try {
            process.env.JWT_SECRET = 'jwt-secret-one';
            const expected = `erased-user-${crypto.createHmac('sha256', 'jwt-secret-one').update(`audit-erasure:${ALICE}`).digest('hex').slice(0, 16)}`;
            expect(redact.pseudonymOf(ALICE)).toBe(expected);
            process.env.JWT_SECRET = 'jwt-secret-two';
            expect(redact.pseudonymOf(ALICE)).not.toBe(expected);
        } finally {
            if (saved === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = saved;
        }
    });
});
