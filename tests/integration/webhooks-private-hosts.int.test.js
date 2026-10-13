const http = require('http');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const KEY = 'WEBHOOK_ALLOWED_PRIVATE_HOSTS';

const sessions = {};
const as = async (role) => {
    if (!sessions[role]) sessions[role] = await loginAs(role);
    return sessions[role];
};

async function waitFor(check, { timeoutMs = 20000, intervalMs = 250 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await check();
        if (value || Date.now() > deadline) return value;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

const received = [];
let sink;

beforeAll(() => new Promise((resolve) => {
    const server = http.createServer((req, res) => {
        received.push({ path: req.url, event: req.headers['x-alianhub-event'] });
        res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => { sink = { server, port: server.address().port }; resolve(); });
}));

const created = [];

afterAll(async () => {
    const owner = await as('owner');
    await owner.api.put('/api/v2/instance/settings', { [KEY]: '' });
    await Promise.all(created.map((id) => owner.api.delete(`/api/v2/webhooks/${id}`)));
    await new Promise((done) => sink.server.close(done));
});

async function setAllowlist(value) {
    const owner = await as('owner');
    const res = await owner.api.put('/api/v2/instance/settings', { [KEY]: value });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
}

async function saveWebhook(url) {
    const owner = await as('owner');
    const res = await owner.api.post('/api/v2/webhooks', { name: `LAN ${uniqueSuffix()}`, url, events: ['task.created'] });
    if (res.body && res.body.status) created.push(res.body.data._id);
    return res.body;
}

async function createTaskInNewProject() {
    const owner = await as('owner');
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    return createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
}

describe('private webhook hosts', () => {
    afterEach(() => setAllowlist(''));

    it('shows the allowlist to the owner, empty by default, and refuses it to a company admin', async () => {
        const owner = await as('owner');
        const settings = await owner.api.get('/api/v2/instance/settings');
        expect(settings.body.data.settings.find((s) => s.key === KEY)).toMatchObject({ group: 'security', type: 'list', value: '', source: 'unset' });

        const admin = await as('admin');
        const refused = await admin.api.put('/api/v2/instance/settings', { [KEY]: '127.0.0.1' });
        expect(refused.status).toBe(403);
        const after = await owner.api.get('/api/v2/instance/settings');
        expect(after.body.data.settings.find((s) => s.key === KEY).value).toBe('');
    });

    it('rejects an entry that is neither a hostname nor a CIDR range', async () => {
        const owner = await as('owner');
        const res = await owner.api.put('/api/v2/instance/settings', { [KEY]: '127.0.0.1, not a host!' });
        expect(res.status).toBe(400);
        expect(res.body.data.errors).toEqual({ [KEY]: 'allowlist' });
    });

    it('refuses a webhook to a LAN address with no entry', async () => {
        const body = await saveWebhook(`http://127.0.0.1:${sink.port}/hook/refused`);
        expect(body.status).toBe(false);
    });

    it('saves and delivers to an address the owner allowed', async () => {
        await setAllowlist('127.0.0.0/8');
        const path = `/hook/allowed-${uniqueSuffix()}`;
        const body = await saveWebhook(`http://127.0.0.1:${sink.port}${path}`);
        expect(body.status).toBe(true);

        await createTaskInNewProject();

        const hit = await waitFor(() => received.find((r) => r.path === path));
        expect(hit).toMatchObject({ event: 'task.created' });
        const owner = await as('owner');
        const logs = await waitFor(async () => {
            const res = await owner.api.get(`/api/v2/webhooks/${body.data._id}/logs`);
            return res.body.data && res.body.data.length ? res.body.data : null;
        });
        expect(logs[0]).toMatchObject({ success: true, statusCode: 200 });
    });

    it('stops delivering once the entry is removed', async () => {
        await setAllowlist('127.0.0.1');
        const path = `/hook/removed-${uniqueSuffix()}`;
        const body = await saveWebhook(`http://127.0.0.1:${sink.port}${path}`);
        expect(body.status).toBe(true);
        await setAllowlist('');

        await createTaskInNewProject();

        const owner = await as('owner');
        const logs = await waitFor(async () => {
            const res = await owner.api.get(`/api/v2/webhooks/${body.data._id}/logs`);
            return res.body.data && res.body.data.length ? res.body.data : null;
        });
        expect(logs[0]).toMatchObject({ success: false });
        expect(logs[0].error).toMatch(/private|local|internal/i);
        expect(received.filter((r) => r.path === path)).toHaveLength(0);
    });

    it('refuses metadata, link-local, overly broad and numeric-spelling entries with their own errors', async () => {
        const owner = await as('owner');
        const cases = [
            ['169.254.169.254', 'allowlist_reserved'],
            ['127.0.0.1, 169.254.0.0/16', 'allowlist_reserved'],
            ['100.64.0.0/10', 'allowlist_reserved'],
            ['fd00:ec2::23', 'allowlist_reserved'],
            ['0.0.0.0/0', 'allowlist_broad'],
            ['10.0.0.5/0', 'allowlist_broad'],
            ['::/32', 'allowlist_broad'],
            ['0x7f000001', 'allowlist'],
        ];
        for (const [value, error] of cases) {
            const res = await owner.api.put('/api/v2/instance/settings', { [KEY]: value });
            expect([value, res.status, res.body.data.errors]).toEqual([value, 400, { [KEY]: error }]);
        }
        const after = await owner.api.get('/api/v2/instance/settings');
        expect(after.body.data.settings.find((s) => s.key === KEY).value).toBe('');
    });

    it('keeps the metadata and credential addresses blocked under an allowed range', async () => {
        await setAllowlist('127.0.0.0/8, 100.64.0.0/11');
        for (const url of ['http://169.254.169.254/latest/meta-data', 'http://169.254.170.2/v2/credentials/x', 'http://100.100.100.200/latest/meta-data/', 'http://0x7f000001:27017/']) {
            const body = await saveWebhook(url);
            expect([url, body.status]).toEqual([url, url.startsWith('http://0x7f000001') ? true : false]);
        }
    });
});
