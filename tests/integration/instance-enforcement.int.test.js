const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 4: the instance console reads and sets what slice 2 (#743) records and resolves. */

const state = readState();
const BASE = '/api/v2/instance/enforcement';
const ROW_DEADLINE_MS = 10000;

let client;
let companies;
let audits;
let owner;
let member;
let admin;
let since;

const companyRow = () => companies.findOne({ _id: new ObjectId(state.companyId) }, { projection: { permissionEnforcement: 1 } });

const waitFor = async (read, what) => {
    const deadline = Date.now() + ROW_DEADLINE_MS;
    for (;;) {
        const found = await read();
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`${what} did not appear within ${ROW_DEADLINE_MS}ms`);
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
};

beforeAll(async () => {
    since = new Date();
    client = await MongoClient.connect(resolveMongoUrl());
    companies = client.db('global').collection('companies');
    audits = client.db(state.companyId).collection('audit_logs');
    owner = await loginAs('owner');
    member = await loginAs('member');
    admin = await loginAs('admin');
});

afterAll(async () => {
    if (owner) await owner.api.put(`${BASE}/${state.companyId}/mode`, { mode: 'inherit' });
    if (companies) await companies.updateOne({ _id: new ObjectId(state.companyId) }, { $unset: { permissionEnforcement: '' } });
    if (client) await client.close();
});

describe('the enforcement console', () => {
    it('shows the owner the instance default and every workspace, the harness company inheriting it', async () => {
        const res = await owner.api.get(BASE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        const { data } = res.body;
        expect(data.instance).toMatchObject({ mode: expect.stringMatching(/^(off|report|enforce)$/), source: expect.stringMatching(/^(env|saved|default)$/), locked: expect.any(Boolean) });
        expect(data).toMatchObject({ readyAfterDays: 14, cacheTtlSeconds: expect.any(Number), instanceBucket: { companyId: 'instance', rows30d: expect.any(Number) } });
        const mine = data.workspaces.find((w) => w.companyId === state.companyId);
        expect(mine).toMatchObject({ name: expect.any(String), mode: 'inherit', effectiveMode: data.instance.mode, rows30d: expect.any(Number), readyToEnforce: false });
    });

    it('refuses a member and a workspace admin on every route', async () => {
        for (const { api } of [member, admin]) {
            expect((await api.get(BASE)).status).toBe(403);
            expect((await api.get(`${BASE}/${state.companyId}/decisions`)).status).toBe(403);
            expect((await api.put(`${BASE}/${state.companyId}/mode`, { mode: 'enforce' })).status).toBe(403);
            expect((await api.put(`${BASE}/default`, { mode: 'enforce' })).status).toBe(403);
        }
        expect(((await companyRow()) || {}).permissionEnforcement).toBeUndefined();
    });

    it('sets the harness company to report, shows it, stamps the row and writes an audit row', async () => {
        const before = Date.now();
        const set = await owner.api.put(`${BASE}/${state.companyId}/mode`, { mode: 'report' });
        expect(set.status).toBe(200);
        expect(set.body.data).toMatchObject({ companyId: state.companyId, mode: 'report', effectiveMode: 'report', cacheTtlSeconds: expect.any(Number) });

        const row = await companyRow();
        expect(row.permissionEnforcement).toMatchObject({ mode: 'report', updatedBy: owner.uid });
        expect(new Date(row.permissionEnforcement.since).getTime()).toBeGreaterThanOrEqual(before - 1000);

        const summary = await owner.api.get(BASE);
        const mine = summary.body.data.workspaces.find((w) => w.companyId === state.companyId);
        expect(mine).toMatchObject({ mode: 'report', effectiveMode: 'report', streakDays: 0, readyToEnforce: false });

        const audit = await waitFor(() => audits.findOne({ action: 'permission.enforcement_mode', actorId: owner.uid, entityId: state.companyId, createdAt: { $gte: since } }), 'the audit row');
        expect(audit).toMatchObject({ entityType: 'company', meta: expect.objectContaining({ from: 'inherit', to: 'report' }) });
    });

    it('lists the grouped rows of the harness company and of the instance bucket without a body or a query string', async () => {
        for (const id of [state.companyId, 'instance']) {
            const res = await owner.api.get(`${BASE}/${id}/decisions`, { query: { days: 30 } });
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ companyId: id, days: 30, knownDifferenceReasons: ['null_global_flag'] });
            expect(Array.isArray(res.body.data.rows)).toBe(true);
            expect(JSON.stringify(res.body.data.rows)).not.toMatch(/"(body|path|query|url|userIds)"/);
        }
        expect((await owner.api.get(`${BASE}/${state.companyId}/decisions`, { query: { reason: 'because' } })).status).toBe(400);
    });

    it('refuses a mode that is not one of the four', async () => {
        const res = await owner.api.put(`${BASE}/${state.companyId}/mode`, { mode: 'strict' });
        expect(res.status).toBe(400);
        expect((await companyRow()).permissionEnforcement.mode).toBe('report');
    });

    it('restores inherit, which unsets the row', async () => {
        const res = await owner.api.put(`${BASE}/${state.companyId}/mode`, { mode: 'inherit' });
        expect(res.status).toBe(200);
        expect(res.body.data.mode).toBe('inherit');
        expect((await companyRow()).permissionEnforcement).toBeUndefined();
    });

    it('sets and clears the instance default through the settings catalogue', async () => {
        const before = (await owner.api.get(BASE)).body.data.instance;
        if (before.locked) {
            const refused = await owner.api.put(`${BASE}/default`, { mode: 'report' });
            expect(refused.status).toBe(409);
            return;
        }
        try {
            const set = await owner.api.put(`${BASE}/default`, { mode: 'report' });
            expect(set.status).toBe(200);
            expect(set.body.data).toMatchObject({ mode: 'report', source: 'saved', locked: false });
            const summary = await owner.api.get(BASE);
            expect(summary.body.data.instance).toMatchObject({ mode: 'report', source: 'saved' });
            expect(summary.body.data.workspaces.find((w) => w.companyId === state.companyId).effectiveMode).toBe('report');
        } finally {
            await owner.api.put('/api/v2/instance/settings', { PERMISSION_ENFORCEMENT_MODE: '' });
        }
        expect((await owner.api.get(BASE)).body.data.instance.mode).toBe(before.mode);
    });
});
