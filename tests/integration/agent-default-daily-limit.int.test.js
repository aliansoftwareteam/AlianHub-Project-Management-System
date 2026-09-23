const { MongoClient, ObjectId } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const NEEDS_A_TASK = 'This agent needs a task to run on. Start the run from a task, or mention the agent in a comment.';

let client;
let db;
let api;
const created = [];

beforeAll(async () => {
    client = new MongoClient(resolveMongoUrl(), { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    db = client.db(state.companyId);
    ({ api } = await loginAs('owner'));
});

afterAll(async () => {
    for (const id of created) {
        // eslint-disable-next-line no-await-in-loop
        await api.delete(`/api/v2/agents/${id}`);
    }
    await client.close();
});

const createAgent = async (overrides = {}) => {
    const res = await api.post('/api/v2/agents', { name: `[QA daily limit] ${uniqueSuffix()}`, autonomy: 1, skills: [], ...overrides });
    if (res.status !== 200 || !res.body.status) throw new Error(`create agent failed (${res.status}): ${JSON.stringify(res.body)}`);
    created.push(res.body.data._id);
    return res.body.data;
};

const storedAgent = (id) => db.collection('agents').findOne({ _id: new ObjectId(id) });

const seedRunsToday = (agentId, n) => db.collection('agent_runs').insertMany(Array.from({ length: n }, () => ({
    agentId: String(agentId), status: 'done', trigger: 'manual', startedAt: new Date(), elapsedMs: 0,
})));

/* Without a task the start is refused only after every limit has let it through,
 * so this answer means the daily limit allowed the run. */
const startRun = (agentId) => api.post('/api/v2/agents/runs', { agentId });

describe('the default daily run limit, end to end', () => {
    it('stores 40 on an agent created without a limit', async () => {
        const agent = await createAgent();
        expect(agent.rateLimitPerDay).toBe(40);
        expect((await storedAgent(agent._id)).rateLimitPerDay).toBe(40);
    });

    it('allows the 40th run and refuses the 41st for an agent with no stored limit', async () => {
        const agent = await createAgent();
        await db.collection('agents').updateOne({ _id: new ObjectId(agent._id) }, { $unset: { rateLimitPerDay: '' } });
        expect((await storedAgent(agent._id)).rateLimitPerDay).toBeUndefined();

        await seedRunsToday(agent._id, 39);
        const fortieth = await startRun(agent._id);
        expect(fortieth.body.statusText).toBe(NEEDS_A_TASK);

        await seedRunsToday(agent._id, 1);
        const fortyFirst = await startRun(agent._id);
        expect(fortyFirst.status).toBe(409);
        expect(fortyFirst.body.statusText).toBe('Daily run limit reached (40 of 40 today).');
    });

    it('honours a stored limit of 12', async () => {
        const agent = await createAgent({ rateLimitPerDay: 12 });
        expect((await storedAgent(agent._id)).rateLimitPerDay).toBe(12);
        await seedRunsToday(agent._id, 12);
        const res = await startRun(agent._id);
        expect(res.status).toBe(409);
        expect(res.body.statusText).toBe('Daily run limit reached (12 of 12 today).');
    });

    it('keeps a stored 0 as no daily limit', async () => {
        const agent = await createAgent({ rateLimitPerDay: 0 });
        expect((await storedAgent(agent._id)).rateLimitPerDay).toBe(0);
        await seedRunsToday(agent._id, 45);
        expect((await startRun(agent._id)).body.statusText).toBe(NEEDS_A_TASK);
    });
});
