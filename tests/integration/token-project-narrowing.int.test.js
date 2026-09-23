const { createApiClient } = require('../../e2e/support/api');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* A token narrowed to some projects reads inside them on every REST route it may call, as the MCP
 * tools already hold it, and nothing filed under no project. Routes that cannot hold it to the list
 * refuse it. A token with an empty list, and a browser session, keep what the person may open. */

const state = readState();

jest.setTimeout(120000);

const A = state.projects.shared._id;
let B;
let taskA;
let taskB;
let taskBKey;
let owner;
let member;
let clients;

const withRetry = async (fn) => {
    let last;
    for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            last = error;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
    }
    throw last;
};

const mintAgentToken = async (session, projectIds) => {
    const res = await session.api.post('/api/v2/api-tokens/mcp', {
        name: `[QA tokp] ${uniqueSuffix()}`, mode: 'personal', expiresInDays: 7, ...(projectIds ? { projectIds } : {}),
    });
    expect(res.body.status).toBe(true);
    return createApiClient({ baseURL: state.baseURL, accessToken: res.body.data.token, companyId: state.companyId });
};

const idsOf = (rows) => (rows || []).map((row) => String(row._id));
const projectsOf = (rows) => [...new Set((rows || []).map((row) => String(row.ProjectID)))];
const refused = (res) => [403, 404].includes(res.status);
const attachmentKey = (projectId, taskId) => `Project/${projectId}/Sprint/${taskId}/Attachment/tokp-notes.txt`;

beforeAll(async () => {
    owner = await loginAs('owner');
    member = await loginAs('member');
    const everyone = Object.values(state.users).map((user) => user.userId);
    const project = await createProject(owner.api, { name: `E2E TokP B ${uniqueSuffix()}`, assigneeIds: everyone, createdBy: owner.userId });
    B = String(project._id);
    taskB = (await withRetry(() => createTask(owner.api, { project, name: 'TokP task in B', user: state.users.owner, companyOwnerId: owner.userId })))._id;
    taskA = state.tasks[0]._id;
    const stored = await owner.api.get(`/api/v1/task/${taskB}`);
    taskBKey = stored.body.TaskKey;

    clients = {
        ownerNarrowed: await mintAgentToken(owner, [A]),
        ownerFull: await mintAgentToken(owner),
        memberNarrowed: await mintAgentToken(member, [A]),
        memberFull: await mintAgentToken(member),
    };
});

describe('a task read by id', () => {
    it('answers inside the list and not outside it', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            expect((await client.get(`/api/v1/task/${taskA}`)).status).toBe(200);
            expect((await client.get(`/api/v1/task/${taskB}`)).status).toBe(404);
        }
    });

    it('is unchanged for a token with an empty list and for a session', async () => {
        for (const client of [clients.ownerFull, clients.memberFull, owner.api, member.api]) {
            const res = await client.get(`/api/v1/task/${taskB}`);
            expect(res.status).toBe(200);
            expect(String(res.body._id)).toBe(String(taskB));
        }
    });
});

describe('task search', () => {
    const find = (client) => client.post('/api/v1/task/find', { findQuery: [{ $match: { deletedStatusKey: { $ne: 1 } } }, { $limit: 1000 }] });

    it('returns tasks from the listed projects only', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            const res = await find(client);
            expect(res.status).toBe(200);
            expect(idsOf(res.body)).toContain(String(taskA));
            expect(projectsOf(res.body)).toEqual([A]);
        }
    });

    it('is unchanged for a token with an empty list and for a session', async () => {
        for (const client of [clients.ownerFull, clients.memberFull, owner.api, member.api]) {
            const res = await find(client);
            expect(idsOf(res.body)).toEqual(expect.arrayContaining([String(taskA), String(taskB)]));
        }
    });

    it('holds the token namespace to the list', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            expect((await client.get('/api/public-v1/tasks', { query: { projectId: B } })).status).toBe(404);
            expect((await client.get(`/api/public-v1/tasks/${taskBKey}`)).status).toBe(404);
            const listed = await client.get('/api/public-v1/tasks', { query: { projectId: A } });
            expect(idsOf(listed.body.data)).toContain(String(taskA));
        }
        const full = await clients.ownerFull.get(`/api/public-v1/tasks/${taskBKey}`);
        expect(String(full.body.data._id)).toBe(String(taskB));
    });
});

describe('the project list', () => {
    it('omits projects outside the list', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            const res = await client.get('/api/public-v1/projects');
            expect(idsOf(res.body.data)).toEqual([A]);
        }
        const full = await clients.ownerFull.get('/api/public-v1/projects');
        expect(idsOf(full.body.data)).toEqual(expect.arrayContaining([A, B]));
    });

    it('refuses the web app project list, which cannot hold the token to it', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            const res = await client.get('/api/v1/project');
            expect(res.status).toBe(403);
            expect(JSON.stringify(res.body)).not.toContain(B);
        }
        const full = await clients.ownerFull.get('/api/v1/project');
        expect(idsOf(full.body)).toEqual(expect.arrayContaining([A, B]));
    });

    it('reads one project only inside the list', async () => {
        expect((await clients.ownerNarrowed.get(`/api/v1/project/${A}`)).status).toBe(200);
        expect((await clients.ownerNarrowed.get(`/api/v1/project/${B}`)).status).toBe(404);
        expect((await clients.memberNarrowed.get(`/api/v1/project/${B}`)).status).toBe(404);
        expect((await clients.ownerFull.get(`/api/v1/project/${B}`)).status).toBe(200);
    });
});

describe('comments', () => {
    const page = (client, projectId, taskId) => client.get('/api/v1/comments/get-paginated-messages', { query: { projectId, taskId } });

    it('reads a listed project\'s comments and refuses the others', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            expect((await page(client, A, taskA)).status).toBe(200);
            expect(refused(await page(client, B, taskB))).toBe(true);
        }
    });

    it('is unchanged for a token with an empty list and for a session', async () => {
        for (const client of [clients.ownerFull, owner.api]) {
            expect((await page(client, B, taskB)).status).toBe(200);
        }
    });
});

describe('task attachments', () => {
    const signed = (client, key) => client.get(`/api/v1/generateSignedUrl/${state.companyId}`, { query: { filepath: key, domainUrl: state.baseURL } });

    it('signs a listed project\'s attachment and refuses the others', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            const inside = await signed(client, attachmentKey(A, taskA));
            expect(inside.status).toBe(200);
            expect(inside.body.url).toBeTruthy();
            const outside = await signed(client, attachmentKey(B, taskB));
            expect(refused(outside)).toBe(true);
            expect(outside.body.url).toBeUndefined();
        }
    });

    it('refuses a listed project\'s path that names a task outside the list', async () => {
        const res = await signed(clients.ownerNarrowed, attachmentKey(A, taskB));
        expect(refused(res)).toBe(true);
    });

    it('is unchanged for a token with an empty list and for a session', async () => {
        for (const client of [clients.ownerFull, owner.api]) {
            expect((await signed(client, attachmentKey(B, taskB))).status).toBe(200);
        }
    });
});

describe('routes that cannot hold a narrowed token to its list', () => {
    const ROUTES = [
        ['post', '/api/v2/search', { query: 'TokP' }],
        ['post', '/api/v1/timesheet', { aggregateQuery: [{ $match: {} }] }],
        ['get', '/api/v1/comments/get-searched-messages', undefined],
        ['post', '/api/v1/mongoOpration', { type: 'tasks', method: 'find', data: [{}] }],
        ['put', `/api/v1/project/${B}`, { updateObject: { ProjectName: 'renamed' } }],
    ];

    it('refuses them for a narrowed token', async () => {
        for (const client of [clients.ownerNarrowed, clients.memberNarrowed]) {
            for (const [method, url, body] of ROUTES) {
                const res = method === 'get' ? await client.get(url) : await client[method](url, body);
                expect({ url, status: res.status }).toEqual({ url, status: 403 });
                expect(JSON.stringify(res.body)).not.toContain('TokP task in B');
            }
        }
    });

    it('leaves a project outside the list unchanged', async () => {
        const stored = await owner.api.get(`/api/v1/project/${B}`);
        expect(stored.body.ProjectName).not.toBe('renamed');
    });

    it('still answers who the token is', async () => {
        const res = await clients.ownerNarrowed.get('/api/v2/api-tokens/me');
        expect(res.status).toBe(200);
    });

    it('leaves them open to a token with an empty list', async () => {
        const res = await clients.ownerFull.post('/api/v2/search', { query: 'TokP' });
        expect(res.status).toBe(200);
    });
});
