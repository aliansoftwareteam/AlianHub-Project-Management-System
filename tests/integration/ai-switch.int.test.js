const { loginAs } = require('../../e2e/support/fixtures');
const { startOpenAiCompatibleServer } = require('../support/openAiCompatibleServer');

/* Task 036 slice 5 through the real routes: the instance owner points AI at a self-hosted
 * OpenAI-compatible server on loopback and tests the connection; workspace owners and admins
 * turn AI off for their workspace and members cannot; while AI is off at either level an AI
 * feature sends nothing to the model server. */

const SWITCH = '/api/v2/ai-switch';
const SETTINGS = '/api/v2/instance/settings';
const AI_KEYS = ['LLM_PROVIDER', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL', 'OPENAI_COMPATIBLE_EMBEDDINGS_MODEL', 'AI_ENABLED'];

const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

const refused = (res) => res.status >= 400 || Boolean(res.body && res.body.status === false);
const describeAi = (owner) => owner.api.post('/api/v1/ai/description', { title: 'Plan the Q3 launch', mode: 'rewrite' });

let stub;
let before;

beforeAll(async () => {
    stub = await startOpenAiCompatibleServer();
    const owner = await as('owner');
    const res = await owner.api.get(SETTINGS);
    before = Object.fromEntries(res.body.data.settings.filter((s) => AI_KEYS.includes(s.key)).map((s) => [s.key, s.source === 'saved' ? s.value : '']));
}, 60000);

afterAll(async () => {
    const owner = await as('owner');
    await owner.api.put(SETTINGS, before);
    await owner.api.put(SWITCH, { enabled: true });
    await stub.stop();
});

describe('with no provider configured', () => {
    it('tells every role AI is unconfigured, and only the owners that they can fix it', async () => {
        const owner = await as('owner');
        await owner.api.put(SETTINGS, { LLM_PROVIDER: '', OPENAI_COMPATIBLE_BASE_URL: '', OPENAI_COMPATIBLE_MODEL: '', AI_ENABLED: '' });
        for (const role of ['owner', 'admin', 'member', 'guest']) {
            const { api } = await as(role);
            const res = await api.get(SWITCH);
            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ state: 'unconfigured', instanceEnabled: true, workspaceEnabled: true });
            expect(res.body.data.canManageWorkspace).toBe(['owner', 'admin'].includes(role));
            expect(res.body.data.canConfigureInstance).toBe(role === 'owner');
        }
    });
});

describe('a self-hosted endpoint in Instance settings', () => {
    it('lets only the instance owner save it and test the connection', async () => {
        const owner = await as('owner');
        const saved = await owner.api.put(SETTINGS, { LLM_PROVIDER: 'openai_compatible', OPENAI_COMPATIBLE_BASE_URL: stub.baseUrl, OPENAI_COMPATIBLE_MODEL: 'llama3.1:8b', OPENAI_COMPATIBLE_EMBEDDINGS_MODEL: 'nomic-embed-text' });
        expect(saved.body.status).toBe(true);

        const test = await owner.api.post(`${SETTINGS}/test`, { group: 'ai', values: {} });
        expect(test.body).toMatchObject({ status: true, data: { group: 'ai', provider: 'openai_compatible', models: ['llama3.1:8b', 'nomic-embed-text'] } });

        const badUrl = await owner.api.put(SETTINGS, { OPENAI_COMPATIBLE_BASE_URL: 'gopher://127.0.0.1/v1' });
        expect(badUrl.status).toBe(400);
        expect(badUrl.body.data.errors).toEqual({ OPENAI_COMPATIBLE_BASE_URL: 'protocol' });

        for (const role of ['admin', 'member', 'guest']) {
            const { api } = await as(role);
            expect(refused(await api.post(`${SETTINGS}/test`, { group: 'ai', values: { OPENAI_COMPATIBLE_BASE_URL: stub.baseUrl } }))).toBe(true);
            expect(refused(await api.put(SETTINGS, { OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:1/v1' }))).toBe(true);
        }
        const res = await (await as('member')).api.get(SWITCH);
        expect(res.body.data).toMatchObject({ state: 'on', provider: 'openai_compatible' });
    });

    it('answers an AI feature from the self-hosted server', async () => {
        stub.reset();
        const owner = await as('owner');
        await describeAi(owner);
        expect(stub.requests.map((r) => `${r.method} ${r.url}`)).toEqual(['POST /v1/chat/completions']);
        expect(stub.requests[0].body.model).toBe('llama3.1:8b');
    });
});

describe('the workspace switch', () => {
    it('is refused to members and guests', async () => {
        for (const role of ['member', 'guest']) {
            const { api } = await as(role);
            const res = await api.put(SWITCH, { enabled: false });
            expect(res.status).toBe(403);
        }
        const res = await (await as('member')).api.get(SWITCH);
        expect(res.body.data.workspaceEnabled).toBe(true);
    });

    it('lets an admin turn AI off, after which nothing reaches the model server', async () => {
        const admin = await as('admin');
        const off = await admin.api.put(SWITCH, { enabled: false });
        expect(off.body).toMatchObject({ status: true, data: { state: 'off_workspace', workspaceEnabled: false } });

        const seen = await (await as('member')).api.get(SWITCH);
        expect(seen.body.data.state).toBe('off_workspace');

        stub.reset();
        const answer = await describeAi(await as('owner'));
        expect(answer.body.status).toBe(false);
        expect(stub.requests).toHaveLength(0);

        const on = await (await as('owner')).api.put(SWITCH, { enabled: true });
        expect(on.body.data.state).toBe('on');
    });

    it('refuses a body that is not a boolean', async () => {
        const res = await (await as('owner')).api.put(SWITCH, { enabled: 'nope' });
        expect(res.status).toBe(400);
    });
});

describe('the instance switch', () => {
    it('turns AI off for every workspace, and nothing reaches the model server', async () => {
        const owner = await as('owner');
        await owner.api.put(SETTINGS, { AI_ENABLED: 'false' });
        const res = await (await as('admin')).api.get(SWITCH);
        expect(res.body.data).toMatchObject({ state: 'off_instance', instanceEnabled: false });

        stub.reset();
        const answer = await describeAi(owner);
        expect(answer.body.status).toBe(false);
        expect(stub.requests).toHaveLength(0);

        await owner.api.put(SETTINGS, { AI_ENABLED: 'true' });
        expect((await owner.api.get(SWITCH)).body.data.state).toBe('on');
    });
});
