const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState } = require('../../e2e/support/fixtures');

const state = readState();
const AGENT_ID = crypto.randomBytes(12).toString('hex');
const MIN = 60 * 1000;

let client;
let owner;
let admin;
let member;

const alertNotices = async (session) => {
    const res = await session.api.get(`/api/v1/app-notification/notification?userId=${session.uid}&batchSize=100`);
    expect(res.status).toBe(200);
    return (res.body.data || []).filter((n) => n.changeType === 'agent_alert' && n.changeData && n.changeData.key === AGENT_ID);
};

/* No provider key runs in the harness, so the failing runs an agent would leave are written straight to the company database. */
const seedFailingRuns = async () => {
    const now = Date.now();
    const run = (status, i) => ({
        agentId: AGENT_ID, agentName: 'Rate alert agent', status, trigger: 'manual', triggerDepth: 0,
        startedAt: new Date(now - (10 + i) * MIN), finishedAt: new Date(now - (9 + i) * MIN),
        createdAt: new Date(now - (10 + i) * MIN), updatedAt: new Date(now - (9 + i) * MIN),
        steps: [], actions: [], proposals: [], decisions: [], spend: { tokens: 0, usd: 0, model: null },
    });
    await client.db(state.companyId).collection('agent_runs').insertMany([
        ...[0, 1, 2, 3].map((i) => run('failed', i)),
        ...[4, 5].map((i) => run('done', i)),
    ]);
};

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    [owner, admin, member] = await Promise.all([loginAs('owner'), loginAs('admin'), loginAs('member')]);
    await seedFailingRuns();
});

afterAll(async () => {
    if (client) await client.close();
});

describe('agent rate alerts', () => {
    it('opens one incident for a failing agent and notifies the owner once', async () => {
        const first = await owner.api.post('/api/v2/agents/alerts/evaluate', {});
        expect(first.status).toBe(200);
        expect(first.body.status).toBe(true);
        expect(first.body.data.opened).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'agent_error_rate', key: AGENT_ID })]));

        const listed = await owner.api.get('/api/v2/agents/alerts');
        expect(listed.status).toBe(200);
        expect(listed.body.data.open.filter((i) => i.type === 'agent_error_rate' && i.key === AGENT_ID)).toEqual([
            expect.objectContaining({ status: 'open', lastValue: expect.any(Number), threshold: 20, window: '1h' }),
        ]);

        const notices = await alertNotices(owner);
        expect(notices).toHaveLength(1);
        expect(notices[0].changeData).toMatchObject({ alertType: 'agent_error_rate', state: 'open' });

        const second = await owner.api.post('/api/v2/agents/alerts/evaluate', {});
        expect(second.body.data.opened.filter((o) => o.key === AGENT_ID)).toEqual([]);
        expect(await alertNotices(owner)).toHaveLength(1);
    });

    it('leaves an admin out of error-rate alerts by default', async () => {
        await owner.api.post('/api/v2/agents/alerts/evaluate', {});
        expect(await alertNotices(admin)).toHaveLength(0);
    });

    it('refuses a member', async () => {
        const res = await member.api.post('/api/v2/agents/alerts/evaluate', {});
        expect(res.status).toBe(403);
    });
});
