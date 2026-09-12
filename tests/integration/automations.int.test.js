const fs = require('node:fs');
const path = require('node:path');
const { createApiClient } = require('../../e2e/support/api');
const { ROOT } = require('../../e2e/support/env');
const { ROLE_NAMES, createProject, createTask, firstSprint, listSprints, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

const state = readState();
const anonymous = createApiClient({ baseURL: state.baseURL });
const anonymousWithCompany = createApiClient({ baseURL: state.baseURL, companyId: state.companyId });
const OTHER_COMPANY = '0123456789abcdef01234567';
const MISSING_ID = '0123456789abcdef01234567';
const FINISHED_RUN = ['success', 'failed', 'stopped'];

const refused = (res) => res.status >= 400 || (res.body && res.body.status === false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeout = 10000, interval = 250 } = {}) {
    const deadline = Date.now() + timeout;
    let value = await check();
    while (!value && Date.now() < deadline) {
        await sleep(interval);
        value = await check();
    }
    return value;
}

const ruleFor = (projectId, overrides = {}) => ({
    name: `E2E automation ${uniqueSuffix()}`,
    trigger: { event: 'task.priority_changed' },
    scope: { allProjects: false, projectIds: [String(projectId)] },
    conditions: {},
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'E2E automation comment' } }],
    ...overrides,
});

async function privateProjectWithTask(owner) {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
    const task = await createTask(owner.api, { project, name: `E2E private task ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

async function createRule(api, rule) {
    const res = await api.post('/api/v2/automations', rule);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe(true);
    return res.body.data;
}

const removeRule = (api, id) => (id ? api.delete(`/api/v2/automations/${id}`) : null);

const finishedRuns = (api, ruleId, atLeast = 1) => waitFor(async () => {
    const res = await api.get(`/api/v2/automations/${ruleId}/runs`);
    const rows = res.body.data || [];
    return rows.length >= atLeast && rows.every((run) => FINISHED_RUN.includes(run.status)) ? rows : null;
}, { timeout: 20000 });

const commenterFor = (projectId, body) => ruleFor(projectId, {
    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
});

/* The shape the builder saves: no name, because the server composes it from the
 * rule. Everything below drops it the same way. */
const unnamed = (rule) => ({ ...rule, name: undefined });

const setPriority = (api, { project, task, user, priority }) => api.patch('/api/v2/tasks', {
    action: 'updatePriority',
    firebaseObj: { Task_Priority: priority },
    projectData: { _id: String(project._id), ProjectName: project.ProjectName, CompanyId: api.companyId },
    taskData: { _id: String(task._id), ProjectID: String(project._id), sprintId: task.sprintId },
    priorityObj: { taskId: String(task._id), taskName: task.name || '', priorityName: 'MEDIUM', newPriorityName: priority },
    userData: { Employee_Name: 'E2E', id: user.userId, companyOwnerId: user.userId },
    isUpdateTask: true,
});

const commentsSaying = async (api, { project, task, body }) => {
    const res = await api.get('/api/v1/comments/get-paginated-messages', {
        query: { projectId: String(project._id), taskId: String(task._id), isDefault: 'true', batchLimit: 100 },
    });
    return (res.body.data || []).filter((c) => c.message === body);
};

const listedRule = async (api, ruleId) => {
    const res = await api.get('/api/v2/automations');
    return (res.body.data || []).find((r) => r._id === ruleId);
};

async function projectWithTask(owner) {
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
    return { project, task };
}

async function mcpCall(pat, method, params = {}) {
    const client = createApiClient({ baseURL: state.baseURL, accessToken: pat, companyId: state.companyId });
    return client.post('/mcp', { jsonrpc: '2.0', id: 1, method, params });
}

describe('automation rules (v2)', () => {
    it('refuses a caller without a session', async () => {
        for (const client of [anonymous, anonymousWithCompany]) {
            expect((await client.get('/api/v2/automations/registry')).status).toBe(401);
            expect((await client.get('/api/v2/automations')).status).toBe(401);
            expect((await client.post('/api/v2/automations', ruleFor(state.projects.shared._id))).status).toBe(401);
        }
    });

    it('refuses a company the caller does not belong to', async () => {
        const { api } = await loginAs('owner');
        const res = await api.withCompany(OTHER_COMPANY).get('/api/v2/automations');
        expect(res.status).toBe(401);
    });

    it.each(ROLE_NAMES)('lets %s read the registry and the rule list', async (role) => {
        const { api } = await loginAs(role);
        const registry = await api.get('/api/v2/automations/registry');
        expect(registry.status).toBe(200);
        expect(registry.body.data.triggers.map((t) => t.key)).toContain('task.created');
        expect(registry.body.data.actions.map((a) => a.key)).toContain('add_comment');

        const list = await api.get('/api/v2/automations');
        expect(list.status).toBe(200);
        expect(list.body.status).toBe(true);
        expect(Array.isArray(list.body.data)).toBe(true);
    });

    it('lets the owner create a rule that starts switched off, edit it, toggle it and delete it', async () => {
        const { api } = await loginAs('owner');
        const rule = await createRule(api, ruleFor(state.projects.shared._id));
        expect(rule).toMatchObject({ enabled: false, version: 2, createdBy: state.users.owner.userId });

        const renamed = await api.put(`/api/v2/automations/${rule._id}`, { ...ruleFor(state.projects.shared._id), name: `${rule.name} renamed` });
        expect(renamed.body.data.name).toBe(`${rule.name} renamed`);

        expect((await api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true })).body.data.enabled).toBe(true);
        expect((await api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false })).body.data.enabled).toBe(false);

        const runs = await api.get(`/api/v2/automations/${rule._id}/runs`);
        expect(runs.body).toEqual({ status: true, data: [] });

        expect((await api.delete(`/api/v2/automations/${rule._id}`)).body.status).toBe(true);
        const list = await api.get('/api/v2/automations');
        expect(list.body.data.map((r) => r._id)).not.toContain(rule._id);
    });

    it('rejects an invalid rule with field-level errors', async () => {
        const { api } = await loginAs('admin');
        const res = await api.post('/api/v2/automations', { name: '', steps: [] });
        expect(res.body.status).toBe(false);
        expect(res.body.errors).toEqual(expect.arrayContaining(['name: required', 'steps: at least one action is required']));
    });

    it('compiles a sentence into a rule and back without a model', async () => {
        const { api } = await loginAs('member');
        const res = await api.post('/api/v2/automations/compile', { sentence: 'When a task priority changes, post a comment saying "hi"' });
        expect(res.body.status).toBe(true);
        expect(res.body.data.rule.trigger.event).toBe('task.priority_changed');
        expect(res.body.data.errors).toEqual([]);

        const back = await api.post('/api/v2/automations/compile', { rule: res.body.data.rule });
        expect(back.body.data.sentence).toBe(res.body.data.sentence);

        expect((await api.post('/api/v2/automations/compile', {})).body.status).toBe(false);
    });

    it('backtests a rule scoped to a project the owner can open', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
        const res = await owner.api.post('/api/v2/automations/backtest', { rule: ruleFor(project._id) });
        expect(res.body.status).toBe(true);
        expect(res.body.data).toMatchObject({ windowDays: 30, matched: 1 });
        expect(res.body.data.sample.map((t) => t.id)).toEqual([task._id]);
    });

    it('runs an enabled rule when a task is created in its project', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const rule = await createRule(owner.api, ruleFor(project._id, { trigger: { event: 'task.created' } }));
        try {
            await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true });
            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });

            const runs = await finishedRuns(owner.api, rule._id);
            expect(runs).toHaveLength(1);
            expect(runs[0]).toMatchObject({ status: 'success', entity: { kind: 'task', id: task._id } });
        } finally {
            await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false });
            await removeRule(owner.api, rule._id);
        }
    });

    it('runs every enabled rule a created task matches', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const rules = [];
        try {
            for (const body of ['E2E first rule comment', 'E2E second rule comment']) {
                const rule = await createRule(owner.api, ruleFor(project._id, {
                    trigger: { event: 'task.created' },
                    steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body } }],
                }));
                rules.push(rule);
                await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true });
            }
            const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });

            for (const rule of rules) {
                const runs = await finishedRuns(owner.api, rule._id);
                expect(runs).toHaveLength(1);
                expect(runs[0]).toMatchObject({ status: 'success', entity: { kind: 'task', id: task._id } });
            }
        } finally {
            for (const rule of rules) {
                await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false });
                await removeRule(owner.api, rule._id);
            }
        }
    });

    it('AUT-04 refuses a guest creating a rule', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const res = await guest.api.post('/api/v2/automations', ruleFor(state.projects.shared._id));
        try {
            expect(refused(res)).toBe(true);
        } finally {
            await removeRule(owner.api, res.body && res.body.data && res.body.data._id);
        }
    });

    it('AUT-04 refuses a member editing a rule someone else created', async () => {
        const owner = await loginAs('owner');
        const member = await loginAs('member');
        const rule = await createRule(owner.api, ruleFor(state.projects.shared._id));
        try {
            const res = await member.api.put(`/api/v2/automations/${rule._id}`, { ...ruleFor(state.projects.shared._id), name: 'Renamed by member' });
            const list = await owner.api.get('/api/v2/automations');
            expect(refused(res)).toBe(true);
            expect(list.body.data.find((r) => r._id === rule._id).name).toBe(rule.name);
        } finally {
            await removeRule(owner.api, rule._id);
        }
    });

    it('AUT-04 refuses a guest switching a rule on', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const rule = await createRule(owner.api, ruleFor(state.projects.shared._id));
        try {
            const res = await guest.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true });
            const list = await owner.api.get('/api/v2/automations');
            expect(refused(res)).toBe(true);
            expect(list.body.data.find((r) => r._id === rule._id).enabled).toBe(false);
        } finally {
            await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false });
            await removeRule(owner.api, rule._id);
        }
    });

    it('AUT-09 reports a missing rule instead of claiming it was updated', async () => {
        const { api } = await loginAs('owner');
        const put = await api.put(`/api/v2/automations/${MISSING_ID}`, ruleFor(state.projects.shared._id));
        const patch = await api.patch(`/api/v2/automations/${MISSING_ID}/enabled`, { enabled: true });
        expect(put.body.status).toBe(false);
        expect(patch.body.status).toBe(false);
    });

    it('AUT-10 names a saved rule after the rule it saved, action body and all', async () => {
        const { api } = await loginAs('owner');
        const body = `E2E body ${uniqueSuffix()}`;
        const rule = await createRule(api, unnamed(commenterFor(state.projects.shared._id, body)));
        try {
            expect(rule.name).toContain(body);
            expect(rule.name).toBe(rule.sentence);
            expect((await listedRule(api, rule._id)).name).toContain(body);
        } finally {
            await removeRule(api, rule._id);
        }
    });

    it('AUT-10 renames a rule when its action body is edited, rather than keeping the old sentence', async () => {
        const { api } = await loginAs('owner');
        const rule = await createRule(api, unnamed(commenterFor(state.projects.shared._id, 'E2E before')));
        try {
            const body = `E2E after ${uniqueSuffix()}`;
            const updated = await api.put(`/api/v2/automations/${rule._id}`, unnamed(commenterFor(state.projects.shared._id, body)));
            expect(updated.body.data.name).toContain(body);
            expect(updated.body.data.name).not.toContain('E2E before');
        } finally {
            await removeRule(api, rule._id);
        }
    });

    it('AUT-11 counts one run per firing and posts one comment for each run that worked', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner);
        const body = `E2E counted ${uniqueSuffix()}`;
        const commenter = await createRule(owner.api, unnamed(commenterFor(project._id, body)));
        const broken = await createRule(owner.api, unnamed(ruleFor(project._id, {
            steps: [{ id: 's1', type: 'action', action: 'set_status', config: { status: 'No such status' } }],
        })));
        try {
            for (const rule of [commenter, broken]) {
                await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true });
            }
            expect((await setPriority(owner.api, { project, task, user: state.users.owner, priority: 'HIGH' })).body.status).toBe(true);

            const [worked, failed] = [await finishedRuns(owner.api, commenter._id), await finishedRuns(owner.api, broken._id)];
            expect(worked.map((r) => r.status)).toEqual(['success']);
            expect(failed.map((r) => r.status)).toEqual(['failed']);

            const counted = await Promise.all([commenter, broken].map((r) => listedRule(owner.api, r._id)));
            expect(counted.map((r) => [r.firedCount, r.failedCount])).toEqual([[1, 0], [1, 1]]);
            // The number people actually care about: a fire that did its work left a
            // comment, and a fire that did not is the one `failedCount` names.
            expect(await commentsSaying(owner.api, { project, task, body })).toHaveLength(counted[0].firedCount - counted[0].failedCount);
            expect(counted.every((r) => r.lastRunCount === undefined)).toBe(true);
        } finally {
            for (const rule of [commenter, broken]) {
                await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false });
                await removeRule(owner.api, rule._id);
            }
        }
    });

    it('AUT-11 fires once for every priority change, including ones inside the same debounce window', async () => {
        const owner = await loginAs('owner');
        const { project, task } = await projectWithTask(owner);
        const body = `E2E every change ${uniqueSuffix()}`;
        const rule = await createRule(owner.api, unnamed(commenterFor(project._id, body)));
        const priorities = ['HIGH', 'LOW', 'MEDIUM'];
        try {
            await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: true });
            for (const priority of priorities) {
                await setPriority(owner.api, { project, task, user: state.users.owner, priority });
            }

            const runs = await finishedRuns(owner.api, rule._id, priorities.length);
            expect(runs.map((r) => r.status)).toEqual(priorities.map(() => 'success'));
            expect(runs.map((r) => r.envelope.data.Task_Priority).sort()).toEqual([...priorities].sort());
            expect(await commentsSaying(owner.api, { project, task, body })).toHaveLength(priorities.length);
            expect((await listedRule(owner.api, rule._id)).firedCount).toBe(priorities.length);
        } finally {
            await owner.api.patch(`/api/v2/automations/${rule._id}/enabled`, { enabled: false });
            await removeRule(owner.api, rule._id);
        }
    });

    it('AUT-03 keeps private-project tasks out of a guest backtest', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const { project, task } = await privateProjectWithTask(owner);
        const res = await guest.api.post('/api/v2/automations/backtest', { rule: ruleFor(project._id) });
        expect(res.body.data.matched).toBe(0);
        expect(res.body.data.sample.map((t) => t.id)).not.toContain(task._id);
    });
});

describe('automation rules (v1)', () => {
    it.each(ROLE_NAMES)('lets %s list rules', async (role) => {
        const { api } = await loginAs(role);
        const res = await api.get('/api/v1/automations');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe(true);
    });

    it('lets the owner create, update and remove a v1 rule', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const created = await owner.api.post('/api/v1/automations', { name: `E2E v1 ${uniqueSuffix()}`, conditions: { projectId: project._id }, actions: [{ type: 'set_priority', value: 'HIGH' }] });
        expect(created.body.status).toBe(true);
        const id = created.body.data._id;

        const updated = await owner.api.put(`/api/v1/automations/${id}`, { enabled: false });
        expect(updated.body.data.enabled).toBe(false);
        expect((await owner.api.put(`/api/v1/automations/${id}`, {})).body.statusText).toBe('Nothing to update.');
        expect((await owner.api.post('/api/v1/automations', { name: 'x', actions: [] })).body.status).toBe(false);
        expect((await owner.api.delete(`/api/v1/automations/${id}`)).body.status).toBe(true);
        expect((await owner.api.post(`/api/v1/automations/${id}/apply`, {})).body.statusText).toBe('Not found.');
    });

    it('previews and applies a v1 rule to the owner project', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project, user: state.users.owner, companyOwnerId: owner.uid });
        const created = await owner.api.post('/api/v1/automations', { name: `E2E v1 ${uniqueSuffix()}`, conditions: { projectId: project._id }, actions: [{ type: 'set_priority', value: 'HIGH' }] });
        const id = created.body.data._id;
        try {
            const applied = await owner.api.post(`/api/v1/automations/${id}/apply`, {});
            expect(applied.body).toMatchObject({ status: true, data: { modified: 1 } });
            const preview = await owner.api.post('/api/v1/automations/preview', { conditions: { projectId: project._id } });
            expect(preview.body.data.sample).toEqual([expect.objectContaining({ id: task._id, priority: 'HIGH' })]);
        } finally {
            await owner.api.delete(`/api/v1/automations/${id}`);
        }
    });

    it('AUT-11 keeps event-driven rules out of the bulk-apply list and refuses to apply one', async () => {
        const { api } = await loginAs('owner');
        const rule = await createRule(api, unnamed(commenterFor(state.projects.shared._id, 'E2E v1 leak')));
        try {
            expect((await api.get('/api/v1/automations')).body.data.map((r) => r._id)).not.toContain(rule._id);
            const applied = await api.post(`/api/v1/automations/${rule._id}/apply`, {});
            expect(refused(applied)).toBe(true);
        } finally {
            await removeRule(api, rule._id);
        }
    });

    it('AUT-05 saves a new v1 rule switched off', async () => {
        const { api } = await loginAs('owner');
        const created = await api.post('/api/v1/automations', { name: `E2E v1 ${uniqueSuffix()}`, actions: [{ type: 'set_priority', value: 'LOW' }] });
        try {
            expect(created.body.data.enabled).toBe(false);
        } finally {
            await api.delete(`/api/v1/automations/${created.body.data._id}`);
        }
    });

    it('AUT-05 refuses a guest bulk-changing priorities in a private project', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const { project, task } = await privateProjectWithTask(owner);
        const created = await guest.api.post('/api/v1/automations', { name: `E2E guest v1 ${uniqueSuffix()}`, conditions: { projectId: project._id }, actions: [{ type: 'set_priority', value: 'HIGH' }] });
        const id = created.body && created.body.data && created.body.data._id;
        try {
            const applied = id ? await guest.api.post(`/api/v1/automations/${id}/apply`, {}) : created;
            const preview = await owner.api.post('/api/v1/automations/preview', { conditions: { projectId: project._id } });
            expect(refused(applied)).toBe(true);
            expect(preview.body.data.sample.find((t) => t.id === task._id).priority).toBe('MEDIUM');
        } finally {
            if (id) await owner.api.delete(`/api/v1/automations/${id}`);
        }
    });

    it('AUT-03 keeps private-project tasks out of a guest v1 preview', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const { project, task } = await privateProjectWithTask(owner);
        const res = await guest.api.post('/api/v1/automations/preview', { conditions: { projectId: project._id } });
        expect(res.body.data.count).toBe(0);
        expect(res.body.data.sample.map((t) => t.id)).not.toContain(task._id);
    });
});

describe('AI features', () => {
    it('refuses the session-protected AI routes without a session', async () => {
        for (const [method, url] of [
            ['post', '/api/v1/ai/task-summary'], ['post', '/api/v1/ai/task-category'], ['get', '/api/v1/ai/ask/sources'],
            ['post', '/api/v1/ai/ask'], ['post', '/api/v1/ai/meeting-notes'], ['post', '/api/v1/ai/transcribe'],
        ]) {
            const res = method === 'get' ? await anonymousWithCompany.get(url) : await anonymousWithCompany.post(url, {});
            expect([url, res.status]).toEqual([url, 401]);
        }
    });

    it.each(ROLE_NAMES)('answers Ask sources for %s without a model', async (role) => {
        const { api } = await loginAs(role);
        const res = await api.get('/api/v1/ai/ask/sources');
        expect(res.body.status).toBe(true);
        expect(res.body.data.configured).toBe(false);
        expect(res.body.data.projects.map((p) => p.id)).toContain(state.projects.shared._id);
    });

    it('leaves a private project out of what Ask searches for a guest', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const { project, task } = await privateProjectWithTask(owner);

        const sources = await guest.api.get('/api/v1/ai/ask/sources');
        expect(sources.body.data.projects.map((p) => p.id)).not.toContain(project._id);

        const asked = await guest.api.post('/api/v1/ai/ask', { question: 'E2E private task', projectId: project._id });
        expect(asked.body.status).toBe(true);
        expect(asked.body.data.sources.map((s) => s.id)).not.toContain(task._id);

        const ownerAsked = await owner.api.post('/api/v1/ai/ask', { question: 'E2E private task', projectId: project._id });
        expect(ownerAsked.body.data.sources.map((s) => s.id)).toContain(task._id);
    });

    it('validates the inputs of the other AI routes', async () => {
        const { api } = await loginAs('member');
        expect((await api.post('/api/v1/ai/ask', { question: ' ' })).body.statusText).toBe('Ask a question first.');
        expect((await api.post('/api/v1/ai/meeting-notes', { transcript: '' })).body.statusText).toBe('Nothing to summarise.');
        expect((await api.post('/api/v1/ai/task-summary', { taskId: 'nope' })).body.statusText).toBe('taskId is required');
        expect((await api.post('/api/v1/ai/task-category', { taskId: 'nope' })).body.statusText).toBe('taskId is required');
        const transcribe = await api.post('/api/v1/ai/transcribe', {});
        expect(transcribe.status).toBe(503);
    });

    it('AUT-02 refuses anonymous callers on the AI-Assist and description routes', async () => {
        const probes = [
            ['/api/v1/ai/description', { title: 'E2E' }],
            ['/api/v1/generatePrompt', { prompt: '' }],
            ['/api/v1/generatePromptChat', { isRegenerate: true, uniqueUserId: `e2e-${uniqueSuffix()}` }],
            ['/api/v1/deleteUserChat', { userId: `e2e-${uniqueSuffix()}` }],
            ['/api/v1/getPrompts', {}],
            ['/api/v1/getAiModels', {}],
        ];
        for (const [url, body] of probes) {
            const res = await anonymousWithCompany.post(url, body);
            expect([url, res.status]).toEqual([url, 401]);
        }
    });

    // The handler rewrites <repo>/.env, so the probe only runs where no .env exists (CI, a fresh worktree).
    (fs.existsSync(path.join(ROOT, '.env')) ? it.skip : it)('AUT-01 refuses an anonymous AI model update', async () => {
        const res = await anonymous.post('/api/v1/updateAiModel', { key: 'E2E_PROBE', value: 'x' });
        expect(res.status).toBe(401);
    });
});

describe('AI project generator', () => {
    it.each(ROLE_NAMES)('tells %s that no provider is configured before any model work', async (role) => {
        const { api } = await loginAs(role);
        const description = 'An internal tool for tracking E2E test runs across teams';
        for (const url of ['/api/v1/ai/project/plan', '/api/v1/ai/project/clarify', '/api/v1/ai/project/brief', '/api/v1/ai/project/upload-brief', `/api/v1/ai/project/${state.projects.shared._id}/tasks/plan`]) {
            const res = await api.post(url, { description });
            expect([url, res.status, res.body.status]).toEqual([url, 503, false]);
        }
    });

    it('validates a plan before executing anything', async () => {
        const { api } = await loginAs('member');
        expect((await api.post('/api/v1/ai/project/guide', { approvedBrief: 'short' })).status).toBe(400);
        expect((await api.post('/api/v1/ai/project/execute', {})).body.statusText).toBe('plan required in request body');
        expect((await api.post('/api/v1/ai/project/execute', { plan: { project: {} } })).status).toBe(400);
        expect((await api.post('/api/v1/ai/project/not-an-id/tasks/execute', { plan: {} })).status).toBe(400);
        const tasksMode = await api.post(`/api/v1/ai/project/${state.projects.shared._id}/tasks/execute`, { mode: 'tasks', plan: {} });
        expect(tasksMode.body.statusText).toBe('targetSprintId required for tasks mode');
    });

    it('refuses the generator without a session and ignores a body company the caller is not in', async () => {
        expect((await anonymousWithCompany.post('/api/v1/ai/project/execute', {})).status).toBe(401);
        const { api } = await loginAs('owner');
        const res = await api.post('/api/v1/ai/project/execute', { companyId: OTHER_COMPANY, plan: { project: {} } });
        expect(res.status).toBe(400);
    });

    it('adds sprints to a project the owner can open', async () => {
        const owner = await loginAs('owner');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        await firstSprint(owner.api, project._id);
        const before = (await listSprints(owner.api, project._id)).length;
        const res = await owner.api.post(`/api/v1/ai/project/${project._id}/tasks/execute`, { mode: 'sprints', plan: { sprints: [{ sprintName: 'E2E sprint' }] } });
        expect(res.body).toMatchObject({ status: true, jobId: expect.any(String) });
        const after = await waitFor(async () => {
            const count = (await listSprints(owner.api, project._id)).length;
            return count > before ? count : null;
        });
        expect(after).toBe(before + 1);
    });

    it('AUT-07 refuses a guest adding sprints to a private project they cannot open', async () => {
        const owner = await loginAs('owner');
        const guest = await loginAs('guest');
        const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid, isPrivate: true });
        await firstSprint(owner.api, project._id);
        const before = (await listSprints(owner.api, project._id)).length;
        const res = await guest.api.post(`/api/v1/ai/project/${project._id}/tasks/execute`, { mode: 'sprints', plan: { sprints: [{ sprintName: 'E2E injected' }] } });
        const after = await waitFor(async () => {
            const count = (await listSprints(owner.api, project._id)).length;
            return count > before ? count : null;
        }, { timeout: 4000 });
        expect(refused(res)).toBe(true);
        expect(after).toBeNull();
    });

    it('streams job progress without a session, by design', async () => {
        const controller = new AbortController();
        const res = await fetch(`${state.baseURL}/api/v1/ai-progress/${uniqueSuffix()}${uniqueSuffix()}${uniqueSuffix()}${uniqueSuffix()}`, { signal: controller.signal });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/event-stream');
        controller.abort();
    });
});

describe('MCP', () => {
    it('publishes the manifest without a session', async () => {
        const res = await anonymous.get('/mcp/manifest');
        expect(res.status).toBe(200);
        expect(res.body.data.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['tasks.next', 'task.get', 'task.comment']));
        expect(res.body.data.never).toEqual(expect.arrayContaining(['task.delete']));
    });

    it('refuses a call without a token, or with a web session token', async () => {
        const member = await loginAs('member');
        expect((await anonymousWithCompany.post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
        expect((await mcpCall(member.accessToken, 'tools/list')).status).toBe(401);
    });

    it('lets a member mint a token, list tools and revoke it', async () => {
        const member = await loginAs('member');
        const minted = await member.api.post('/api/v2/api-tokens/mcp', { name: `E2E MCP ${uniqueSuffix()}`, mode: 'personal', projectIds: [state.projects.shared._id], expiresInDays: 1 });
        expect(minted.body.status).toBe(true);
        const { token, _id: tokenId } = minted.body.data;
        try {
            const init = await mcpCall(token, 'initialize', { protocolVersion: '2025-06-18' });
            expect(init.body.result.serverInfo.name).toBe('alianhub');
            const tools = await mcpCall(token, 'tools/list');
            expect(tools.body.result.tools.length).toBeGreaterThan(5);
            expect((await mcpCall(token, 'nope/nope')).body.error.code).toBe(-32601);
            const mintWithPat = await createApiClient({ baseURL: state.baseURL, accessToken: token, companyId: state.companyId }).post('/api/v2/api-tokens/mcp', { name: 'x' });
            expect(mintWithPat.status).toBe(403);
        } finally {
            expect((await member.api.delete(`/api/v2/api-tokens/${tokenId}`)).body.status).toBe(true);
        }
        expect((await mcpCall(token, 'tools/list')).status).toBe(401);
    });

    it('AUT-08 keeps task.get inside the projects a token is scoped to', async () => {
        const owner = await loginAs('owner');
        const inScope = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const outOfScope = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
        const task = await createTask(owner.api, { project: outOfScope, user: state.users.owner, companyOwnerId: owner.uid });
        const minted = await owner.api.post('/api/v2/api-tokens/mcp', { name: `E2E MCP scope ${uniqueSuffix()}`, mode: 'personal', projectIds: [inScope._id], expiresInDays: 1 });
        const { token, _id: tokenId } = minted.body.data;
        try {
            const res = await mcpCall(token, 'tools/call', { name: 'task.get', arguments: { taskId: task._id } });
            const payload = JSON.parse(res.body.result.content[0].text);
            expect(payload.taskId).toBeUndefined();
        } finally {
            await owner.api.delete(`/api/v2/api-tokens/${tokenId}`);
        }
    });
});
