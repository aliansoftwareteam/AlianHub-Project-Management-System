const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...args) => mockDb.crud(...args) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Audit/controller');
const { pseudonymOf } = require('../Modules/Audit/redact');

/* Follow-up 98: an outside client acting under an OAuth grant is recorded with its client id as actorId. The list and
 * the export name the client and the person who delegated it, and only for a client this workspace approved. */

const CID = '6f00000000000000000000c1';
const OTHER_CID = '6f00000000000000000000c2';
const OWNER = '6f0000000000000000000001';
const DELEGATOR = '6f0000000000000000000002';
const STRANGER = '6f0000000000000000000009';
const CLIENT = 'ahc_0123456789abcdef01234567';
const FOREIGN_CLIENT = 'ahc_fedcba9876543210fedcba98';

const outsideRow = (clientId, delegatedBy, over = {}) => ({
    action: 'agent.action_refused', actorId: clientId, actorName: `${clientId} for Member`, entityType: 'agent_session', entityId: 's1',
    createdAt: new Date(Date.UTC(2026, 8, 20, 10, 0, 0)),
    meta: { actorType: 'agent', agentName: clientId, viaAccount: 'external', clientId, grantId: 'g1', delegatedBy, onBehalfOf: delegatedBy, action: 'task_update', reason: 'external agent step refused' },
    ...over,
});

const list = async (query) => {
    const res = { code: 200 };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { res.body = b; return res; };
    await ctrl.listAuditLogs({ uid: OWNER, headers: { companyid: CID }, query, body: {} }, res);
    return res.body;
};

const exportCsv = async (query) => {
    const chunks = [];
    const res = { code: 200, headers: {} };
    res.status = (c) => { res.code = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    res.send = (b) => { chunks.push(String(b)); return res; };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.write = (b) => { chunks.push(String(b)); return true; };
    res.end = (b) => { if (b) chunks.push(String(b)); };
    await ctrl.exportAuditCsv({ uid: OWNER, headers: { companyid: CID }, query, body: {} }, res);
    return chunks.join('');
};

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: OWNER, roleType: 1, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: DELEGATOR, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Olivia Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: DELEGATOR, Employee_Name: 'Dev Delegator' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: STRANGER, Employee_Name: 'Sam Stranger' });
    mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENTS, { clientId: CLIENT, companyId: CID, name: 'Coder' });
    mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: CID, clientId: CLIENT, clientName: 'Coder (as approved)', status: 'approved' });
    mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENTS, { clientId: FOREIGN_CLIENT, companyId: OTHER_CID, name: 'Elsewhere Bot' });
    mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: OTHER_CID, clientId: FOREIGN_CLIENT, clientName: 'Elsewhere Bot', status: 'approved' });
});

describe('follow-up 98: an outside client in the audit log', () => {
    it('lists the client by name and the person who delegated it', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(CLIENT, DELEGATOR));
        const body = await list({});
        expect(body.status).toBe(true);
        expect(body.data).toHaveLength(1);
        expect(body.data[0].outsideAgent).toEqual({ clientId: CLIENT, clientName: 'Coder', delegatedBy: DELEGATOR, delegatedByName: 'Dev Delegator' });
    });

    it('names a client with no registered row by its approval in this workspace', async () => {
        const documentClient = 'https://agent.example.test/client.json';
        mockDb.seed(SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS, { companyId: CID, clientId: documentClient, clientName: 'Doc Agent', status: 'approved' });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(documentClient, DELEGATOR));
        const [row] = (await list({})).data;
        expect(row.outsideAgent.clientName).toBe('Doc Agent');
    });

    it('does not name a client this workspace never approved, nor a person outside it', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(FOREIGN_CLIENT, STRANGER));
        const body = await list({});
        const [row] = body.data;
        expect(row.outsideAgent).toEqual({ clientId: FOREIGN_CLIENT, clientName: null, delegatedBy: STRANGER, delegatedByName: null });
        expect(JSON.stringify(body)).not.toContain('Elsewhere Bot');
        expect(JSON.stringify(body)).not.toContain('Sam Stranger');
    });

    it('reads approvals for this workspace only and people through this workspace\'s seats', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(CLIENT, DELEGATOR));
        await list({});
        const approvalReads = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.OAUTH_CLIENT_APPROVALS);
        expect(approvalReads.length).toBeGreaterThan(0);
        approvalReads.forEach((c) => expect(c.data[0].companyId).toBe(CID));
        const seatReads = mockDb.calls.filter((c) => c.type === SCHEMA_TYPE.COMPANY_USERS && c.method === 'find');
        expect(seatReads.length).toBeGreaterThan(0);
        seatReads.forEach((c) => expect(String(c.companyId)).toBe(CID));
    });

    it('does not bring back the name of a person whose audit trail was erased', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_REDACTIONS, { _id: pseudonymOf(DELEGATOR), finishedAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(CLIENT, DELEGATOR));
        const body = await list({});
        expect(body.data[0].outsideAgent.delegatedByName).toBeNull();
        expect(JSON.stringify(body)).not.toContain('Dev Delegator');
    });

    it('filters to outside-client rows only', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(CLIENT, DELEGATOR));
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'agent.action', actorId: OWNER, actorName: 'Workspace agent', meta: { actorType: 'agent', viaAccount: 'workspace', agentName: 'Planner' }, createdAt: new Date() });
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, { action: 'member.update', actorId: OWNER, actorName: 'Olivia Owner', meta: {}, createdAt: new Date() });
        const outside = await list({ actorType: 'outside_agent' });
        expect(outside.data.map((r) => r.actorId)).toEqual([CLIENT]);
        expect(outside.metadata.total).toBe(1);
        const agents = await list({ actorType: 'agent' });
        expect(agents.data).toHaveLength(2);
    });

    it('names the client and the delegating person in the CSV, not the bare client id', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(CLIENT, DELEGATOR));
        const [, line] = (await exportCsv({ actorType: 'outside_agent' })).split('\n');
        const cells = line.split(',');
        expect(cells[2]).toBe('Coder (outside agent) for Dev Delegator');
        expect(cells[3]).toBe('Coder');
        expect(line).not.toContain(`${CLIENT} for`);
    });

    it('does not name a foreign client in the CSV either', async () => {
        mockDb.seed(SCHEMA_TYPE.AUDIT_LOGS, outsideRow(FOREIGN_CLIENT, STRANGER));
        const text = await exportCsv({});
        expect(text).not.toContain('Elsewhere Bot');
        expect(text).not.toContain('Sam Stranger');
        expect(text.split('\n')[1].split(',')[2]).toBe('An outside agent for a member');
    });
});
