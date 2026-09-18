const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 8 slice 10: the harness runs with AGENT_EGRESS_ALLOWLIST on (e2e/support/server.js), so the
 * gateway applies whatever list the instance owner sets for the harness company. */

const state = readState();
const BASE = '/api/v2/instance/egress';
const ROW_DEADLINE_MS = 10000;
const PR_HOST = 'github.com';

let client;
let lists;
let audits;
let owner;
let member;
let admin;
let project;
let task;

const listRow = () => lists.findOne({ _id: 'workspace' });

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
    client = await MongoClient.connect(resolveMongoUrl());
    lists = client.db(state.companyId).collection('egress_allowlists');
    audits = client.db(state.companyId).collection('audit_logs');
    owner = await loginAs('owner');
    member = await loginAs('member');
    admin = await loginAs('admin');
    project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, name: `Review https://${PR_HOST}/acme/repo/pull/7 ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
});

afterAll(async () => {
    if (owner) await owner.api.put(`${BASE}/${state.companyId}`, { hosts: [] });
    if (lists) await lists.deleteMany({});
    if (client) await client.close();
});

describe('the workspace egress allowlist', () => {
    it('shows the owner the flag on and the harness company with no hosts', async () => {
        const res = await owner.api.get(BASE);
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ flag: { on: true, envKey: 'AGENT_EGRESS_ALLOWLIST' }, cacheTtlSeconds: expect.any(Number), windowDays: 7 });
        const mine = res.body.data.workspaces.find((w) => w.companyId === state.companyId);
        expect(mine).toMatchObject({ name: expect.any(String), hosts: [], refused7d: expect.any(Number) });
    });

    it('refuses a member and a workspace admin on every route', async () => {
        for (const { api } of [member, admin]) {
            expect((await api.get(BASE)).status).toBe(403);
            expect((await api.put(`${BASE}/${state.companyId}`, { hosts: ['docs.example.com'] })).status).toBe(403);
        }
        expect(await listRow()).toBeNull();
    });

    it('lets the owner set a list, shows it, and writes an audit row naming the change', async () => {
        const before = Date.now();
        const set = await owner.api.put(`${BASE}/${state.companyId}`, { hosts: ['Docs.example.com', '*.api.example.com'] });
        expect(set.status).toBe(200);
        expect(set.body.data).toMatchObject({ companyId: state.companyId, hosts: ['docs.example.com', '*.api.example.com'], updatedBy: owner.uid });

        const row = await listRow();
        expect(row).toMatchObject({ hosts: ['docs.example.com', '*.api.example.com'], updatedBy: owner.uid });
        expect(new Date(row.updatedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);

        const summary = await owner.api.get(BASE);
        expect(summary.body.data.workspaces.find((w) => w.companyId === state.companyId)).toMatchObject({ hosts: ['docs.example.com', '*.api.example.com'], updatedByName: expect.any(String) });

        const audit = await waitFor(() => audits.findOne({ action: 'agent.egress_allowlist', actorId: owner.uid, entityId: state.companyId }), 'the audit row');
        expect(audit.meta).toMatchObject({ added: ['docs.example.com', '*.api.example.com'], removed: [], count: 2 });
    });

    it('refuses an agent fetch to an unlisted host before it leaves the box, and audits the host only', async () => {
        const started = Date.now();
        const res = await owner.api.post('/api/v2/agents/skills/pr.summary/dry-run', { taskId: task._id });
        expect(res.status >= 400 || res.body.status === false).toBe(true);
        expect(JSON.stringify(res.body)).toMatch(new RegExp(`${PR_HOST}.*allow`, 'i'));
        expect(Date.now() - started).toBeLessThan(5000);

        const refusal = await waitFor(() => audits.findOne({ action: 'agent.egress_refused', entityId: PR_HOST, actorId: owner.uid }), 'the refusal audit row');
        expect(refusal).toMatchObject({ entityType: 'host', meta: expect.objectContaining({ reason: 'unlisted', host: PR_HOST, hop: 0 }) });
        expect(JSON.stringify(refusal)).not.toContain('/acme/repo/pull/7');

        const summary = await owner.api.get(BASE);
        expect(summary.body.data.workspaces.find((w) => w.companyId === state.companyId).refused7d).toBeGreaterThanOrEqual(1);
    });

    it('refuses an address, a private name, a scheme and a path, and keeps the list', async () => {
        for (const [entry, reason] of [['10.0.0.1', 'address'], ['169.254.169.254', 'address'], ['localhost', 'private'], ['vault.internal', 'private'], ['https://docs.example.com', 'scheme'], ['docs.example.com/api', 'path'], ['*.com', 'wildcard']]) {
            const res = await owner.api.put(`${BASE}/${state.companyId}`, { hosts: ['docs.example.com', entry] });
            expect([entry, res.status]).toEqual([entry, 400]);
            expect(res.body.data.errors).toEqual([{ entry, reason }]);
        }
        expect((await listRow()).hosts).toEqual(['docs.example.com', '*.api.example.com']);
    });

    it('a member cannot change the list once it exists', async () => {
        expect((await member.api.put(`${BASE}/${state.companyId}`, { hosts: [] })).status).toBe(403);
        expect((await listRow()).hosts).toEqual(['docs.example.com', '*.api.example.com']);
    });

    it('clearing the list restores today\'s behaviour for the workspace', async () => {
        const res = await owner.api.put(`${BASE}/${state.companyId}`, { hosts: [] });
        expect(res.status).toBe(200);
        expect(res.body.data.hosts).toEqual([]);
        expect((await listRow()).hosts).toEqual([]);
        const audit = await waitFor(() => audits.findOne({ action: 'agent.egress_allowlist', actorId: owner.uid, 'meta.count': 0 }), 'the clearing audit row');
        expect(audit.meta.removed).toEqual(['docs.example.com', '*.api.example.com']);
    });
});
