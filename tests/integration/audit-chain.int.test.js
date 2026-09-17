const crypto = require('node:crypto');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const { createApiClient } = require('../../e2e/support/api');
const { STATE_DIR, resolveMongoUrl } = require('../../e2e/support/env');
const { emailFor, login, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');
const { startServer } = require('../../e2e/support/server');
const { generateToken, hashToken, tokenPrefixOf } = require('../../Modules/ApiTokens/helpers/apiTokenRules');

/* Sprint 8 slice 5. A second server runs with AUDIT_CHAIN on against the harness database, so every
 * row it writes is chained while the harness server keeps writing unchained rows beside them. */

const state = readState();
const BOOT_TIMEOUT_MS = 180000;
const ROW_DEADLINE_MS = 10000;
const KEY = crypto.randomBytes(32).toString('hex');

let server;
let client;
let audits;
let owner;
let startedAt;

const waitFor = async (read, what) => {
    const deadline = Date.now() + ROW_DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not appear within ${ROW_DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

const list = async (query) => {
    const res = await owner.get('/api/v1/audit-logs', { query: { limit: 100, ...query } });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body;
};

const scimRows = () => audits.find({ action: 'scim.config_update', 'chain.seq': { $type: 'number' }, createdAt: { $gte: startedAt } }).sort({ 'chain.seq': 1 }).toArray();

async function agentToken(agentId) {
    const raw = generateToken();
    await client.db(state.companyId).collection('apiTokens').insertOne({
        name: `[QA chain] ${agentId}`, tokenHash: hashToken(raw), prefix: tokenPrefixOf(raw), scopes: ['read', 'write'],
        userId: state.users.owner.userId, active: true, kind: 'agent', agentId: String(agentId), projectIds: [], createdAt: new Date(), updatedAt: new Date(),
    });
    return createApiClient({ baseURL: server.baseURL, accessToken: raw, companyId: state.companyId });
}

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    audits = client.db(state.companyId).collection('audit_logs');
    startedAt = new Date();
    server = await startServer({
        mongoUrl: resolveMongoUrl(),
        logFile: path.join(STATE_DIR, 'audit-chain-server.log'),
        env: { AUDIT_CHAIN: 'true', AUDIT_CHAIN_KEY: KEY },
    });
    const session = await login(server.baseURL, emailFor('owner'));
    owner = createApiClient({ baseURL: server.baseURL, accessToken: session.accessToken, companyId: state.companyId });
}, BOOT_TIMEOUT_MS);

afterAll(async () => {
    if (server) await server.stop();
    if (client) {
        await client.db(state.companyId).collection('apiTokens').deleteMany({ name: /^\[QA chain\]/ });
        await client.close();
    }
}, BOOT_TIMEOUT_MS);

describe('the audit hash chain through real routes', () => {
    let actionRow;

    let agentApi;

    beforeAll(async () => {
        for (const isEnabled of [false, false, false]) {
            const res = await owner.put('/api/v2/scim/config', { isEnabled });
            expect(res.body.status).toBe(true);
        }
        await waitFor(async () => (await scimRows()).length === 3, 'three chained scim rows');

        const agent = (await owner.post('/api/v2/agents', {
            name: `[QA chain] ${uniqueSuffix()}`, description: 'audit chain', autonomy: 1, spendCapUsd: 1,
            projectIds: [state.projects.shared._id], skills: [], allowedActions: ['task.comment'],
        })).body.data;
        const taskId = state.tasks[0]._id;
        agentApi = await agentToken(agent._id);
        const proposal = (await agentApi.post('/api/v2/agents/proposals', {
            agentId: agent._id, taskId, projectId: state.projects.shared._id, what: '[QA chain] proposal', why: 'integration',
            changes: [{ action: 'task.comment', params: { taskId, body: `[QA chain] comment ${uniqueSuffix()}` }, label: 'Comment' }],
        })).body.data;
        const approved = await owner.post(`/api/v2/agents/proposals/${proposal._id}/approve`);
        expect(approved.body.data.applied).toEqual([expect.objectContaining({ action: 'task.comment', ok: true })]);

        actionRow = await waitFor(() => audits.findOne({ action: 'agent.action', 'meta.agentId': String(agent._id) }), 'the agent action row');
        const undone = await owner.post(`/api/v1/audit-logs/${actionRow._id}/undo`, {});
        expect(undone.body.status).toBe(true);
        await waitFor(() => audits.findOne({ action: 'agent.action_undone', 'meta.originalAuditId': String(actionRow._id) }), 'the undo row');
    }, 60000);

    it('chains every row the server writes, with contiguous sequence numbers', async () => {
        const written = await audits.find({ createdAt: { $gte: startedAt }, 'chain.seq': { $type: 'number' } }).sort({ 'chain.seq': 1 }).toArray();
        expect(written.length).toBeGreaterThanOrEqual(7);
        const seqs = written.map((r) => r.chain.seq);
        expect(seqs).toEqual(seqs.map((_, i) => seqs[0] + i));
        written.slice(1).forEach((row, i) => expect(row.chain.prevHash).toBe(written[i].chain.hash));
        expect(written.every((r) => /^[0-9a-f]{64}$/.test(r.chain.hash))).toBe(true);
    });

    it('never edits the action row: its changes are appended rows that reference it', async () => {
        const stored = await audits.findOne({ _id: actionRow._id });
        expect(stored.meta).toMatchObject({ state: 'pending', undo: null, undoneAt: null });
        const amendments = await audits.find({ action: 'audit.amended', 'meta.amends': String(actionRow._id) }).sort({ 'chain.seq': 1 }).toArray();
        expect(amendments.map((a) => Object.keys(a.meta.set).sort())).toEqual([
            ['settledAt', 'state', 'undo', 'undoable'],
            ['undoneAt', 'undoneBy'],
        ]);
        expect(amendments.every((a) => a.chain.seq > stored.chain.seq)).toBe(true);
    });

    it('lists the folded state with an integrity state per row and hides the appended changes', async () => {
        const body = await list({});
        expect(body.metadata.chain).toEqual({ on: true });
        expect(body.data.some((r) => r.action === 'audit.amended')).toBe(false);

        const action = body.data.find((r) => r._id === String(actionRow._id));
        expect(action.meta).toMatchObject({ state: 'applied', undoable: true, undoneBy: state.users.owner.userId });
        expect(action.meta.undoneAt).toBeTruthy();
        expect(action.entityId).toBe(String(state.tasks[0]._id));
        expect(action.integrity).toEqual({ state: 'verified' });

        const chainedRows = body.data.filter((r) => r.chain);
        expect(chainedRows.length).toBeGreaterThanOrEqual(5);
        chainedRows.forEach((r) => expect(r.integrity).toEqual({ state: 'verified' }));
        body.data.filter((r) => !r.chain).forEach((r) => expect(r.integrity).toEqual({ state: 'unchained' }));

        const undoneTab = await list({ undone: 'true' });
        expect(undoneTab.data.map((r) => r._id)).toContain(String(actionRow._id));
        const searched = await list({ q: 'task.comment', undone: 'true' });
        expect(searched.data.map((r) => r._id)).toContain(String(actionRow._id));
        const byEntity = await list({ entityId: action.entityId });
        expect(byEntity.data.map((r) => r._id)).toContain(String(actionRow._id));
    });

    it('reports a row changed in Mongo as broken from its sequence number, and verified once restored', async () => {
        const [first, second, third] = await scimRows();
        await audits.updateOne({ _id: second._id }, { $set: { 'meta.isEnabled': true } });
        try {
            const body = await list({ action: 'scim.config_update' });
            const byId = new Map(body.data.map((r) => [r._id, r]));
            expect(byId.get(String(first._id)).integrity).toEqual({ state: 'verified' });
            expect(byId.get(String(second._id)).integrity).toEqual({ state: 'broken', brokenAt: second.chain.seq });
            expect(byId.get(String(third._id)).integrity).toEqual({ state: 'broken', brokenAt: second.chain.seq });
        } finally {
            await audits.updateOne({ _id: second._id }, { $set: { meta: second.meta } });
        }
        const restored = await list({ action: 'scim.config_update' });
        expect(restored.data.find((r) => r._id === String(second._id)).integrity).toEqual({ state: 'verified' });
    });

    it('reports a deleted middle row as a break for every later row', async () => {
        const [first, second, third] = await scimRows();
        await audits.deleteOne({ _id: second._id });
        try {
            const body = await list({ action: 'scim.config_update' });
            const byId = new Map(body.data.map((r) => [r._id, r]));
            expect(byId.get(String(first._id)).integrity).toEqual({ state: 'verified' });
            expect(byId.get(String(third._id)).integrity).toEqual({ state: 'broken', brokenAt: second.chain.seq });
        } finally {
            await audits.insertOne(second);
        }
        const restored = await list({ action: 'scim.config_update' });
        expect(restored.data.find((r) => r._id === String(third._id)).integrity).toEqual({ state: 'verified' });
    });

    it('verifies a row whose text held a lone surrogate, as Mongo stored it', async () => {
        const proposal = (await agentApi.post('/api/v2/agents/proposals', {
            agentId: actionRow.meta.agentId, taskId: state.tasks[0]._id, projectId: state.projects.shared._id, what: '[QA chain] declined', why: 'integration',
            changes: [{ action: 'task.comment', params: { taskId: state.tasks[0]._id, body: '[QA chain] never posted' }, label: 'Comment' }],
        })).body.data;
        const declined = await owner.post(`/api/v2/agents/proposals/${proposal._id}/decline`, { reason: 'odd \ud800 reason' });
        expect(declined.body.status).toBe(true);
        const decided = await waitFor(() => audits.findOne({ action: 'agent.proposal_decided', entityId: String(proposal._id) }), 'the decision row');
        expect(decided.meta.decision).toBe('declined: odd \ufffd reason');
        expect(decided.chain.seq).toBeGreaterThan(0);

        const body = await list({ action: 'agent.proposal_decided' });
        expect(body.data.find((r) => r._id === String(decided._id)).integrity).toEqual({ state: 'verified' });
    });

    it('filters to permission refusals, and reads an unchained row written after the chain started as broken', async () => {
        const marker = `[QA chain] ${uniqueSuffix()}`;
        await audits.insertOne({ action: 'permission.refused', actorId: state.users.member.userId, actorName: '', entityType: 'permission', entityId: 'task.task_priority', entityName: marker, meta: { mode: 'enforce', reason: 'denied' }, ip: '', createdAt: new Date(), updatedAt: new Date() });
        const body = await list({ refused: 'true' });
        expect(body.data.length).toBeGreaterThanOrEqual(1);
        expect(body.data.every((r) => r.action === 'permission.refused')).toBe(true);
        expect(body.data.find((r) => r.entityName === marker).integrity).toEqual({ state: 'broken', brokenAt: null });
    });

    it('never applies an appended change inserted outside the chain', async () => {
        const forged = await audits.insertOne({ action: 'audit.amended', actorId: '', entityType: 'task', entityId: '', meta: { amends: String(actionRow._id), set: { undoneAt: null, state: 'failed' } }, createdAt: new Date(), updatedAt: new Date() });
        try {
            const body = await list({ action: 'agent.action' });
            const action = body.data.find((r) => r._id === String(actionRow._id));
            expect(action.meta.state).toBe('applied');
            expect(action.meta.undoneAt).toBeTruthy();
            expect(action.integrity).toMatchObject({ state: 'broken' });
        } finally {
            await audits.deleteOne({ _id: forged.insertedId });
        }
    });
});

describe('the harness server, with AUDIT_CHAIN off', () => {
    it('answers the audit log in the shape it had before the chain', async () => {
        const harnessOwner = await loginAs('owner');
        const res = await harnessOwner.api.get('/api/v1/audit-logs', { query: { limit: 100 } });
        expect(res.body.status).toBe(true);
        expect(Object.keys(res.body.metadata).sort()).toEqual(['page', 'total', 'totalPages']);
        expect(res.body.data.length).toBeGreaterThan(0);
        res.body.data.forEach((row) => expect(row).not.toHaveProperty('integrity'));
    });
});
