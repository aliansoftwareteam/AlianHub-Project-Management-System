const { MongoClient } = require('mongodb');
const { resolveMongoUrl } = require('../../e2e/support/env');
const { createProject, createTask, loginAs, readState, uniqueSuffix } = require('../../e2e/support/fixtures');

/* Sprint 11 slice S1: the harness runs with SKILL_EXTERNAL_READS on (e2e/support/server.js). */

const state = readState();
const EGRESS = '/api/v2/instance/egress';
const HOST = 'api.github.com';

let client;
let lists;
let skills;
let owner;
let admin;
let task;
const keys = [];

const version = async () => ((await lists.findOne({ _id: 'workspace' })) || {}).version || 0;
const setHosts = async (hosts) => {
    const res = await owner.api.put(`${EGRESS}/${state.companyId}`, { hosts, version: await version() });
    if (res.status !== 200) throw new Error(`allowlist save failed (${res.status}): ${JSON.stringify(res.body)}`);
};

const skillBody = (key, host = HOST) => ({
    key,
    name: `[QA reads] ${key}`,
    inputs: ['pr_link'],
    gather: [{ reader: 'api', as: 'pr', params: { host, path: '/repos/acme/app/pulls/{{input.pr_link}}', maxBytes: 65536, timeoutMs: 5000, maxRedirects: 1, format: 'diff' } }],
    prompt: { template: '{{gather.pr.text}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
});

beforeAll(async () => {
    client = await MongoClient.connect(resolveMongoUrl());
    lists = client.db(state.companyId).collection('egress_allowlists');
    skills = client.db(state.companyId).collection('agent_skills');
    owner = await loginAs('owner');
    admin = await loginAs('admin');
    const project = await createProject(owner.api, { assigneeIds: [owner.uid], createdBy: owner.uid });
    task = await createTask(owner.api, { project, name: `Review https://github.com/acme/app/pull/7 ${uniqueSuffix()}`, user: state.users.owner, companyOwnerId: owner.uid });
});

afterAll(async () => {
    for (const key of keys) await admin.api.delete(`/api/v2/agents/skills/${key}`); // eslint-disable-line no-await-in-loop
    if (owner && lists) await setHosts([]).catch(() => {});
    if (lists) await lists.deleteMany({});
    if (client) await client.close();
});

describe('declared external reads in a data skill', () => {
    it('offers the url and api readers', async () => {
        const res = await admin.api.get('/api/v2/agents/skills/catalogues');
        expect(res.body.data.readers.map((r) => r.key)).toEqual(expect.arrayContaining(['url', 'api']));
    });

    it('refuses a host the workspace allowlist does not name, even when the list is empty', async () => {
        await setHosts([]);
        const key = `qa-reads-${uniqueSuffix()}`;
        const res = await admin.api.post('/api/v2/agents/skills', skillBody(key));
        expect(res.status).toBe(400);
        expect(res.body.data.errors).toEqual([expect.objectContaining({ field: 'gather[0].params.host', code: 'host_not_allowed', host: HOST })]);
        expect(await skills.findOne({ key })).toBeNull();
    });

    it('refuses a private host even when listed around the console', async () => {
        const key = `qa-reads-${uniqueSuffix()}`;
        const res = await admin.api.post('/api/v2/agents/skills', skillBody(key, '169.254.169.254'));
        expect(res.status).toBe(400);
        expect(res.body.data.errors.map((e) => e.code)).toEqual(['host_not_allowed']);
    });

    it('saves a listed host, keeps it on the row, and a run fails before anything is fetched', async () => {
        await setHosts([HOST]);
        const key = `qa-reads-${uniqueSuffix()}`;
        const created = await admin.api.post('/api/v2/agents/skills', skillBody(key));
        expect(created.status).toBe(201);
        keys.push(key);
        expect((await skills.findOne({ key })).declaredHosts).toEqual([HOST]);

        const dry = await owner.api.post(`/api/v2/agents/skills/${key}/dry-run`, { taskId: task._id });
        expect(dry.body.status).toBe(false);
        expect(dry.body.message).toContain('external_reads_not_available');
    });

    it('refuses a raw secret in the skill body', async () => {
        const key = `qa-reads-${uniqueSuffix()}`;
        const body = skillBody(key);
        body.prompt.instructions = `Authenticate with ghp_${'a1b2c3'.repeat(6)}`;
        const res = await admin.api.post('/api/v2/agents/skills', body);
        expect(res.status).toBe(400);
        expect(res.body.data.errors).toEqual([expect.objectContaining({ field: 'prompt.instructions', code: 'secret_in_body' })]);
    });
});
