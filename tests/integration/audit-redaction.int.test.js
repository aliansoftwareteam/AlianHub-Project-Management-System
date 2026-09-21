const crypto = require('node:crypto');
const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');

/* Erasure by person against a real MongoDB with AUDIT_CHAIN on: the person's personal fields are
 * replaced in every row, no hashed field moves, every chain still verifies, and the redaction is one
 * new chained row. Two tenant databases of their own, named after random ids, so no fixture company
 * and no other suite is touched. */

process.env.MONGODB_URL = resolveMongoUrl();
process.env.AUDIT_CHAIN = 'true';
process.env.AUDIT_CHAIN_KEY = crypto.randomBytes(32).toString('hex');

jest.mock('../../Config/permissionGuard', () => ({ ...jest.requireActual('../../Config/permissionGuard'), getRoleType: jest.fn(async () => 1) }));

const { closeConnection } = require('../../middlewares/mongoConnector/helper');
const chain = require('../../Modules/Audit/chain');
const rules = require('../../Modules/Audit/helpers/chainRules');
const agentAudit = require('../../Modules/Agents/agentAudit');
const redact = require('../../Modules/Audit/redact');
const controls = require('../../Modules/Knowledge/controls');
const ctrl = require('../../Modules/Audit/controller');

const COMPANY = crypto.randomBytes(12).toString('hex');
const OTHER = crypto.randomBytes(12).toString('hex');
const PERSON = crypto.randomBytes(12).toString('hex');
const BYSTANDER = crypto.randomBytes(12).toString('hex');
const ADMIN = crypto.randomBytes(12).toString('hex');
const AGENT = crypto.randomBytes(12).toString('hex');

let client;

const audits = (companyId) => client.db(companyId).collection('audit_logs');
const sorted = (companyId) => audits(companyId).find({}).sort({ _id: 1 }).toArray();
const hashedOf = (companyId, row) => rules.canonical(rules.hashedContent(companyId, row));
const writeUnchained = async (companyId, entry) => {
    process.env.AUDIT_CHAIN = 'false';
    try {
        await chain.saveAuditRow(companyId, entry);
    } finally {
        process.env.AUDIT_CHAIN = 'true';
    }
};

const writeRows = async (companyId) => {
    await writeUnchained(companyId, { actorId: PERSON, actorName: 'Pat Person', action: 'member.update', entityType: 'member', entityId: BYSTANDER, entityName: 'Sam Bystander', meta: {}, ip: '10.1.0.7' });
    await chain.saveAuditRow(companyId, { actorId: PERSON, actorName: 'Pat Person', action: 'sso.config_update', entityType: 'sso', entityId: '', entityName: '', meta: { provider: 'google' }, ip: '10.1.0.7' });
    await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'scim.user_provision', entityType: 'member', entityId: PERSON, entityName: 'pat@example.com', meta: {}, ip: '10.1.0.1' });
    await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'pto.create', entityType: 'pto', entityId: 'p1', entityName: '', meta: { subject: { userId: PERSON, email: 'pat@example.com', userAgent: 'Firefox' } }, ip: '10.1.0.1' });
    await chain.saveAuditRow(companyId, { actorId: BYSTANDER, actorName: 'Sam Bystander', action: 'invoice.create', entityType: 'invoice', entityId: 'inv1', entityName: 'INV-1', meta: { total: 3 }, ip: '10.1.0.9' });
    await agentAudit.openAction(companyId, { kind: 'agent', userId: PERSON, personName: 'Pat Person', provider: 'Claude', agentId: AGENT, agentName: 'Claude', viaAccount: 'personal' },
        { action: 'task.comment', reason: 'asked', params: { taskId: 't1' }, entityType: 'task', entityId: 't1', entityName: 'Fix the door', ip: '10.1.0.7' });
    const onBehalf = await agentAudit.openAction(companyId, { kind: 'agent', userId: PERSON, agentId: AGENT, agentName: 'Reviewer', viaAccount: 'workspace' },
        { action: 'task.comment', reason: 'asked', params: { taskId: 't2' }, entityType: 'task', entityId: 't2', entityName: 'Oil the hinge', ip: '10.1.0.7' });
    await agentAudit.applyAction(companyId, onBehalf, { undo: null });
    const member = await chain.saveAuditRow(companyId, { actorId: ADMIN, actorName: 'Ada Admin', action: 'member.update', entityType: 'member', entityId: PERSON, entityName: '', meta: {}, ip: '10.1.0.1' });
    await chain.amend(companyId, String(member._id), { entityName: 'Pat Person' });
};

const exportCsv = async (companyId) => {
    const chunks = [];
    const res = { headers: {} };
    res.status = () => res;
    res.json = (b) => { res.body = b; return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.write = (b) => { chunks.push(String(b)); return true; };
    res.end = (b) => { if (b) chunks.push(String(b)); };
    await ctrl.exportAuditCsv({ uid: ADMIN, headers: { companyid: companyId }, query: {}, body: {} }, res);
    return chunks.join('');
};

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    await writeRows(COMPANY);
    await writeRows(OTHER);
});

afterAll(async () => {
    await chain.flushMirrors();
    if (client) {
        await Promise.all([COMPANY, OTHER].map((id) => client.db(id).dropDatabase().catch(() => {})));
        await client.db('global').collection('audit_chain_heads').deleteMany({ _id: { $in: [COMPANY, OTHER] } });
        await client.close();
    }
    [COMPANY, OTHER, 'global'].forEach((db) => closeConnection(db));
    await new Promise((resolve) => setTimeout(resolve, 50));
});

describe('erasure by person over real audit rows', () => {
    let before;
    let other;
    let verifiedBefore;
    let result;
    let refused;

    beforeAll(async () => {
        before = await sorted(COMPANY);
        other = await sorted(OTHER);
        verifiedBefore = await chain.verifyChain(COMPANY);
        await controls.erasePerson(COMPANY, PERSON, { removed: {} }, { by: ADMIN });
        expect(await sorted(COMPANY)).toEqual(before);
        const runs = await Promise.allSettled([
            redact.redactPerson(COMPANY, PERSON, { by: ADMIN, reason: 'instance.audit_redact_person' }),
            redact.redactPerson(COMPANY, PERSON, { by: ADMIN, reason: 'instance.audit_redact_person' }),
        ]);
        refused = runs.filter((r) => r.status === 'rejected').map((r) => r.reason);
        result = runs.filter((r) => r.status === 'fulfilled').map((r) => r.value)[0];
    });

    it('leaves audit rows alone on the knowledge erasure, and lets one of two concurrent runs through', () => {
        expect(refused).toEqual([expect.objectContaining({ code: 'redaction_running', status: 409 })]);
        expect(result).toBeTruthy();
    });

    it('starts from a chain that verifies, with an unchained row beside it', () => {
        expect(verifiedBefore).toMatchObject({ state: 'verified', brokenAt: null });
        expect(before.filter((r) => !r.chain)).toHaveLength(1);
        expect(before.filter((r) => r.chain).length).toBeGreaterThanOrEqual(9);
    });

    it('replaces the person\'s personal fields in every row type, and nothing of anyone else\'s', async () => {
        const alias = redact.pseudonymOf(PERSON);
        const rows = await sorted(COMPANY);
        const of = (action, pick = () => true) => rows.find((r) => r.action === action && pick(r));

        expect(of('member.update', (r) => r.actorId === PERSON)).toMatchObject({ actorName: alias, ip: alias, entityName: 'Sam Bystander' });
        expect(of('member.update', (r) => r.actorId === PERSON).chain).toBeUndefined();
        expect(of('sso.config_update')).toMatchObject({ actorName: alias, ip: alias });
        expect(of('scim.user_provision')).toMatchObject({ entityName: alias, actorName: 'Ada Admin', ip: '10.1.0.1' });
        expect(of('pto.create').meta.subject).toEqual({ userId: PERSON, email: alias, userAgent: alias });
        expect(of('invoice.create')).toMatchObject({ actorName: 'Sam Bystander', entityName: 'INV-1', ip: '10.1.0.9' });
        expect(of('agent.action', (r) => r.actorId === PERSON)).toMatchObject({ actorName: alias, ip: alias, entityName: 'Fix the door' });
        expect(of('agent.action', (r) => r.actorId === AGENT)).toMatchObject({ actorName: 'Reviewer', ip: alias, entityName: 'Oil the hinge' });
        expect(rows.filter((r) => r.action === rules.AMENDED_ACTION && r.meta.setRow).map((r) => r.meta.setRow.entityName)).toEqual([alias]);

        expect(JSON.stringify(rows)).not.toMatch(/Pat Person|pat@example\.com|10\.1\.0\.7|Firefox/);
        expect(result).toMatchObject({ rows: 7, fields: 11 });
    });

    it('leaves every hashed field and every link as it was', async () => {
        const after = new Map((await sorted(COMPANY)).map((r) => [String(r._id), r]));
        before.forEach((row) => {
            const now = after.get(String(row._id));
            expect(now.chain).toEqual(row.chain);
            if (row.chain) expect(hashedOf(COMPANY, now)).toBe(hashedOf(COMPANY, row));
        });
    });

    it('still verifies every row, the redaction row included', async () => {
        const report = await chain.verifyChain(COMPANY);
        expect(report).toMatchObject({ state: 'verified', brokenAt: null, verifiedThrough: verifiedBefore.verifiedThrough + 1 });
        const listed = await chain.readForList(COMPANY, (await sorted(COMPANY)).filter((r) => r.chain && r.action !== rules.AMENDED_ACTION).map((r) => r._id), { integrity: true });
        expect(listed.length).toBeGreaterThanOrEqual(8);
        listed.forEach((r) => expect(r.integrity).toEqual({ state: 'verified' }));
    });

    it('records the redaction as one new chained row', async () => {
        const recorded = await audits(COMPANY).find({ action: redact.REDACTED_ACTION }).toArray();
        expect(recorded).toHaveLength(1);
        const tip = Math.max(...before.filter((r) => r.chain).map((r) => r.chain.seq));
        const alias = redact.pseudonymOf(PERSON);
        expect(recorded[0]).toMatchObject({
            actorId: ADMIN, entityType: 'user', entityId: alias, entityName: alias,
            meta: { reason: 'instance.audit_redact_person', rows: 7, fields: 11 }, chain: { seq: tip + 1 },
        });
        expect(JSON.stringify(recorded[0])).not.toContain(PERSON);
    });

    it('changes nothing on a second run', async () => {
        const snapshot = await sorted(COMPANY);
        const again = await redact.redactPerson(COMPANY, PERSON, { by: ADMIN, reason: 'again' });
        expect(again).toMatchObject({ rows: 0, fields: 0, recorded: null });
        expect(await sorted(COMPANY)).toEqual(snapshot);
    });

    it('leaves another company\'s rows alone', async () => {
        expect(await sorted(OTHER)).toEqual(other);
        expect(await chain.verifyChain(OTHER)).toMatchObject({ state: 'verified' });
    });

    it('exports the pseudonym, never the person', async () => {
        const csv = await exportCsv(COMPANY);
        expect(csv).toContain(redact.pseudonymOf(PERSON));
        expect(csv).not.toMatch(/Pat Person|pat@example\.com/);
        expect(csv).toContain('Sam Bystander');
    });

    it('keeps a progress marker by pseudonym, never by id', async () => {
        const markers = await client.db(COMPANY).collection('audit_redactions').find({}).toArray();
        expect(markers).toEqual([expect.objectContaining({ _id: redact.pseudonymOf(PERSON), after: expect.any(String) })]);
        expect(markers[0].finishedAt).toBeInstanceOf(Date);
        expect(JSON.stringify(markers)).not.toContain(PERSON);
        expect(ObjectId.isValid(markers[0].after)).toBe(true);
    });
});
